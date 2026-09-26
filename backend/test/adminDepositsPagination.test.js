// GET /api/admin/deposits is paginated on the server (default 25 per page) and
// searchable across ALL deposits. These tests run against a REAL throwaway
// mongod (see test/support/realMongo.js): pagination, filtering and populate
// have to be proven against a database, not a stub. Skipped (not failed) when
// no mongod binary is available.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MODE = "off";

const { describe, before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../src/app");
const Attendee = require("../src/models/Attendee");
const Deposit = require("../src/models/Deposit");
const School = require("../src/models/School");
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

const list = async (base, query = "") => {
  const response = await fetch(`${base}/api/admin/deposits${query}`, { headers: adminHeaders() });
  return { status: response.status, body: await response.json() };
};

test("the deposits list still requires admin authentication", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/admin/deposits?page=1`)).status, 401);
  });
});

describe("paginated admin deposits against a real MongoDB", { skip: MONGOD_SKIP_REASON }, () => {
  let mongo;
  const ids = {};
  // 60 deposits: 30 pending, 20 approved, 10 rejected. Newest = highest index.
  const PENDING = 30;
  const APPROVED = 20;
  const REJECTED = 10;

  before(async () => {
    mongo = await startRealMongo();
    await mongoose.connect(mongo.uri);

    const [schoolA, schoolB] = await School.create([
      { name: "Mega Heliopolis", ticketPrice: 6000 },
      { name: "Cairo Prep", ticketPrice: 6000 }
    ]);
    const make = (key, fullName, phone, school) =>
      Attendee.create({
        fullName,
        phone,
        phoneNormalized: phone,
        email: `${key}@example.com`,
        attendeeType: "incomer",
        accessType: "INCOMER",
        schoolId: school._id,
        ticketPrice: 6000,
        incomerPhoto: { url: `https://res.cloudinary.com/demo/image/upload/v1/${key}.jpg`, publicId: `secret-${key}` }
      });
    ids.marina = (await make("marina", "Marina Adel", "01012345678", schoolA))._id;
    ids.youssef = (await make("youssef", "Youssef Hassan", "01099998888", schoolB))._id;
    ids.nour = (await make("nour", "Nour Samir", "01055554444", schoolB))._id;

    const owners = [ids.marina, ids.youssef, ids.nour];
    const statuses = [...Array(PENDING).fill("pending"), ...Array(APPROVED).fill("approved"), ...Array(REJECTED).fill("rejected")];
    const docs = statuses.map((status, i) => ({
      attendeeId: owners[i % 3],
      amount: 500 + i,
      status,
      paymentOptionSnapshot: { amount: 500 + i, label: `Option ${i}` },
      paymentProof: { url: `https://res.cloudinary.com/demo/image/upload/v1/proof-${i}.jpg`, publicId: "proof-public-id" },
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
      updatedAt: new Date()
    }));
    await Deposit.collection.insertMany(docs);
  });

  after(async () => {
    await mongoose.disconnect().catch(() => {});
    if (mongo) await mongo.stop();
  });

  test("defaults to page 1 of 25, newest first, with the total", async () => {
    await withServer(async (base) => {
      const { status, body } = await list(base);
      assert.equal(status, 200);
      assert.equal(body.deposits.length, 25);
      assert.deepEqual(body.pagination, { page: 1, pageSize: 25, total: 60, totalPages: 3 });
      const times = body.deposits.map((deposit) => new Date(deposit.createdAt).getTime());
      assert.deepEqual(times, [...times].sort((a, b) => b - a));
      assert.equal(body.deposits[0].amount, 500 + 59); // newest deposit
    });
  });

  test("pages partition the deposits: no repeats, no gaps, short last page, empty beyond", async () => {
    await withServer(async (base) => {
      const p1 = (await list(base, "?page=1")).body;
      const p2 = (await list(base, "?page=2")).body;
      const p3 = (await list(base, "?page=3")).body;
      const p4 = (await list(base, "?page=4")).body;
      assert.deepEqual([p1.deposits.length, p2.deposits.length, p3.deposits.length, p4.deposits.length], [25, 25, 10, 0]);
      const seen = [...p1.deposits, ...p2.deposits, ...p3.deposits].map((deposit) => deposit._id);
      assert.equal(new Set(seen).size, 60);
      assert.equal(p4.pagination.total, 60);
    });
  });

  test("page size can be 50 or 100", async () => {
    await withServer(async (base) => {
      const fifty = (await list(base, "?pageSize=50")).body;
      assert.equal(fifty.deposits.length, 50);
      assert.deepEqual(fifty.pagination, { page: 1, pageSize: 50, total: 60, totalPages: 2 });
      const hundred = (await list(base, "?pageSize=100")).body;
      assert.equal(hundred.deposits.length, 60);
      assert.deepEqual(hundred.pagination, { page: 1, pageSize: 100, total: 60, totalPages: 1 });
    });
  });

  test("bad paging is a 422, and can never ask for more than 100 at once", async () => {
    await withServer(async (base) => {
      for (const query of ["?page=0", "?page=abc", "?pageSize=0", "?pageSize=101", "?pageSize=1000", "?pageSize=2.5"]) {
        assert.equal((await list(base, query)).status, 422, query);
      }
    });
  });

  test("Pending / Approved / Rejected filters still work and paginate their own totals", async () => {
    await withServer(async (base) => {
      const pending = (await list(base, "?status=pending")).body;
      assert.deepEqual(pending.pagination, { page: 1, pageSize: 25, total: PENDING, totalPages: 2 });
      assert.ok(pending.deposits.every((deposit) => deposit.status === "pending"));
      assert.equal((await list(base, "?status=pending&page=2")).body.deposits.length, PENDING - 25);

      const approved = (await list(base, "?status=approved")).body;
      assert.equal(approved.pagination.total, APPROVED);
      assert.ok(approved.deposits.every((deposit) => deposit.status === "approved"));

      const rejected = (await list(base, "?status=rejected")).body;
      assert.equal(rejected.pagination.total, REJECTED);
      assert.ok(rejected.deposits.every((deposit) => deposit.status === "rejected"));

      assert.equal((await list(base, "?status=bogus")).status, 422);
    });
  });

  test("the attendeeId filter still works", async () => {
    await withServer(async (base) => {
      const { body } = await list(base, `?attendeeId=${ids.marina}&pageSize=100`);
      assert.equal(body.pagination.total, 20);
      assert.ok(body.deposits.every((deposit) => String(deposit.attendeeId._id) === String(ids.marina)));
      assert.equal((await list(base, "?attendeeId=not-an-id")).status, 422);
    });
  });

  test("search covers ALL deposits (not just the current page): by name, phone and School name", async () => {
    await withServer(async (base) => {
      const byName = (await list(base, "?q=youssef&pageSize=100")).body;
      assert.equal(byName.pagination.total, 20);
      assert.ok(byName.deposits.every((deposit) => deposit.attendeeId.fullName === "Youssef Hassan"));

      const byPhone = (await list(base, "?q=01055554444&pageSize=100")).body;
      assert.equal(byPhone.pagination.total, 20);
      assert.ok(byPhone.deposits.every((deposit) => deposit.attendeeId.fullName === "Nour Samir"));

      // Cairo Prep is Youssef's and Nour's School → 40 deposits; Mega Heliopolis → Marina's 20.
      assert.equal((await list(base, "?q=cairo&pageSize=100")).body.pagination.total, 40);
      assert.equal((await list(base, "?q=MEGA")).body.pagination.total, 20);

      assert.equal((await list(base, "?q=zzz-nobody")).body.pagination.total, 0);
      // Regex characters are literal.
      assert.equal((await list(base, "?q=.*")).body.pagination.total, 0);
    });
  });

  test("search + status + paging combine", async () => {
    await withServer(async (base) => {
      // Youssef's pending deposits: every third of the first 30 → 10.
      const { body } = await list(base, "?q=youssef&status=pending&pageSize=100");
      assert.equal(body.pagination.total, 10);
      assert.ok(body.deposits.every((deposit) => deposit.status === "pending" && deposit.attendeeId.fullName === "Youssef Hassan"));

      const paged = (await list(base, "?q=youssef&pageSize=5&page=2")).body;
      assert.deepEqual(paged.pagination, { page: 2, pageSize: 5, total: 20, totalPages: 4 });
      assert.equal(paged.deposits.length, 5);

      // attendeeId AND a search that matches someone else → nothing.
      assert.equal((await list(base, `?attendeeId=${ids.marina}&q=youssef`)).body.pagination.total, 0);
    });
  });

  test("each deposit keeps the shape the details panel needs: customer, School name, photo URL, proof URL — never a publicId select", async () => {
    await withServer(async (base) => {
      const { body } = await list(base, "?pageSize=1");
      const deposit = body.deposits[0];
      assert.ok(deposit.attendeeId.fullName);
      assert.ok(deposit.attendeeId.schoolId.name);
      assert.match(deposit.attendeeId.incomerPhoto.url, /^https:\/\/res\.cloudinary\.com\//);
      assert.equal(deposit.attendeeId.incomerPhoto.publicId, undefined);
      assert.ok(deposit.paymentProof.url);
      assert.ok(deposit.paymentOptionSnapshot.label);
    });
  });

  test("listing a page changes nothing in the database", async () => {
    const snapshot = async () => JSON.stringify(await Deposit.find({}).sort({ _id: 1 }).lean());
    const before = await snapshot();
    await withServer(async (base) => {
      await list(base, "?status=pending&q=marina&page=2&pageSize=10");
      await list(base);
    });
    assert.equal(await snapshot(), before);
  });

  test("a single deposit is still fetchable by id (details panel)", async () => {
    const some = await Deposit.findOne({}).lean();
    await withServer(async (base) => {
      const response = await fetch(`${base}/api/admin/deposits/${some._id}`, { headers: adminHeaders() });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).deposit._id, String(some._id));
    });
  });
});
