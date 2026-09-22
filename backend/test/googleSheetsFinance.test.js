// Season 2 finance Google Sheets integration — config, Mongo → Sheet write
// sync, and the accountant's DONE read-back. Google is never contacted: the
// googleapis client is replaced by a fake that records what WOULD be sent.
// Models run on the in-memory database (test/support/memoryDb.js).
//
// Run with:  npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-for-real-use";
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-key";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-secret";
// The service account is only read to build a JWT, which the fake ignores.
process.env.GOOGLE_CLIENT_EMAIL = "qa-service-account@example.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----\\n";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");

const app = require("../src/app");
const FullPaymentStatus = require("../src/models/FullPaymentStatus");
const SchoolFinanceConfig = require("../src/models/SchoolFinanceConfig");
const { parseSpreadsheetId, buildSpreadsheetUrl } = require("../src/utils/googleSheetUrl");
const { createMemoryDb, queryResult } = require("./support/memoryDb");

const SHEET_ID = "1AbCdEf123456789_ABCDEFGHIJKLMNOPQRSTUVWX";
const OTHER_SHEET_ID = "2ZyXwVu987654321_ZYXWVUTSRQPONMLKJIHG";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let db;
let sheet; // the fake spreadsheet

test.beforeEach(() => {
  db = createMemoryDb();
  sheet = createFakeSheets();
});
test.afterEach(() => {
  db.restore();
  sheet.restore();
});

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const adminHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ email: "admin@example.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" })}`
});

function client(base) {
  const json = async (res) => ({ status: res.status, body: await res.json() });
  return {
    saveConfig: (school, body) =>
      fetch(`${base}/api/admin/school-finance-config/${school._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify(body)
      }).then(json),
    getConfig: (school) =>
      fetch(`${base}/api/admin/school-finance-config/${school._id}`, { headers: adminHeaders() }).then(json),
    listConfigs: () => fetch(`${base}/api/admin/school-finance-config`, { headers: adminHeaders() }).then(json),
    syncToSheet: (school) =>
      fetch(`${base}/api/admin/school-finance-config/${school._id}/sync`, { method: "POST", headers: adminHeaders() }).then(json),
    syncFullPayment: (school) =>
      fetch(`${base}/api/admin/school-finance-config/${school._id}/sync-full-payment`, {
        method: "POST",
        headers: adminHeaders()
      }).then(json)
  };
}

// Records every read/write the services make, and serves rows for reads.
function createFakeSheets() {
  const state = { rows: [], reads: [], writes: [], failNextWith: null };
  const originalSheets = google.sheets;
  const originalJwt = google.auth.JWT;

  google.auth.JWT = function FakeJWT(options) {
    state.auth = options;
  };
  google.sheets = () => ({
    spreadsheets: {
      values: {
        get: async ({ spreadsheetId, range }) => {
          state.reads.push({ spreadsheetId, range });
          if (state.failNextWith) {
            const error = new Error(state.failNextWith);
            state.failNextWith = null;
            throw error;
          }
          return { data: { values: state.rows.map((row) => [...row]) } };
        },
        batchUpdate: async ({ spreadsheetId, requestBody }) => {
          state.writes.push({ spreadsheetId, data: requestBody.data, valueInputOption: requestBody.valueInputOption });
          return { data: {} };
        }
      }
    }
  });

  return {
    state,
    setRows: (rows) => {
      state.rows = rows;
    },
    // Every A1 range this sync wrote, e.g. "A2:H2".
    writtenRanges: () => state.writes.flatMap((write) => write.data.map((entry) => entry.range.split("!")[1])),
    rowFor: (customerId) => {
      for (const write of state.writes) {
        for (const entry of write.data) {
          if (String(entry.values[0][0]) === String(customerId)) return entry.values[0];
        }
      }
      return null;
    },
    restore: () => {
      google.sheets = originalSheets;
      google.auth.JWT = originalJwt;
    }
  };
}

// SchoolFinanceConfig + FullPaymentStatus live only in these tests.
function installFinanceStores() {
  const configs = [];
  const fullPayments = db.fullPayments;
  const restorers = [];
  const stub = (obj, method, impl) => {
    const original = obj[method];
    obj[method] = impl;
    restorers.push(() => {
      obj[method] = original;
    });
  };
  const matchesSchool = (doc, filter) => !filter.schoolId || String(doc.schoolId) === String(filter.schoolId);

  stub(SchoolFinanceConfig, "find", (filter = {}) => queryResult(configs.filter((doc) => matchesSchool(doc, filter))));
  stub(SchoolFinanceConfig, "findOne", (filter = {}) =>
    queryResult(configs.find((doc) => matchesSchool(doc, filter)) || null)
  );
  stub(SchoolFinanceConfig, "findOneAndUpdate", (filter, update) => {
    let doc = configs.find((candidate) => matchesSchool(candidate, filter));
    if (!doc) {
      doc = {
        _id: new mongoose.Types.ObjectId(),
        tabName: "Sheet1",
        enabled: true,
        ...(update.$setOnInsert || {}),
        save: async () => doc
      };
      configs.push(doc);
    }
    Object.assign(doc, update.$set || {});
    return queryResult(doc);
  });

  stub(FullPaymentStatus, "find", (filter = {}) => {
    const ids = filter.attendeeId?.$in?.map(String) || null;
    return queryResult(fullPayments.filter((doc) => !ids || ids.includes(String(doc.attendeeId))));
  });
  stub(FullPaymentStatus, "findOneAndUpdate", (filter, update) => {
    let doc = fullPayments.find((candidate) => String(candidate.attendeeId) === String(filter.attendeeId));
    if (!doc) {
      doc = { attendeeId: filter.attendeeId, ...(update.$setOnInsert || {}) };
      fullPayments.push(doc);
    }
    Object.assign(doc, update.$set || {});
    return queryResult(doc);
  });

  return {
    configs,
    addConfig: (school, overrides = {}) => {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        schoolId: school._id,
        googleSheetId: SHEET_ID,
        tabName: "Sheet1",
        enabled: true,
        save: async () => doc,
        ...overrides
      };
      configs.push(doc);
      return doc;
    },
    restore: () => {
      while (restorers.length) restorers.pop()();
    }
  };
}

let finance;
test.beforeEach(() => {
  finance = installFinanceStores();
});
test.afterEach(() => finance.restore());

// Adds an approved / pending / rejected Deposit straight into the store.
let depositClock = Date.parse("2026-09-01T10:00:00Z");
function addDeposit(attendee, { amount, status = "approved", customerConfirmationPending = false } = {}) {
  const deposit = {
    _id: new mongoose.Types.ObjectId(),
    attendeeId: attendee._id,
    amount,
    status,
    customerConfirmationPending,
    createdAt: new Date((depositClock += 1000))
  };
  db.deposits.push(deposit);
  return deposit;
}

// ---------------------------------------------------------------------------
// URL / ID normalization
// ---------------------------------------------------------------------------

test("spreadsheet id parser", async (t) => {
  await t.test("extracts the id from every real Google Sheets URL shape", () => {
    for (const input of [
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`,
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing#gid=123`,
      `https://docs.google.com/spreadsheets/u/0/d/${SHEET_ID}/edit`,
      `http://docs.google.com/spreadsheets/d/${SHEET_ID}`,
      `docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      `   https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit   `
    ]) {
      assert.equal(parseSpreadsheetId(input), SHEET_ID, input);
    }
  });

  await t.test("accepts a bare spreadsheet id", () => {
    assert.equal(parseSpreadsheetId(SHEET_ID), SHEET_ID);
    assert.equal(parseSpreadsheetId(`  ${SHEET_ID}  `), SHEET_ID);
  });

  await t.test("rejects anything else with a 422 and an admin-safe message", () => {
    for (const bad of [
      "",
      "   ",
      null,
      undefined,
      "not a link",
      "has space here",
      "short",
      `https://example.com/spreadsheets/d/${SHEET_ID}`,
      `https://docs.google.com.evil.com/spreadsheets/d/${SHEET_ID}`,
      `https://docs.google.com/document/d/${SHEET_ID}/edit`,
      `https://drive.google.com/file/d/${SHEET_ID}/view`
    ]) {
      assert.throws(
        () => parseSpreadsheetId(bad),
        (error) => error.statusCode === 422 && /Google Sheets link/.test(error.message),
        JSON.stringify(bad)
      );
    }
  });

  await t.test("builds the canonical admin link", () => {
    assert.equal(buildSpreadsheetUrl(SHEET_ID), `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
    assert.equal(buildSpreadsheetUrl(""), null);
  });
});

// ---------------------------------------------------------------------------
// Admin config
// ---------------------------------------------------------------------------

test("finance config endpoints", async (t) => {
  await t.test("a pasted full URL is stored as the canonical id (never the URL)", async () => {
    const school = db.addSchool({ name: "A", ticketPrice: 6000 });

    await withServer(async (base) => {
      const res = await client(base).saveConfig(school, {
        googleSheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`,
        tabName: "Finance",
        enabled: true
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.config.googleSheetId, SHEET_ID);
      assert.equal(res.body.config.tabName, "Finance");
      assert.equal(res.body.config.enabled, true);
    });
  });

  await t.test("a raw id is accepted, and legacy googleSheetId field still works", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });

    await withServer(async (base) => {
      const res = await client(base).saveConfig(school, { googleSheetId: SHEET_ID });
      assert.equal(res.status, 200);
      assert.equal(res.body.config.googleSheetId, SHEET_ID);
    });
  });

  await t.test("an invalid link is refused with 422 and nothing is stored", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });

    await withServer(async (base) => {
      const res = await client(base).saveConfig(school, { googleSheetUrl: "https://example.com/not-a-sheet" });
      assert.equal(res.status, 422);
      assert.match(res.body.message, /Google Sheets link/);
      assert.equal(finance.configs.length, 0);
    });
  });

  await t.test("updating keeps the config for that School and toggles enabled", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });

    await withServer(async (base) => {
      const api = client(base);
      await api.saveConfig(school, { googleSheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit` });
      const off = await api.saveConfig(school, { enabled: false });
      assert.equal(off.body.config.enabled, false);
      assert.equal(off.body.config.googleSheetId, SHEET_ID, "the sheet mapping survives a toggle");

      const on = await api.saveConfig(school, { enabled: true, tabName: "Q1" });
      assert.equal(on.body.config.enabled, true);
      assert.equal(on.body.config.tabName, "Q1");
      assert.equal(finance.configs.length, 1, "one config per School");
    });
  });

  await t.test("School A's config is isolated from School B's", async () => {
    const schoolA = db.addSchool({ name: "A", ticketPrice: 6000 });
    const schoolB = db.addSchool({ name: "B", ticketPrice: 4500 });

    await withServer(async (base) => {
      const api = client(base);
      await api.saveConfig(schoolA, { googleSheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit` });
      await api.saveConfig(schoolB, { googleSheetUrl: `https://docs.google.com/spreadsheets/d/${OTHER_SHEET_ID}/edit`, tabName: "B tab" });

      assert.equal((await api.getConfig(schoolA)).body.config.googleSheetId, SHEET_ID);
      assert.equal((await api.getConfig(schoolB)).body.config.googleSheetId, OTHER_SHEET_ID);
      assert.equal((await api.getConfig(schoolA)).body.config.tabName, "Sheet1");
    });
  });

  await t.test("every finance endpoint requires admin auth", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });

    await withServer(async (base) => {
      const calls = [
        fetch(`${base}/api/admin/school-finance-config`),
        fetch(`${base}/api/admin/school-finance-config/${school._id}`),
        fetch(`${base}/api/admin/school-finance-config/${school._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleSheetId: SHEET_ID })
        }),
        fetch(`${base}/api/admin/school-finance-config/${school._id}/sync`, { method: "POST" }),
        fetch(`${base}/api/admin/school-finance-config/${school._id}/sync-full-payment`, { method: "POST" })
      ];
      for (const res of await Promise.all(calls)) {
        assert.equal(res.status, 401);
      }
    });
  });

  await t.test("no customer endpoint exposes the sheet id or tab name", async () => {
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school);
    finance.addConfig(school, { tabName: "Secret Tab" });

    await withServer(async (base) => {
      const pair = { attendeeId: String(customer._id), phone: customer.phoneNormalized };
      for (const path of ["/api/payments/customer-summary", "/api/payments/customer-options"]) {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pair)
        });
        const raw = await res.text();
        assert.equal(res.status, 200);
        assert.ok(!raw.includes(SHEET_ID), `${path} leaked the sheet id`);
        assert.ok(!raw.toLowerCase().includes("secret tab"), `${path} leaked the tab name`);
        assert.ok(!raw.includes("googleSheet"), `${path} leaked a sheet field`);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Mongo → Sheet (write sync)
// ---------------------------------------------------------------------------

test("sync customers to sheet", async (t) => {
  await t.test("writes A:H per customer, never column I, and uses the configured sheet + tab", async () => {
    const school = db.addSchool({ name: "Mega Heliopolis", ticketPrice: 6000 });
    const customer = db.addAttendee(school, { fullName: "Marina Adel", phone: "01012345678", ticketPrice: 6000 });
    addDeposit(customer, { amount: 500 });
    finance.addConfig(school, { tabName: "Finance" });

    await withServer(async (base) => {
      const res = await client(base).syncToSheet(school);
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.syncedCount, 1);
    });

    assert.equal(sheet.state.reads[0].spreadsheetId, SHEET_ID);
    assert.equal(sheet.state.reads[0].range, "'Finance'!A:I");
    assert.ok(sheet.writtenRanges().every((range) => /^A\d+:H\d+$|^A1:I1$/.test(range)));
    assert.ok(!sheet.writtenRanges().some((range) => /^A\d+:I\d+$/.test(range) && range !== "A1:I1"));

    const row = sheet.rowFor(customer._id);
    assert.deepEqual(row, [String(customer._id), "Marina Adel", "01012345678", "Mega Heliopolis", 6000, "500", 500, "PAYMENTS ACTIVE"]);
  });

  await t.test("Approved Payments lists approved amounts only, oldest first; Approved Total sums them", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school);
    addDeposit(customer, { amount: 500 });
    addDeposit(customer, { amount: 1000 });
    addDeposit(customer, { amount: 300, status: "rejected" });
    addDeposit(customer, { amount: 2000 });
    addDeposit(customer, { amount: 750, status: "pending" });
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const row = sheet.rowFor(customer._id);
    assert.equal(row[5], "500, 1000, 2000", "no rejected or pending amounts");
    assert.equal(row[6], 3500);
    assert.equal(row[7], "UNDER REVIEW", "a pending deposit shows as under review");
    assert.ok(!JSON.stringify(sheet.state.writes).includes("cloudinary"));
  });

  await t.test("a customer with no deposits is exported with an empty summary", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school);
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const row = sheet.rowFor(customer._id);
    assert.equal(row[5], "");
    assert.equal(row[6], 0);
    assert.equal(row[7], "NO PAYMENT");
  });

  await t.test("column E is the customer's own locked ticket price, not the School's current one", async () => {
    const school = db.addSchool({ ticketPrice: 9000 });
    const locked = db.addAttendee(school, { ticketPrice: 6000, ticketPriceLocked: true });
    const unlocked = db.addAttendee(school, { ticketPrice: 9000 });
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    assert.equal(sheet.rowFor(locked._id)[4], 6000);
    assert.equal(sheet.rowFor(unlocked._id)[4], 9000);
  });

  await t.test("Payment State covers every case", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const none = db.addAttendee(school);
    const pending = db.addAttendee(school);
    const awaiting = db.addAttendee(school);
    const active = db.addAttendee(school);
    const done = db.addAttendee(school);
    addDeposit(pending, { amount: 500, status: "pending" });
    addDeposit(awaiting, { amount: 500, customerConfirmationPending: true });
    addDeposit(active, { amount: 500 });
    addDeposit(done, { amount: 6000 });
    db.fullPayments.push({ attendeeId: done._id, confirmed: true });
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    assert.equal(sheet.rowFor(none._id)[7], "NO PAYMENT");
    assert.equal(sheet.rowFor(pending._id)[7], "UNDER REVIEW");
    assert.equal(sheet.rowFor(awaiting._id)[7], "AWAITING CUSTOMER CONFIRMATION");
    assert.equal(sheet.rowFor(active._id)[7], "PAYMENTS ACTIVE");
    assert.equal(sheet.rowFor(done._id)[7], "FULL PAYMENT COMPLETE");
  });

  await t.test("only that School's customers are exported", async () => {
    const schoolA = db.addSchool({ name: "A", ticketPrice: 6000 });
    const schoolB = db.addSchool({ name: "B", ticketPrice: 4500 });
    const inA = db.addAttendee(schoolA);
    const inB = db.addAttendee(schoolB);
    const outcomer = db.addAttendee(schoolA, { attendeeType: "outcomer" });
    finance.addConfig(schoolA);

    await withServer(async (base) => {
      const res = await client(base).syncToSheet(schoolA);
      assert.equal(res.body.syncedCount, 1);
    });

    assert.ok(sheet.rowFor(inA._id));
    assert.equal(sheet.rowFor(inB._id), null);
    assert.equal(sheet.rowFor(outcomer._id), null);
  });

  await t.test("existing rows update in place (column I untouched) and new customers append", async () => {
    const school = db.addSchool({ name: "A", ticketPrice: 6000 });
    const existing = db.addAttendee(school, { fullName: "Existing" });
    const fresh = db.addAttendee(school, { fullName: "Fresh" });
    addDeposit(existing, { amount: 500 });
    finance.addConfig(school);

    // The sheet already has a header and this customer's row, with DONE in I.
    sheet.setRows([
      ["Customer ID", "Full Name", "Phone", "School", "Ticket Price", "Approved Payments", "Approved Total", "Payment State", "Full Payment"],
      [String(existing._id), "Old Name", "old", "A", 1, "", 0, "NO PAYMENT", "DONE"]
    ]);

    await withServer(async (base) => {
      const res = await client(base).syncToSheet(school);
      assert.equal(res.body.updated, 1);
      assert.equal(res.body.appended, 1);
    });

    const ranges = sheet.writtenRanges();
    assert.deepEqual(ranges, ["A2:H2", "A3:H3"], "row 2 updated in place, row 3 appended — never column I");
    assert.equal(sheet.rowFor(existing._id)[1], "Existing");
    assert.equal(sheet.rowFor(fresh._id)[1], "Fresh");
    assert.ok(!JSON.stringify(sheet.state.writes).includes("DONE"), "the sync never writes DONE");
  });

  await t.test("an empty sheet gets the header row first", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    db.addAttendee(school);
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const header = sheet.state.writes[0].data[0];
    assert.equal(header.range, "'Sheet1'!A1:I1");
    assert.deepEqual(header.values[0], [
      "Customer ID",
      "Full Name",
      "Phone",
      "School",
      "Ticket Price",
      "Approved Payments",
      "Approved Total",
      "Payment State",
      "Full Payment"
    ]);
  });

  await t.test("disabled / unconfigured / missing config are skipped without touching Google", async () => {
    const disabled = db.addSchool({ name: "Disabled", ticketPrice: 6000 });
    const noSheet = db.addSchool({ name: "No sheet", ticketPrice: 6000 });
    const unconfigured = db.addSchool({ name: "Unconfigured", ticketPrice: 6000 });
    finance.addConfig(disabled, { enabled: false });
    finance.addConfig(noSheet, { googleSheetId: "" });

    await withServer(async (base) => {
      const api = client(base);
      assert.equal((await api.syncToSheet(disabled)).body.skipped, true);
      assert.equal((await api.syncToSheet(noSheet)).body.skipped, true);
      assert.equal((await api.syncToSheet(unconfigured)).status, 404);
    });

    assert.equal(sheet.state.reads.length, 0);
    assert.equal(sheet.state.writes.length, 0);
  });

  await t.test("a Google failure is reported, not thrown, and recorded on the config", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    db.addAttendee(school);
    const config = finance.addConfig(school);
    sheet.state.failNextWith = "The caller does not have permission";

    await withServer(async (base) => {
      const res = await client(base).syncToSheet(school);
      assert.equal(res.status, 200);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /permission/);
    });
    assert.equal(config.lastSync.status, "error");
  });
});

// ---------------------------------------------------------------------------
// Sheet → Mongo (accountant's DONE)
// ---------------------------------------------------------------------------

test("sync full payment from sheet", async (t) => {
  const headerRow = ["Customer ID", "Full Name", "Phone", "School", "Ticket Price", "Approved Payments", "Approved Total", "Payment State", "Full Payment"];
  const rowFor = (attendee, fullPaymentCell) => [String(attendee._id), "N", "P", "S", 6000, "", 0, "NO PAYMENT", fullPaymentCell];

  await t.test("DONE in any casing/whitespace confirms; anything else does not", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const cases = ["DONE", "done", " Done ", "\tdone\n", "", "NOT DONE", "done!", "yes", "TRUE", "1"];
    const attendees = cases.map(() => db.addAttendee(school));
    finance.addConfig(school);
    sheet.setRows([headerRow, ...attendees.map((attendee, i) => rowFor(attendee, cases[i]))]);

    await withServer(async (base) => {
      const res = await client(base).syncFullPayment(school);
      assert.equal(res.body.success, true);
      assert.equal(res.body.confirmedCount, 4);
      assert.equal(res.body.unconfirmedCount, 6);
    });

    const confirmedFor = (attendee) =>
      db.fullPayments.find((status) => String(status.attendeeId) === String(attendee._id))?.confirmed;
    attendees.forEach((attendee, i) => {
      assert.equal(confirmedFor(attendee), i < 4, `case ${JSON.stringify(cases[i])}`);
    });
  });

  await t.test("a DONE that is later cleared flips confirmed back to false", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school);
    finance.addConfig(school);

    await withServer(async (base) => {
      const api = client(base);
      sheet.setRows([headerRow, rowFor(customer, "DONE")]);
      await api.syncFullPayment(school);
      assert.equal(db.fullPayments[0].confirmed, true);

      sheet.setRows([headerRow, rowFor(customer, "")]);
      await api.syncFullPayment(school);
      assert.equal(db.fullPayments[0].confirmed, false);
    });
  });

  await t.test("duplicate, unknown, malformed and wrong-School rows are skipped safely", async () => {
    const schoolA = db.addSchool({ name: "A", ticketPrice: 6000 });
    const schoolB = db.addSchool({ name: "B", ticketPrice: 4500 });
    const duplicated = db.addAttendee(schoolA);
    const good = db.addAttendee(schoolA);
    const inB = db.addAttendee(schoolB);
    const unknownId = new mongoose.Types.ObjectId();
    finance.addConfig(schoolA);

    sheet.setRows([
      headerRow,
      rowFor(duplicated, "DONE"),
      rowFor(duplicated, "DONE"),
      rowFor(good, "DONE"),
      rowFor(inB, "DONE"),
      [String(unknownId), "", "", "", "", "", "", "", "DONE"],
      ["not-an-object-id", "", "", "", "", "", "", "", "DONE"],
      [],
      ["", "", "", "", "", "", "", "", "DONE"]
    ]);

    await withServer(async (base) => {
      const res = await client(base).syncFullPayment(schoolA);
      assert.equal(res.body.success, true);
      assert.equal(res.body.syncedCount, 1, "only the one good row is applied");
      assert.deepEqual(res.body.duplicateCustomerIds, [String(duplicated._id)]);
      assert.equal(res.body.skippedWrongSchool.length, 1);
      assert.equal(res.body.skippedUnknown.length, 2);
    });

    const confirmedIds = db.fullPayments.filter((s) => s.confirmed).map((s) => String(s.attendeeId));
    assert.deepEqual(confirmedIds, [String(good._id)], "no duplicate, unknown or cross-School update");
    assert.equal(db.fullPayments.some((s) => String(s.attendeeId) === String(inB._id)), false);
  });

  await t.test("reads the configured tab and never writes to the sheet", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school);
    finance.addConfig(school, { tabName: "Finance" });
    sheet.setRows([headerRow, rowFor(customer, "DONE")]);

    await withServer(async (base) => {
      await client(base).syncFullPayment(school);
    });

    assert.equal(sheet.state.reads[0].range, "'Finance'!A:I");
    assert.equal(sheet.state.writes.length, 0, "read-back never writes a cell");
  });

  await t.test("full payment is never inferred from Approved Total or Ticket Price", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const overpaid = db.addAttendee(school);
    addDeposit(overpaid, { amount: 7000 });
    finance.addConfig(school);
    sheet.setRows([headerRow, rowFor(overpaid, "")]);

    await withServer(async (base) => {
      await client(base).syncFullPayment(school);
    });

    assert.equal(db.fullPayments[0].confirmed, false, "paying past the ticket price confirms nothing");
  });

  await t.test("disabled / unconfigured schools are skipped without reading Google", async () => {
    const disabled = db.addSchool({ ticketPrice: 6000 });
    finance.addConfig(disabled, { enabled: false });

    await withServer(async (base) => {
      assert.equal((await client(base).syncFullPayment(disabled)).body.skipped, true);
    });
    assert.equal(sheet.state.reads.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Immutability: neither sync direction may touch Deposits (or Attendees).
// Both syncs are reporting/mirroring jobs — the ONLY model either may write
// is FullPaymentStatus, and only the read-back direction may do so.
// ---------------------------------------------------------------------------

// Deep, stable serialization: Dates and ObjectIds become strings so two
// snapshots can be compared byte for byte.
function snapshot(value) {
  return JSON.stringify(value, (key, raw) => {
    if (raw instanceof Date) return `Date(${raw.toISOString()})`;
    if (raw && typeof raw === "object" && raw._bsontype === "ObjectId") return `ObjectId(${String(raw)})`;
    if (raw && typeof raw === "object" && raw.constructor && raw.constructor.name === "ObjectId") {
      return `ObjectId(${String(raw)})`;
    }
    return raw;
  });
}

// One attendee carrying every Deposit shape that exists, with full metadata.
function seedFullyLoadedSchool() {
  const school = db.addSchool({ name: "Immutability School", ticketPrice: 6000 });
  const customer = db.addAttendee(school, {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Immutable Customer",
    phone: "01099887766",
    ticketPrice: 6000,
    ticketPriceLocked: true,
    ticketPriceLockedAt: new Date("2026-09-01T09:00:00Z")
  });

  const proof = (id) => ({
    url: `https://res.cloudinary.example/alshayeb/${id}.jpg`,
    publicId: `alshayeb/incomer-deposit-proofs/${id}`,
    fileName: `${id}.jpg`,
    fileType: "image/jpeg",
    uploadedAt: new Date("2026-09-02T10:00:00Z")
  });

  // approved + already acknowledged (cycle released)
  db.deposits.push({
    _id: new mongoose.Types.ObjectId(),
    attendeeId: customer._id,
    amount: 500,
    status: "approved",
    paymentOptionSnapshot: { amount: 500, label: "500 EGP" },
    paymentProof: proof("approved-acked"),
    customerConfirmationPending: false,
    customerConfirmationAcknowledgedAt: new Date("2026-09-03T12:00:00Z"),
    reviewedAt: new Date("2026-09-03T11:00:00Z"),
    createdAt: new Date("2026-09-02T10:00:00Z")
  });
  // approved + awaiting the customer's OK (still owns the active cycle)
  db.deposits.push({
    _id: new mongoose.Types.ObjectId(),
    attendeeId: customer._id,
    amount: 1000,
    status: "approved",
    paymentOptionSnapshot: { amount: 1000, label: "1000 EGP" },
    paymentProof: proof("approved-awaiting"),
    customerConfirmationPending: true,
    customerConfirmationAcknowledgedAt: null,
    activeCycle: 1,
    reviewedAt: new Date("2026-09-04T11:00:00Z"),
    createdAt: new Date("2026-09-04T10:00:00Z")
  });
  // rejected, with its reason and released markers
  db.deposits.push({
    _id: new mongoose.Types.ObjectId(),
    attendeeId: customer._id,
    amount: 300,
    status: "rejected",
    paymentOptionSnapshot: { amount: 300, label: "300 EGP" },
    paymentProof: proof("rejected"),
    rejectionReason: "Screenshot did not show the transfer amount.",
    customerConfirmationPending: false,
    reviewedAt: new Date("2026-09-05T11:00:00Z"),
    createdAt: new Date("2026-09-05T10:00:00Z")
  });
  // pending, owning the active cycle
  db.deposits.push({
    _id: new mongoose.Types.ObjectId(),
    attendeeId: customer._id,
    amount: 2000,
    status: "pending",
    paymentOptionSnapshot: { amount: 2000, label: "2000 EGP" },
    paymentProof: proof("pending"),
    customerConfirmationPending: false,
    activeCycle: 1,
    createdAt: new Date("2026-09-06T10:00:00Z")
  });

  finance.addConfig(school);
  return { school, customer };
}

test("neither sync direction mutates Deposits", async (t) => {
  await t.test("Mongo → Sheet leaves Deposits, Attendees and FullPaymentStatus byte-for-byte identical", async () => {
    const { school, customer } = seedFullyLoadedSchool();
    db.fullPayments.push({ attendeeId: customer._id, confirmed: false, lastSheetValue: "" });

    const before = {
      deposits: snapshot(db.deposits),
      attendees: snapshot(db.attendees),
      fullPayments: snapshot(db.fullPayments)
    };

    await withServer(async (base) => {
      const res = await client(base).syncToSheet(school);
      assert.equal(res.body.success, true);
      assert.equal(res.body.syncedCount, 1);
    });

    assert.equal(snapshot(db.deposits), before.deposits, "a Deposit changed during the write sync");
    assert.equal(snapshot(db.attendees), before.attendees, "an Attendee changed during the write sync");
    assert.equal(snapshot(db.fullPayments), before.fullPayments, "FullPaymentStatus changed during the write sync");
  });

  await t.test("Sheet → Mongo leaves Deposits and Attendees byte-for-byte identical", async () => {
    const { school, customer } = seedFullyLoadedSchool();
    sheet.setRows([
      ["Customer ID", "Full Name", "Phone", "School", "Ticket Price", "Approved Payments", "Approved Total", "Payment State", "Full Payment"],
      [String(customer._id), "Immutable Customer", "01099887766", "Immutability School", 6000, "500, 1000", 1500, "UNDER REVIEW", "DONE"]
    ]);

    const beforeDeposits = snapshot(db.deposits);
    const beforeAttendees = snapshot(db.attendees);

    await withServer(async (base) => {
      const res = await client(base).syncFullPayment(school);
      assert.equal(res.body.success, true);
      assert.equal(res.body.confirmedCount, 1);
    });

    assert.equal(snapshot(db.deposits), beforeDeposits, "a Deposit changed during the read sync");
    assert.equal(snapshot(db.attendees), beforeAttendees, "an Attendee changed during the read sync");
    // The one model this direction may write:
    assert.equal(db.fullPayments.length, 1);
    assert.equal(db.fullPayments[0].confirmed, true);
    assert.equal(db.fullPayments[0].lastSheetValue, "DONE");
  });

  await t.test("DONE changes ONLY FullPaymentStatus, nothing else in the database", async () => {
    const { school, customer } = seedFullyLoadedSchool();
    db.fullPayments.push({ attendeeId: customer._id, confirmed: false, lastSheetValue: "" });
    const headerRow = [
      "Customer ID",
      "Full Name",
      "Phone",
      "School",
      "Ticket Price",
      "Approved Payments",
      "Approved Total",
      "Payment State",
      "Full Payment"
    ];
    sheet.setRows([headerRow, [String(customer._id), "", "", "", "", "", "", "", "DONE"]]);

    const beforeEverythingElse = {
      deposits: snapshot(db.deposits),
      attendees: snapshot(db.attendees),
      schools: snapshot(db.schools),
      paymentOptions: snapshot(db.paymentOptions)
    };

    await withServer(async (base) => {
      await client(base).syncFullPayment(school);
    });

    const status = db.fullPayments[0];
    assert.equal(status.confirmed, true);
    assert.ok(status.confirmedAt instanceof Date, "confirmedAt stamped on the false → true transition");
    assert.ok(status.lastSyncedAt instanceof Date);
    assert.equal(status.lastSheetValue, "DONE");
    assert.equal(String(status.attendeeId), String(customer._id));

    assert.equal(snapshot(db.deposits), beforeEverythingElse.deposits);
    assert.equal(snapshot(db.attendees), beforeEverythingElse.attendees);
    assert.equal(snapshot(db.schools), beforeEverythingElse.schools);
    assert.equal(snapshot(db.paymentOptions), beforeEverythingElse.paymentOptions);
  });

  await t.test("a failing write sync still leaves every Deposit untouched", async () => {
    const { school } = seedFullyLoadedSchool();
    const before = snapshot(db.deposits);
    sheet.state.failNextWith = "The caller does not have permission";

    await withServer(async (base) => {
      const res = await client(base).syncToSheet(school);
      assert.equal(res.body.success, false);
    });

    assert.equal(snapshot(db.deposits), before);
  });
});

test("write sync sends RAW values so phone numbers keep their leading zero", async () => {
  const school = db.addSchool({ name: "RAW School", ticketPrice: 6000 });
  db.addAttendee(school, { fullName: "Leading Zero", phone: "01000000001", ticketPrice: 6000 });
  finance.addConfig(school);

  await withServer(async (base) => {
    await client(base).syncToSheet(school);
  });

  // RAW: Google stores exactly what we send, so "01000000001" stays text.
  // USER_ENTERED would parse it as the number 1000000001.
  assert.equal(sheet.state.writes[0].valueInputOption, "RAW");
  const row = sheet.state.writes[0].data.find((entry) => entry.values[0][1] === "Leading Zero").values[0];
  assert.equal(row[2], "01000000001");
  assert.equal(typeof row[2], "string");
  // Money stays numeric.
  assert.equal(typeof row[4], "number");
  assert.equal(typeof row[6], "number");
});
