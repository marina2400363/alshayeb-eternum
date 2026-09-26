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
const { HEADER_ROW } = require("../src/services/googleSheetsSchoolFinanceSync");
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
    // The full A:L image this sync produced for one customer: A:H from the
    // "A{n}:H{n}" write, J:L from the matching "J{n}:L{n}" write. Column I is
    // never written, so it stays `undefined` — the assertion that it was left alone.
    imageFor: (customerId) => {
      for (const write of state.writes) {
        for (const entry of write.data) {
          const match = entry.range.split("!")[1].match(/^A(\d+):H\d+$/);
          if (match && String(entry.values[0][0]) === String(customerId)) {
            const extra = write.data.find((candidate) => candidate.range.split("!")[1] === `J${match[1]}:L${match[1]}`);
            const image = new Array(12).fill(undefined);
            entry.values[0].forEach((value, index) => (image[index] = value));
            (extra ? extra.values[0] : []).forEach((value, index) => (image[9 + index] = value));
            return image;
          }
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

// True when an A1 range like "A2:H2" / "J2:L2" spans column I (the accountant's
// Full Payment column).
function rangeCoversColumnI(range) {
  const [from, to] = range.split(":").map((part) => part.replace(/\d+/g, ""));
  return from <= "I" && "I" <= to;
}

// Adds an approved / pending / rejected Deposit straight into the store.
let depositClock = Date.parse("2026-09-01T10:00:00Z");
function addDeposit(attendee, { amount, status = "approved", customerConfirmationPending = false, proofUrl } = {}) {
  const deposit = {
    _id: new mongoose.Types.ObjectId(),
    attendeeId: attendee._id,
    amount,
    status,
    customerConfirmationPending,
    ...(proofUrl ? { paymentProof: { url: proofUrl, publicId: "never-in-the-sheet" } } : {}),
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
  await t.test("exact final A:L mapping: A:H and J:L are written, column I never is", async () => {
    const school = db.addSchool({ name: "Mega Heliopolis", ticketPrice: 6000 });
    const customer = db.addAttendee(school, {
      fullName: "Marina Adel",
      phone: "01012345678",
      ticketPrice: 6000,
      email: "marina@example.com",
      incomerPhoto: { url: "https://res.cloudinary.com/demo/image/upload/v1/alshayeb/incomer-photos/marina.jpg", publicId: "secret-public-id" }
    });
    addDeposit(customer, { amount: 500, proofUrl: "https://res.cloudinary.com/demo/image/upload/v1/alshayeb/incomer-deposit-proofs/p1.png" });
    finance.addConfig(school, { tabName: "Finance" });

    await withServer(async (base) => {
      const res = await client(base).syncToSheet(school);
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.syncedCount, 1);
    });

    assert.equal(sheet.state.reads[0].spreadsheetId, SHEET_ID);
    assert.equal(sheet.state.reads[0].range, "'Finance'!A:L");
    // Every written range is A:H, J:L, or the fresh-sheet header — none other.
    assert.ok(sheet.writtenRanges().every((range) => /^A\d+:H\d+$|^J\d+:L\d+$|^A1:L1$/.test(range)));
    // …and no range touches column I on a data row.
    assert.ok(!sheet.writtenRanges().some((range) => range !== "A1:L1" && /^[A-Z]\d+:[A-Z]\d+$/.test(range) && rangeCoversColumnI(range)));

    assert.deepEqual(sheet.imageFor(customer._id), [
      String(customer._id), // A Customer ID
      "Marina Adel", //        B Full Name
      "01012345678", //        C Phone
      "Mega Heliopolis", //    D School
      6000, //                 E Ticket Price
      "500", //                F Approved Payments
      1, //                    G Number of Payments
      500, //                  H Total Paid
      undefined, //            I Full Payment — never written by the backend
      "marina@example.com", // J Email
      "https://res.cloudinary.com/demo/image/upload/v1/alshayeb/incomer-photos/marina.jpg", // K Customer Photo Link
      "https://res.cloudinary.com/demo/image/upload/v1/alshayeb/incomer-deposit-proofs/p1.png" // L Payment Proof Links
    ]);
    assert.ok(!JSON.stringify(sheet.state.writes).includes("public-id"), "no Cloudinary public ids in the sheet");
  });

  await t.test("Approved Payments lists approved amounts only, oldest first", async () => {
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

    assert.equal(sheet.imageFor(customer._id)[5], "500, 1000, 2000", "no rejected or pending amounts");
  });

  await t.test("Number of Payments counts APPROVED Deposits only (integer); Total Paid sums APPROVED only", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const mixed = db.addAttendee(school);
    const pendingOnly = db.addAttendee(school);
    const rejectedOnly = db.addAttendee(school);
    const four = db.addAttendee(school);
    addDeposit(mixed, { amount: 500 });
    addDeposit(mixed, { amount: 1000 });
    addDeposit(mixed, { amount: 300, status: "rejected" });
    addDeposit(mixed, { amount: 2000 });
    addDeposit(mixed, { amount: 750, status: "pending" });
    addDeposit(pendingOnly, { amount: 500, status: "pending" });
    addDeposit(rejectedOnly, { amount: 500, status: "rejected" });
    for (const amount of [100, 200, 300, 400]) addDeposit(four, { amount });
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const at = (customer) => sheet.imageFor(customer._id);
    assert.equal(at(mixed)[6], 3, "3 approved of 5 deposits");
    assert.equal(at(mixed)[7], 3500, "500 + 1000 + 2000, never the pending 750 or rejected 300");
    assert.equal(at(pendingOnly)[6], 0);
    assert.equal(at(pendingOnly)[7], 0);
    assert.equal(at(rejectedOnly)[6], 0);
    assert.equal(at(rejectedOnly)[7], 0);
    assert.equal(at(four)[6], 4);
    assert.equal(at(four)[7], 1000);
    for (const customer of [mixed, pendingOnly, rejectedOnly, four]) {
      assert.ok(Number.isInteger(at(customer)[6]));
    }
  });

  await t.test("a customer with no deposits is exported with an empty summary and no proof link", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school);
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const image = sheet.imageFor(customer._id);
    assert.equal(image[5], "");
    assert.equal(image[6], 0);
    assert.equal(image[7], 0);
    assert.equal(image[11], "", "no approved deposit => no Payment Proof Links");
  });

  await t.test("J Email and K Customer Photo Link come from the attendee; both blank when absent", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const complete = db.addAttendee(school, { email: "a@example.com", incomerPhoto: { url: "https://cdn.example/a.jpg" } });
    const bare = db.addAttendee(school);
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    assert.deepEqual(sheet.imageFor(complete._id).slice(9, 11), ["a@example.com", "https://cdn.example/a.jpg"]);
    assert.deepEqual(sheet.imageFor(bare._id).slice(9, 11), ["", ""]);
  });

  await t.test("L Payment Proof Links holds ALL approved proofs, oldest first, in the same order as F — never pending or rejected", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school);
    const pendingOnly = db.addAttendee(school);
    const rejectedOnly = db.addAttendee(school);
    const single = db.addAttendee(school);
    addDeposit(customer, { amount: 500, proofUrl: "https://cdn.example/first.png" });
    addDeposit(customer, { amount: 1000, proofUrl: "https://cdn.example/second.png" });
    addDeposit(customer, { amount: 300, status: "rejected", proofUrl: "https://cdn.example/rejected.png" });
    addDeposit(customer, { amount: 750, status: "pending", proofUrl: "https://cdn.example/pending.png" });
    addDeposit(customer, { amount: 2000, proofUrl: "https://cdn.example/third.png" });
    addDeposit(pendingOnly, { amount: 500, status: "pending", proofUrl: "https://cdn.example/only-pending.png" });
    addDeposit(rejectedOnly, { amount: 500, status: "rejected", proofUrl: "https://cdn.example/only-rejected.png" });
    addDeposit(single, { amount: 800, proofUrl: "https://cdn.example/single.png" });
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const image = sheet.imageFor(customer._id);
    assert.equal(image[5], "500, 1000, 2000");
    assert.equal(
      image[11],
      "https://cdn.example/first.png, https://cdn.example/second.png, https://cdn.example/third.png",
      "every approved proof, chronological, same order as Approved Payments"
    );
    // the Nth link belongs to the Nth amount
    assert.equal(image[11].split(", ").length, image[6], "one link per approved payment (Number of Payments)");
    assert.equal(sheet.imageFor(single._id)[11], "https://cdn.example/single.png");
    assert.equal(sheet.imageFor(pendingOnly._id)[11], "", "blank when nothing is approved");
    assert.equal(sheet.imageFor(rejectedOnly._id)[11], "");
    const written = JSON.stringify(sheet.state.writes);
    assert.ok(!written.includes("rejected.png") && !written.includes("pending.png"));
    assert.ok(!written.includes("never-in-the-sheet"), "no Cloudinary public ids");
  });

  await t.test("an approved Deposit with no proof URL on file simply contributes no link", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school);
    addDeposit(customer, { amount: 500 }); // no proofUrl
    addDeposit(customer, { amount: 1000, proofUrl: "https://cdn.example/has-proof.png" });
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const image = sheet.imageFor(customer._id);
    assert.equal(image[5], "500, 1000");
    assert.equal(image[11], "https://cdn.example/has-proof.png");
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

  await t.test("the Payment State column is gone: no state text is ever written", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const pending = db.addAttendee(school);
    const awaiting = db.addAttendee(school);
    const done = db.addAttendee(school);
    addDeposit(pending, { amount: 500, status: "pending" });
    addDeposit(awaiting, { amount: 500, customerConfirmationPending: true });
    addDeposit(done, { amount: 6000 });
    db.fullPayments.push({ attendeeId: done._id, confirmed: true });
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const written = JSON.stringify(sheet.state.writes);
    for (const stateText of ["Payment State", "NO PAYMENT", "UNDER REVIEW", "AWAITING", "PAYMENTS ACTIVE", "FULL PAYMENT COMPLETE"]) {
      assert.equal(written.includes(stateText), false, `${stateText} must not be written`);
    }
    // Column H is Total Paid (a number) for every customer.
    for (const customer of [pending, awaiting, done]) {
      assert.equal(typeof sheet.imageFor(customer._id)[7], "number");
    }
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

    // The sheet already has the CURRENT header and this customer's row, with
    // DONE in I.
    sheet.setRows([
      HEADER_ROW,
      [String(existing._id), "Old Name", "old", "A", 1, "", 0, 0, "DONE", "old@example.com", "", ""]
    ]);

    await withServer(async (base) => {
      const res = await client(base).syncToSheet(school);
      assert.equal(res.body.updated, 1);
      assert.equal(res.body.appended, 1);
    });

    const ranges = sheet.writtenRanges();
    assert.deepEqual(
      ranges,
      ["A2:H2", "J2:L2", "A3:H3", "J3:L3"],
      "row 2 updated in place, row 3 appended — A:H and J:L only, never column I"
    );
    assert.equal(sheet.rowFor(existing._id)[1], "Existing");
    assert.equal(sheet.rowFor(fresh._id)[1], "Fresh");
    assert.ok(!JSON.stringify(sheet.state.writes).includes("DONE"), "the sync never writes DONE");
    assert.equal(sheet.imageFor(existing._id)[8], undefined);
  });

  await t.test("column I survives the sync: DONE, other text and blanks are never written or cleared", async () => {
    const school = db.addSchool({ name: "A", ticketPrice: 6000 });
    const done = db.addAttendee(school);
    const other = db.addAttendee(school);
    const blank = db.addAttendee(school);
    addDeposit(done, { amount: 500 });
    finance.addConfig(school);

    sheet.setRows([
      HEADER_ROW,
      [String(done._id), "n", "p", "A", 1, "", 0, 0, "DONE", "", "", ""],
      [String(other._id), "n", "p", "A", 1, "", 0, 0, "waiting for bank", "", "", ""],
      [String(blank._id), "n", "p", "A", 1, "", 0, 0]
    ]);

    await withServer(async (base) => {
      assert.equal((await client(base).syncToSheet(school)).body.success, true);
    });

    // Every existing row was rewritten (A:H and J:L) and NOT ONE write range
    // reaches column I, so the accountant's values cannot have changed.
    assert.equal(sheet.writtenRanges().length, 6);
    assert.ok(sheet.writtenRanges().every((range) => !rangeCoversColumnI(range)));
    const written = JSON.stringify(sheet.state.writes);
    assert.ok(!written.includes("DONE") && !written.includes("waiting for bank"));
    for (const customer of [done, other, blank]) assert.equal(sheet.imageFor(customer._id)[8], undefined);
  });

  await t.test("an existing sheet with the OLD layout (Payment State) gets its system headers refreshed; I1 is never touched", async () => {
    const school = db.addSchool({ name: "A", ticketPrice: 6000 });
    const existing = db.addAttendee(school);
    finance.addConfig(school);

    sheet.setRows([
      ["Customer ID", "Full Name", "Phone", "School", "Ticket Price", "Approved Payments", "Approved Total", "Payment State", "My Custom Full Payment"],
      [String(existing._id), "n", "p", "A", 1, "", 0, "NO PAYMENT", "DONE"]
    ]);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const [first, second] = sheet.state.writes[0].data;
    assert.equal(first.range, "'Sheet1'!A1:H1");
    assert.deepEqual(first.values[0], HEADER_ROW.slice(0, 8));
    assert.equal(second.range, "'Sheet1'!J1:L1");
    assert.deepEqual(second.values[0], HEADER_ROW.slice(9, 12));
    assert.ok(sheet.writtenRanges().every((range) => !rangeCoversColumnI(range)), "I1 (the accountant's header) is left alone");
  });

  await t.test("a current header is not rewritten on every sync", async () => {
    const school = db.addSchool({ name: "A", ticketPrice: 6000 });
    const existing = db.addAttendee(school);
    finance.addConfig(school);
    sheet.setRows([HEADER_ROW, [String(existing._id)]]);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    assert.ok(!sheet.writtenRanges().some((range) => /^[A-Z]1:[A-Z]1$/.test(range)));
  });

  await t.test("an empty sheet gets the header row first", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    db.addAttendee(school);
    finance.addConfig(school);

    await withServer(async (base) => {
      await client(base).syncToSheet(school);
    });

    const header = sheet.state.writes[0].data[0];
    assert.equal(header.range, "'Sheet1'!A1:L1");
    assert.deepEqual(header.values[0], [
      "Customer ID",
      "Full Name",
      "Phone",
      "School",
      "Ticket Price",
      "Approved Payments",
      "Number of Payments",
      "Total Paid",
      "Full Payment",
      "Email",
      "Customer Photo Link",
      "Payment Proof Links"
    ]);
    assert.deepEqual(header.values[0], HEADER_ROW);
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
  const headerRow = HEADER_ROW;
  // A:L — column I (index 8) is the accountant's; J:L hold email / photo / proof links.
  const rowFor = (attendee, fullPaymentCell) => [
    String(attendee._id), "N", "P", "S", 6000, "", 0, 0, fullPaymentCell, "n@example.com", "https://cdn.example/photo.jpg", "https://cdn.example/proof.png"
  ];

  await t.test("DONE is read from column I even with the J:L columns populated (they never shift it)", async () => {
    const school = db.addSchool({ ticketPrice: 6000 });
    const done = db.addAttendee(school);
    const notDone = db.addAttendee(school);
    finance.addConfig(school);
    // If the read mistakenly used J (index 9) it would see the email, never DONE.
    sheet.setRows([headerRow, rowFor(done, "DONE"), rowFor(notDone, "")]);

    await withServer(async (base) => {
      const res = await client(base).syncFullPayment(school);
      assert.equal(res.body.success, true);
      assert.equal(res.body.confirmedCount, 1);
    });

    assert.equal(sheet.state.reads[0].range, "'Sheet1'!A:I", "the read only needs A:I");
    const confirmedFor = (attendee) =>
      db.fullPayments.find((status) => String(status.attendeeId) === String(attendee._id))?.confirmed;
    assert.equal(confirmedFor(done), true);
    assert.equal(confirmedFor(notDone), false);
    assert.equal(sheet.state.writes.length, 0, "the read-back never writes the sheet");
  });

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
      HEADER_ROW,
      [String(customer._id), "Immutable Customer", "01099887766", "Immutability School", 6000, "500, 1000", 2, 1500, "DONE", "c@example.com", "", ""]
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
    sheet.setRows([HEADER_ROW, [String(customer._id), "", "", "", "", "", "", "", "DONE", "", "", ""]]);

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
