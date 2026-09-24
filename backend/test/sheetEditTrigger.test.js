// POST /api/sheets/full-payment-edit — the endpoint the Google Sheets installable
// on-edit trigger calls when the accountant edits column I.
//
// It must reuse the EXISTING Full Payment read-back (no second implementation of
// DONE parsing / FullPaymentStatus / the email), be protected by CRON_SECRET, and
// stay quiet and PII-free. The behaviour tests run against a REAL throwaway mongod
// (test/support/realMongo.js) because the once-only email and the per-School lease
// are database behaviours; Google Sheets and Resend are faked, so nothing leaves
// this process. Skipped (not failed) when no mongod binary is available; the
// authentication tests need no database and always run.

const SECRET = "test-cron-secret-0123456789-abcdefghij";
process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MODE = "off";
process.env.CRON_SECRET = SECRET;
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-key";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-secret";
process.env.GOOGLE_CLIENT_EMAIL = "qa-service-account@example.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----\\n";

const { describe, before, after, beforeEach, afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const resendPkg = require("resend");
const { google } = require("googleapis");

const app = require("../src/app");
const Attendee = require("../src/models/Attendee");
const Deposit = require("../src/models/Deposit");
const FullPaymentStatus = require("../src/models/FullPaymentStatus");
const School = require("../src/models/School");
const SchoolFinanceConfig = require("../src/models/SchoolFinanceConfig");
const financeAutoSync = require("../src/services/financeAutoSync");
const { MONGOD_SKIP_REASON, startRealMongo } = require("./support/realMongo");

const SHEET_ID = "1AbCdEf123456789_ABCDEFGHIJKLMNOPQRSTUVWX";
const OTHER_SHEET_ID = "2ZyXwVu987654321_ZYXWVUTSRQPONMLKJIHG";
const ENDPOINT = "/api/sheets/full-payment-edit";

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = async (base, body, { secret = SECRET, headers = {}, path = ENDPOINT } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { Authorization: `Bearer ${secret}` }),
      ...headers
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
};

// Fake Google Sheets: serves `rows`, records reads and writes, can fail once.
function installFakeGoogle() {
  const state = { rows: [], reads: [], writes: [], failNextWith: null };
  const originalSheets = google.sheets;
  const originalJwt = google.auth.JWT;
  google.auth.JWT = function FakeJWT() {};
  google.sheets = () => ({
    spreadsheets: {
      values: {
        get: async ({ spreadsheetId, range }) => {
          state.reads.push({ spreadsheetId, range });
          if (state.failNextWith) {
            const message = state.failNextWith;
            state.failNextWith = null;
            throw new Error(message);
          }
          return { data: { values: state.rows.map((row) => [...row]) } };
        },
        batchUpdate: async (request) => {
          state.writes.push(request);
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
    restore: () => {
      google.sheets = originalSheets;
      google.auth.JWT = originalJwt;
    }
  };
}

// Fake Resend (same approach as season2EmailLifecycle.test.js).
function installFakeResend() {
  const calls = [];
  const original = resendPkg.Resend;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "test-resend-key";
  resendPkg.Resend = class FakeResend {
    get emails() {
      return {
        send: async (payload, options) => {
          calls.push({ payload, options });
          return { data: { id: "fake-email-id" }, error: null };
        }
      };
    }
  };
  return {
    calls,
    restore: () => {
      resendPkg.Resend = original;
      if (originalKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalKey;
    }
  };
}

// Captures everything the process prints while `fn` runs.
async function captureLogs(fn) {
  const lines = [];
  const originals = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}\n${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  }
  try {
    await fn();
  } finally {
    for (const level of Object.keys(originals)) console[level] = originals[level];
  }
  return lines.join("\n");
}

const HEADER = ["Customer ID", "Full Name", "Phone", "School", "Ticket Price", "Approved Payments", "Approved Total", "Payment State", "Full Payment"];
const rowFor = (attendee, cell) => [String(attendee._id), attendee.fullName, attendee.phone, "S", 6000, "", 0, "NO PAYMENT", cell];

// ---------------------------------------------------------------------------
// Authentication — no database needed
// ---------------------------------------------------------------------------

describe("the sheet-edit endpoint is protected by CRON_SECRET", () => {
  let google_;
  beforeEach(() => {
    google_ = installFakeGoogle();
  });
  afterEach(() => {
    google_.restore();
    process.env.CRON_SECRET = SECRET;
  });

  test("a missing Authorization header is rejected and reads nothing", async () => {
    await withServer(async (base) => {
      const response = await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1" }, { secret: null });
      assert.equal(response.status, 401);
      assert.equal(google_.state.reads.length, 0);
    });
  });

  test("a wrong secret is rejected and reads nothing", async () => {
    await withServer(async (base) => {
      for (const secret of ["wrong-secret-wrong-secret-wrong", SECRET.slice(0, -1), `${SECRET}x`, ""]) {
        const response = await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1" }, { secret });
        assert.equal(response.status, 401, JSON.stringify(secret));
      }
      assert.equal(google_.state.reads.length, 0);
    });
  });

  test("the secret is accepted ONLY as a Bearer header — never in the query string or body", async () => {
    await withServer(async (base) => {
      const inQuery = await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1" }, { secret: null, path: `${ENDPOINT}?secret=${SECRET}&key=${SECRET}` });
      assert.equal(inQuery.status, 401);
      const inBody = await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1", secret: SECRET, cronSecret: SECRET }, { secret: null });
      assert.equal(inBody.status, 401);
      // A JWT-style admin token is not the cron secret either.
      const admin = await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1" }, { secret: "eyJhbGciOiJIUzI1NiJ9.e30.abc" });
      assert.equal(admin.status, 401);
    });
  });

  test("fails closed (503) when CRON_SECRET is unset or too short to be a real secret", async () => {
    await withServer(async (base) => {
      delete process.env.CRON_SECRET;
      assert.equal((await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1" }, { secret: "anything-at-all-anything" })).status, 503);
      process.env.CRON_SECRET = "short";
      assert.equal((await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1" }, { secret: "short" })).status, 503);
      assert.equal(google_.state.reads.length, 0);
    });
  });

  test("only POST is served (a GET cannot trigger a read-back)", async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}${ENDPOINT}`, { headers: { Authorization: `Bearer ${SECRET}` } });
      assert.equal(response.status, 404);
      assert.equal(google_.state.reads.length, 0);
    });
  });

  test("the secret never appears in what a rejected request logs", async () => {
    await withServer(async (base) => {
      const output = await captureLogs(async () => {
        await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1" }, { secret: `${SECRET}-tampered` });
        await post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1" }, { secret: SECRET.slice(0, 20) });
      });
      assert.equal(output.includes(SECRET), false);
      assert.equal(output.includes(SECRET.slice(0, 20)), false);
    });
  });
});

// ---------------------------------------------------------------------------
// Behaviour — real MongoDB
// ---------------------------------------------------------------------------

describe("the sheet-edit endpoint runs the existing Full Payment read-back", { skip: MONGOD_SKIP_REASON }, () => {
  let mongo;
  let sheets;
  let resend;
  let school;

  before(async () => {
    mongo = await startRealMongo();
    await mongoose.connect(mongo.uri);
  });

  after(async () => {
    await mongoose.disconnect().catch(() => {});
    if (mongo) await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([School, Attendee, Deposit, FullPaymentStatus, SchoolFinanceConfig].map((model) => model.deleteMany({})));
    sheets = installFakeGoogle();
    resend = installFakeResend();
    financeAutoSync.__testing.setLeaseWait(6, 60);
    school = await School.create({ name: "Mega Heliopolis", ticketPrice: 6000 });
    await SchoolFinanceConfig.create({ schoolId: school._id, googleSheetId: SHEET_ID, tabName: "Sheet1", enabled: true });
  });

  afterEach(() => {
    sheets.restore();
    resend.restore();
    financeAutoSync.__testing.reset();
  });

  const addCustomer = (fullName, email, phoneSuffix) =>
    Attendee.create({
      fullName,
      phone: `010000${phoneSuffix}`,
      phoneNormalized: `010000${phoneSuffix}`,
      email,
      attendeeType: "incomer",
      accessType: "INCOMER",
      schoolId: school._id,
      ticketPrice: 6000
    });
  const statusOf = (customer) => FullPaymentStatus.findOne({ attendeeId: customer._id }).lean();
  const edit = (base, overrides = {}) => post(base, { spreadsheetId: SHEET_ID, sheetName: "Sheet1", ...overrides });

  test("correct secret + DONE: FullPaymentStatus is updated and ONE Full Payment Complete email is sent", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);

    await withServer(async (base) => {
      const response = await edit(base);
      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.confirmedCount, 1);
    });

    const status = await statusOf(customer);
    assert.equal(status.confirmed, true);
    assert.ok(status.confirmedAt);
    assert.ok(status.season2EmailNotifications.completionSentAt, "completionSentAt is stamped");
    assert.equal(resend.calls.length, 1);
    assert.equal(resend.calls[0].options.idempotencyKey, `season2-full-payment-${customer._id}`);
    assert.equal(resend.calls[0].payload.to.includes("marina@example.com") || JSON.stringify(resend.calls[0].payload).includes("marina@example.com"), true);
  });

  test("it reuses the existing read-back exactly: reads A:I of the configured tab and never writes the sheet", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);
    await withServer(async (base) => {
      await edit(base);
    });
    assert.equal(sheets.state.reads.length, 1);
    assert.deepEqual(sheets.state.reads[0], { spreadsheetId: SHEET_ID, range: "'Sheet1'!A:I" });
    assert.equal(sheets.state.writes.length, 0, "the trigger path never writes into the sheet the accountant is editing");
  });

  test("the exact same DONE trigger again does NOT send the email again", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);

    await withServer(async (base) => {
      assert.equal((await edit(base)).status, 200);
      assert.equal(resend.calls.length, 1);
      assert.equal((await edit(base)).status, 200);
      assert.equal((await edit(base)).status, 200);
    });
    assert.equal(resend.calls.length, 1);
    assert.equal(await FullPaymentStatus.countDocuments({ attendeeId: customer._id }), 1);
  });

  test("DONE cleared and typed again (or edited to 'done') never resends", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");

    await withServer(async (base) => {
      sheets.setRows([HEADER, rowFor(customer, "DONE")]);
      await edit(base);
      assert.equal((await statusOf(customer)).confirmed, true);

      sheets.setRows([HEADER, rowFor(customer, "")]);
      await edit(base);
      assert.equal((await statusOf(customer)).confirmed, false);

      sheets.setRows([HEADER, rowFor(customer, " done ")]);
      await edit(base);
      assert.equal((await statusOf(customer)).confirmed, true);
    });
    assert.equal(resend.calls.length, 1, "completionSentAt keeps it to a single email");
  });

  test("anything that is not exactly DONE does nothing: no confirmation, no email", async () => {
    const cells = ["", "NOT DONE", "done!", "yes", "TRUE", "1", "DONE?"];
    const customers = [];
    for (let i = 0; i < cells.length; i += 1) {
      customers.push(await addCustomer(`Customer ${i}`, `c${i}@example.com`, `01${i}0`));
    }
    sheets.setRows([HEADER, ...customers.map((customer, i) => rowFor(customer, cells[i]))]);

    await withServer(async (base) => {
      const response = await edit(base);
      assert.equal(response.status, 200);
      assert.equal(response.body.confirmedCount, 0);
    });

    assert.equal(await FullPaymentStatus.countDocuments({ confirmed: true }), 0);
    assert.equal(resend.calls.length, 0);
  });

  test("only the DONE customer is confirmed and emailed when several rows are present", async () => {
    const done = await addCustomer("Done Person", "done@example.com", "0001");
    const notDone = await addCustomer("Not Done", "notdone@example.com", "0002");
    sheets.setRows([HEADER, rowFor(done, "DONE"), rowFor(notDone, "")]);

    await withServer(async (base) => {
      assert.equal((await edit(base)).body.confirmedCount, 1);
    });
    assert.equal((await statusOf(done)).confirmed, true);
    assert.notEqual((await statusOf(notDone))?.confirmed, true);
    assert.equal(resend.calls.length, 1);
    assert.equal(resend.calls[0].options.idempotencyKey, `season2-full-payment-${done._id}`);
  });

  test("a burst of simultaneous edits still sends exactly one email (the per-School lease serialises them)", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);

    await withServer(async (base) => {
      const responses = await Promise.all(Array.from({ length: 6 }, () => edit(base)));
      assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200, 200]);
    });
    assert.equal(resend.calls.length, 1);
    assert.equal(await FullPaymentStatus.countDocuments({ attendeeId: customer._id, confirmed: true }), 1);
    const config = await SchoolFinanceConfig.findOne({ schoolId: school._id }).lean();
    assert.equal(config.autoSync.lockedUntil, null, "the lease is released");
  });

  test("while another sync holds the School's lease it answers 503 + Retry-After, changes nothing, and leaves that lease alone", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);
    const heldUntil = new Date(Date.now() + 60 * 1000);
    await SchoolFinanceConfig.updateOne({ schoolId: school._id }, { $set: { "autoSync.lockedUntil": heldUntil } });
    financeAutoSync.__testing.setLeaseWait(2, 5);

    await withServer(async (base) => {
      const busy = await edit(base);
      assert.equal(busy.status, 503);
      assert.equal(busy.headers.get("retry-after"), "5");
      assert.equal(sheets.state.reads.length, 0);
      assert.equal(await FullPaymentStatus.countDocuments({}), 0);
      assert.equal(resend.calls.length, 0);
      const config = await SchoolFinanceConfig.findOne({ schoolId: school._id }).lean();
      assert.equal(config.autoSync.lockedUntil.getTime(), heldUntil.getTime(), "someone else's lease is not stolen or cleared");

      // Once the other sync is done, the retry (which the Apps Script makes) succeeds.
      await SchoolFinanceConfig.updateOne({ schoolId: school._id }, { $set: { "autoSync.lockedUntil": null } });
      assert.equal((await edit(base)).status, 200);
    });
    assert.equal(resend.calls.length, 1);
  });

  test("an edit on another tab is ignored: 200, no read, nothing changes", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);
    await withServer(async (base) => {
      const response = await edit(base, { sheetName: "Notes" });
      assert.equal(response.status, 200);
      assert.equal(response.body.ignored, true);
    });
    assert.equal(sheets.state.reads.length, 0);
    assert.equal(resend.calls.length, 0);
  });

  test("an unknown spreadsheet is a 404 and reads nothing", async () => {
    await withServer(async (base) => {
      const response = await edit(base, { spreadsheetId: OTHER_SHEET_ID });
      assert.equal(response.status, 404);
    });
    assert.equal(sheets.state.reads.length, 0);
  });

  test("a School whose sync is disabled is skipped (200, skipped) and nothing is read", async () => {
    await SchoolFinanceConfig.updateOne({ schoolId: school._id }, { $set: { enabled: false } });
    await withServer(async (base) => {
      const response = await edit(base);
      assert.equal(response.status, 200);
      assert.equal(response.body.skipped, true);
    });
    assert.equal(sheets.state.reads.length, 0);
  });

  test("malformed bodies are a 422 and read nothing", async () => {
    await withServer(async (base) => {
      for (const body of [{}, { spreadsheetId: SHEET_ID }, { sheetName: "Sheet1" }, { spreadsheetId: "not a sheet id!", sheetName: "Sheet1" }, { spreadsheetId: SHEET_ID, sheetName: "   " }, { spreadsheetId: SHEET_ID, sheetName: "x".repeat(101) }]) {
        assert.equal((await post(base, body)).status, 422, JSON.stringify(body));
      }
    });
    assert.equal(sheets.state.reads.length, 0);
  });

  test("a Google failure is a generic 502 (no details leaked), the lease is released, and the next edit works", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);
    sheets.state.failNextWith = "quota exceeded for project 987654321 (internal detail)";

    await withServer(async (base) => {
      const failed = await edit(base);
      assert.equal(failed.status, 502);
      assert.equal(JSON.stringify(failed.body).includes("quota"), false);
      assert.equal(JSON.stringify(failed.body).includes("987654321"), false);
      assert.equal(resend.calls.length, 0);

      assert.equal((await edit(base)).status, 200);
    });
    assert.equal(resend.calls.length, 1);
  });

  test("responses carry counts only — no customer id, name, email or sheet content", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    const stranger = new mongoose.Types.ObjectId();
    sheets.setRows([HEADER, rowFor(customer, "DONE"), [String(stranger), "Ghost", "0100", "S", 1, "", 0, "", "DONE"]]);

    await withServer(async (base) => {
      const response = await edit(base);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.body).sort(), [
        "confirmedCount",
        "duplicateCount",
        "skippedUnknownCount",
        "skippedWrongSchoolCount",
        "success",
        "syncedCount",
        "unconfirmedCount"
      ]);
      assert.equal(response.body.skippedUnknownCount, 1);
      const text = JSON.stringify(response.body);
      assert.equal(text.includes(String(customer._id)), false);
      assert.equal(text.includes(String(stranger)), false);
      assert.equal(text.includes("Marina"), false);
      assert.equal(text.includes("marina@example.com"), false);
    });
  });

  test("nothing sensitive is logged — not the secret, the spreadsheet id, or any customer detail", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);

    await withServer(async (base) => {
      const output = await captureLogs(async () => {
        await edit(base); // success
        await edit(base); // duplicate
        await edit(base, { sheetName: "Notes" }); // ignored
        await edit(base, { spreadsheetId: OTHER_SHEET_ID }); // 404
        sheets.state.failNextWith = "boom";
        await edit(base); // 502 path
      });
      for (const secret of [SECRET, SHEET_ID, "marina@example.com", "Marina Adel", String(customer._id), "0100000001"]) {
        assert.equal(output.includes(secret), false, `logged: ${secret}`);
      }
    });
  });

  test("it changes nothing but FullPaymentStatus: Deposits and Attendees are untouched", async () => {
    const customer = await addCustomer("Marina Adel", "marina@example.com", "0001");
    await Deposit.create({ attendeeId: customer._id, amount: 500, status: "approved", paymentOptionSnapshot: { amount: 500, label: "First" } });
    const snapshot = async () => JSON.stringify([await Deposit.find({}).sort({ _id: 1 }).lean(), await Attendee.find({}).sort({ _id: 1 }).lean()]);
    const before = await snapshot();
    sheets.setRows([HEADER, rowFor(customer, "DONE")]);

    await withServer(async (base) => {
      await edit(base);
    });
    assert.equal(await snapshot(), before);
  });
});
