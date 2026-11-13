// Admin-only, 100% MANUAL Full Payments management.
//
// ISOLATED: runs on a REAL throwaway mongod (test/support/realMongo.js) so
// aggregation, pagination, unique indexes and simultaneous requests are proven
// for real. Google Sheets and Resend are faked. Every customer is fictional;
// nothing here can reach a configured database, Sheet or email service.
//
// NOTE: FULL_PAYMENT_SHEET_SYNC is deliberately NOT set here, so these tests run
// against the DEFAULT behaviour (the legacy Sheet read-back is retired).
// Skipped (not failed) when no mongod binary is available; the authentication
// tests need no database and always run.

const SECRET = "test-cron-secret-0123456789-abcdefghij";
process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MODE = "off";
process.env.CRON_SECRET = SECRET;
delete process.env.FULL_PAYMENT_SHEET_SYNC;
delete process.env.ROOMS_GOOGLE_SHEET_ID;
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-key";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-secret";
process.env.GOOGLE_CLIENT_EMAIL = "qa-service-account@example.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----\\n";

const { describe, before, after, beforeEach, afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const resendPkg = require("resend");

const app = require("../src/app");
const Attendee = require("../src/models/Attendee");
const Deposit = require("../src/models/Deposit");
const FullPaymentStatus = require("../src/models/FullPaymentStatus");
const School = require("../src/models/School");
const SchoolFinanceConfig = require("../src/models/SchoolFinanceConfig");
const { syncFullPaymentFromSchoolSheet } = require("../src/services/googleSheetsFullPaymentSync");
const { createFakeSpreadsheet, installFakes } = require("./support/statefulSheets");
const { MONGOD_SKIP_REASON, startRealMongo } = require("./support/realMongo");

const BASE_PATH = "/api/admin/season2-full-payments";
const ADMIN_EMAIL = "manual-admin@example.test";
const adminHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ email: ADMIN_EMAIL, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" })}`
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

async function call(base, method, path, { headers = adminHeaders(), body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text };
}

// ---------------------------------------------------------------------------
// Authentication (no database needed)
// ---------------------------------------------------------------------------

test("every Full Payments endpoint rejects a missing or invalid admin token (401)", async () => {
  await withServer(async (base) => {
    const id = new mongoose.Types.ObjectId().toString();
    for (const [method, path] of [
      ["GET", ""],
      ["GET", `/${id}/deposits`],
      ["POST", `/${id}/done`],
      ["POST", `/${id}/revoke`]
    ]) {
      const none = await call(base, method, `${BASE_PATH}${path}`, { headers: {} });
      assert.equal(none.status, 401, `${method} ${path} without a token`);
      const bad = await call(base, method, `${BASE_PATH}${path}`, { headers: { Authorization: "Bearer nope" } });
      assert.equal(bad.status, 401, `${method} ${path} with a bad token`);
    }
    // The customer-facing CRON_SECRET is not an admin credential either.
    const cron = await call(base, "POST", `${BASE_PATH}/${id}/done`, { headers: { Authorization: `Bearer ${SECRET}` } });
    assert.equal(cron.status, 401);
  });
});

// ---------------------------------------------------------------------------
// Everything below needs the throwaway mongod
// ---------------------------------------------------------------------------

describe("manual Full Payments (real throwaway MongoDB)", { skip: MONGOD_SKIP_REASON }, () => {
  let mongo;
  let schoolA;
  let schoolB;
  let seq = 0;
  let resendCalls;
  let restoreResend;

  before(async () => {
    mongo = await startRealMongo();
    await mongoose.connect(mongo.uri);
    await Promise.all([Attendee, Deposit, FullPaymentStatus, School, SchoolFinanceConfig].map((model) => model.createIndexes()));
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([School, Attendee, Deposit, FullPaymentStatus, SchoolFinanceConfig].map((model) => model.deleteMany({})));
    [schoolA, schoolB] = await School.insertMany([
      { name: "Fictional School Alpha", ticketPrice: 6000, accessCode: "ALPHA1" },
      { name: "Fictional School Beta", ticketPrice: 4500, accessCode: "BETA22" }
    ]);
    seq = 0;

    // Fake Resend: any email sent by anything in these tests is recorded.
    resendCalls = [];
    const original = resendPkg.Resend;
    const originalKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "test-resend-key";
    resendPkg.Resend = class FakeResend {
      get emails() {
        return {
          send: async (payload) => {
            resendCalls.push(payload);
            return { data: { id: "fake" }, error: null };
          }
        };
      }
    };
    restoreResend = () => {
      resendPkg.Resend = original;
      if (originalKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalKey;
    };
  });

  afterEach(() => restoreResend());

  // --- fictional data helpers ---------------------------------------------

  const phone = () => `010${String(10000000 + (seq += 1)).slice(-8)}`;

  async function addCustomer({ name, school = schoolA, ticketPrice = 6000, type = "incomer", createdAt } = {}) {
    const number = phone();
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      fullName: name || `Fictional Customer ${seq}`,
      phone: number,
      phoneNormalized: number,
      attendeeType: type,
      schoolId: school._id,
      ticketPrice,
      createdAt: createdAt || new Date(Date.UTC(2026, 8, 1, 10, seq % 60, 0)),
      updatedAt: new Date()
    };
    await Attendee.collection.insertOne(doc);
    return doc;
  }

  async function addDeposit(customer, amount, status, { at, reviewedAt, proof = true, reason } = {}) {
    const submitted = at || new Date(Date.UTC(2026, 8, 2, 12, (seq += 1) % 60, 0));
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      attendeeId: customer._id,
      amount,
      status,
      paymentOptionSnapshot: { amount, label: null },
      createdAt: submitted,
      updatedAt: submitted
    };
    if (proof) doc.paymentProof = { url: `https://res.cloudinary.test/proof/${doc._id}.jpg`, publicId: `secret/${doc._id}` };
    if (reviewedAt) doc.reviewedAt = reviewedAt;
    if (reason) doc.rejectionReason = reason;
    await Deposit.collection.insertOne(doc);
    return doc;
  }

  const snapshotCollections = async () => ({
    attendees: JSON.stringify(await Attendee.find({}).sort({ _id: 1 }).lean()),
    deposits: JSON.stringify(await Deposit.find({}).sort({ _id: 1 }).lean()),
    schools: JSON.stringify(await School.find({}).sort({ _id: 1 }).lean())
  });

  const list = (base, query = "") => call(base, "GET", `${BASE_PATH}${query}`);
  const deposits = (base, id) => call(base, "GET", `${BASE_PATH}/${id}/deposits`);
  const markDone = (base, id) => call(base, "POST", `${BASE_PATH}/${id}/done`);
  const revoke = (base, id) => call(base, "POST", `${BASE_PATH}/${id}/revoke`);

  // --- the list ------------------------------------------------------------

  test("lists EVERY customer: zero, pending-only, rejected-only, approved, multiple and mixed deposits", async () => {
    const zero = await addCustomer({ name: "Zero Deposits" });
    const pending = await addCustomer({ name: "Pending Only" });
    const rejected = await addCustomer({ name: "Rejected Only" });
    const oneApproved = await addCustomer({ name: "One Approved" });
    const multi = await addCustomer({ name: "Multiple Approved" });
    const mixed = await addCustomer({ name: "Mixed Deposits" });

    await addDeposit(pending, 500, "pending");
    await addDeposit(rejected, 700, "rejected", { reviewedAt: new Date(), reason: "Blurry proof" });
    await addDeposit(oneApproved, 1000, "approved", { reviewedAt: new Date() });
    await addDeposit(multi, 1000, "approved", { reviewedAt: new Date() });
    await addDeposit(multi, 2000, "approved", { reviewedAt: new Date() });
    await addDeposit(mixed, 1000, "approved", { reviewedAt: new Date() });
    await addDeposit(mixed, 5000, "pending");
    await addDeposit(mixed, 3000, "rejected", { reviewedAt: new Date() });

    await withServer(async (base) => {
      const res = await list(base);
      assert.equal(res.status, 200);
      assert.equal(res.body.pagination.total, 6);
      const byName = Object.fromEntries(res.body.customers.map((c) => [c.fullName, c]));

      assert.equal(byName["Zero Deposits"].approvedTotalPaid, 0);
      assert.equal(byName["Pending Only"].approvedTotalPaid, 0);
      assert.equal(byName["Rejected Only"].approvedTotalPaid, 0);
      assert.equal(byName["One Approved"].approvedTotalPaid, 1000);
      assert.equal(byName["Multiple Approved"].approvedTotalPaid, 3000);
      // Approved deposits ONLY: the pending 5000 and rejected 3000 are not counted.
      assert.equal(byName["Mixed Deposits"].approvedTotalPaid, 1000);

      for (const customer of res.body.customers) {
        assert.equal(customer.manualStatus, "NOT_DONE");
        assert.equal(customer.customerType, "incomer");
        assert.equal(customer.schoolName, "Fictional School Alpha");
        assert.equal(customer.ticketPrice, 6000);
      }

      // No automatic payment classification is ever sent to the browser.
      assert.doesNotMatch(res.text, /partial|fully|eligible|insufficient|automatic|remaining|balance/i);
      assert.deepEqual(Object.keys(res.body.customers[0]).sort(), [
        "approvedTotalPaid", "customerType", "doneAt", "doneBy", "eventId", "eventName",
        "fullName", "id", "manualStatus", "phone", "schoolId", "schoolName", "ticketPrice"
      ]);
    });
  });

  test("each customer shows THEIR OWN ticket price, not the School's", async () => {
    await addCustomer({ name: "Locked Lower", ticketPrice: 5000 });
    await addCustomer({ name: "Current Price", ticketPrice: 6000 });
    await withServer(async (base) => {
      const res = await list(base);
      const byName = Object.fromEntries(res.body.customers.map((c) => [c.fullName, c.ticketPrice]));
      assert.deepEqual(byName, { "Locked Lower": 5000, "Current Price": 6000 });
    });
  });

  // --- deposit details -----------------------------------------------------

  test("deposit details: numbered history, statuses, dates, proof links; total counts APPROVED only", async () => {
    const customer = await addCustomer({ name: "Mixed Deposits" });
    const t = (h) => new Date(Date.UTC(2026, 8, 5, h, 0, 0));
    await addDeposit(customer, 1000, "approved", { at: t(9), reviewedAt: t(10) });
    await addDeposit(customer, 3000, "rejected", { at: t(11), reviewedAt: t(12), reason: "Wrong amount", proof: false });
    await addDeposit(customer, 5000, "pending", { at: t(13) });

    await withServer(async (base) => {
      const res = await deposits(base, customer._id);
      assert.equal(res.status, 200);
      assert.equal(res.body.customer.fullName, "Mixed Deposits");
      assert.equal(res.body.customer.schoolName, "Fictional School Alpha");
      assert.equal(res.body.summary.ticketPrice, 6000);
      assert.equal(res.body.summary.approvedTotalPaid, 1000);
      assert.equal(res.body.summary.manualStatus, "NOT_DONE");

      const [first, second, third] = res.body.deposits;
      assert.deepEqual([first.number, second.number, third.number], [1, 2, 3]);
      assert.deepEqual([first.status, second.status, third.status], ["approved", "rejected", "pending"]);
      assert.equal(first.approvedAt, t(10).toISOString());
      assert.equal(first.rejectedAt, null);
      assert.match(first.proofUrl, /^https:\/\/res\.cloudinary\.test\/proof\//);
      assert.equal(second.rejectedAt, t(12).toISOString());
      assert.equal(second.approvedAt, null);
      assert.equal(second.rejectionReason, "Wrong amount");
      assert.equal(second.proofUrl, null);
      assert.equal(third.approvedAt, null);
      assert.equal(third.rejectedAt, null);
      assert.equal(third.submittedAt, t(13).toISOString());
      // The Cloudinary publicId is never returned.
      assert.doesNotMatch(res.text, /publicId|secret\//);
    });
  });

  test("a customer with no deposits has an empty history", async () => {
    const customer = await addCustomer({ name: "Zero Deposits" });
    await withServer(async (base) => {
      const res = await deposits(base, customer._id);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.deposits, []);
      assert.equal(res.body.summary.approvedTotalPaid, 0);
    });
  });

  // --- manual DONE ---------------------------------------------------------

  test("Admin can mark DONE regardless of amounts: lower, equal, higher, none — nothing is compared", async () => {
    const lower = await addCustomer({ name: "Paid Lower", ticketPrice: 6000 });
    const equal = await addCustomer({ name: "Paid Equal", ticketPrice: 6000 });
    const higher = await addCustomer({ name: "Paid Higher", ticketPrice: 6000 });
    const none = await addCustomer({ name: "Paid Nothing", ticketPrice: 6000 });
    await addDeposit(lower, 1000, "approved", { reviewedAt: new Date() });
    await addDeposit(equal, 6000, "approved", { reviewedAt: new Date() });
    await addDeposit(higher, 9000, "approved", { reviewedAt: new Date() });

    await withServer(async (base) => {
      for (const customer of [lower, equal, higher, none]) {
        const res = await markDone(base, customer._id);
        assert.equal(res.status, 200, customer.fullName);
        assert.equal(res.body.success, true);
        assert.equal(res.body.changed, true);
        assert.equal(res.body.manualStatus, "DONE");
        assert.equal(res.body.doneBy, ADMIN_EMAIL);
        assert.ok(res.body.doneAt);
      }

      const after = await list(base);
      assert.ok(after.body.customers.every((c) => c.manualStatus === "DONE"));
      const doc = await FullPaymentStatus.findOne({ attendeeId: lower._id }).lean();
      assert.equal(doc.confirmed, true);
      assert.equal(doc.decision.source, "admin");
      assert.equal(doc.decision.by, ADMIN_EMAIL);
      assert.equal(doc.auditLog.length, 1);
      assert.equal(doc.auditLog[0].action, "marked_done");
    });
  });

  test("marking DONE changes ONLY that customer, sends no email, and never touches deposits, customers or Schools", async () => {
    const target = await addCustomer({ name: "Target" });
    const other = await addCustomer({ name: "Bystander" });
    await addDeposit(target, 1000, "approved", { reviewedAt: new Date() });
    await addDeposit(other, 2000, "pending");
    const before = await snapshotCollections();

    await withServer(async (base) => {
      await markDone(base, target._id);
      await revoke(base, target._id);
      await markDone(base, target._id);
    });

    assert.deepEqual(await snapshotCollections(), before, "deposits, customers and Schools are byte-for-byte identical");
    assert.equal(await FullPaymentStatus.countDocuments({}), 1, "only the target has a status record");
    assert.equal(await FullPaymentStatus.countDocuments({ attendeeId: other._id }), 0);
    assert.equal(resendCalls.length, 0, "no email or notification is sent by a manual decision");
    const doc = await FullPaymentStatus.findOne({ attendeeId: target._id }).lean();
    assert.equal(doc.season2EmailNotifications, undefined);
  });

  test("repeated DONE is safe: nothing changes and no second audit entry is written", async () => {
    const customer = await addCustomer();
    await withServer(async (base) => {
      const first = await markDone(base, customer._id);
      const again = await markDone(base, customer._id);
      assert.equal(first.body.changed, true);
      assert.equal(again.status, 200);
      assert.equal(again.body.changed, false);
      assert.equal(again.body.manualStatus, "DONE");
      assert.equal(again.body.doneAt, first.body.doneAt, "the original confirmation time is kept");
    });
    const doc = await FullPaymentStatus.findOne({ attendeeId: customer._id }).lean();
    assert.equal(doc.auditLog.length, 1);
  });

  test("simultaneous DONE requests for one customer: exactly one wins, one audit entry, no error", async () => {
    const customer = await addCustomer();
    await withServer(async (base) => {
      const results = await Promise.all(Array.from({ length: 12 }, () => markDone(base, customer._id)));
      assert.ok(results.every((r) => r.status === 200 && r.body.manualStatus === "DONE"));
      assert.equal(results.filter((r) => r.body.changed).length, 1);
    });
    assert.equal(await FullPaymentStatus.countDocuments({ attendeeId: customer._id }), 1);
    const doc = await FullPaymentStatus.findOne({ attendeeId: customer._id }).lean();
    assert.equal(doc.auditLog.length, 1);
  });

  test("simultaneous DONE for DIFFERENT customers never crosses over", async () => {
    const customers = [];
    for (let i = 0; i < 8; i += 1) customers.push(await addCustomer({ name: `Parallel ${i}` }));
    const doneIds = customers.filter((_, i) => i % 2 === 0).map((c) => String(c._id));
    await withServer(async (base) => {
      await Promise.all(customers.filter((_, i) => i % 2 === 0).map((c) => markDone(base, c._id)));
    });
    const stored = (await FullPaymentStatus.find({ confirmed: true }).lean()).map((d) => String(d.attendeeId)).sort();
    assert.deepEqual(stored, doneIds.sort());
  });

  test("a database failure is never reported as success and changes nothing", async () => {
    const customer = await addCustomer();
    const original = FullPaymentStatus.updateOne;
    FullPaymentStatus.updateOne = async () => {
      throw new Error("simulated database outage");
    };
    try {
      await withServer(async (base) => {
        const res = await markDone(base, customer._id);
        assert.equal(res.status, 500);
        assert.equal(res.body.success, false);
      });
    } finally {
      FullPaymentStatus.updateOne = original;
    }
    assert.equal(await FullPaymentStatus.countDocuments({}), 0);
  });

  test("bad ids are rejected; unknown customers and non-Incomers are 404 and no record is created", async () => {
    const outcomerLike = await addCustomer({ name: "Not An Incomer", type: "outcomer" });
    const guest = await addCustomer({ name: "A Guest", type: "guest" });
    await withServer(async (base) => {
      for (const id of ["not-an-id", "123", "zzzzzzzzzzzzzzzzzzzzzzzz"]) {
        assert.equal((await markDone(base, id)).status, 422, id);
        assert.equal((await revoke(base, id)).status, 422, id);
        assert.equal((await deposits(base, id)).status, 422, id);
      }
      const unknown = new mongoose.Types.ObjectId();
      assert.equal((await markDone(base, unknown)).status, 404);
      assert.equal((await markDone(base, outcomerLike._id)).status, 404);
      assert.equal((await markDone(base, guest._id)).status, 404);
      assert.equal((await deposits(base, unknown)).status, 404);
    });
    assert.equal(await FullPaymentStatus.countDocuments({}), 0);
  });

  // --- existing DONE ---------------------------------------------------------

  test("existing DONE statuses are preserved: listed as DONE, untouched by a repeat, and never reset", async () => {
    const legacy = await addCustomer({ name: "Legacy Done" });
    const legacyAt = new Date(Date.UTC(2026, 7, 20, 8, 0, 0));
    const sentAt = new Date(Date.UTC(2026, 7, 20, 8, 1, 0));
    await FullPaymentStatus.collection.insertOne({
      _id: new mongoose.Types.ObjectId(),
      attendeeId: legacy._id,
      confirmed: true,
      confirmedAt: legacyAt,
      lastSyncedAt: legacyAt,
      lastSheetValue: "DONE",
      season2EmailNotifications: { completionSentAt: sentAt },
      createdAt: legacyAt,
      updatedAt: legacyAt
    });
    const before = JSON.stringify(await FullPaymentStatus.findOne({ attendeeId: legacy._id }).lean());

    await withServer(async (base) => {
      const res = await list(base);
      assert.equal(res.body.customers[0].manualStatus, "DONE");
      assert.equal(res.body.customers[0].doneAt, legacyAt.toISOString());
      assert.equal(res.body.customers[0].doneBy, null, "an old Sheet-era DONE has no Admin author");

      const again = await markDone(base, legacy._id);
      assert.equal(again.body.changed, false);
      assert.equal(again.body.manualStatus, "DONE");
      assert.equal((await list(base, "?manual=done")).body.pagination.total, 1);
    });

    assert.equal(JSON.stringify(await FullPaymentStatus.findOne({ attendeeId: legacy._id }).lean()), before, "the record is byte-for-byte unchanged");
    assert.equal(resendCalls.length, 0);
  });

  // --- revoke ----------------------------------------------------------------

  test("revoke is individual, audited and idempotent; it works on an old DONE too, and never on someone else", async () => {
    const mine = await addCustomer({ name: "Revoke Me" });
    const keep = await addCustomer({ name: "Keep Me" });
    const never = await addCustomer({ name: "Never Done" });
    await withServer(async (base) => {
      await markDone(base, mine._id);
      await markDone(base, keep._id);

      const res = await revoke(base, mine._id);
      assert.equal(res.body.changed, true);
      assert.equal(res.body.manualStatus, "NOT_DONE");
      assert.equal(res.body.doneAt, null);

      const again = await revoke(base, mine._id);
      assert.equal(again.body.changed, false);

      const untouched = await revoke(base, never._id);
      assert.equal(untouched.body.changed, false);
      assert.equal(untouched.body.manualStatus, "NOT_DONE");

      const all = (await list(base)).body.customers;
      assert.equal(all.find((c) => c.fullName === "Keep Me").manualStatus, "DONE");
      assert.equal(all.find((c) => c.fullName === "Revoke Me").manualStatus, "NOT_DONE");
    });
    const doc = await FullPaymentStatus.findOne({ attendeeId: mine._id }).lean();
    assert.deepEqual(doc.auditLog.map((entry) => entry.action), ["marked_done", "revoked_done"]);
    assert.ok(doc.auditLog.every((entry) => entry.by === ADMIN_EMAIL && entry.at));
    assert.equal(await FullPaymentStatus.countDocuments({ attendeeId: never._id }), 0);
  });

  // --- search, filters, pagination -----------------------------------------

  test("search by name, phone and Customer ID (full and partial); filters combine", async () => {
    const ann = await addCustomer({ name: "Ann Fictional", school: schoolA });
    const bob = await addCustomer({ name: "Bob Fictional", school: schoolB });
    const cat = await addCustomer({ name: "Cat Imaginary", school: schoolB });
    await FullPaymentStatus.collection.insertMany([
      { _id: new mongoose.Types.ObjectId(), attendeeId: ann._id, confirmed: true, confirmedAt: new Date() },
      { _id: new mongoose.Types.ObjectId(), attendeeId: bob._id, confirmed: false }
    ]);

    await withServer(async (base) => {
      const names = (res) => res.body.customers.map((c) => c.fullName).sort();

      assert.deepEqual(names(await list(base, "?q=fictional")), ["Ann Fictional", "Bob Fictional"]);
      assert.deepEqual(names(await list(base, "?q=IMAGINARY")), ["Cat Imaginary"]);
      assert.deepEqual(names(await list(base, `?q=${bob.phone}`)), ["Bob Fictional"]);
      assert.deepEqual(names(await list(base, `?q=${encodeURIComponent("+2" + cat.phone)}`)), ["Cat Imaginary"]);
      assert.deepEqual(names(await list(base, `?q=${ann._id}`)), ["Ann Fictional"]);
      // A leading part of an id is a prefix match (ids created together share a long prefix), so it finds the customer among its neighbours.
      assert.ok(names(await list(base, `?q=${String(cat._id).slice(0, 12)}`)).includes("Cat Imaginary"));
      assert.equal((await list(base, `?q=${"f".repeat(24)}`)).body.pagination.total, 0);
      assert.equal((await list(base, "?q=nobody-at-all")).body.pagination.total, 0);

      assert.deepEqual(names(await list(base, `?schoolId=${schoolB._id}`)), ["Bob Fictional", "Cat Imaginary"]);
      assert.deepEqual(names(await list(base, "?manual=done")), ["Ann Fictional"]);
      assert.deepEqual(names(await list(base, "?manual=not_done")), ["Bob Fictional", "Cat Imaginary"], "a confirmed:false record counts as NOT DONE");
      assert.deepEqual(names(await list(base, `?schoolId=${schoolB._id}&manual=not_done&q=fictional`)), ["Bob Fictional"]);
      assert.deepEqual(names(await list(base, `?schoolId=${schoolA._id}&manual=not_done`)), []);
      assert.equal((await list(base, `?customerType=incomer&schoolId=${schoolB._id}&manual=done`)).body.pagination.total, 0);
    });
  });

  test("Outcomers are only prepared for: never listed or invented; Event filter and type filter return nothing yet", async () => {
    await addCustomer({ name: "Real Incomer" });
    await addCustomer({ name: "Legacy Outcomer Shaped Record", type: "outcomer" });
    await withServer(async (base) => {
      const all = await list(base);
      assert.deepEqual(all.body.customers.map((c) => c.fullName), ["Real Incomer"]);
      assert.equal(all.body.outcomers.available, false);

      const outcomers = await list(base, "?customerType=outcomer");
      assert.equal(outcomers.status, 200);
      assert.deepEqual(outcomers.body.customers, []);
      assert.equal(outcomers.body.pagination.total, 0);

      const byEvent = await list(base, `?eventId=${new mongoose.Types.ObjectId()}`);
      assert.deepEqual(byEvent.body.customers, []);

      assert.equal((await list(base, "?customerType=bogus")).status, 422);
      assert.equal((await list(base, "?eventId=nope")).status, 422);
    });
  });

  test("validates paging and filter values", async () => {
    await withServer(async (base) => {
      for (const query of ["?pageSize=51", "?pageSize=0", "?pageSize=abc", "?page=0", "?page=1.5", "?manual=maybe", "?schoolId=nope"]) {
        assert.equal((await list(base, query)).status, 422, query);
      }
      assert.equal((await list(base, "?pageSize=50")).status, 200);
      assert.equal((await list(base, "?pageSize=25&page=1")).body.pagination.pageSize, 25);
    });
  });

  test("server-side pagination, counts and search across thousands of fictional customers", async () => {
    const total = 3000;
    const attendees = [];
    const statuses = [];
    const approved = [];
    for (let i = 1; i <= total; i += 1) {
      const id = new mongoose.Types.ObjectId();
      const number = `011${String(10000000 + i).slice(-8)}`;
      attendees.push({
        _id: id,
        fullName: `Bulk Customer ${String(i).padStart(4, "0")}`,
        phone: number,
        phoneNormalized: number,
        attendeeType: "incomer",
        schoolId: i % 2 === 0 ? schoolA._id : schoolB._id,
        ticketPrice: 6000,
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60000)
      });
      if (i % 7 === 0) statuses.push({ _id: new mongoose.Types.ObjectId(), attendeeId: id, confirmed: true, confirmedAt: new Date() });
      if (i % 3 === 0) {
        approved.push({
          _id: new mongoose.Types.ObjectId(), attendeeId: id, amount: 1000, status: "approved",
          paymentOptionSnapshot: { amount: 1000 }, createdAt: new Date(), reviewedAt: new Date()
        });
      }
    }
    await Attendee.collection.insertMany(attendees);
    await FullPaymentStatus.collection.insertMany(statuses);
    await Deposit.collection.insertMany(approved);

    const expectedDone = Math.floor(total / 7);
    const expectedSchoolA = total / 2;

    await withServer(async (base) => {
      const started = Date.now();
      const first = await list(base);
      assert.equal(first.body.pagination.total, total);
      assert.equal(first.body.pagination.pageSize, 25);
      assert.equal(first.body.pagination.totalPages, 120);
      assert.equal(first.body.customers.length, 25);
      // Newest first; only summary fields — no deposit history on the list.
      assert.equal(first.body.customers[0].fullName, "Bulk Customer 3000");
      assert.ok(!("deposits" in first.body.customers[0]));
      assert.ok(Date.now() - started < 5000, "the first page loads quickly");

      const second = await list(base, "?page=2");
      const overlap = second.body.customers.filter((c) => first.body.customers.some((f) => f.id === c.id));
      assert.equal(overlap.length, 0, "pages never overlap");

      const last = await list(base, "?page=120");
      assert.equal(last.body.customers.length, 25);
      assert.equal((await list(base, "?page=121")).body.customers.length, 0);

      const fifty = await list(base, "?pageSize=50&page=3");
      assert.equal(fifty.body.customers.length, 50);
      assert.equal(fifty.body.pagination.totalPages, 60);

      // Search covers ALL customers, not just the current page.
      // (the search is an OR across name, phone and ID, so digits in a name can also match phones)
      const found = await list(base, "?q=Bulk Customer 0042&pageSize=50");
      assert.ok(found.body.pagination.total >= 1);
      assert.ok(found.body.customers.some((c) => c.fullName === "Bulk Customer 0042"));
      const byName = await list(base, "?q=Customer 2999");
      assert.ok(byName.body.customers.some((c) => c.fullName === "Bulk Customer 2999"));
      const byPhone = await list(base, "?q=01110000100");
      assert.equal(byPhone.body.pagination.total, 1);

      // Accurate totals under filters, with and without the DONE filter.
      assert.equal((await list(base, `?schoolId=${schoolA._id}`)).body.pagination.total, expectedSchoolA);
      const done = await list(base, "?manual=done&pageSize=50");
      assert.equal(done.body.pagination.total, expectedDone);
      assert.ok(done.body.customers.every((c) => c.manualStatus === "DONE"));
      assert.equal((await list(base, "?manual=not_done")).body.pagination.total, total - expectedDone);
      const combined = await list(base, `?manual=done&schoolId=${schoolA._id}`);
      const expectedCombined = Array.from({ length: total }, (_, k) => k + 1).filter((n) => n % 7 === 0 && n % 2 === 0).length;
      assert.equal(combined.body.pagination.total, expectedCombined);

      // The approved totals on a page match the seeded approved deposits.
      const row = first.body.customers.find((c) => c.fullName === "Bulk Customer 2997"); // 2997 = 3 * 999
      assert.equal(row.approvedTotalPaid, 1000);
    });
  });

  // --- the legacy Google Sheets DONE system cannot override the Admin ------

  describe("legacy Google Sheets DONE can never override the Admin Portal", () => {
    const SHEET_ID = "1ManualFullPaymentFictionalSheetXXXXXXXXXX";
    let sheet;
    let restoreGoogle;
    let school;
    let adminDone;
    let adminRevoked;
    let legacyDone;
    let plain;

    beforeEach(async () => {
      school = await School.create({ name: "Fictional Sheet School", ticketPrice: 6000, accessCode: "SHEET1" });
      await SchoolFinanceConfig.create({ schoolId: school._id, googleSheetId: SHEET_ID, tabName: "Sheet1", enabled: true });
      adminDone = await addCustomer({ name: "Admin Marked Done", school });
      adminRevoked = await addCustomer({ name: "Admin Revoked", school });
      legacyDone = await addCustomer({ name: "Old Sheet Done", school });
      plain = await addCustomer({ name: "Untouched", school });

      await withServer(async (base) => {
        await markDone(base, adminDone._id);
        await markDone(base, adminRevoked._id);
        await revoke(base, adminRevoked._id);
      });
      const at = new Date(Date.UTC(2026, 7, 1));
      await FullPaymentStatus.collection.insertOne({
        _id: new mongoose.Types.ObjectId(), attendeeId: legacyDone._id, confirmed: true, confirmedAt: at, lastSheetValue: "DONE"
      });

      // The accountant's column I says the OPPOSITE of the Admin everywhere.
      sheet = createFakeSpreadsheet();
      sheet.rows[0] = ["Customer ID", "Full Name", "Phone", "School", "Ticket Price", "Approved Payments", "Number of Payments", "Total Paid", "Full Payment"];
      [[adminDone, ""], [adminRevoked, "DONE"], [legacyDone, ""], [plain, "DONE"]].forEach(([customer, cell], i) => {
        sheet.rows[i + 1] = [String(customer._id), customer.fullName, customer.phone, "Fictional Sheet School", 6000, "", 0, 0, cell];
      });
      restoreGoogle = installFakes(() => ({ [SHEET_ID]: sheet }));
    });

    afterEach(() => restoreGoogle());

    const statusMap = async () => {
      const docs = await FullPaymentStatus.find({}).lean();
      return Object.fromEntries(docs.map((d) => [String(d.attendeeId), d.confirmed]));
    };
    const expectedAfterAdmin = () => ({
      [String(adminDone._id)]: true,
      [String(adminRevoked._id)]: false,
      [String(legacyDone._id)]: true
    });

    test("by default the read-back is retired: it does nothing, reads nothing, emails nothing", async () => {
      const before = JSON.stringify(await FullPaymentStatus.find({}).sort({ _id: 1 }).lean());
      const result = await syncFullPaymentFromSchoolSheet(school._id);
      assert.equal(result.skipped, true);
      assert.equal(result.success, false);
      assert.match(result.reason, /Admin Portal/);
      assert.equal(sheet.reads, 0, "Google is not even read");
      assert.equal(JSON.stringify(await FullPaymentStatus.find({}).sort({ _id: 1 }).lean()), before);
      assert.equal(resendCalls.length, 0);
    });

    test("the cron, the Sheets on-edit endpoint and the manual button all leave every decision alone", async () => {
      const before = JSON.stringify(await FullPaymentStatus.find({}).sort({ _id: 1 }).lean());
      const columnIBefore = JSON.stringify(sheet.columnI());

      await withServer(async (base) => {
        const cron = await fetch(`${base}/api/cron/sync-all`, { headers: { Authorization: `Bearer ${SECRET}` } });
        assert.equal(cron.status, 200);

        const edit = await fetch(`${base}/api/sheets/full-payment-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
          body: JSON.stringify({ spreadsheetId: SHEET_ID, sheetName: "Sheet1" })
        });
        assert.equal(edit.status, 200, "the Apps Script still gets a 2xx, so nothing breaks or retries");
        const editBody = await edit.json();
        assert.equal(editBody.skipped, true);

        const manual = await call(base, "POST", `/api/admin/school-finance-config/${school._id}/sync-full-payment`);
        assert.equal(manual.status, 200);
        assert.equal(manual.body.skipped, true);
        assert.match(manual.body.reason, /Admin Portal/);
      });

      assert.equal(JSON.stringify(await FullPaymentStatus.find({}).sort({ _id: 1 }).lean()), before);
      assert.deepEqual(await statusMap(), expectedAfterAdmin());
      assert.equal(JSON.stringify(sheet.columnI()), columnIBefore, "Column I is never written");
      assert.equal(resendCalls.length, 0, "no email from any Sheet path");
    });

    test("even if the legacy mode is switched back on, an Admin decision still wins (DONE stays DONE, revoked stays NOT DONE)", async () => {
      process.env.FULL_PAYMENT_SHEET_SYNC = "legacy";
      try {
        const result = await syncFullPaymentFromSchoolSheet(school._id);
        assert.equal(result.success, true);
      } finally {
        delete process.env.FULL_PAYMENT_SHEET_SYNC;
      }

      const map = await statusMap();
      assert.equal(map[String(adminDone._id)], true, "an Admin DONE is not reversed by an empty Column I");
      assert.equal(map[String(adminRevoked._id)], false, "an Admin revoke is not undone by a DONE in Column I");
      assert.equal(await FullPaymentStatus.countDocuments({ attendeeId: adminDone._id }), 1);
      assert.equal(resendCalls.some((c) => JSON.stringify(c).includes(adminDone.fullName)), false);
    });
  });
});
