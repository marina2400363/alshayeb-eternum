// Season 2 Customer Area "Accepted / Rejected / Pending" counter.
//
// Manually admin-set display numbers, stored on their own Season2Settings
// document (never the legacy SiteSettings doc), never derived from Deposit,
// Attendee or FullPaymentStatus. Runs against a REAL throwaway mongod (see
// test/support/realMongo.js) to prove the values actually persist in Mongo —
// skipped (not failed) if no mongod binary is available.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.NODE_ENV = "test";

const { describe, before, after, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../src/app");
const Season2Settings = require("../src/models/Season2Settings");
const { MONGOD_SKIP_REASON, startRealMongo } = require("./support/realMongo");

const adminHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ email: "admin@example.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" })}`
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

const getJson = async (base, path, headers) => {
  const response = await fetch(`${base}${path}`, { headers });
  return { status: response.status, body: await response.json() };
};

const putJson = async (base, path, body, headers) => {
  const response = await fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};

describe("season2 status counter admin auth", () => {
  test("GET and PUT both reject a missing or bad token", async () => {
    await withServer(async (base) => {
      assert.equal((await fetch(`${base}/api/admin/season2/settings`)).status, 401);
      assert.equal(
        (await fetch(`${base}/api/admin/season2/settings`, { headers: { Authorization: "Bearer nope" } })).status,
        401
      );
      assert.equal(
        (
          await fetch(`${base}/api/admin/season2/settings/status-counter`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accepted: 1, rejected: 1, pending: 1 })
          })
        ).status,
        401
      );
    });
  });
});

describe("season2 status counter against a real MongoDB", { skip: MONGOD_SKIP_REASON }, () => {
  let mongo;

  before(async () => {
    mongo = await startRealMongo();
    await mongoose.connect(mongo.uri);
  });

  beforeEach(async () => {
    await Season2Settings.deleteMany({});
  });

  after(async () => {
    await mongoose.disconnect().catch(() => {});
    if (mongo) await mongo.stop();
  });

  test("the public endpoint needs no token at all", async () => {
    await withServer(async (base) => {
      const { status } = await getJson(base, "/api/season2/settings/status-counter");
      assert.equal(status, 200);
    });
  });

  test("defaults to zero for both admin and public reads when nothing has been configured", async () => {
    await withServer(async (base) => {
      const admin = await getJson(base, "/api/admin/season2/settings", adminHeaders());
      assert.equal(admin.status, 200);
      assert.deepEqual(admin.body.statusCounter, { accepted: 0, rejected: 0, pending: 0 });

      const pub = await getJson(base, "/api/season2/settings/status-counter");
      assert.equal(pub.status, 200);
      assert.equal(pub.body.accepted, 0);
      assert.equal(pub.body.rejected, 0);
      assert.equal(pub.body.pending, 0);
    });
  });

  test("admin can set the counter and both admin + public reads reflect it", async () => {
    await withServer(async (base) => {
      const saved = await putJson(
        base,
        "/api/admin/season2/settings/status-counter",
        { accepted: 350, rejected: 12, pending: 8 },
        adminHeaders()
      );
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.body.statusCounter, { accepted: 350, rejected: 12, pending: 8 });

      const pub = await getJson(base, "/api/season2/settings/status-counter");
      assert.deepEqual(
        { accepted: pub.body.accepted, rejected: pub.body.rejected, pending: pub.body.pending },
        { accepted: 350, rejected: 12, pending: 8 }
      );
    });
  });

  test("the public endpoint never exposes admin/document fields beyond the three counters", async () => {
    await withServer(async (base) => {
      await putJson(base, "/api/admin/season2/settings/status-counter", { accepted: 1, rejected: 2, pending: 3 }, adminHeaders());
      const pub = await getJson(base, "/api/season2/settings/status-counter");
      assert.deepEqual(Object.keys(pub.body).sort(), ["accepted", "pending", "rejected", "success"]);
    });
  });

  test("values persist across a fresh connection (simulating a restart)", async () => {
    await withServer(async (base) => {
      await putJson(base, "/api/admin/season2/settings/status-counter", { accepted: 77, rejected: 4, pending: 1 }, adminHeaders());
    });

    await mongoose.disconnect();
    await mongoose.connect(mongo.uri);

    await withServer(async (base) => {
      const pub = await getJson(base, "/api/season2/settings/status-counter");
      assert.deepEqual(
        { accepted: pub.body.accepted, rejected: pub.body.rejected, pending: pub.body.pending },
        { accepted: 77, rejected: 4, pending: 1 }
      );
    });
  });

  test("rejects negative, non-integer or missing fields with 422 and does not change stored values", async () => {
    await withServer(async (base) => {
      await putJson(base, "/api/admin/season2/settings/status-counter", { accepted: 10, rejected: 5, pending: 2 }, adminHeaders());

      for (const bad of [
        { accepted: -1, rejected: 5, pending: 2 },
        { accepted: 1.5, rejected: 5, pending: 2 },
        { accepted: "10", rejected: 5, pending: 2 },
        { rejected: 5, pending: 2 }
      ]) {
        const res = await putJson(base, "/api/admin/season2/settings/status-counter", bad, adminHeaders());
        assert.equal(res.status, 422, JSON.stringify(bad));
      }

      const pub = await getJson(base, "/api/season2/settings/status-counter");
      assert.deepEqual(
        { accepted: pub.body.accepted, rejected: pub.body.rejected, pending: pub.body.pending },
        { accepted: 10, rejected: 5, pending: 2 }
      );
    });
  });
});
