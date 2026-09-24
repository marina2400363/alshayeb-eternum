// Pre-launch hardening regressions, through the REAL Express app on the
// in-memory database (test/support/memoryDb.js):
//   1. GET /api/schools never exposes a hidden ticket price or admin fields;
//   2. the legacy Season 1 public write paths are retired (410) without
//      breaking Season 2 Incomer registration;
//   3. the sync triggers require CRON_SECRET (Authorization: Bearer only).
// No live Mongo, Cloudinary, Resend or Google call is ever made.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const resendPkg = require("resend");

const app = require("../src/app");
const Attendee = require("../src/models/Attendee");
const Event = require("../src/models/Event");
const rl = require("../src/middleware/rateLimit");
const { createMemoryDb, queryResult } = require("./support/memoryDb");
const { MemoryRateLimitStore } = require("./support/rateLimitMemoryStore");

let db;
let restoreConsole;
let captured;
const restorers = [];

test.beforeEach(() => {
  db = createMemoryDb();
  rl.__testing.reset();
  rl.__testing.setStore(new MemoryRateLimitStore());

  captured = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const level of Object.keys(original)) {
    console[level] = (...args) => captured.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(" "));
  }
  restoreConsole = () => Object.assign(console, original);
});

test.afterEach(() => {
  restoreConsole();
  while (restorers.length) restorers.pop()();
  rl.__testing.reset();
  db.restore();
  delete process.env.CRON_SECRET;
  delete process.env.ROOMS_GOOGLE_SHEET_ID;
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
  const calls = [];
  const original = resendPkg.Resend;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "test-resend-key";
  resendPkg.Resend = class FakeResend {
    get emails() {
      return { send: async (payload, options) => (calls.push({ payload, options }), { data: { id: "fake" }, error: null }) };
    }
  };
  restorers.push(() => {
    resendPkg.Resend = original;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });
  return calls;
}

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  restorers.push(() => {
    obj[method] = original;
  });
}

// ---------------------------------------------------------------------------
// 1. Public School list: price hidden when the School hides it
// ---------------------------------------------------------------------------

test("GET /api/schools: public shape, ticket price only when the School shows it", async (t) => {
  const seed = () => {
    const visible = db.addSchool({ name: "Visible School", ticketPrice: 6000, showTicketPriceToCustomer: true });
    const hidden = db.addSchool({ name: "Hidden School", ticketPrice: 7777, showTicketPriceToCustomer: false });
    const unset = db.addSchool({ name: "Unset School", ticketPrice: 5555 });
    delete unset.showTicketPriceToCustomer; // legacy document: field physically missing => visible
    for (const school of [visible, hidden, unset]) {
      Object.assign(school, { internalNotes: "admin-only", createdAt: new Date(), updatedAt: new Date(), __v: 0 });
    }
    return { visible, hidden, unset };
  };

  await t.test("hidden price is ABSENT from the response (not just null, not just hidden in the UI)", async () => {
    const { hidden } = seed();
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/schools`).then(parse);
      assert.equal(res.status, 200);

      const entry = res.body.schools.find((school) => school._id === String(hidden._id));
      assert.deepEqual(Object.keys(entry).sort(), ["_id", "name"]);
      assert.equal(res.text.includes("7777"), false, "the hidden amount must not appear anywhere in the response");
    });
  });

  await t.test("visible price is included; a MISSING flag means visible", async () => {
    const { visible, unset } = seed();
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/schools`).then(parse);
      const byId = Object.fromEntries(res.body.schools.map((school) => [school._id, school]));

      assert.deepEqual(byId[String(visible._id)], { _id: String(visible._id), name: "Visible School", ticketPrice: 6000 });
      assert.deepEqual(byId[String(unset._id)], { _id: String(unset._id), name: "Unset School", ticketPrice: 5555 });
    });
  });

  await t.test("no internal/admin fields are ever exposed (allowlist, not denylist)", async () => {
    seed();
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/schools`).then(parse);
      for (const forbidden of ["internalNotes", "showTicketPriceToCustomer", "createdAt", "updatedAt", "__v"]) {
        assert.equal(res.text.includes(forbidden), false, `leaked field: ${forbidden}`);
      }
    });
  });

  await t.test("the Season 2 registration dropdown contract (_id + name) is unchanged", async () => {
    const { visible } = seed();
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/schools`).then(parse);
      assert.equal(res.body.success, true);
      assert.ok(res.body.schools.every((school) => school._id && school.name));
      assert.ok(res.body.schools.some((school) => school._id === String(visible._id)));
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Legacy Season 1 public writes are retired
// ---------------------------------------------------------------------------

function multipart(fields, fileField) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  if (fileField) form.append(fileField, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "file.png");
  return form;
}

test("legacy Season 1 public writes are retired (410 Gone), Season 2 registration untouched", async (t) => {
  await t.test("POST /api/attendees/register with a non-Incomer type -> 410, nothing written, nothing uploaded", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    let legacyUpserts = 0;
    stub(Attendee, "findOneAndUpdate", () => {
      legacyUpserts += 1;
      return queryResult(null);
    });

    await withServer(async (base) => {
      for (const attendeeType of ["guest", "outcomer", "GUEST", "Outcomer", "something-else"]) {
        const res = await fetch(`${base}/api/attendees/register`, {
          method: "POST",
          body: multipart({ attendeeType, fullName: "Legacy User", phone: "01012345678", email: "legacy@example.com", schoolId: String(school._id) }, "incomerPhoto")
        }).then(parse);
        assert.equal(res.status, 410, `attendeeType=${attendeeType}`);
        assert.equal(res.body.success, false);
        assert.equal(res.body.message, "This registration is no longer available.");
      }

      const json = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeType: "outcomer", fullName: "Legacy User", phone: "01012345678" })
      }).then(parse);
      assert.equal(json.status, 410);
    });

    assert.equal(legacyUpserts, 0, "the legacy upsert must never run");
    assert.equal(db.attendees.length, 0);
    assert.equal(db.uploads.length, 0);
  });

  await t.test("Season 2 Incomer registration still works: default type and explicit incomer", async () => {
    installFakeResend();
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });

    await withServer(async (base) => {
      const implicit = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        body: multipart({ fullName: "Marina Adel", phone: "01012345678", email: "marina@example.com", schoolId: String(school._id) }, "incomerPhoto")
      }).then(parse);
      assert.equal(implicit.status, 201);
      assert.equal(implicit.body.attendee.attendeeType, "incomer");

      const explicit = await fetch(`${base}/api/attendees/register`, {
        method: "POST",
        body: multipart(
          { attendeeType: "incomer", fullName: "Second Person", phone: "01023456789", email: "second@example.com", schoolId: String(school._id) },
          "incomerPhoto"
        )
      }).then(parse);
      assert.equal(explicit.status, 201);
    });

    assert.equal(db.attendees.length, 2);
    assert.equal(db.uploads.length, 2);
  });

  await t.test("POST /api/outcomers/register and /payment-proof -> 410 for JSON and multipart alike, nothing touched", async () => {
    const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
    const attendee = db.addAttendee(school, { paymentProof: undefined });
    let writes = 0;
    stub(Attendee, "findByIdAndUpdate", () => {
      writes += 1;
      return queryResult(null);
    });
    stub(Attendee, "create", async () => {
      writes += 1;
      return {};
    });

    await withServer(async (base) => {
      const attempts = [
        ["/api/outcomers/register", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: "X", phone: "01012345678" }) }],
        ["/api/outcomers/register", { body: multipart({ fullName: "X", phone: "01012345678" }, "outcomerPhoto") }],
        ["/api/outcomers/payment-proof", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attendeeId: String(attendee._id) }) }],
        ["/api/outcomers/payment-proof", { body: multipart({ attendeeId: String(attendee._id) }, "paymentProof") }]
      ];

      for (const [path, init] of attempts) {
        const res = await fetch(`${base}${path}`, { method: "POST", ...init }).then(parse);
        assert.equal(res.status, 410, path);
        assert.equal(res.body.message, "This registration is no longer available.");
      }
    });

    assert.equal(writes, 0);
    assert.equal(db.uploads.length, 0);
    assert.equal(attendee.paymentProof, undefined);
  });
});

// ---------------------------------------------------------------------------
// 3. CRON_SECRET protection on the sync triggers
// ---------------------------------------------------------------------------

const SECRET = "test-cron-secret-0123456789abcdef";
const PROTECTED = ["/api/cron/sync-all", "/api/rooms/force-sync"];

test("sync triggers require CRON_SECRET as a Bearer header", async (t) => {
  await t.test("not configured (or too short) -> 503 fail closed, endpoint never runs", async () => {
    let eventQueries = 0;
    stub(Event, "find", () => (eventQueries += 1, queryResult([])));

    await withServer(async (base) => {
      for (const path of PROTECTED) {
        assert.equal((await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${SECRET}` } }).then(parse)).status, 503, `${path} (unset)`);
      }

      process.env.CRON_SECRET = "short";
      for (const path of PROTECTED) {
        assert.equal((await fetch(`${base}${path}`, { headers: { Authorization: "Bearer short" } }).then(parse)).status, 503, `${path} (too short)`);
      }
    });
    assert.equal(eventQueries, 0);
  });

  await t.test("missing / wrong / malformed secret -> 401 and the sync never runs", async () => {
    process.env.CRON_SECRET = SECRET;
    let eventQueries = 0;
    stub(Event, "find", () => (eventQueries += 1, queryResult([])));

    await withServer(async (base) => {
      const attempts = [
        {},
        { headers: { Authorization: "Bearer wrong-secret-value-1234" } },
        { headers: { Authorization: SECRET } }, // no scheme
        { headers: { Authorization: `Basic ${SECRET}` } },
        { headers: { Authorization: "Bearer " } },
        { headers: { Authorization: `Bearer ${SECRET}x` } },
        { headers: { Authorization: `Bearer ${SECRET.slice(0, -1)}` } },
        // an admin JWT is NOT the cron secret
        { headers: { Authorization: `Bearer ${jwt.sign({ email: "a@b.c", role: "admin" }, process.env.JWT_SECRET)}` } }
      ];

      for (const path of PROTECTED) {
        for (const init of attempts) {
          assert.equal((await fetch(`${base}${path}`, init).then(parse)).status, 401, `${path} ${JSON.stringify(init.headers || {})}`);
        }
      }
    });
    assert.equal(eventQueries, 0, "no sync work may happen for unauthenticated callers");
  });

  await t.test("the secret is NOT accepted through the query string", async () => {
    process.env.CRON_SECRET = SECRET;
    await withServer(async (base) => {
      for (const path of PROTECTED) {
        for (const query of [`?secret=${SECRET}`, `?token=${SECRET}`, `?cron_secret=${SECRET}`, `?key=${SECRET}`]) {
          assert.equal((await fetch(`${base}${path}${query}`).then(parse)).status, 401, `${path}${query.split("=")[0]}`);
        }
      }
    });
  });

  await t.test("correct secret -> existing behaviour unchanged", async () => {
    process.env.CRON_SECRET = SECRET;
    delete process.env.ROOMS_GOOGLE_SHEET_ID;
    stub(Event, "find", () => queryResult([]));

    await withServer(async (base) => {
      const all = await fetch(`${base}/api/cron/sync-all`, { headers: { Authorization: `Bearer ${SECRET}` } }).then(parse);
      assert.equal(all.status, 200);
      assert.equal(all.body.success, true);
      assert.ok(Array.isArray(all.body.results));
      assert.ok(all.body.results.some((result) => result.type === "rooms" && result.status === "skipped"));

      const force = await fetch(`${base}/api/rooms/force-sync`, { headers: { Authorization: `bearer   ${SECRET}` } }).then(parse);
      assert.equal(force.status, 200);
      assert.equal(force.body.success, false);
      assert.match(force.body.message, /ROOMS_GOOGLE_SHEET_ID is not configured/);
    });
  });

  await t.test("the secret is never logged or echoed back (valid, invalid and missing calls)", async () => {
    process.env.CRON_SECRET = SECRET;
    stub(Event, "find", () => queryResult([]));

    await withServer(async (base) => {
      const responses = [];
      for (const path of PROTECTED) {
        responses.push(await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${SECRET}` } }).then(parse));
        responses.push(await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${SECRET}-wrong` } }).then(parse));
        responses.push(await fetch(`${base}${path}?secret=${SECRET}`).then(parse));
      }
      for (const res of responses) assert.equal(res.text.includes(SECRET), false, "secret echoed in a response body");
    });

    assert.ok(captured.length > 0, "the harness must have captured log output");
    assert.equal(captured.some((line) => line.includes(SECRET)), false, "secret leaked into logs");
  });

  await t.test("the workflow sends the secret from the repository secret, in a header", () => {
    const yml = require("fs").readFileSync(require("path").join(__dirname, "..", "..", ".github", "workflows", "cron-sync.yml"), "utf8");
    assert.match(yml, /\$\{\{\s*secrets\.CRON_SECRET\s*\}\}/);
    assert.match(yml, /Authorization: Bearer \$CRON_SECRET/);
    assert.equal(/sync-all\?/.test(yml), false, "the secret must never be placed in the URL");
  });
});

test("mongoose is not connected in tests, yet limiter-protected routes still respond (sanity)", () => {
  assert.notEqual(mongoose.connection.readyState, 1);
});
