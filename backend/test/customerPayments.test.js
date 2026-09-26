// Stub-only test harness for Sandra's customer payment API layer. No live
// Mongo, Cloudinary, or Google Sheets connection is ever made: Mongoose model
// static methods and the Cloudinary uploader are monkey-patched per test, and
// restored in a `finally` so tests don't leak state into each other.
//
// Run with:  npm test   (see package.json)   — uses Node's built-in test
// runner (node:test), no new dependency added.

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
const PaymentOption = require("../src/models/PaymentOption");
const School = require("../src/models/School");
const { createMemoryDb } = require("./support/memoryDb");
const Deposit = require("../src/models/Deposit");
const FullPaymentStatus = require("../src/models/FullPaymentStatus");
const app = require("../src/app");

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

// Mimics a Mongoose query result that can be awaited directly (findById(id))
// or chained with .select()/.sort() before awaiting (findById(id).select(...)).
function queryResult(value) {
  const promise = Promise.resolve(value);
  promise.select = () => queryResult(value);
  promise.sort = () => queryResult(value);
  promise.populate = () => queryResult(value);
  return promise;
}

function makeId() {
  return new mongoose.Types.ObjectId();
}

let activeServer = null;

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  activeServer = server;
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    activeServer = null;
  }
}

const FORBIDDEN_SUMMARY_KEYS = [
  "attendeeId",
  "phone",
  "email",
  "proof",
  "proofUrl",
  "publicId",
  "activeSlot",
  "paymentOptionId",
  "paymentOptionSnapshot",
  "reviewedBy",
  "reviewedAt",
  "adminNotes",
  "googleSheetId",
  "tabName",
  "lastSync",
  "lastSheetValue",
  "lastSyncedAt",
  "qrId",
  "qrToken",
  "event",
  "_id",
  "__v",
  // Product rule (this revision): payment progress is never customer-facing.
  "approvedTotal",
  "remaining",
  "remainingBalance",
  "schoolId",
  "enabled",
  "displayOrder",
  "createdAt2",
  // Product rule (no customer payment history): no history array, no
  // progress, no internal notification bookkeeping, no proof object.
  "deposits",
  "progress",
  "paymentProof",
  "customerConfirmationPending",
  "customerConfirmationAcknowledgedAt"
];

function assertNoForbiddenKeys(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      assert.ok(
        !FORBIDDEN_SUMMARY_KEYS.includes(key),
        `forbidden key "${key}" found at ${path || "<root>"}`
      );
      assertNoForbiddenKeys(val, `${path}.${key}`);
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/payments/customer-summary
// ---------------------------------------------------------------------------

test("POST /api/payments/customer-summary", async (t) => {
  await t.test("matching attendeeId + phone returns a minimal summary — no payment progress", async () => {
    const attendeeId = makeId();
    const restoreFind = stub(Attendee, "findById", () =>
      queryResult({
        _id: attendeeId,
        attendeeType: "incomer",
        phoneNormalized: "01012345678",
        ticketPrice: 1000,
        schoolId: makeId()
      })
    );

    const approved = {
      _id: makeId(),
      amount: 400,
      status: "approved",
      activeSlot: 1,
      paymentOptionSnapshot: { amount: 400, label: "400 EGP" },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      rejectionReason: undefined
    };
    const pending = {
      _id: makeId(),
      amount: 200,
      status: "pending",
      activeSlot: 2,
      paymentOptionSnapshot: { amount: 200, label: "200 EGP" },
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      rejectionReason: undefined
    };
    const rejected = {
      _id: makeId(),
      amount: 300,
      status: "rejected",
      activeSlot: undefined,
      paymentOptionSnapshot: { amount: 300, label: "300 EGP" },
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      rejectionReason: "Screenshot illegible."
    };

    const restoreDepositFind = stub(Deposit, "find", () => queryResult([approved, pending, rejected]));
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult({ confirmed: true }));
    const restoreSchool = stub(School, "findById", () => queryResult(null));

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "010 1234 5678" })
        });
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.equal(body.success, true);

        // Exactly these keys — no approvedTotal, no remaining, and (product
        // rule) no deposits history array.
        assert.deepEqual(Object.keys(body.summary).sort(), [
          "latestRejection",
          "paymentConfirmation",
          "paymentStatus",
          "ticketPrice",
          "ticketPriceVisible"
        ]);
        assert.equal(body.summary.ticketPriceVisible, true);
        assert.equal(body.summary.ticketPrice, 1000);
        // Full Payment DONE outranks everything else on the normal screen.
        assert.equal(body.summary.paymentStatus, "full_payment_complete");
        // paymentStatus is the only state field the UI needs.
        assert.equal(body.summary.fullPaymentConfirmed, undefined);
        assert.equal(body.summary.hasPendingPayment, undefined);
        // The approved fixture predates the feature (no
        // customerConfirmationPending field) — it must NOT raise a popup.
        assert.equal(body.summary.paymentConfirmation, null);
        // A pending request exists, so the older rejection is not "current".
        assert.equal(body.summary.latestRejection, null);
        assert.equal(body.summary.deposits, undefined);

        assertNoForbiddenKeys(body.summary);
      });
    } finally {
      restoreFind();
      restoreDepositFind();
      restoreFullPayment();
      restoreSchool();
    }
  });

  await t.test("no FullPaymentStatus document leaves the customer able to pay", async () => {
    const attendeeId = makeId();
    const restoreFind = stub(Attendee, "findById", () =>
      queryResult({ _id: attendeeId, attendeeType: "incomer", phoneNormalized: "01012345678", ticketPrice: 500, schoolId: makeId() })
    );
    const restoreDepositFind = stub(Deposit, "find", () => queryResult([]));
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));
    const restoreSchool = stub(School, "findById", () => queryResult(null));

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01012345678" })
        });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.summary.paymentStatus, "ready");
      });
    } finally {
      restoreFind();
      restoreDepositFind();
      restoreFullPayment();
      restoreSchool();
    }
  });

  await t.test("wrong phone for a valid attendeeId is rejected with a generic error", async () => {
    const attendeeId = makeId();
    const restoreFind = stub(Attendee, "findById", () =>
      queryResult({ _id: attendeeId, attendeeType: "incomer", phoneNormalized: "01012345678", ticketPrice: 500, schoolId: makeId() })
    );

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01099999999" })
        });
        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "We couldn't verify this account. Check your details and try again.");
      });
    } finally {
      restoreFind();
    }
  });

  await t.test("unknown attendeeId is rejected with the SAME generic error/status as wrong phone", async () => {
    const restoreFind = stub(Attendee, "findById", () => queryResult(null));

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(makeId()), phone: "01012345678" })
        });
        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "We couldn't verify this account. Check your details and try again.");
      });
    } finally {
      restoreFind();
    }
  });

  await t.test("an Outcomer attendeeId is rejected the same way (not just wrong type message)", async () => {
    const attendeeId = makeId();
    const restoreFind = stub(Attendee, "findById", () =>
      queryResult({ _id: attendeeId, attendeeType: "outcomer", phoneNormalized: "01012345678", ticketPrice: null })
    );

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01012345678" })
        });
        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "We couldn't verify this account. Check your details and try again.");
      });
    } finally {
      restoreFind();
    }
  });

  await t.test("malformed attendeeId / missing phone get 422 field-validation errors, not the generic 404", async () => {
    await withServer(async (base) => {
      const res1 = await fetch(`${base}/api/payments/customer-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeId: "not-an-id", phone: "01012345678" })
      });
      assert.equal(res1.status, 422);

      const res2 = await fetch(`${base}/api/payments/customer-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeId: String(makeId()), phone: "" })
      });
      assert.equal(res2.status, 422);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/deposits — ownership, validation, safe shape, locks.
// Payment Options, cycles, the price lock and visibility are covered end to
// end in paymentOptions.test.js.
// ---------------------------------------------------------------------------

function buildDepositForm(fields, { withProof = true } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (withProof) {
    form.append("paymentProof", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "proof.png");
  }
  return form;
}

test("POST /api/deposits", async (t) => {
  let db;
  t.beforeEach(() => {
    db = createMemoryDb();
  });
  t.afterEach(() => db.restore());

  const postDeposit = (base, fields, options) =>
    fetch(`${base}/api/deposits`, { method: "POST", body: buildDepositForm(fields, options) }).then(async (res) => ({
      status: res.status,
      body: await res.json()
    }));

  const fieldsFor = (attendee, option, overrides = {}) => ({
    attendeeId: String(attendee._id),
    phone: attendee.phoneNormalized,
    paymentOptionId: String(option._id),
    ...overrides
  });

  await t.test("creates a Deposit for the chosen option and returns only the safe shape", async () => {
    const school = db.addSchool({ ticketPrice: 3000, options: [{ amount: 1000, label: "First" }] });
    const attendee = db.addAttendee(school);

    await withServer(async (base) => {
      const res = await postDeposit(base, fieldsFor(attendee, db.optionOf(school, 1000)));
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.body.deposit).sort(), ["amount", "createdAt", "id", "label", "status"]);
      assert.equal(res.body.deposit.amount, 1000);
      assert.equal(res.body.deposit.label, "First");
      assert.equal(res.body.deposit.status, "pending");
      assertNoForbiddenKeys(res.body.deposit);
      assert.equal(db.destroyed.length, 0, "no cleanup on the success path");
    });
  });

  await t.test("wrong phone is rejected with the generic ownership error before any upload", async () => {
    const school = db.addSchool({ ticketPrice: 3000, options: [1000] });
    const attendee = db.addAttendee(school);

    await withServer(async (base) => {
      const res = await postDeposit(base, fieldsFor(attendee, db.optionOf(school, 1000), { phone: "01099999999" }));
      assert.equal(res.status, 404);
      assert.equal(res.body.message, "We couldn't verify this account. Check your details and try again.");
      assert.equal(db.uploads.length, 0);
      assert.equal(db.deposits.length, 0);
    });
  });

  await t.test("an Outcomer is rejected the same way", async () => {
    const school = db.addSchool({ ticketPrice: 3000, options: [1000] });
    const outcomer = db.addAttendee(school, { attendeeType: "outcomer" });

    await withServer(async (base) => {
      const res = await postDeposit(base, fieldsFor(outcomer, db.optionOf(school, 1000)));
      assert.equal(res.status, 404);
      assert.equal(db.uploads.length, 0);
    });
  });

  await t.test("missing phone / malformed ids / missing proof are 422 validation errors", async () => {
    const school = db.addSchool({ ticketPrice: 3000, options: [1000] });
    const attendee = db.addAttendee(school);
    const option = db.optionOf(school, 1000);

    await withServer(async (base) => {
      assert.equal((await postDeposit(base, fieldsFor(attendee, option, { phone: "" }))).status, 422);
      assert.equal((await postDeposit(base, fieldsFor(attendee, option, { attendeeId: "nope" }))).status, 422);
      assert.equal((await postDeposit(base, fieldsFor(attendee, option, { paymentOptionId: "nope" }))).status, 422);
      const noProof = await postDeposit(base, fieldsFor(attendee, option), { withProof: false });
      assert.equal(noProof.status, 422);
      assert.equal(noProof.body.message, "Payment proof image is required.");
      assert.equal(db.uploads.length, 0);
    });
  });

  await t.test("an unknown option id is refused with the same generic message", async () => {
    const school = db.addSchool({ ticketPrice: 3000, options: [1000] });
    const attendee = db.addAttendee(school);

    await withServer(async (base) => {
      const res = await postDeposit(base, fieldsFor(attendee, { _id: makeId() }));
      assert.equal(res.status, 422);
      assert.equal(res.body.message, "Selected payment option is not available.");
    });
  });

  await t.test("Full Payment confirmed → refused with no upload and no Deposit", async () => {
    const school = db.addSchool({ ticketPrice: 3000, options: [1000] });
    const attendee = db.addAttendee(school);
    db.fullPayments.push({ attendeeId: attendee._id, confirmed: true });

    await withServer(async (base) => {
      const res = await postDeposit(base, fieldsFor(attendee, db.optionOf(school, 1000)));
      assert.equal(res.status, 422);
      assert.equal(res.body.message, "Full payment has already been confirmed.");
      assert.equal(db.uploads.length, 0);
      assert.equal(db.deposits.length, 0);
    });
  });

  await t.test("Full Payment confirmed=false behaves normally", async () => {
    const school = db.addSchool({ ticketPrice: 3000, options: [1000] });
    const attendee = db.addAttendee(school);
    db.fullPayments.push({ attendeeId: attendee._id, confirmed: false });

    await withServer(async (base) => {
      assert.equal((await postDeposit(base, fieldsFor(attendee, db.optionOf(school, 1000)))).status, 201);
    });
  });

  await t.test("already-approved money past the ticket price never blocks a new payment", async () => {
    const school = db.addSchool({ ticketPrice: 3000, options: [7000] });
    const attendee = db.addAttendee(school);
    db.deposits.push({
      _id: makeId(),
      attendeeId: attendee._id,
      amount: 2500,
      status: "approved",
      customerConfirmationPending: false,
      createdAt: new Date("2026-01-01T00:00:00Z")
    });

    await withServer(async (base) => {
      const res = await postDeposit(base, fieldsFor(attendee, db.optionOf(school, 7000)));
      assert.equal(res.status, 201);
      assert.equal(res.body.deposit.amount, 7000);
    });
  });
});

function adminToken() {
  return jwt.sign({ email: "admin@example.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

test("admin payment-option endpoints", async (t) => {
  await t.test("still require admin auth (untouched)", async () => {
    await withServer(async (base) => {
      const res1 = await fetch(`${base}/api/admin/deposits`);
      assert.equal(res1.status, 401);

      const res2 = await fetch(`${base}/api/admin/payment-options`);
      assert.equal(res2.status, 401);
    });
  });

  await t.test("POST requires a valid, existing schoolId (new model requirement)", async () => {
    const restoreSchoolFind = stub(School, "findById", () => queryResult(null));

    try {
      await withServer(async (base) => {
        // Missing schoolId entirely.
        const res1 = await fetch(`${base}/api/admin/payment-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
          body: JSON.stringify({ amount: 500 })
        });
        assert.equal(res1.status, 422);

        // schoolId provided but no such School exists.
        const res2 = await fetch(`${base}/api/admin/payment-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
          body: JSON.stringify({ schoolId: String(makeId()), amount: 500 })
        });
        const body2 = await res2.json();
        assert.equal(res2.status, 422);
        assert.equal(body2.message, "School not found.");
      });
    } finally {
      restoreSchoolFind();
    }
  });

  await t.test("POST creates a PaymentOption scoped to the given School", async () => {
    const schoolId = makeId();
    const restoreSchoolFind = stub(School, "findById", () => queryResult({ _id: schoolId, name: "Test School" }));
    let createdWith = null;
    const restoreCreate = stub(PaymentOption, "create", async (data) => {
      createdWith = data;
      return { _id: makeId(), ...data };
    });

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/admin/payment-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
          body: JSON.stringify({ schoolId: String(schoolId), amount: 1500, label: "1500 EGP" })
        });
        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(String(createdWith.schoolId), String(schoolId));
        assert.equal(body.paymentOption.amount, 1500);
      });
    } finally {
      restoreSchoolFind();
      restoreCreate();
    }
  });

  await t.test("GET supports an optional ?schoolId= filter for the future Admin Portal", async () => {
    const schoolId = makeId();
    let queriedFilter = null;
    const restoreFind = stub(PaymentOption, "find", (filter) => {
      queriedFilter = filter;
      return queryResult([]);
    });

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/admin/payment-options?schoolId=${schoolId}`, {
          headers: { Authorization: `Bearer ${adminToken()}` }
        });
        assert.equal(res.status, 200);
        assert.equal(String(queriedFilter.schoolId), String(schoolId));
      });
    } finally {
      restoreFind();
    }
  });
});

test.after(() => {
  if (activeServer) {
    activeServer.close();
  }
});
