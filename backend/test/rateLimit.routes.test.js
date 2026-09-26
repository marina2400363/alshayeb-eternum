// Route-level rate limiting, driven through the REAL Express app on the
// in-memory database (test/support/memoryDb.js) with the in-memory limiter
// store, a fake Cloudinary and a fake Resend. Nothing leaves this process.
//
// Client IPs are simulated with x-vercel-forwarded-for (process.env.VERCEL is
// set, exactly as on Vercel), so "many users behind one carrier IP" and
// "different networks" are both testable.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.ADMIN_EMAIL = "admin@example.com";
process.env.ADMIN_PASSWORD = "correct-horse-battery";
process.env.NODE_ENV = "test";
process.env.VERCEL = "1";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const resendPkg = require("resend");

const app = require("../src/app");
const rl = require("../src/middleware/rateLimit");
const { LIMITS } = require("../src/config/rateLimits");
const { createMemoryDb } = require("./support/memoryDb");
const { MemoryRateLimitStore } = require("./support/rateLimitMemoryStore");

const NOW = Date.parse("2026-09-20T10:00:00Z");
const IP_A = "198.51.100.10";
const IP_B = "198.51.100.20";

let db;
let store;
let fakeResend;
let restoreConsole;

test.beforeEach(() => {
  db = createMemoryDb();
  rl.__testing.reset();
  store = new MemoryRateLimitStore();
  rl.__testing.setStore(store);
  rl.__testing.setNow(() => NOW);
  delete process.env.RATE_LIMIT_MODE;
  fakeResend = installFakeResend();

  const original = { warn: console.warn, error: console.error };
  console.warn = () => {};
  console.error = () => {};
  restoreConsole = () => Object.assign(console, original);
});

test.afterEach(() => {
  restoreConsole();
  fakeResend.restore();
  rl.__testing.reset();
  db.restore();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
          return { data: { id: "fake" }, error: null };
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

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const parse = async (res) => ({ status: res.status, headers: res.headers, body: await res.json() });

function api(base) {
  const ipHeader = (ip) => (ip ? { "x-vercel-forwarded-for": ip } : {});

  return {
    login: (password, ip = IP_A, email = "admin@example.com") =>
      fetch(`${base}/api/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ipHeader(ip) },
        body: JSON.stringify({ email, password })
      }).then(parse),
    lookup: (phone, ip = IP_A) =>
      fetch(`${base}/api/attendees/season2/lookup?phone=${phone}`, { headers: ipHeader(ip) }).then(parse),
    register: (fields, ip = IP_A, { includePhoto = true } = {}) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      if (includePhoto) form.append("incomerPhoto", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "photo.png");
      return fetch(`${base}/api/attendees/register`, { method: "POST", headers: ipHeader(ip), body: form }).then(parse);
    },
    postJson: (path, body, ip = IP_A) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ipHeader(ip) },
        body: JSON.stringify(body)
      }).then(parse),
    deposit: (fields, ip = IP_A) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      form.append("paymentProof", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "proof.png");
      return fetch(`${base}/api/deposits`, { method: "POST", headers: ipHeader(ip), body: form }).then(parse);
    }
  };
}

const idOf = (bucket, limit, windowSec, identity) => rl.__testing.idFor(rl.rule(bucket, limit, windowSec, identity));
const ipIdentity = (ip) => `v4:${ip}`;

function assertRateLimited(res) {
  assert.equal(res.status, 429);
  assert.equal(res.body.success, false);
  assert.ok(typeof res.body.message === "string" && res.body.message.length > 0);
  assert.ok(Number(res.headers.get("retry-after")) >= 1, "Retry-After header must be present");
  assert.ok(res.body.retryAfterSeconds >= 1);
}

function summaryBody(attendee, overrides = {}) {
  return { attendeeId: String(attendee._id), phone: attendee.phoneNormalized, ...overrides };
}

function setupCustomer() {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500, 1000] });
  const attendee = db.addAttendee(school);
  return { school, attendee };
}

// ---------------------------------------------------------------------------
// A. Admin login
// ---------------------------------------------------------------------------

test("A. admin login", async (t) => {
  await t.test("5 failed logins per IP, then 429 + Retry-After — even with the correct password", async () => {
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < LIMITS.adminLoginFailuresPerIp.limit; i += 1) {
        const res = await c.login("wrong-password", IP_A);
        assert.equal(res.status, 401);
      }

      const blocked = await c.login("correct-horse-battery", IP_A);
      assertRateLimited(blocked);
      assert.equal(blocked.body.token, undefined);
      assert.match(blocked.body.message, /Try again in \d+ minutes/);
    });
  });

  await t.test("the lock is per IP: another IP can still log in", async () => {
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 5; i += 1) await c.login("wrong-password", IP_A);
      assertRateLimited(await c.login("correct-horse-battery", IP_A));

      const other = await c.login("correct-horse-battery", IP_B);
      assert.equal(other.status, 200);
      assert.ok(other.body.token);
    });
  });

  await t.test("global failed-login ceiling: 30 failures across many IPs blocks everyone (fresh IP too)", async () => {
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < LIMITS.adminLoginFailuresGlobal.limit; i += 1) {
        const res = await c.login("wrong-password", `203.0.113.${i + 1}`);
        assert.equal(res.status, 401);
      }

      assertRateLimited(await c.login("correct-horse-battery", "203.0.113.200"));
    });
  });

  await t.test("successful logins are not counted as failures", async () => {
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 12; i += 1) assert.equal((await c.login("correct-horse-battery", IP_A)).status, 200);
      // a wrong password afterwards still gets the normal 401, not a lock
      assert.equal((await c.login("wrong-password", IP_A)).status, 401);
    });
  });

  await t.test("validation errors (missing fields) are not counted as failures", async () => {
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 10; i += 1) assert.equal((await c.login("", IP_A)).status, 400);
      assert.equal((await c.login("correct-horse-battery", IP_A)).status, 200);
    });
  });

  await t.test("FAIL CLOSED: limiter store down -> 503, no token, even with the correct password", async () => {
    store.fail();
    await withServer(async (base) => {
      const res = await api(base).login("correct-horse-battery", IP_A);
      assert.equal(res.status, 503);
      assert.equal(res.body.token, undefined);
    });
  });

  await t.test("stored keys contain no IP or email", async () => {
    await withServer(async (base) => {
      await api(base).login("wrong-password", IP_A, "someone@example.com");
    });
    const persisted = store.serialized();
    assert.ok(store.docs.size >= 1);
    assert.equal(persisted.includes(IP_A), false);
    assert.equal(persisted.includes("someone"), false);
  });
});

// ---------------------------------------------------------------------------
// B. Season 2 lookup
// ---------------------------------------------------------------------------

test("B. Season 2 lookup", async (t) => {
  await t.test("per phone: 15 per 10 min, then 429 + Retry-After; a different phone is unaffected", async () => {
    const { attendee } = setupCustomer();
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < LIMITS.lookupPerPhone.limit; i += 1) {
        const res = await c.lookup(attendee.phoneNormalized, IP_A);
        assert.equal(res.status, 200);
        assert.equal(res.body.found, true);
      }

      assertRateLimited(await c.lookup(attendee.phoneNormalized, IP_A));
      assert.equal((await c.lookup("01099999999", IP_A)).status, 200);
    });
  });

  await t.test("the per-phone limit follows the PHONE across IPs (identity, not IP)", async () => {
    const { attendee } = setupCustomer();
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 15; i += 1) await c.lookup(attendee.phoneNormalized, `203.0.113.${i + 1}`);
      assertRateLimited(await c.lookup(attendee.phoneNormalized, "203.0.113.250"));
    });
  });

  await t.test("shared carrier IP: 120 DIFFERENT phones from one IP are all served", async () => {
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 120; i += 1) {
        const phone = `0101${String(1000000 + i)}`;
        assert.equal((await c.lookup(phone, IP_A)).status, 200, `phone #${i} must not be blocked`);
      }
    });
  });

  await t.test("high IP flood ceiling: 300 per 10 min, then 429 even for a new phone", async () => {
    store.seed(idOf("lookup-ip", 300, 600, ipIdentity(IP_A)), LIMITS.lookupIpCeiling.limit);
    await withServer(async (base) => {
      const c = api(base);
      assertRateLimited(await c.lookup("01011112222", IP_A));
      assert.equal((await c.lookup("01011112222", IP_B)).status, 200);
    });
  });

  await t.test("malformed phone is a normal 422 (validation), not a limiter decision", async () => {
    await withServer(async (base) => {
      const res = await api(base).lookup("123", IP_A);
      assert.equal(res.status, 422);
    });
  });

  await t.test("FAIL OPEN: limiter store down -> lookup still works", async () => {
    const { attendee } = setupCustomer();
    store.fail();
    await withServer(async (base) => {
      const res = await api(base).lookup(attendee.phoneNormalized, IP_A);
      assert.equal(res.status, 200);
      assert.equal(res.body.found, true);
    });
  });
});

// ---------------------------------------------------------------------------
// C. Season 2 registration
// ---------------------------------------------------------------------------

function registrationFields(school, overrides = {}) {
  return { fullName: "Marina Adel", phone: "01012345678", email: "marina@example.com", schoolId: String(school._id), ...overrides };
}

test("C. Season 2 registration", async (t) => {
  await t.test("per email: 3 new registrations per 24h, the 4th is 429 and uploads/emails NOTHING", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < LIMITS.registerPerEmail.limit; i += 1) {
        const res = await c.register(registrationFields(school, { phone: `0101000000${i}` }), IP_A);
        assert.equal(res.status, 201);
      }
      assert.equal(db.uploads.length, 3);
      assert.equal(fakeResend.calls.length, 3);

      const blocked = await c.register(registrationFields(school, { phone: "01010000009" }), IP_A);
      assertRateLimited(blocked);
      assert.equal(db.uploads.length, 3, "Cloudinary must NOT be called when blocked");
      assert.equal(fakeResend.calls.length, 3, "Resend must NOT be called when blocked");
      assert.equal(db.attendees.length, 3);
    });
  });

  await t.test("per phone: 6 attempts per hour (duplicates count), the 7th is 429, no extra upload/email", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    await withServer(async (base) => {
      const c = api(base);
      const first = await c.register(registrationFields(school), IP_A);
      assert.equal(first.status, 201);

      for (let i = 1; i < LIMITS.registerPerPhone.limit; i += 1) {
        const res = await c.register(registrationFields(school, { email: `other${i}@example.com` }), IP_A);
        assert.equal(res.status, 200);
        assert.equal(res.body.duplicate, true);
      }

      assertRateLimited(await c.register(registrationFields(school, { email: "other9@example.com" }), IP_A));
      assert.equal(db.uploads.length, 1);
      assert.equal(fakeResend.calls.length, 1);
    });
  });

  await t.test("pre-parse IP flood ceiling (300/hour): blocked BEFORE the upload is even parsed", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    store.seed(idOf("register-ip", 300, 3600, ipIdentity(IP_A)), LIMITS.registerIpCeiling.limit);
    await withServer(async (base) => {
      const res = await api(base).register(registrationFields(school), IP_A);
      assertRateLimited(res);
      assert.equal(db.uploads.length, 0);
      assert.equal(db.attendees.length, 0);
      assert.equal(fakeResend.calls.length, 0);

      // a different network is unaffected
      assert.equal((await api(base).register(registrationFields(school), IP_B)).status, 201);
    });
  });

  await t.test("shared carrier IP: 40 different people register from one IP without any block", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 40; i += 1) {
        const res = await c.register(registrationFields(school, { phone: `0102${String(3000000 + i)}`, email: `student${i}@example.com` }), IP_A);
        assert.equal(res.status, 201, `registration #${i} must not be blocked`);
      }
    });
  });

  await t.test("validation failures stay normal 4xx and are not turned into 429", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    await withServer(async (base) => {
      const res = await api(base).register(registrationFields(school, { email: "not-an-email" }), IP_A);
      assert.equal(res.status, 422);
    });
  });

  await t.test("FAIL OPEN: limiter store down -> registration still works (upload + email happen)", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    store.fail();
    await withServer(async (base) => {
      const res = await api(base).register(registrationFields(school), IP_A);
      assert.equal(res.status, 201);
      assert.equal(db.uploads.length, 1);
      assert.equal(fakeResend.calls.length, 1);
    });
  });

  await t.test("stored keys contain no phone, email or IP", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    await withServer(async (base) => {
      await api(base).register(registrationFields(school), IP_A);
    });
    const persisted = store.serialized();
    assert.ok(store.docs.size >= 3);
    for (const value of ["01012345678", "marina@example.com", "marina", IP_A]) {
      assert.equal(persisted.includes(value), false, `leaked: ${value}`);
    }
  });
});

// ---------------------------------------------------------------------------
// D/E/F. Customer summary, options, acknowledge
// ---------------------------------------------------------------------------

for (const endpoint of [
  { name: "summary", path: "/api/payments/customer-summary", limit: LIMITS.summaryPerAttendee.limit, ipBucket: "summary-ip", ipLimit: LIMITS.summaryIpCeiling.limit },
  { name: "options", path: "/api/payments/customer-options", limit: LIMITS.optionsPerAttendee.limit, ipBucket: "options-ip", ipLimit: LIMITS.optionsIpCeiling.limit }
]) {
  test(`${endpoint.name === "summary" ? "D" : "E"}. customer ${endpoint.name}`, async (t) => {
    await t.test(`per attendeeId: ${endpoint.limit} per 5 min, then 429; another attendee from the same IP is fine`, async () => {
      const { school, attendee } = setupCustomer();
      const other = db.addAttendee(school);
      await withServer(async (base) => {
        const c = api(base);
        for (let i = 0; i < endpoint.limit; i += 1) {
          assert.equal((await c.postJson(endpoint.path, summaryBody(attendee), IP_A)).status, 200);
        }
        assertRateLimited(await c.postJson(endpoint.path, summaryBody(attendee), IP_A));
        assert.equal((await c.postJson(endpoint.path, summaryBody(other), IP_A)).status, 200);
      });
    });

    await t.test("normal page refreshes (a handful of calls) are never blocked", async () => {
      const { attendee } = setupCustomer();
      await withServer(async (base) => {
        for (let i = 0; i < 8; i += 1) assert.equal((await api(base).postJson(endpoint.path, summaryBody(attendee), IP_A)).status, 200);
      });
    });

    await t.test("shared carrier IP: 60 different customers on one IP, 3 calls each, none blocked", async () => {
      const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500] });
      const customers = Array.from({ length: 60 }, () => db.addAttendee(school));
      await withServer(async (base) => {
        const c = api(base);
        for (const customer of customers) {
          for (let i = 0; i < 3; i += 1) {
            assert.equal((await c.postJson(endpoint.path, summaryBody(customer), IP_A)).status, 200);
          }
        }
      });
    });

    await t.test("IP flood ceiling (600/10 min): 429 for that IP only", async () => {
      const { attendee } = setupCustomer();
      store.seed(idOf(endpoint.ipBucket, 600, 600, ipIdentity(IP_A)), endpoint.ipLimit);
      await withServer(async (base) => {
        assertRateLimited(await api(base).postJson(endpoint.path, summaryBody(attendee), IP_A));
        assert.equal((await api(base).postJson(endpoint.path, summaryBody(attendee), IP_B)).status, 200);
      });
    });

    await t.test("FAIL OPEN: limiter store down -> endpoint works", async () => {
      const { attendee } = setupCustomer();
      store.fail();
      await withServer(async (base) => {
        assert.equal((await api(base).postJson(endpoint.path, summaryBody(attendee), IP_A)).status, 200);
      });
    });
  });
}

test("ownership failures: 20 per 10 min per IP, SHARED by summary/options/acknowledge/deposit", async (t) => {
  await t.test("20 wrong attendeeId+phone pairs -> the 21st request (even a correct pair) is 429 from that IP", async () => {
    const { attendee } = setupCustomer();
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < LIMITS.ownershipFailuresPerIp.limit; i += 1) {
        const res = await c.postJson("/api/payments/customer-summary", summaryBody(attendee, { phone: "01000000000" }), IP_A);
        assert.equal(res.status, 404);
      }

      assertRateLimited(await c.postJson("/api/payments/customer-summary", summaryBody(attendee), IP_A));
      // the shared bucket also blocks the other endpoints for that IP
      assertRateLimited(await c.postJson("/api/payments/customer-options", summaryBody(attendee), IP_A));
      // another IP (e.g. the real owner on their own network) is unaffected
      assert.equal((await c.postJson("/api/payments/customer-summary", summaryBody(attendee), IP_B)).status, 200);
    });
  });

  await t.test("failures are shared across endpoints: 10 on summary + 10 on acknowledge block options", async () => {
    const { attendee } = setupCustomer();
    const wrong = summaryBody(attendee, { phone: "01000000000" });
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 10; i += 1) assert.equal((await c.postJson("/api/payments/customer-summary", wrong, IP_A)).status, 404);
      for (let i = 0; i < 10; i += 1) {
        const res = await c.postJson("/api/payments/acknowledge-confirmation", { ...wrong, depositId: String(new mongoose.Types.ObjectId()) }, IP_A);
        assert.equal(res.status, 404);
      }
      assertRateLimited(await c.postJson("/api/payments/customer-options", summaryBody(attendee), IP_A));
    });
  });

  await t.test("validation errors (bad id / bad phone) do NOT count as ownership failures", async () => {
    const { attendee } = setupCustomer();
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 30; i += 1) {
        const res = await c.postJson("/api/payments/customer-summary", { attendeeId: "not-an-id", phone: attendee.phoneNormalized }, IP_A);
        assert.equal(res.status, 422);
      }
      assert.equal((await c.postJson("/api/payments/customer-summary", summaryBody(attendee), IP_A)).status, 200);
    });
  });

  await t.test("a legitimate owner is never counted as a failure", async () => {
    const { attendee } = setupCustomer();
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 40; i += 1) assert.equal((await c.postJson("/api/payments/customer-summary", summaryBody(attendee), IP_A)).status, 200);
      assert.equal(store.countFor(idOf("ownership-fail-ip", 20, 600, ipIdentity(IP_A))), 0);
    });
  });
});

test("F. acknowledge confirmation: per attendeeId 20 per 10 min, then 429", async () => {
  const { attendee } = setupCustomer();
  await withServer(async (base) => {
    const c = api(base);
    const body = { ...summaryBody(attendee), depositId: String(new mongoose.Types.ObjectId()) };
    for (let i = 0; i < LIMITS.acknowledgePerAttendee.limit; i += 1) {
      // no such confirmation -> the normal business 404 (NOT an ownership failure)
      assert.equal((await c.postJson("/api/payments/acknowledge-confirmation", body, IP_A)).status, 404);
    }
    assertRateLimited(await c.postJson("/api/payments/acknowledge-confirmation", body, IP_A));
  });
});

// ---------------------------------------------------------------------------
// G. Deposit submission
// ---------------------------------------------------------------------------

function depositFields(school, attendee, overrides = {}) {
  return {
    attendeeId: String(attendee._id),
    phone: attendee.phoneNormalized,
    paymentOptionId: String(db.optionOf(school, 500)._id),
    ...overrides
  };
}

test("G. deposit submission", async (t) => {
  await t.test("per attendeeId: 5 per hour; the 6th is 429 and never reaches Cloudinary", async () => {
    const { school, attendee } = setupCustomer();
    await withServer(async (base) => {
      const c = api(base);
      const first = await c.deposit(depositFields(school, attendee), IP_A);
      assert.equal(first.status, 201);
      assert.equal(db.uploads.length, 1);

      // 4 more attempts: the cycle is busy (409) — they still count toward the quota
      for (let i = 1; i < LIMITS.depositPerAttendee.limit; i += 1) {
        assert.equal((await c.deposit(depositFields(school, attendee), IP_A)).status, 409);
      }

      assertRateLimited(await c.deposit(depositFields(school, attendee), IP_A));
      assert.equal(db.uploads.length, 1, "Cloudinary must NOT be called when blocked");
      assert.equal(db.deposits.length, 1);
    });
  });

  await t.test("pre-parse IP ceiling (200/hour): 429 before the file is parsed or uploaded", async () => {
    const { school, attendee } = setupCustomer();
    store.seed(idOf("deposit-ip", 200, 3600, ipIdentity(IP_A)), LIMITS.depositIpCeiling.limit);
    await withServer(async (base) => {
      assertRateLimited(await api(base).deposit(depositFields(school, attendee), IP_A));
      assert.equal(db.uploads.length, 0);
      assert.equal(db.deposits.length, 0);

      assert.equal((await api(base).deposit(depositFields(school, attendee), IP_B)).status, 201);
    });
  });

  await t.test("a stranger cannot burn a customer's quota: wrong-phone attempts fail ownership BEFORE the per-attendee counter", async () => {
    const { school, attendee } = setupCustomer();
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 10; i += 1) {
        const res = await c.deposit(depositFields(school, attendee, { phone: "01000000000" }), IP_B);
        assert.equal(res.status, 404);
      }
      assert.equal(store.countFor(idOf("deposit-attendee", 5, 3600, String(attendee._id))), 0);

      // the real owner, on their own network, submits normally
      assert.equal((await c.deposit(depositFields(school, attendee), IP_A)).status, 201);
    });
  });

  await t.test("ownership failures on deposit share the IP failure bucket (20 -> 429)", async () => {
    const { school, attendee } = setupCustomer();
    await withServer(async (base) => {
      const c = api(base);
      for (let i = 0; i < 20; i += 1) {
        assert.equal((await c.deposit(depositFields(school, attendee, { phone: "01000000000" }), IP_A)).status, 404);
      }
      assertRateLimited(await c.deposit(depositFields(school, attendee), IP_A));
      assert.equal(db.uploads.length, 0);
    });
  });

  await t.test("shared carrier IP: 30 different customers each pay once from one IP", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500] });
    const customers = Array.from({ length: 30 }, () => db.addAttendee(school));
    await withServer(async (base) => {
      const c = api(base);
      for (const customer of customers) {
        assert.equal((await c.deposit(depositFields(school, customer), IP_A)).status, 201);
      }
      assert.equal(db.uploads.length, 30);
    });
  });

  await t.test("FAIL OPEN: limiter store down -> payment submission still works", async () => {
    const { school, attendee } = setupCustomer();
    store.fail();
    await withServer(async (base) => {
      const res = await api(base).deposit(depositFields(school, attendee), IP_A);
      assert.equal(res.status, 201);
      assert.equal(db.uploads.length, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

test("RATE_LIMIT_MODE=off disables every limiter (and never touches the store)", async () => {
  process.env.RATE_LIMIT_MODE = "off";
  const { attendee } = setupCustomer();
  try {
    await withServer(async (base) => {
      for (let i = 0; i < 20; i += 1) assert.equal((await api(base).lookup(attendee.phoneNormalized, IP_A)).status, 200);
    });
    assert.equal(store.calls.hit, 0);
  } finally {
    delete process.env.RATE_LIMIT_MODE;
  }
});

test("the limiter store is never touched by non-protected routes (health, public settings path untouched)", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
  });
  assert.equal(store.calls.hit + store.calls.count + store.calls.record, 0);
});
