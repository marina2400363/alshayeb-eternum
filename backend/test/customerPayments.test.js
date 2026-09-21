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
const { v2: cloudinary } = require("cloudinary");

const Attendee = require("../src/models/Attendee");
const PaymentOption = require("../src/models/PaymentOption");
const School = require("../src/models/School");
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

function stubCloudinaryUploadStream(result) {
  return stub(cloudinary.uploader, "upload_stream", (options, callback) => ({
    end: () => {
      // Real cloudinary streams call back asynchronously; mirror that so any
      // accidental sync-assumption in the route would fail like production.
      setImmediate(() => callback(null, result));
    }
  }));
}

function stubCloudinaryDestroy(impl) {
  return stub(cloudinary.uploader, "destroy", impl || (async () => ({ result: "ok" })));
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
  "createdAt2"
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

function fakeAttendee(overrides = {}) {
  return {
    _id: makeId(),
    attendeeType: "incomer",
    phoneNormalized: "01012345678",
    ticketPrice: 1000,
    schoolId: makeId(),
    ...overrides
  };
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

        // Exactly these four keys — no approvedTotal, no remaining.
        assert.deepEqual(Object.keys(body.summary).sort(), [
          "activeDepositCount",
          "deposits",
          "fullPaymentConfirmed",
          "ticketPrice"
        ]);
        assert.equal(body.summary.ticketPrice, 1000);
        assert.equal(body.summary.activeDepositCount, 2);
        assert.equal(body.summary.fullPaymentConfirmed, true);
        assert.equal(body.summary.deposits.length, 3);

        const rejectedLine = body.summary.deposits.find((d) => d.status === "rejected");
        assert.equal(rejectedLine.rejectionReason, "Screenshot illegible.");
        assert.equal(rejectedLine.label, "300 EGP");

        const approvedLine = body.summary.deposits.find((d) => d.status === "approved");
        assert.equal(approvedLine.rejectionReason, null);

        assertNoForbiddenKeys(body.summary);
      });
    } finally {
      restoreFind();
      restoreDepositFind();
      restoreFullPayment();
    }
  });

  await t.test("no FullPaymentStatus document yields fullPaymentConfirmed: false", async () => {
    const attendeeId = makeId();
    const restoreFind = stub(Attendee, "findById", () =>
      queryResult({ _id: attendeeId, attendeeType: "incomer", phoneNormalized: "01012345678", ticketPrice: 500, schoolId: makeId() })
    );
    const restoreDepositFind = stub(Deposit, "find", () => queryResult([]));
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01012345678" })
        });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.summary.fullPaymentConfirmed, false);
        assert.equal(body.summary.activeDepositCount, 0);
      });
    } finally {
      restoreFind();
      restoreDepositFind();
      restoreFullPayment();
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
// POST /api/payments/customer-options — school-specific, remaining-filtered
// ---------------------------------------------------------------------------

test("POST /api/payments/customer-options", async (t) => {
  await t.test("School A's customer sees only School A's enabled options, sorted", async () => {
    const schoolAId = makeId();
    const schoolBId = makeId();
    const attendeeId = makeId();

    const restoreAttendeeFind = stub(Attendee, "findById", () =>
      queryResult(fakeAttendee({ _id: attendeeId, schoolId: schoolAId, ticketPrice: 6000 }))
    );
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));
    const restoreDepositFind = stub(Deposit, "find", () => queryResult([]));

    let queriedFilter = null;
    const restorePaymentOptionFind = stub(PaymentOption, "find", (filter) => {
      queriedFilter = filter;
      // Simulate the real Mongo filter: only School A's enabled docs match.
      const allDocs = [
        { _id: makeId(), schoolId: schoolAId, amount: 500, label: "500 EGP", enabled: true, displayOrder: 2, createdAt: new Date("2026-01-02") },
        { _id: makeId(), schoolId: schoolAId, amount: 1000, label: "1000 EGP", enabled: true, displayOrder: 1, createdAt: new Date("2026-01-01") },
        { _id: makeId(), schoolId: schoolAId, amount: 9999, label: "Disabled", enabled: false, displayOrder: 3, createdAt: new Date("2026-01-03") },
        { _id: makeId(), schoolId: schoolBId, amount: 750, label: "750 EGP (School B)", enabled: true, displayOrder: 1, createdAt: new Date("2026-01-01") }
      ];
      // Real Mongo applies .sort({displayOrder:1, createdAt:1}) server-side;
      // this mock does it explicitly so the test actually proves the route
      // asks for the right order, not just the right filter.
      const matched = allDocs
        .filter((doc) => String(doc.schoolId) === String(filter.schoolId) && doc.enabled === filter.enabled)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt - b.createdAt);
      return queryResult(matched);
    });

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01012345678" })
        });
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.equal(String(queriedFilter.schoolId), String(schoolAId));
        assert.equal(queriedFilter.enabled, true);

        // 1000 sorts before 500 (displayOrder 1 < 2); School B's 750 and the
        // disabled 9999 never appear.
        assert.deepEqual(
          body.paymentOptions.map((o) => o.amount),
          [1000, 500]
        );
        for (const option of body.paymentOptions) {
          assert.deepEqual(Object.keys(option).sort(), ["amount", "id", "label"]);
        }
        assertNoForbiddenKeys(body.paymentOptions);
      });
    } finally {
      restoreAttendeeFind();
      restoreFullPayment();
      restoreDepositFind();
      restorePaymentOptionFind();
    }
  });

  await t.test("School B's customer never sees School A's options (independent query)", async () => {
    const schoolBId = makeId();
    const attendeeId = makeId();

    const restoreAttendeeFind = stub(Attendee, "findById", () =>
      queryResult(fakeAttendee({ _id: attendeeId, schoolId: schoolBId, ticketPrice: 4000 }))
    );
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));
    const restoreDepositFind = stub(Deposit, "find", () => queryResult([]));
    const restorePaymentOptionFind = stub(PaymentOption, "find", (filter) =>
      queryResult(
        String(filter.schoolId) === String(schoolBId)
          ? [{ _id: makeId(), schoolId: schoolBId, amount: 2000, label: null, enabled: true, displayOrder: 1, createdAt: new Date() }]
          : []
      )
    );

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01012345678" })
        });
        const body = await res.json();
        assert.deepEqual(body.paymentOptions.map((o) => o.amount), [2000]);
      });
    } finally {
      restoreAttendeeFind();
      restoreFullPayment();
      restoreDepositFind();
      restorePaymentOptionFind();
    }
  });

  await t.test("options greater than the internal remaining balance are filtered out, not disabled", async () => {
    const schoolId = makeId();
    const attendeeId = makeId();

    const restoreAttendeeFind = stub(Attendee, "findById", () =>
      queryResult(fakeAttendee({ _id: attendeeId, schoolId, ticketPrice: 1000 }))
    );
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));
    // approvedTotalPaid = 700 → remainingBalance = 300 (internal only)
    const restoreDepositFind = stub(Deposit, "find", () => queryResult([{ amount: 700, status: "approved" }]));
    const restorePaymentOptionFind = stub(PaymentOption, "find", () =>
      queryResult([
        { _id: makeId(), schoolId, amount: 200, label: "Fits", enabled: true, displayOrder: 1, createdAt: new Date() },
        { _id: makeId(), schoolId, amount: 500, label: "Too big", enabled: true, displayOrder: 2, createdAt: new Date() }
      ])
    );

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01012345678" })
        });
        const body = await res.json();
        assert.deepEqual(body.paymentOptions.map((o) => o.amount), [200]);
        // remainingBalance (300) itself is never in the response.
        assertNoForbiddenKeys(body);
      });
    } finally {
      restoreAttendeeFind();
      restoreFullPayment();
      restoreDepositFind();
      restorePaymentOptionFind();
    }
  });

  await t.test("fullPaymentConfirmed=true returns an empty option list without querying PaymentOption", async () => {
    const attendeeId = makeId();
    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(fakeAttendee({ _id: attendeeId })));
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult({ confirmed: true }));
    let paymentOptionQueried = false;
    const restorePaymentOptionFind = stub(PaymentOption, "find", () => {
      paymentOptionQueried = true;
      return queryResult([]);
    });

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01012345678" })
        });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.deepEqual(body.paymentOptions, []);
        assert.equal(paymentOptionQueried, false);
      });
    } finally {
      restoreAttendeeFind();
      restoreFullPayment();
      restorePaymentOptionFind();
    }
  });

  await t.test("wrong phone is rejected with the same generic ownership error", async () => {
    const attendeeId = makeId();
    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(fakeAttendee({ _id: attendeeId })));

    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/customer-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendeeId: String(attendeeId), phone: "01000000000" })
        });
        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "We couldn't verify this account. Check your details and try again.");
      });
    } finally {
      restoreAttendeeFind();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/deposits
// ---------------------------------------------------------------------------

function buildDepositForm({ attendeeId, paymentOptionId, phone, includeFile = true }) {
  const form = new FormData();
  if (attendeeId !== undefined) form.append("attendeeId", attendeeId);
  if (paymentOptionId !== undefined) form.append("paymentOptionId", paymentOptionId);
  if (phone !== undefined) form.append("phone", phone);
  if (includeFile) {
    form.append("paymentProof", new Blob([Buffer.from("fake-image-bytes")], { type: "image/png" }), "proof.png");
  }
  return form;
}

test("POST /api/deposits", async (t) => {
  await t.test("correct phone + matching-school option creates a deposit and returns only the safe shape", async () => {
    const attendeeId = makeId();
    const paymentOptionId = makeId();
    const schoolId = makeId();
    const attendee = fakeAttendee({ _id: attendeeId, schoolId });

    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(attendee));
    const restorePaymentOptionFind = stub(PaymentOption, "findById", () =>
      queryResult({ _id: paymentOptionId, schoolId, amount: 300, label: "300 EGP", enabled: true })
    );
    // getAttendeeFinancialSummary() calls Attendee.findById(...).select(...) and Deposit.find(...).sort(...)
    const restoreDepositFind = stub(Deposit, "find", () => queryResult([]));
    const restoreCount = stub(Deposit, "countDocuments", async () => 0);
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));

    let createCallCount = 0;
    let createdWith = null;
    const restoreCreate = stub(Deposit, "create", async (data) => {
      createCallCount += 1;
      createdWith = data;
      return {
        _id: makeId(),
        amount: data.amount,
        status: "pending",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        paymentOptionSnapshot: data.paymentOptionSnapshot,
        paymentProof: data.paymentProof,
        activeSlot: data.activeSlot
      };
    });

    const uploadResult = { secure_url: "https://cloudinary.example/proof.png", public_id: "alshayeb/incomer-deposit-proofs/abc123" };
    const restoreUpload = stubCloudinaryUploadStream(uploadResult);
    let destroyCalled = false;
    const restoreDestroy = stubCloudinaryDestroy(async () => {
      destroyCalled = true;
      return { result: "ok" };
    });

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(paymentOptionId),
          phone: "01012345678"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();

        assert.equal(res.status, 201);
        assert.equal(body.success, true);
        assert.equal(createCallCount, 1);
        assert.equal(destroyCalled, false, "no cleanup should run on the success path");
        assert.equal(createdWith.amount, 300, "amount must come from the server-side PaymentOption, not the request");

        assert.deepEqual(Object.keys(body.deposit).sort(), ["amount", "createdAt", "id", "label", "status"]);
        assert.equal(body.deposit.amount, 300);
        assert.equal(body.deposit.label, "300 EGP");
        assert.equal(body.deposit.status, "pending");
        assertNoForbiddenKeys(body.deposit);
      });
    } finally {
      restoreAttendeeFind();
      restorePaymentOptionFind();
      restoreDepositFind();
      restoreCount();
      restoreCreate();
      restoreUpload();
      restoreDestroy();
      restoreFullPayment();
    }
  });

  await t.test("a PaymentOption belonging to a DIFFERENT School is rejected with the same generic message, no upload", async () => {
    const attendeeId = makeId();
    const paymentOptionId = makeId();
    const attendeeSchoolId = makeId();
    const otherSchoolId = makeId();
    const attendee = fakeAttendee({ _id: attendeeId, schoolId: attendeeSchoolId });

    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(attendee));
    // A real, enabled option — just owned by a different School.
    const restorePaymentOptionFind = stub(PaymentOption, "findById", () =>
      queryResult({ _id: paymentOptionId, schoolId: otherSchoolId, amount: 300, label: "300 EGP", enabled: true })
    );
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));
    let uploadCalled = false;
    const restoreUpload = stub(cloudinary.uploader, "upload_stream", () => {
      uploadCalled = true;
      return { end: () => {} };
    });
    let createCalled = false;
    const restoreCreate = stub(Deposit, "create", async () => {
      createCalled = true;
      return null;
    });

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(paymentOptionId),
          phone: "01012345678"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();

        assert.equal(res.status, 422);
        // Same message as "disabled"/"missing" — never reveals the real reason.
        assert.equal(body.message, "Selected payment option is not available.");
        assert.equal(uploadCalled, false);
        assert.equal(createCalled, false);
      });
    } finally {
      restoreAttendeeFind();
      restorePaymentOptionFind();
      restoreFullPayment();
      restoreUpload();
      restoreCreate();
    }
  });

  await t.test("wrong phone is rejected before any upload or Deposit.create", async () => {
    const attendeeId = makeId();
    const paymentOptionId = makeId();
    const attendee = fakeAttendee({ _id: attendeeId });

    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(attendee));
    let uploadCalled = false;
    const restoreUpload = stub(cloudinary.uploader, "upload_stream", () => {
      uploadCalled = true;
      return { end: () => {} };
    });
    let createCalled = false;
    const restoreCreate = stub(Deposit, "create", async () => {
      createCalled = true;
      return null;
    });

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(paymentOptionId),
          phone: "01099999999"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();

        assert.equal(res.status, 404);
        assert.equal(body.message, "We couldn't verify this account. Check your details and try again.");
        assert.equal(uploadCalled, false);
        assert.equal(createCalled, false);
      });
    } finally {
      restoreAttendeeFind();
      restoreUpload();
      restoreCreate();
    }
  });

  await t.test("missing phone field is a 422 validation error", async () => {
    await withServer(async (base) => {
      const form = buildDepositForm({ attendeeId: String(makeId()), paymentOptionId: String(makeId()) });
      const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
      const body = await res.json();
      assert.equal(res.status, 422);
      assert.equal(body.message, "A valid phone number is required.");
    });
  });

  await t.test("max-5 active deposits: claimActiveSlot exhausts all slots, upload is cleaned up", async () => {
    const attendeeId = makeId();
    const paymentOptionId = makeId();
    const schoolId = makeId();
    const attendee = fakeAttendee({ _id: attendeeId, schoolId });

    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(attendee));
    const restorePaymentOptionFind = stub(PaymentOption, "findById", () =>
      queryResult({ _id: paymentOptionId, schoolId, amount: 100, label: "100 EGP", enabled: true })
    );
    const restoreDepositFind = stub(Deposit, "find", () => queryResult([]));
    // Pre-check under-counts on purpose (simulating a race) so the real
    // authority — claimActiveSlot's duplicate-key loop — is what's exercised.
    const restoreCount = stub(Deposit, "countDocuments", async () => 0);
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));

    const dupError = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    const restoreCreate = stub(Deposit, "create", async () => {
      throw dupError;
    });

    const uploadResult = { secure_url: "https://cloudinary.example/proof.png", public_id: "alshayeb/incomer-deposit-proofs/full123" };
    const restoreUpload = stubCloudinaryUploadStream(uploadResult);
    let destroyedPublicId = null;
    const restoreDestroy = stubCloudinaryDestroy(async (publicId) => {
      destroyedPublicId = publicId;
      return { result: "ok" };
    });

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(paymentOptionId),
          phone: "01012345678"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();

        assert.equal(res.status, 422);
        assert.match(body.message, /maximum of 5 active deposits/);
        assert.equal(destroyedPublicId, uploadResult.public_id, "orphaned upload must be cleaned up");
      });
    } finally {
      restoreAttendeeFind();
      restorePaymentOptionFind();
      restoreDepositFind();
      restoreCount();
      restoreCreate();
      restoreUpload();
      restoreDestroy();
      restoreFullPayment();
    }
  });

  await t.test("amount over the internal remaining balance is still rejected server-side without reaching upload", async () => {
    const attendeeId = makeId();
    const paymentOptionId = makeId();
    const schoolId = makeId();
    const attendee = fakeAttendee({ _id: attendeeId, schoolId, ticketPrice: 100 });

    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(attendee));
    const restorePaymentOptionFind = stub(PaymentOption, "findById", () =>
      queryResult({ _id: paymentOptionId, schoolId, amount: 500, label: "500 EGP", enabled: true })
    );
    // Already fully paid: approvedTotalPaid === ticketPrice → remaining 0
    const restoreDepositFind = stub(Deposit, "find", () =>
      queryResult([{ amount: 100, status: "approved" }])
    );
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));
    let uploadCalled = false;
    const restoreUpload = stub(cloudinary.uploader, "upload_stream", () => {
      uploadCalled = true;
      return { end: () => {} };
    });

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(paymentOptionId),
          phone: "01012345678"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();
        assert.equal(res.status, 422);
        assert.match(body.message, /exceeds the remaining balance/);
        assert.equal(uploadCalled, false);
      });
    } finally {
      restoreAttendeeFind();
      restorePaymentOptionFind();
      restoreDepositFind();
      restoreUpload();
      restoreFullPayment();
    }
  });

  await t.test("disabled/unknown PaymentOption is rejected", async () => {
    const attendeeId = makeId();
    const attendee = fakeAttendee({ _id: attendeeId });
    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(attendee));
    const restorePaymentOptionFind = stub(PaymentOption, "findById", () => queryResult(null));
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult(null));

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(makeId()),
          phone: "01012345678"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();
        assert.equal(res.status, 422);
        assert.equal(body.message, "Selected payment option is not available.");
      });
    } finally {
      restoreAttendeeFind();
      restorePaymentOptionFind();
      restoreFullPayment();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/deposits — Full Payment lock (Step 0 guard)
// ---------------------------------------------------------------------------

test("POST /api/deposits — Full Payment lock", async (t) => {
  function stubHappyPathUpTo({ attendee, paymentOption, fullPaymentDoc }) {
    const restores = [
      stub(Attendee, "findById", () => queryResult(attendee)),
      stub(PaymentOption, "findById", () => queryResult(paymentOption)),
      stub(Deposit, "find", () => queryResult([])),
      stub(Deposit, "countDocuments", async () => 0),
      stub(FullPaymentStatus, "findOne", () => queryResult(fullPaymentDoc))
    ];
    return () => restores.forEach((restore) => restore());
  }

  await t.test("confirmed=false → deposit creation still works", async () => {
    const attendeeId = makeId();
    const paymentOptionId = makeId();
    const schoolId = makeId();
    const restoreAll = stubHappyPathUpTo({
      attendee: fakeAttendee({ _id: attendeeId, schoolId }),
      paymentOption: { _id: paymentOptionId, schoolId, amount: 250, label: "250 EGP", enabled: true },
      fullPaymentDoc: { confirmed: false }
    });
    const restoreCreate = stub(Deposit, "create", async (data) => ({
      _id: makeId(),
      amount: data.amount,
      status: "pending",
      createdAt: new Date(),
      paymentOptionSnapshot: data.paymentOptionSnapshot
    }));
    const restoreUpload = stubCloudinaryUploadStream({
      secure_url: "https://cloudinary.example/proof.png",
      public_id: "alshayeb/incomer-deposit-proofs/full-lock-false"
    });

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(paymentOptionId),
          phone: "01012345678"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.deposit.status, "pending");
      });
    } finally {
      restoreAll();
      restoreCreate();
      restoreUpload();
    }
  });

  await t.test("no FullPaymentStatus row → works normally", async () => {
    const attendeeId = makeId();
    const paymentOptionId = makeId();
    const schoolId = makeId();
    const restoreAll = stubHappyPathUpTo({
      attendee: fakeAttendee({ _id: attendeeId, schoolId }),
      paymentOption: { _id: paymentOptionId, schoolId, amount: 250, label: "250 EGP", enabled: true },
      fullPaymentDoc: null
    });
    const restoreCreate = stub(Deposit, "create", async (data) => ({
      _id: makeId(),
      amount: data.amount,
      status: "pending",
      createdAt: new Date(),
      paymentOptionSnapshot: data.paymentOptionSnapshot
    }));
    const restoreUpload = stubCloudinaryUploadStream({
      secure_url: "https://cloudinary.example/proof.png",
      public_id: "alshayeb/incomer-deposit-proofs/full-lock-none"
    });

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(paymentOptionId),
          phone: "01012345678"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.deposit.status, "pending");
      });
    } finally {
      restoreAll();
      restoreCreate();
      restoreUpload();
    }
  });

  await t.test("confirmed=true → rejected with no Cloudinary upload and no Deposit.create", async () => {
    const attendeeId = makeId();
    const paymentOptionId = makeId();

    const restoreAttendeeFind = stub(Attendee, "findById", () => queryResult(fakeAttendee({ _id: attendeeId })));
    const restoreFullPayment = stub(FullPaymentStatus, "findOne", () => queryResult({ confirmed: true }));

    let uploadCalled = false;
    const restoreUpload = stub(cloudinary.uploader, "upload_stream", () => {
      uploadCalled = true;
      return { end: () => {} };
    });
    let createCalled = false;
    const restoreCreate = stub(Deposit, "create", async () => {
      createCalled = true;
      return null;
    });
    // If the guard didn't short-circuit, the next call would be
    // PaymentOption.findById — leaving it unstubbed would surface as a
    // thrown error (undefined has no query methods) rather than a silent
    // false pass, so this doubles as a "did we even get this far" tripwire.

    try {
      await withServer(async (base) => {
        const form = buildDepositForm({
          attendeeId: String(attendeeId),
          paymentOptionId: String(paymentOptionId),
          phone: "01012345678"
        });
        const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form });
        const body = await res.json();

        assert.equal(res.status, 422);
        assert.equal(body.message, "Full payment has already been confirmed.");
        assert.equal(uploadCalled, false, "Cloudinary must never be called once Full Payment is confirmed");
        assert.equal(createCalled, false, "Deposit.create must never be called once Full Payment is confirmed");
      });
    } finally {
      restoreAttendeeFind();
      restoreFullPayment();
      restoreUpload();
      restoreCreate();
    }
  });
});

// ---------------------------------------------------------------------------
// Admin endpoints — payment options now require a valid schoolId
// ---------------------------------------------------------------------------

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
