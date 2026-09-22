// Stub-only tests for the customer's one-time "PAYMENT CONFIRMED" lifecycle:
// Admin approval raises it, customer-summary surfaces it (one at a time, no
// history), and POST /api/payments/acknowledge-confirmation clears it.
// No live Mongo, Cloudinary or Google Sheets: Mongoose statics are replaced
// by a tiny in-memory Deposit store and restored after every test.
//
// Run with:  npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-for-real-use";
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-key";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-secret";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const Attendee = require("../src/models/Attendee");
const Deposit = require("../src/models/Deposit");
const DepositApprovalLock = require("../src/models/DepositApprovalLock");
const FullPaymentStatus = require("../src/models/FullPaymentStatus");
const School = require("../src/models/School");
const app = require("../src/app");

const OWNERSHIP_ERROR = "We couldn't verify this account. Check your details and try again.";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const restorers = [];

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  restorers.push(() => {
    obj[method] = original;
  });
}

function restoreAll() {
  while (restorers.length) restorers.pop()();
}

// Awaitable directly, or chainable with .select/.sort/.populate/.session.
function queryResult(value) {
  const promise = Promise.resolve(value);
  promise.select = () => queryResult(value);
  promise.sort = () => queryResult(value);
  promise.populate = () => queryResult(value);
  promise.session = () => queryResult(value);
  return promise;
}

const makeId = () => new mongoose.Types.ObjectId();

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function adminToken() {
  return jwt.sign({ email: "admin@example.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

// Minimal Mongo-style filter matching for the exact filters the routes use:
// plain equality (ObjectIds compared as strings, null matches null/undefined)
// and {$ne: value}.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === "object" && "$ne" in expected) {
      return expected.$ne === null ? actual != null : String(actual) !== String(expected.$ne);
    }
    if (expected === null) return actual == null;
    if (typeof expected === "boolean") return actual === expected;
    return String(actual) === String(expected);
  });
}

// In-memory Deposit collection behind Deposit.find/findOne/findOneAndUpdate.
function installDepositStore(docs) {
  const store = docs;
  const updates = [];
  stub(Deposit, "find", (filter = {}) =>
    queryResult(
      store.filter((doc) => matches(doc, filter)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    )
  );
  stub(Deposit, "findOne", (filter = {}) => queryResult(store.find((doc) => matches(doc, filter)) || null));
  stub(Deposit, "findOneAndUpdate", (filter, update) => {
    updates.push({ filter, update });
    const doc = store.find((candidate) => matches(candidate, filter));
    if (doc) {
      Object.assign(doc, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete doc[key];
    }
    return queryResult(doc || null);
  });
  return { store, updates };
}

// The summary also reads the attendee's School (for ticket-price
// visibility); default to "no School" (price shown), or pass one.
function installAttendee(attendee, school = null) {
  stub(Attendee, "findById", (id) => queryResult(String(id) === String(attendee._id) ? attendee : null));
  stub(School, "findById", () => queryResult(school));
}

function fakeAttendee(overrides = {}) {
  return {
    _id: makeId(),
    attendeeType: "incomer",
    phoneNormalized: "01012345678",
    ticketPrice: 3000,
    schoolId: makeId(),
    ...overrides
  };
}

function fakeDeposit(attendee, overrides = {}) {
  return {
    _id: makeId(),
    attendeeId: attendee._id,
    amount: 500,
    paymentOptionSnapshot: { amount: 500, label: "500 EGP" },
    paymentProof: { url: "https://res.cloudinary.example/proof.jpg", publicId: "proof-public-id" },
    status: "pending",
    activeSlot: 1,
    createdAt: new Date("2026-09-01T10:00:00Z"),
    ...overrides
  };
}

function summaryFor(base, attendee) {
  return post(base, "/api/payments/customer-summary", {
    attendeeId: String(attendee._id),
    phone: attendee.phoneNormalized
  }).then((res) => res.json());
}

function acknowledge(base, attendee, depositId, phone = attendee.phoneNormalized) {
  return post(base, "/api/payments/acknowledge-confirmation", {
    attendeeId: String(attendee._id),
    phone,
    depositId: String(depositId)
  });
}

test.afterEach(restoreAll);

// ---------------------------------------------------------------------------
// customer-summary — current state only, no history
// ---------------------------------------------------------------------------

test("customer-summary: current-state shape", async (t) => {
  await t.test("a submitted (pending) Deposit yields under_review and no confirmation", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    installDepositStore([fakeDeposit(attendee)]);
    stub(FullPaymentStatus, "findOne", () => queryResult(null));

    await withServer(async (base) => {
      const body = await summaryFor(base, attendee);
      assert.equal(body.summary.paymentStatus, "under_review");
      assert.equal(body.summary.paymentConfirmation, null);
      assert.equal(body.summary.latestRejection, null);
      assert.equal(body.summary.deposits, undefined);
    });
  });

  await t.test("never returns history, totals, progress, proof or internal fields", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    installDepositStore([
      fakeDeposit(attendee, { status: "approved", reviewedAt: new Date(), customerConfirmationPending: true }),
      fakeDeposit(attendee, { status: "approved", customerConfirmationPending: false, activeSlot: 2 }),
      fakeDeposit(attendee, { status: "rejected", activeSlot: undefined, rejectionReason: "Blurry." })
    ]);
    stub(FullPaymentStatus, "findOne", () => queryResult(null));

    await withServer(async (base) => {
      const body = await summaryFor(base, attendee);
      const serialized = JSON.stringify(body);
      for (const forbidden of [
        "deposits",
        "approvedTotal",
        "remaining",
        "progress",
        "paymentProof",
        "publicId",
        "cloudinary",
        "activeSlot",
        "reviewedBy",
        "reviewedAt",
        "schoolId",
        "customerConfirmationPending",
        "attendeeId"
      ]) {
        assert.ok(!serialized.includes(forbidden), `summary leaked "${forbidden}"`);
      }
      assert.deepEqual(Object.keys(body.summary.paymentConfirmation).sort(), ["depositId"]);
    });
  });

  await t.test("legacy approved Deposits (field absent) never raise a confirmation", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    installDepositStore([fakeDeposit(attendee, { status: "approved", reviewedAt: new Date("2026-01-01") })]);
    stub(FullPaymentStatus, "findOne", () => queryResult(null));

    await withServer(async (base) => {
      const body = await summaryFor(base, attendee);
      assert.equal(body.summary.paymentConfirmation, null);
      assert.equal(body.summary.paymentStatus, "ready");
    });
  });

  await t.test("latestRejection is current-state only: newest request rejected and nothing pending", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    const { store } = installDepositStore([
      fakeDeposit(attendee, { status: "rejected", activeSlot: undefined, rejectionReason: "Old reason." }),
      fakeDeposit(attendee, {
        status: "rejected",
        activeSlot: undefined,
        rejectionReason: "Amount doesn't match.",
        createdAt: new Date("2026-09-02T10:00:00Z")
      })
    ]);
    stub(FullPaymentStatus, "findOne", () => queryResult(null));

    await withServer(async (base) => {
      const first = await summaryFor(base, attendee);
      // Only the newest reason, as a single object — never a list.
      assert.deepEqual(first.summary.latestRejection, { reason: "Amount doesn't match." });

      // A new submission makes it disappear.
      store.push(fakeDeposit(attendee, { createdAt: new Date("2026-09-03T10:00:00Z") }));
      const second = await summaryFor(base, attendee);
      assert.equal(second.summary.latestRejection, null);
      assert.equal(second.summary.paymentStatus, "under_review");
    });
  });
});

// ---------------------------------------------------------------------------
// One-time confirmation lifecycle
// ---------------------------------------------------------------------------

test("acknowledge-confirmation", async (t) => {
  await t.test("summary returns the confirmation; OK acknowledges it; later visits never show it again", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    const approvedAt = new Date("2026-09-05T12:00:00Z");
    const deposit = fakeDeposit(attendee, {
      status: "approved",
      reviewedAt: approvedAt,
      customerConfirmationPending: true,
      customerConfirmationAcknowledgedAt: null
    });
    const { updates } = installDepositStore([deposit]);
    stub(FullPaymentStatus, "findOne", () => queryResult(null));

    await withServer(async (base) => {
      const before = await summaryFor(base, attendee);
      assert.deepEqual(before.summary.paymentConfirmation, { depositId: String(deposit._id) });

      const res = await acknowledge(base, attendee, deposit._id);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { success: true });

      // Scoped to THIS attendee, approved, and still pending.
      const { filter, update } = updates[0];
      assert.equal(String(filter._id), String(deposit._id));
      assert.equal(String(filter.attendeeId), String(attendee._id));
      assert.equal(filter.status, "approved");
      assert.equal(filter.customerConfirmationPending, true);
      assert.equal(update.$set.customerConfirmationPending, false);
      // Acknowledging closes the payment cycle so the customer may pay again.
      assert.deepEqual(update.$unset, { activeCycle: 1 });
      assert.ok(update.$set.customerConfirmationAcknowledgedAt instanceof Date);

      assert.equal(deposit.customerConfirmationPending, false);
      assert.ok(deposit.customerConfirmationAcknowledgedAt instanceof Date);
      // Acknowledging never touches money/review/history fields.
      assert.equal(deposit.status, "approved");
      assert.equal(deposit.amount, 500);
      assert.equal(deposit.reviewedAt, approvedAt);
      assert.equal(deposit.paymentProof.publicId, "proof-public-id");

      const after = await summaryFor(base, attendee);
      assert.equal(after.summary.paymentConfirmation, null);
      const laterVisit = await summaryFor(base, attendee);
      assert.equal(laterVisit.summary.paymentConfirmation, null);
    });
  });

  await t.test("is idempotent — a repeat OK succeeds and keeps the original acknowledgedAt", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    const deposit = fakeDeposit(attendee, { status: "approved", reviewedAt: new Date(), customerConfirmationPending: true });
    installDepositStore([deposit]);

    await withServer(async (base) => {
      assert.equal((await acknowledge(base, attendee, deposit._id)).status, 200);
      const firstAck = deposit.customerConfirmationAcknowledgedAt;
      await new Promise((resolve) => setTimeout(resolve, 5));

      const repeat = await acknowledge(base, attendee, deposit._id);
      assert.equal(repeat.status, 200);
      assert.deepEqual(await repeat.json(), { success: true });
      assert.equal(deposit.customerConfirmationAcknowledgedAt, firstAck);
    });
  });

  await t.test("wrong phone is rejected by the shared ownership check before any Deposit is touched", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    const deposit = fakeDeposit(attendee, { status: "approved", customerConfirmationPending: true });
    const { updates } = installDepositStore([deposit]);

    await withServer(async (base) => {
      const res = await acknowledge(base, attendee, deposit._id, "01099999999");
      assert.equal(res.status, 404);
      assert.equal((await res.json()).message, OWNERSHIP_ERROR);
      assert.equal(updates.length, 0);
      assert.equal(deposit.customerConfirmationPending, true);
    });
  });

  await t.test("a customer can never acknowledge ANOTHER attendee's Deposit", async () => {
    const victim = fakeAttendee({ phoneNormalized: "01122223333" });
    const attacker = fakeAttendee({ phoneNormalized: "01012345678" });
    stub(Attendee, "findById", (id) =>
      queryResult([victim, attacker].find((candidate) => String(candidate._id) === String(id)) || null)
    );
    const victimDeposit = fakeDeposit(victim, { status: "approved", customerConfirmationPending: true });
    installDepositStore([victimDeposit]);

    await withServer(async (base) => {
      // Attacker's own valid {attendeeId, phone}, victim's depositId.
      const res = await acknowledge(base, attacker, victimDeposit._id);
      assert.equal(res.status, 404);
      assert.equal((await res.json()).message, "Payment confirmation not found.");
      assert.equal(victimDeposit.customerConfirmationPending, true);
      assert.equal(victimDeposit.customerConfirmationAcknowledgedAt, undefined);
    });
  });

  await t.test("pending, rejected and legacy-approved Deposits cannot be acknowledged", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    const pending = fakeDeposit(attendee);
    const rejected = fakeDeposit(attendee, { status: "rejected", activeSlot: undefined });
    const legacyApproved = fakeDeposit(attendee, { status: "approved" });
    installDepositStore([pending, rejected, legacyApproved]);

    await withServer(async (base) => {
      for (const deposit of [pending, rejected, legacyApproved]) {
        const res = await acknowledge(base, attendee, deposit._id);
        assert.equal(res.status, 404, `status ${deposit.status} should not be acknowledgeable`);
      }
      const missing = await acknowledge(base, attendee, makeId());
      assert.equal(missing.status, 404);
    });
  });

  await t.test("malformed ids get 422 validation errors", async () => {
    await withServer(async (base) => {
      const attendee = fakeAttendee();
      const badDeposit = await post(base, "/api/payments/acknowledge-confirmation", {
        attendeeId: String(attendee._id),
        phone: attendee.phoneNormalized,
        depositId: "nope"
      });
      assert.equal(badDeposit.status, 422);

      const badAttendee = await post(base, "/api/payments/acknowledge-confirmation", {
        attendeeId: "nope",
        phone: attendee.phoneNormalized,
        depositId: String(makeId())
      });
      assert.equal(badAttendee.status, 422);
    });
  });

  await t.test("two unacknowledged confirmations are returned one at a time, oldest approval first", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    // Created in one order, approved in the other — approval time decides.
    const createdFirstApprovedLast = fakeDeposit(attendee, {
      status: "approved",
      reviewedAt: new Date("2026-09-10T10:00:00Z"),
      customerConfirmationPending: true,
      createdAt: new Date("2026-09-01T10:00:00Z")
    });
    const createdLastApprovedFirst = fakeDeposit(attendee, {
      amount: 1000,
      paymentOptionSnapshot: { amount: 1000, label: "1000 EGP" },
      status: "approved",
      reviewedAt: new Date("2026-09-09T10:00:00Z"),
      customerConfirmationPending: true,
      activeSlot: 2,
      createdAt: new Date("2026-09-02T10:00:00Z")
    });
    installDepositStore([createdFirstApprovedLast, createdLastApprovedFirst]);
    stub(FullPaymentStatus, "findOne", () => queryResult(null));

    await withServer(async (base) => {
      const first = await summaryFor(base, attendee);
      assert.equal(first.summary.paymentConfirmation.depositId, String(createdLastApprovedFirst._id));

      await acknowledge(base, attendee, createdLastApprovedFirst._id);
      const second = await summaryFor(base, attendee);
      assert.equal(second.summary.paymentConfirmation.depositId, String(createdFirstApprovedLast._id));

      await acknowledge(base, attendee, createdFirstApprovedLast._id);
      const done = await summaryFor(base, attendee);
      assert.equal(done.summary.paymentConfirmation, null);
    });
  });
});

// ---------------------------------------------------------------------------
// Paying again + Full Payment are independent of the acknowledgement
// ---------------------------------------------------------------------------

test("after acknowledgement", async (t) => {
  await t.test("the customer may pay again once they press OK", async () => {
    const attendee = fakeAttendee({ ticketPrice: 1500 });
    installAttendee(attendee);
    const deposit = fakeDeposit(attendee, {
      status: "approved",
      reviewedAt: new Date(),
      customerConfirmationPending: true,
      activeCycle: 1
    });
    installDepositStore([deposit]);
    stub(FullPaymentStatus, "findOne", () => queryResult(null));

    await withServer(async (base) => {
      const before = await summaryFor(base, attendee);
      assert.equal(before.summary.paymentStatus, "awaiting_confirmation");

      assert.equal((await acknowledge(base, attendee, deposit._id)).status, 200);
      assert.equal(deposit.activeCycle, undefined);

      const after = await summaryFor(base, attendee);
      assert.equal(after.summary.paymentStatus, "ready");
    });
  });

  await t.test("FullPaymentStatus.confirmed still locks payments — acknowledgement never overrides it", async () => {
    const attendee = fakeAttendee();
    installAttendee(attendee);
    const deposit = fakeDeposit(attendee, { status: "approved", reviewedAt: new Date(), customerConfirmationPending: true });
    installDepositStore([deposit]);
    stub(FullPaymentStatus, "findOne", () => queryResult({ confirmed: true }));
    const fullPaymentWrites = [];
    for (const method of ["findOneAndUpdate", "updateOne", "updateMany", "create", "deleteOne"]) {
      stub(FullPaymentStatus, method, (...args) => {
        fullPaymentWrites.push(method, args);
        return queryResult(null);
      });
    }

    await withServer(async (base) => {
      const before = await summaryFor(base, attendee);
      assert.equal(before.summary.paymentStatus, "full_payment_complete");
      assert.ok(before.summary.paymentConfirmation);

      assert.equal((await acknowledge(base, attendee, deposit._id)).status, 200);

      const after = await summaryFor(base, attendee);
      assert.equal(after.summary.paymentStatus, "full_payment_complete");
      assert.equal(after.summary.paymentConfirmation, null);

      assert.equal(after.summary.paymentStatus, "full_payment_complete");
      assert.equal(fullPaymentWrites.length, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Admin approval — raises the notification inside the unchanged transaction
// ---------------------------------------------------------------------------

function installFakeSession({ onStart } = {}) {
  let started = 0;
  stub(mongoose, "startSession", async () => {
    started += 1;
    if (onStart) onStart(started);
    return {
      withTransaction: async (fn) => fn(),
      endSession: async () => {}
    };
  });
  return () => started;
}

test("admin approval", async (t) => {
  await t.test("sets customerConfirmationPending=true + acknowledgedAt=null alongside status/reviewedAt", async () => {
    const attendee = fakeAttendee({ ticketPrice: 3000 });
    const deposit = fakeDeposit(attendee);
    stub(Attendee, "findById", () => queryResult(attendee));
    stub(Deposit, "findById", () => queryResult(deposit));
    stub(Deposit, "find", () => queryResult([]));
    const lockCalls = [];
    stub(DepositApprovalLock, "findOneAndUpdate", (...args) => {
      lockCalls.push(args);
      return queryResult({});
    });
    let approvalWrite = null;
    stub(Deposit, "findOneAndUpdate", (filter, update, options) => {
      approvalWrite = { filter, update, options };
      return queryResult({ ...deposit, ...update.$set });
    });
    const sessions = installFakeSession();

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/deposits/${deposit._id}/approve`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminToken()}` }
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.deposit.status, "approved");
      assert.equal(body.deposit.customerConfirmationPending, true);
    });

    // Lock taken, inside a session, before the write — unchanged.
    assert.equal(sessions(), 1);
    assert.equal(lockCalls.length, 1);
    assert.equal(lockCalls[0][2].upsert, true);
    assert.ok(lockCalls[0][2].session);

    // Still conditional on status pending, still in the transaction session.
    assert.equal(approvalWrite.filter.status, "pending");
    assert.ok(approvalWrite.options.session);
    assert.equal(approvalWrite.update.$set.status, "approved");
    assert.ok(approvalWrite.update.$set.reviewedAt instanceof Date);
    assert.equal(approvalWrite.update.$set.customerConfirmationPending, true);
    assert.equal(approvalWrite.update.$set.customerConfirmationAcknowledgedAt, null);
    // activeSlot untouched — an approved deposit keeps its slot.
    assert.equal(approvalWrite.update.$unset, undefined);
  });

  await t.test("the ticket price is NOT a ceiling: approving past it succeeds", async () => {
    const attendee = fakeAttendee({ ticketPrice: 1000 });
    const deposit = fakeDeposit(attendee, { amount: 7000 });
    stub(Attendee, "findById", () => queryResult(attendee));
    stub(Deposit, "findById", () => queryResult(deposit));
    stub(Deposit, "find", () => queryResult([{ status: "approved", amount: 900 }]));
    stub(DepositApprovalLock, "findOneAndUpdate", () => queryResult({}));
    let approvalWrite = null;
    stub(Deposit, "findOneAndUpdate", (filter, update) => {
      approvalWrite = update;
      return queryResult({ ...deposit, ...update.$set });
    });
    installFakeSession();

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/deposits/${deposit._id}/approve`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminToken()}` }
      });
      assert.equal(res.status, 200);
      assert.equal(approvalWrite.$set.status, "approved");
      assert.equal(approvalWrite.$set.customerConfirmationPending, true);
    });
  });

  await t.test("a missing attendee still refuses approval", async () => {
    const deposit = fakeDeposit(fakeAttendee());
    stub(Attendee, "findById", () => queryResult(null));
    stub(Deposit, "findById", () => queryResult(deposit));
    stub(DepositApprovalLock, "findOneAndUpdate", () => queryResult({}));
    let wrote = false;
    stub(Deposit, "findOneAndUpdate", () => {
      wrote = true;
      return queryResult(null);
    });
    installFakeSession();

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/deposits/${deposit._id}/approve`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminToken()}` }
      });
      assert.equal(res.status, 404);
      assert.equal(wrote, false);
    });
  });

  await t.test("a non-pending Deposit is still refused with 409", async () => {
    const attendee = fakeAttendee();
    const deposit = fakeDeposit(attendee, { status: "approved" });
    stub(Deposit, "findById", () => queryResult(deposit));
    let wrote = false;
    stub(Deposit, "findOneAndUpdate", () => {
      wrote = true;
      return queryResult(null);
    });
    installFakeSession();

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/deposits/${deposit._id}/approve`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminToken()}` }
      });
      assert.equal(res.status, 409);
      assert.equal(wrote, false);
    });
  });

  await t.test("the first-use lock race (E11000) still retries with a fresh session", async () => {
    const attendee = fakeAttendee();
    const deposit = fakeDeposit(attendee);
    stub(Attendee, "findById", () => queryResult(attendee));
    stub(Deposit, "findById", () => queryResult(deposit));
    stub(Deposit, "find", () => queryResult([]));
    let lockAttempts = 0;
    stub(DepositApprovalLock, "findOneAndUpdate", () => {
      lockAttempts += 1;
      if (lockAttempts === 1) {
        const duplicate = new Error("E11000 duplicate key");
        duplicate.code = 11000;
        return Promise.reject(duplicate);
      }
      return queryResult({});
    });
    stub(Deposit, "findOneAndUpdate", (filter, update) => queryResult({ ...deposit, ...update.$set }));
    const sessions = installFakeSession();

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/deposits/${deposit._id}/approve`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminToken()}` }
      });
      assert.equal(res.status, 200);
    });
    assert.equal(sessions(), 2);
    assert.equal(lockAttempts, 2);
  });

  await t.test("rejection is unchanged and never raises a customer confirmation", async () => {
    const attendee = fakeAttendee();
    const deposit = fakeDeposit(attendee);
    stub(Deposit, "findById", () => queryResult(deposit));
    let rejectionWrite = null;
    stub(Deposit, "findOneAndUpdate", (filter, update) => {
      rejectionWrite = { filter, update };
      return queryResult({ ...deposit, ...update.$set, activeSlot: undefined });
    });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/deposits/${deposit._id}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
        body: JSON.stringify({ rejectionReason: "Blurry screenshot." })
      });
      assert.equal(res.status, 200);
    });
    assert.equal(rejectionWrite.update.$set.status, "rejected");
    assert.equal(rejectionWrite.update.$set.rejectionReason, "Blurry screenshot.");
    // Releases the payment cycle so the customer can pay again.
    assert.deepEqual(rejectionWrite.update.$unset, { activeSlot: 1, activeCycle: 1 });
    assert.equal("customerConfirmationPending" in rejectionWrite.update.$set, false);
  });
});

// ---------------------------------------------------------------------------
// Admin history — complete and unchanged
// ---------------------------------------------------------------------------

test("admin Deposit history stays complete", async () => {
  const attendee = fakeAttendee();
  const approvedAcknowledged = fakeDeposit(attendee, {
    status: "approved",
    customerConfirmationPending: false,
    customerConfirmationAcknowledgedAt: new Date()
  });
  const approvedLegacy = fakeDeposit(attendee, { status: "approved", activeSlot: 2 });
  const rejected = fakeDeposit(attendee, { status: "rejected", activeSlot: undefined, rejectionReason: "Blurry." });
  const pending = fakeDeposit(attendee, { activeSlot: 3 });
  let adminFilter = null;
  stub(Deposit, "find", (filter) => {
    adminFilter = filter;
    return queryResult([approvedAcknowledged, approvedLegacy, rejected, pending]);
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/admin/deposits?attendeeId=${attendee._id}`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    // Customer acknowledgement never filters anything out of Admin's view.
    assert.deepEqual(Object.keys(adminFilter), ["attendeeId"]);
    assert.equal(body.deposits.length, 4);
    assert.deepEqual(body.deposits.map((deposit) => deposit.status).sort(), ["approved", "approved", "pending", "rejected"]);
    // Proof / admin data unchanged.
    assert.equal(body.deposits[0].paymentProof.publicId, "proof-public-id");
    assert.equal(body.deposits[2].rejectionReason, "Blurry.");
  });
});
