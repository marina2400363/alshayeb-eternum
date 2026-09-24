// The Admin deposits API must carry the customer's registration photo URL (text
// only, so the details view can lazy-load a small preview) — and must never
// select the Cloudinary publicId. The in-memory stubs ignore populate(), so the
// test captures what the routes ASK the database for.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MODE = "off";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const Deposit = require("../src/models/Deposit");

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

// A chainable stand-in for a Mongoose query that records populate() arguments.
function capturingQuery(result, captured) {
  const query = Promise.resolve(result);
  query.populate = (...args) => {
    captured.push(args);
    return query;
  };
  query.sort = () => query;
  return query;
}

test("admin deposit list and detail select incomerPhoto.url for the attendee, never a publicId", async () => {
  const originalFind = Deposit.find;
  const originalFindById = Deposit.findById;
  const captured = [];
  Deposit.find = () => capturingQuery([], captured);
  Deposit.findById = () => capturingQuery({ _id: "dep1" }, captured);

  try {
    await withServer(async (base) => {
      assert.equal((await fetch(`${base}/api/admin/deposits`, { headers: adminHeaders() })).status, 200);
      assert.equal((await fetch(`${base}/api/admin/deposits/${"a".repeat(24)}`, { headers: adminHeaders() })).status, 200);
    });
  } finally {
    Deposit.find = originalFind;
    Deposit.findById = originalFindById;
  }

  const attendeePopulates = captured.map(([arg]) => arg).filter((arg) => arg && arg.path === "attendeeId");
  assert.equal(attendeePopulates.length, 2, "both the list and the detail populate the attendee");
  for (const populate of attendeePopulates) {
    assert.match(populate.select, /\bincomerPhoto\.url\b/);
    assert.equal(/publicId/i.test(populate.select), false);
    assert.equal(/qrToken|qrId|email/i.test(populate.select), false, "no unrelated sensitive fields were added");
  }
});

test("the admin deposits API stays behind admin auth", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/admin/deposits`)).status, 401);
  });
});
