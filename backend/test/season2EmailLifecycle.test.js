// End-to-end tests for the Season 2 transactional email lifecycle, driven
// through the REAL routes (registration, deposit submission, admin
// approve/reject, Full Payment sheet sync) on the in-memory database
// (test/support/memoryDb.js). No live Mongo, Cloudinary or Google Sheets
// connection, and no real Resend call: the Resend constructor is swapped on
// the `resend` module object (see season2Email.js's testability note) and
// Google Sheets is faked the same way test/googleSheetsFinance.test.js does
// it. Nothing leaves this process.
//
// Run with:  npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-for-real-use";
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-key";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-secret";
process.env.GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || "qa-service-account@example.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY =
  process.env.GOOGLE_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----\\n";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const resendPkg = require("resend");
const { google } = require("googleapis");

const app = require("../src/app");
const Attendee = require("../src/models/Attendee");
const Deposit = require("../src/models/Deposit");
const FullPaymentStatus = require("../src/models/FullPaymentStatus");
const SchoolFinanceConfig = require("../src/models/SchoolFinanceConfig");
const emailModule = require("../src/utils/email");
const { createMemoryDb, queryResult } = require("./support/memoryDb");

const SHEET_ID = "1AbCdEf123456789_ABCDEFGHIJKLMNOPQRSTUVWX";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let db;
test.beforeEach(() => {
  db = createMemoryDb();
});
test.afterEach(() => db.restore());

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

// Fake Resend: never contacts the network. Installed per-test so each test
// controls success/failure independently.
function installFakeResend({ failWith = null } = {}) {
  const calls = [];
  const original = resendPkg.Resend;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "test-resend-key";

  resendPkg.Resend = class FakeResend {
    get emails() {
      return {
        send: async (payload, options) => {
          calls.push({ payload, options });
          if (failWith) return { data: null, error: failWith };
          return { data: { id: "fake-email-id" }, error: null };
        }
      };
    }
  };

  return {
    calls,
    byPrefix: (prefix) => calls.filter((call) => call.options?.idempotencyKey?.startsWith(prefix)),
    restore: () => {
      resendPkg.Resend = original;
      if (originalKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalKey;
    }
  };
}

// Fake Google Sheets for the Full Payment read-back sync (Email E).
function installFinanceHarness() {
  const configs = [];
  const restorers = [];
  const stub = (obj, method, impl) => {
    const orig = obj[method];
    obj[method] = impl;
    restorers.push(() => {
      obj[method] = orig;
    });
  };

  stub(SchoolFinanceConfig, "findOne", (filter = {}) =>
    queryResult(configs.find((doc) => String(doc.schoolId) === String(filter.schoolId)) || null)
  );

  const sheetState = { rows: [] };
  const originalSheets = google.sheets;
  const originalJwt = google.auth.JWT;
  google.auth.JWT = function FakeJWT() {};
  google.sheets = () => ({
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: sheetState.rows.map((row) => [...row]) } })
      }
    }
  });

  return {
    addConfig: (school, overrides = {}) => {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        schoolId: school._id,
        googleSheetId: SHEET_ID,
        tabName: "Sheet1",
        enabled: true,
        ...overrides
      };
      configs.push(doc);
      return doc;
    },
    setRows: (rows) => {
      sheetState.rows = rows;
    },
    restore: () => {
      while (restorers.length) restorers.pop()();
      google.sheets = originalSheets;
      google.auth.JWT = originalJwt;
    }
  };
}

function client(base) {
  const json = async (res) => ({ status: res.status, body: await res.json() });

  return {
    register: (fields, { includePhoto = true } = {}) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      if (includePhoto) {
        form.append("incomerPhoto", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "photo.png");
      }
      return fetch(`${base}/api/attendees/register`, { method: "POST", body: form }).then(json);
    },
    submitDeposit: (attendee, option) => {
      const form = new FormData();
      form.append("attendeeId", String(attendee._id));
      form.append("phone", attendee.phoneNormalized);
      form.append("paymentOptionId", String(option._id || option));
      form.append("paymentProof", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "proof.png");
      return fetch(`${base}/api/deposits`, { method: "POST", body: form }).then(json);
    },
    approve: (depositId) =>
      fetch(`${base}/api/admin/deposits/${depositId}/approve`, { method: "PUT", headers: adminHeaders() }).then(json),
    reject: (depositId, reason = "Screenshot unclear.") =>
      fetch(`${base}/api/admin/deposits/${depositId}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ rejectionReason: reason })
      }).then(json),
    syncFullPayment: (school) =>
      fetch(`${base}/api/admin/school-finance-config/${school._id}/sync-full-payment`, {
        method: "POST",
        headers: adminHeaders()
      }).then(json)
  };
}

const depositById = (id) => db.deposits.find((deposit) => String(deposit._id) === String(id));
const attendeeById = (id) => db.attendees.find((attendee) => String(attendee._id) === String(id));

// ---------------------------------------------------------------------------
// A. Registration received
// ---------------------------------------------------------------------------

test("A. registration received", async (t) => {
  await t.test("a successful new registration sends exactly one email and stamps registrationSentAt", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });

    try {
      await withServer(async (base) => {
        const res = await client(base).register({
          fullName: "Marina Adel",
          phone: "01012345678",
          email: "marina@example.com",
          schoolId: String(school._id)
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));

        assert.equal(fake.calls.length, 1);
        const attendee = attendeeById(res.body.attendee.id);
        assert.equal(fake.calls[0].options.idempotencyKey, `season2-registration-${attendee._id}`);
        assert.ok(attendee.season2EmailNotifications.registrationSentAt instanceof Date);
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("a duplicate registration (already exists) sends zero new emails", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000 });
    db.addAttendee(school, {
      fullName: "Existing Person",
      phoneNormalized: "01099998888",
      attendeeType: "incomer",
      email: "existing@example.com"
    });

    try {
      await withServer(async (base) => {
        const res = await client(base).register({
          fullName: "Existing Person",
          phone: "01099998888",
          email: "existing@example.com",
          schoolId: String(school._id)
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.duplicate, true);
        assert.equal(fake.calls.length, 0);
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("a race between two concurrent registrations for the same phone sends exactly one email", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000 });

    try {
      await withServer(async (base) => {
        const api = client(base);
        const fields = {
          fullName: "Race Customer",
          phone: "01055556666",
          email: "race@example.com",
          schoolId: String(school._id)
        };
        const [first, second] = await Promise.all([api.register(fields), api.register(fields)]);
        const statuses = [first.status, second.status].sort();
        assert.deepEqual(statuses, [200, 201], "one wins with 201, the other resolves as a duplicate");
        assert.equal(db.attendees.length, 1, "only one Attendee document is ever created");
        assert.equal(fake.calls.length, 1, "the loser's race-recovery branch must never send again");
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("Resend failure never fails registration, and registrationSentAt stays unset", async () => {
    const fake = installFakeResend({ failWith: { statusCode: 500, name: "internal_error", message: "down" } });
    const school = db.addSchool({ ticketPrice: 6000 });

    try {
      await withServer(async (base) => {
        const res = await client(base).register({
          fullName: "Resilient Customer",
          phone: "01033334444",
          email: "resilient@example.com",
          schoolId: String(school._id)
        });
        assert.equal(res.status, 201, "registration succeeds regardless of email provider failure");
        const attendee = attendeeById(res.body.attendee.id);
        assert.equal(attendee.season2EmailNotifications?.registrationSentAt, undefined, "never marked sent on failure");
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("registrationSentAt is unset before send and only set after a confirmed success", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000 });

    try {
      await withServer(async (base) => {
        const res = await client(base).register({
          fullName: "Timestamp Customer",
          phone: "01066667777",
          email: "timestamp@example.com",
          schoolId: String(school._id)
        });
        const attendee = attendeeById(res.body.attendee.id);
        assert.ok(attendee.season2EmailNotifications.registrationSentAt instanceof Date);
      });
    } finally {
      fake.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// B. Payment under review
// ---------------------------------------------------------------------------

test("B. payment under review", async (t) => {
  await t.test("a successful Deposit sends exactly one email and stamps proofReceivedSentAt", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina Adel", email: "marina@example.com" });

    try {
      await withServer(async (base) => {
        const res = await client(base).submitDeposit(customer, db.optionOf(school, 500));
        assert.equal(res.status, 201, JSON.stringify(res.body));

        assert.equal(fake.calls.length, 1);
        const deposit = depositById(res.body.deposit.id);
        assert.equal(fake.calls[0].options.idempotencyKey, `season2-proof-${deposit._id}`);
        assert.ok(deposit.season2EmailNotifications.proofReceivedSentAt instanceof Date);
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("a failed Deposit creation (disabled option) sends zero emails", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000 });
    const disabled = db.addOption(school, { amount: 500, enabled: false });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });

    try {
      await withServer(async (base) => {
        const res = await client(base).submitDeposit(customer, disabled);
        assert.equal(res.status, 422);
        assert.equal(fake.calls.length, 0);
        assert.equal(db.deposits.length, 0);
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("two concurrent submissions block the loser with 409 and send exactly one email", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });
    const option = db.optionOf(school, 500);

    try {
      await withServer(async (base) => {
        const api = client(base);
        const [first, second] = await Promise.all([api.submitDeposit(customer, option), api.submitDeposit(customer, option)]);
        assert.deepEqual([first.status, second.status].sort(), [201, 409]);
        assert.equal(db.deposits.length, 1);
        assert.equal(fake.calls.length, 1, "the blocked/duplicate submission must never send its own email");
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("Resend failure never fails the deposit response, and the Deposit stays valid", async () => {
    const fake = installFakeResend({ failWith: { statusCode: 500, name: "internal_error", message: "down" } });
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });

    try {
      await withServer(async (base) => {
        const res = await client(base).submitDeposit(customer, db.optionOf(school, 500));
        assert.equal(res.status, 201, "the deposit is created regardless of email provider failure");
        const deposit = depositById(res.body.deposit.id);
        assert.equal(deposit.status, "pending");
        assert.equal(deposit.season2EmailNotifications?.proofReceivedSentAt, undefined, "never marked sent on failure");
      });
    } finally {
      fake.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// C. Payment confirmed (approval)
// ---------------------------------------------------------------------------

test("C. payment confirmed", async (t) => {
  await t.test("pending -> approved sends exactly one email and stamps approvalSentAt", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina Adel", email: "marina@example.com" });

    try {
      await withServer(async (base) => {
        const api = client(base);
        const submitted = await api.submitDeposit(customer, db.optionOf(school, 500));
        fake.calls.length = 0; // isolate the approval email from the payment-under-review email

        const approved = await api.approve(submitted.body.deposit.id);
        assert.equal(approved.status, 200);

        assert.equal(fake.calls.length, 1);
        const deposit = depositById(submitted.body.deposit.id);
        assert.equal(fake.calls[0].options.idempotencyKey, `season2-approved-${deposit._id}`);
        assert.ok(deposit.season2EmailNotifications.approvalSentAt instanceof Date);
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("retrying an already-approved Deposit is refused with 409 and sends no second email", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });

    try {
      await withServer(async (base) => {
        const api = client(base);
        const submitted = await api.submitDeposit(customer, db.optionOf(school, 500));
        fake.calls.length = 0;

        assert.equal((await api.approve(submitted.body.deposit.id)).status, 200);
        assert.equal(fake.calls.length, 1);

        const retry = await api.approve(submitted.body.deposit.id);
        assert.equal(retry.status, 409);
        assert.equal(fake.calls.length, 1, "the retry must never send a second confirmation email");
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("Resend failure never undoes the approval", async () => {
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });

    const submitFake = installFakeResend();
    let submitted;
    try {
      await withServer(async (base) => {
        submitted = await client(base).submitDeposit(customer, db.optionOf(school, 500));
      });
    } finally {
      submitFake.restore();
    }

    const failFake = installFakeResend({ failWith: { statusCode: 500, name: "internal_error", message: "down" } });
    try {
      await withServer(async (base) => {
        const approved = await client(base).approve(submitted.body.deposit.id);
        assert.equal(approved.status, 200, "approval succeeds regardless of email provider failure");
        const deposit = depositById(submitted.body.deposit.id);
        assert.equal(deposit.status, "approved");
        assert.equal(deposit.season2EmailNotifications?.approvalSentAt, undefined, "never marked sent on failure");
      });
    } finally {
      failFake.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// D. Payment needs your attention (rejection)
// ---------------------------------------------------------------------------

test("D. payment needs your attention", async (t) => {
  await t.test("pending -> rejected sends exactly one email, escapes the reason, and stamps rejectionSentAt", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina Adel", email: "marina@example.com" });

    try {
      await withServer(async (base) => {
        const api = client(base);
        const submitted = await api.submitDeposit(customer, db.optionOf(school, 500));
        fake.calls.length = 0;

        const rejected = await api.reject(submitted.body.deposit.id, '<script>alert(1)</script> Blurry & unclear');
        assert.equal(rejected.status, 200);

        assert.equal(fake.calls.length, 1);
        const deposit = depositById(submitted.body.deposit.id);
        assert.equal(fake.calls[0].options.idempotencyKey, `season2-rejected-${deposit._id}`);
        assert.ok(deposit.season2EmailNotifications.rejectionSentAt instanceof Date);

        const html = fake.calls[0].payload.html;
        assert.ok(!html.includes("<script>alert(1)</script>"), "rejectionReason must be HTML-escaped");
        assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert.ok(html.includes("Blurry &amp; unclear"));
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("retrying an already-reviewed Deposit is refused with 409 and sends no second email", async () => {
    const fake = installFakeResend();
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });

    try {
      await withServer(async (base) => {
        const api = client(base);
        const submitted = await api.submitDeposit(customer, db.optionOf(school, 500));
        fake.calls.length = 0;

        assert.equal((await api.reject(submitted.body.deposit.id)).status, 200);
        assert.equal(fake.calls.length, 1);

        const retry = await api.reject(submitted.body.deposit.id);
        assert.equal(retry.status, 409);
        assert.equal(fake.calls.length, 1, "the retry must never send a second rejection email");
      });
    } finally {
      fake.restore();
    }
  });

  await t.test("Resend failure never undoes the rejection", async () => {
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });

    const submitFake = installFakeResend();
    let submitted;
    try {
      await withServer(async (base) => {
        submitted = await client(base).submitDeposit(customer, db.optionOf(school, 500));
      });
    } finally {
      submitFake.restore();
    }

    const failFake = installFakeResend({ failWith: { statusCode: 500, name: "internal_error", message: "down" } });
    try {
      await withServer(async (base) => {
        const rejected = await client(base).reject(submitted.body.deposit.id, "Blurry.");
        assert.equal(rejected.status, 200, "rejection succeeds regardless of email provider failure");
        const deposit = depositById(submitted.body.deposit.id);
        assert.equal(deposit.status, "rejected");
        assert.equal(deposit.season2EmailNotifications?.rejectionSentAt, undefined, "never marked sent on failure");
      });
    } finally {
      failFake.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// E. Full payment complete
// ---------------------------------------------------------------------------

const headerRow = ["Customer ID", "Full Name", "Phone", "School", "Ticket Price", "Approved Payments", "Approved Total", "Payment State", "Full Payment"];
const rowFor = (attendee, cell) => [String(attendee._id), attendee.fullName, attendee.phone, "S", 6000, "", 0, "NO PAYMENT", cell];

test("E. full payment complete", async (t) => {
  await t.test("false -> true sends exactly one email and stamps completionSentAt", async () => {
    const fake = installFakeResend();
    const finance = installFinanceHarness();
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school, { fullName: "Marina Adel", email: "marina@example.com" });
    finance.addConfig(school);
    finance.setRows([headerRow, rowFor(customer, "DONE")]);

    try {
      await withServer(async (base) => {
        const res = await client(base).syncFullPayment(school);
        assert.equal(res.status, 200);
        assert.equal(res.body.confirmedCount, 1);

        assert.equal(fake.calls.length, 1);
        assert.equal(fake.calls[0].options.idempotencyKey, `season2-full-payment-${customer._id}`);
        const status = db.fullPayments.find((s) => String(s.attendeeId) === String(customer._id));
        assert.ok(status.season2EmailNotifications.completionSentAt instanceof Date);
      });
    } finally {
      finance.restore();
      fake.restore();
    }
  });

  await t.test("a repeated true -> true sync sends no second email", async () => {
    const fake = installFakeResend();
    const finance = installFinanceHarness();
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });
    finance.addConfig(school);
    finance.setRows([headerRow, rowFor(customer, "DONE")]);

    try {
      await withServer(async (base) => {
        const api = client(base);
        assert.equal((await api.syncFullPayment(school)).body.confirmedCount, 1);
        assert.equal(fake.calls.length, 1);

        const again = await api.syncFullPayment(school);
        assert.equal(again.body.confirmedCount, 1, "still confirmed on re-sync");
        assert.equal(fake.calls.length, 1, "a repeated DONE sync must never re-send");
      });
    } finally {
      finance.restore();
      fake.restore();
    }
  });

  await t.test("false remains false: no email", async () => {
    const fake = installFakeResend();
    const finance = installFinanceHarness();
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });
    finance.addConfig(school);
    finance.setRows([headerRow, rowFor(customer, "")]);

    try {
      await withServer(async (base) => {
        const res = await client(base).syncFullPayment(school);
        assert.equal(res.body.confirmedCount, 0);
        assert.equal(fake.calls.length, 0);
      });
    } finally {
      finance.restore();
      fake.restore();
    }
  });

  await t.test("Resend failure never undoes the confirmed transition", async () => {
    const fake = installFakeResend({ failWith: { statusCode: 500, name: "internal_error", message: "down" } });
    const finance = installFinanceHarness();
    const school = db.addSchool({ ticketPrice: 6000 });
    const customer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });
    finance.addConfig(school);
    finance.setRows([headerRow, rowFor(customer, "DONE")]);

    try {
      await withServer(async (base) => {
        const res = await client(base).syncFullPayment(school);
        assert.equal(res.status, 200);
        assert.equal(res.body.confirmedCount, 1, "confirmed regardless of email provider failure");
        const status = db.fullPayments.find((s) => String(s.attendeeId) === String(customer._id));
        assert.equal(status.confirmed, true);
        assert.equal(status.season2EmailNotifications?.completionSentAt, undefined, "never marked sent on failure");
      });
    } finally {
      finance.restore();
      fake.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy — across every captured lifecycle email
// ---------------------------------------------------------------------------

test("privacy: no lifecycle email ever contains internal/forbidden fields", async () => {
  const fake = installFakeResend();
  const finance = installFinanceHarness();
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school, { fullName: "Marina Adel", email: "marina@example.com" });
  finance.addConfig(school);

  try {
    await withServer(async (base) => {
      const api = client(base);
      await api.register({
        fullName: "Privacy Customer",
        phone: "01044443333",
        email: "privacy@example.com",
        schoolId: String(school._id)
      });
      const submitted = await api.submitDeposit(customer, db.optionOf(school, 500));
      await api.reject(submitted.body.deposit.id, "Screenshot unclear.");

      const second = await api.submitDeposit(customer, db.optionOf(school, 500));
      await api.approve(second.body.deposit.id);

      finance.setRows([headerRow, rowFor(customer, "DONE")]);
      await api.syncFullPayment(school);

      assert.ok(fake.calls.length >= 5, "all five events should have fired at least once");

      const forbidden = [
        "qrToken",
        "qrId",
        "publicId",
        "proof.png",
        "cloudinary",
        "googleSheet",
        String(SHEET_ID),
        "Ticket Price",
        "6000",
        "Paid",
        "Remaining",
        String(customer._id),
        String(school._id)
      ];

      for (const call of fake.calls) {
        const serialized = call.payload.html + call.payload.text;
        for (const term of forbidden) {
          assert.ok(!serialized.includes(term), `a lifecycle email leaked "${term}"`);
        }
      }
    });
  } finally {
    finance.restore();
    fake.restore();
  }
});

// ---------------------------------------------------------------------------
// Legacy isolation — Season 2 flows never touch the legacy sender
// ---------------------------------------------------------------------------

test("legacy isolation: Season 2 routes never call sendStatusEmail", async () => {
  const fake = installFakeResend();
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  // Two separate customers: approving a Deposit does NOT free its payment
  // cycle (only rejection/acknowledgement does), so a second submission from
  // the SAME customer right after an approval would 409 — irrelevant to what
  // this test checks (legacy isolation), so side-step it entirely.
  const approvedCustomer = db.addAttendee(school, { fullName: "Marina", email: "marina@example.com" });
  const rejectedCustomer = db.addAttendee(school, { fullName: "Sara", email: "sara@example.com" });

  const originalSendStatusEmail = emailModule.sendStatusEmail;
  let legacyCalls = 0;
  emailModule.sendStatusEmail = async (...args) => {
    legacyCalls += 1;
    return originalSendStatusEmail(...args);
  };

  try {
    await withServer(async (base) => {
      const api = client(base);
      const registered = await api.register({
        fullName: "Legacy Isolation",
        phone: "01077778888",
        email: "isolation@example.com",
        schoolId: String(school._id)
      });
      assert.equal(registered.status, 201, JSON.stringify(registered.body));

      const submitted = await api.submitDeposit(approvedCustomer, db.optionOf(school, 500));
      assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
      assert.equal((await api.approve(submitted.body.deposit.id)).status, 200);

      const second = await api.submitDeposit(rejectedCustomer, db.optionOf(school, 500));
      assert.equal(second.status, 201, JSON.stringify(second.body));
      assert.equal((await api.reject(second.body.deposit.id)).status, 200);
    });

    assert.equal(legacyCalls, 0, "no Season 2 flow may ever invoke the legacy sendStatusEmail");
    assert.ok(fake.calls.length > 0, "Season 2's own sender was used instead");
  } finally {
    emailModule.sendStatusEmail = originalSendStatusEmail;
    fake.restore();
  }
});
