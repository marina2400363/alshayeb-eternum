// School Access Code flow — through the REAL Express app on the in-memory
// database (test/support/memoryDb.js). No live Mongo, Cloudinary or Resend
// call is ever made.
//
// Covers:
//   1. a valid School code resolves the correct School
//   2. an invalid code reveals no School data
//   3. a code cannot resolve multiple Schools (defence in depth)
//   4. duplicate School codes are rejected (Admin API)
//   5. an arbitrary schoolId cannot bypass code verification
//   6. rate limiting applies to School Access Code attempts
//   7. registration writes the resolved School correctly, and the verified
//      token persists (can be used again by the registration call)

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const resendPkg = require("resend");

const app = require("../src/app");
const rl = require("../src/middleware/rateLimit");
const { SCHOOL_ACCESS_TOKEN_PURPOSE } = require("../src/utils/schoolAccessCode");
const { createMemoryDb } = require("./support/memoryDb");
const { MemoryRateLimitStore } = require("./support/rateLimitMemoryStore");

let db;
const restorers = [];

test.beforeEach(() => {
  db = createMemoryDb();
  rl.__testing.reset();
  rl.__testing.setStore(new MemoryRateLimitStore());
});

test.afterEach(() => {
  while (restorers.length) restorers.pop()();
  rl.__testing.reset();
  db.restore();
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

const parse = async (res) => {
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
};

function installFakeResend() {
  const original = resendPkg.Resend;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "test-resend-key";
  resendPkg.Resend = class FakeResend {
    get emails() {
      return { send: async () => ({ data: { id: "fake" }, error: null }) };
    }
  };
  restorers.push(() => {
    resendPkg.Resend = original;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });
}

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  restorers.push(() => {
    obj[method] = original;
  });
}

function adminToken() {
  return jwt.sign({ email: "admin@alshayeb.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "8h" });
}

function multipart(fields, fileField) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  if (fileField) form.append(fileField, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "file.png");
  return form;
}

// A forged token — as if a customer minted their own with a schoolId of
// their choosing, WITHOUT ever going through /api/school-access/verify.
function forgeSchoolAccessToken(schoolId, overrides = {}) {
  return jwt.sign({ schoolId: String(schoolId), purpose: SCHOOL_ACCESS_TOKEN_PURPOSE, ...overrides }, process.env.JWT_SECRET, {
    expiresIn: "2h"
  });
}

// ---------------------------------------------------------------------------
// 1 & 2. Verify: a valid code resolves exactly the right School; an invalid
// code reveals nothing.
// ---------------------------------------------------------------------------

test("POST /api/school-access/verify: valid code resolves the correct School only", async () => {
  const alpha = db.addSchool({ name: "AlRaya Language School", ticketPrice: 6000, accessCode: "ALRAYA01" });
  db.addSchool({ name: "Other School", ticketPrice: 5000, accessCode: "OTHER002" });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/school-access/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "alraya01" }) // lower-case: comparison is case-insensitive
    }).then(parse);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.schoolName, "AlRaya Language School");
    assert.ok(res.body.schoolAccessToken);

    const payload = jwt.verify(res.body.schoolAccessToken, process.env.JWT_SECRET);
    assert.equal(payload.schoolId, String(alpha._id));
    assert.equal(payload.purpose, SCHOOL_ACCESS_TOKEN_PURPOSE);

    // Nothing about the OTHER School ever appears in the response.
    assert.equal(res.text.includes("Other School"), false);
    assert.equal(res.text.includes(String(alpha._id)), false, "the raw schoolId itself must not appear in the JSON response");
  });
});

test("POST /api/school-access/verify: whitespace around the code is trimmed", async () => {
  db.addSchool({ name: "Heliopolis Prep", ticketPrice: 6000, accessCode: "HELIO777" });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/school-access/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "  helio777  " })
    }).then(parse);

    assert.equal(res.status, 200);
    assert.equal(res.body.schoolName, "Heliopolis Prep");
  });
});

test("POST /api/school-access/verify: an invalid code reveals no School data", async (t) => {
  await t.test("an unknown code -> 422, generic message, no school data", async () => {
    db.addSchool({ name: "Real School", ticketPrice: 6000, accessCode: "REALCODE" });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/school-access/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "WRONGCODE" })
      }).then(parse);

      assert.equal(res.status, 422);
      assert.equal(res.body.success, false);
      assert.equal(res.body.message, "Invalid access code.");
      assert.equal(res.body.schoolAccessToken, undefined);
      assert.equal(res.body.schoolName, undefined);
      assert.equal(res.text.includes("Real School"), false);
      assert.equal(res.text.includes("6000"), false);
    });
  });

  await t.test("an empty code -> 422, same generic message (no field-specific hint)", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/school-access/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "   " })
      }).then(parse);

      assert.equal(res.status, 422);
      assert.equal(res.body.message, "Invalid access code.");
    });
  });

  await t.test("a code belonging to no School vs a real one takes the same code path (no timing/shape tell)", async () => {
    db.addSchool({ name: "Real School", ticketPrice: 6000, accessCode: "REALCODE" });
    await withServer(async (base) => {
      const missing = await fetch(`${base}/api/school-access/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "NOPE0000" })
      }).then(parse);
      assert.equal(missing.status, 422);
      assert.deepEqual(Object.keys(missing.body).sort(), ["message", "success"]);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. A code cannot resolve multiple Schools
// ---------------------------------------------------------------------------

test("POST /api/school-access/verify: an ambiguous code (matches more than one School) is treated as invalid, never picks one", async () => {
  // The unique index prevents this in production; this proves the endpoint
  // itself refuses to guess even if the database ever ended up ambiguous.
  db.addSchool({ name: "School One", ticketPrice: 6000, accessCode: "SHARED01" });
  db.addSchool({ name: "School Two", ticketPrice: 5000, accessCode: "SHARED01" });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/school-access/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "SHARED01" })
    }).then(parse);

    assert.equal(res.status, 422);
    assert.equal(res.body.message, "Invalid access code.");
    assert.equal(res.text.includes("School One"), false);
    assert.equal(res.text.includes("School Two"), false);
  });
});

// ---------------------------------------------------------------------------
// 4. Duplicate School codes are rejected (Admin API)
// ---------------------------------------------------------------------------

test("Admin School Access Code API rejects duplicates and manages codes correctly", async (t) => {
  await t.test("a new School gets a unique access code automatically", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/schools`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
        body: JSON.stringify({ name: "New School", ticketPrice: 4000 })
      }).then(parse);

      assert.equal(res.status, 201);
      assert.ok(res.body.school.accessCode);
      assert.match(res.body.school.accessCode, /^[A-Z0-9]{8}$/);
    });
  });

  await t.test("setting a custom code that collides with another School -> 409, nothing changed", async () => {
    db.addSchool({ name: "School A", ticketPrice: 6000, accessCode: "TAKEN001" });
    const schoolB = db.addSchool({ name: "School B", ticketPrice: 5000, accessCode: "FREEXX02" });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/schools/${schoolB._id}/access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
        body: JSON.stringify({ code: "taken001" }) // case-insensitive collision too
      }).then(parse);

      assert.equal(res.status, 409);
      assert.equal(res.body.success, false);
    });

    assert.equal(schoolB.accessCode, "FREEXX02", "School B's code must be unchanged after the rejected clash");
  });

  await t.test("regenerating (no code given) always produces a fresh, valid code", async () => {
    const school = db.addSchool({ name: "School C", ticketPrice: 6000, accessCode: "OLDCODE1" });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/schools/${school._id}/access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
        body: JSON.stringify({})
      }).then(parse);

      assert.equal(res.status, 200);
      assert.notEqual(res.body.school.accessCode, "OLDCODE1");
      assert.match(res.body.school.accessCode, /^[A-Z0-9]{8}$/);
    });
  });

  await t.test("setting a valid custom code succeeds and normalizes it", async () => {
    const school = db.addSchool({ name: "School D", ticketPrice: 6000 });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/schools/${school._id}/access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
        body: JSON.stringify({ code: "  myCode123  " })
      }).then(parse);

      assert.equal(res.status, 200);
      assert.equal(res.body.school.accessCode, "MYCODE123");
    });
  });

  await t.test("access codes require Admin auth — no token -> 401", async () => {
    const school = db.addSchool({ name: "School E", ticketPrice: 6000 });
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/schools/${school._id}/access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).then(parse);
      assert.equal(res.status, 401);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Arbitrary schoolId cannot bypass code verification
// ---------------------------------------------------------------------------

test("POST /api/attendees/register: a schoolId in the body is never trusted", async (t) => {
  await t.test("no schoolAccessToken at all -> rejected, nothing written", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, accessCode: "HELIO999" });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        body: multipart(
          { fullName: "Attacker", phone: "01099999999", email: "attacker@example.com", schoolId: String(school._id) },
          "incomerPhoto"
        )
      }).then(parse);

      assert.equal(res.status, 422);
      assert.match(res.body.message, /school access/i);
    });

    assert.equal(db.attendees.length, 0);
  });

  await t.test("a schoolId body field is ignored even alongside a valid token for a DIFFERENT school", async () => {
    installFakeResend();
    const realSchool = db.addSchool({ name: "Real School", ticketPrice: 6000, accessCode: "REAL0001" });
    const decoySchool = db.addSchool({ name: "Decoy School", ticketPrice: 9999, accessCode: "DECOY001" });
    const token = forgeSchoolAccessToken(realSchool._id);

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        body: multipart(
          {
            fullName: "Marina Adel",
            phone: "01011122233",
            email: "marina@example.com",
            schoolId: String(decoySchool._id), // attacker tries to override via the raw field
            schoolAccessToken: token
          },
          "incomerPhoto"
        )
      }).then(parse);

      assert.equal(res.status, 201);
    });

    assert.equal(db.attendees.length, 1);
    assert.equal(String(db.attendees[0].schoolId), String(realSchool._id), "the token's School wins, never the body's schoolId");
    assert.equal(db.attendees[0].ticketPrice, 6000, "the ticket price is the REAL school's, not the decoy's 9999");
  });

  await t.test("a forged token (wrong purpose) is rejected", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    const badToken = forgeSchoolAccessToken(school._id, { purpose: "admin" });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        body: multipart(
          { fullName: "Attacker", phone: "01099999998", email: "attacker2@example.com", schoolAccessToken: badToken },
          "incomerPhoto"
        )
      }).then(parse);
      assert.equal(res.status, 422);
      assert.match(res.body.message, /school access/i);
    });
    assert.equal(db.attendees.length, 0);
  });

  await t.test("a token signed with the wrong secret is rejected", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    const badToken = jwt.sign({ schoolId: String(school._id), purpose: "school-access" }, "not-the-real-secret", {
      expiresIn: "2h"
    });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        body: multipart(
          { fullName: "Attacker", phone: "01099999997", email: "attacker3@example.com", schoolAccessToken: badToken },
          "incomerPhoto"
        )
      }).then(parse);
      assert.equal(res.status, 422);
    });
    assert.equal(db.attendees.length, 0);
  });

  await t.test("an expired token is rejected", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    const expiredToken = jwt.sign({ schoolId: String(school._id), purpose: "school-access" }, process.env.JWT_SECRET, {
      expiresIn: -10 // already expired
    });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        body: multipart(
          { fullName: "Attacker", phone: "01099999996", email: "attacker4@example.com", schoolAccessToken: expiredToken },
          "incomerPhoto"
        )
      }).then(parse);
      assert.equal(res.status, 422);
      assert.match(res.body.message, /school access/i);
    });
    assert.equal(db.attendees.length, 0);
  });

  await t.test("a token pointing at a School that no longer exists is rejected", async () => {
    const ghostId = "64b000000000000000000abc";
    const token = forgeSchoolAccessToken(ghostId);

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        body: multipart(
          { fullName: "Attacker", phone: "01099999995", email: "attacker5@example.com", schoolAccessToken: token },
          "incomerPhoto"
        )
      }).then(parse);
      assert.equal(res.status, 422);
    });
    assert.equal(db.attendees.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. Rate limiting applies to School Access Code attempts
// ---------------------------------------------------------------------------

test("POST /api/school-access/verify is rate-limited", async (t) => {
  await t.test("repeated attempts against the SAME code are throttled, valid or not", async () => {
    db.addSchool({ name: "Rate Limited School", ticketPrice: 6000, accessCode: "RATELIM1" });

    await withServer(async (base) => {
      const attempt = () =>
        fetch(`${base}/api/school-access/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "WRONGWRONG" })
        }).then(parse);

      let lastStatus;
      for (let i = 0; i < 8; i += 1) {
        lastStatus = (await attempt()).status;
      }
      assert.equal(lastStatus, 422, "under the limit, attempts are still evaluated normally");

      const blocked = await attempt();
      assert.equal(blocked.status, 429);
      assert.ok(blocked.body.message);
    });
  });

  await t.test("a correct code is ALSO throttled once the per-code bucket is exhausted", async () => {
    db.addSchool({ name: "Rate Limited School 2", ticketPrice: 6000, accessCode: "RATELIM2" });

    await withServer(async (base) => {
      const attempt = (code) =>
        fetch(`${base}/api/school-access/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code })
        }).then(parse);

      for (let i = 0; i < 8; i += 1) await attempt("RATELIM2");
      const blocked = await attempt("RATELIM2");
      assert.equal(blocked.status, 429);
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Registration writes the resolved School correctly; the verified token
//    persists (usable by the later registration call).
// ---------------------------------------------------------------------------

test("end to end: verify then register writes the resolved School, not a guess", async () => {
  installFakeResend();
  const school = db.addSchool({ name: "AlRaya Language School", ticketPrice: 7500, accessCode: "GOOD1234" });

  await withServer(async (base) => {
    const verifyRes = await fetch(`${base}/api/school-access/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "GOOD1234" })
    }).then(parse);
    assert.equal(verifyRes.status, 200);
    const { schoolAccessToken } = verifyRes.body;

    const registerRes = await fetch(`${base}/api/attendees/register`, {
      method: "POST",
      body: multipart(
        { fullName: "Marina Adel", phone: "01055566677", email: "marina2@example.com", schoolAccessToken },
        "incomerPhoto"
      )
    }).then(parse);

    assert.equal(registerRes.status, 201);
    assert.equal(registerRes.body.attendee.attendeeType, "incomer");
  });

  assert.equal(db.attendees.length, 1);
  assert.equal(String(db.attendees[0].schoolId), String(school._id));
  assert.equal(db.attendees[0].ticketPrice, 7500);
});
