// Core limiter behaviour: fixed windows, atomic Mongo upsert semantics
// (E11000 = blocked, first-insert race retried), HMAC-hashed keys, failure
// counters, fail-open / fail-closed, modes. No live Mongo: the store is either
// the in-memory stand-in or the real Mongo store driven through a fake
// collection.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const rl = require("../src/middleware/rateLimit");
const { MemoryRateLimitStore } = require("./support/rateLimitMemoryStore");

const T0 = Date.parse("2026-09-20T10:00:00Z");
let store;
let restoreConsole;

test.beforeEach(() => {
  rl.__testing.reset();
  store = new MemoryRateLimitStore();
  rl.__testing.setStore(store);
  rl.__testing.setNow(() => T0);
  delete process.env.RATE_LIMIT_MODE;
  delete process.env.RATE_LIMIT_SECRET;

  const original = { warn: console.warn, error: console.error };
  console.warn = () => {};
  console.error = () => {};
  restoreConsole = () => Object.assign(console, original);
});

test.afterEach(() => {
  restoreConsole();
  rl.__testing.reset();
  delete process.env.RATE_LIMIT_MODE;
  delete process.env.RATE_LIMIT_SECRET;
});

const rule = (identity, limit = 3, windowSec = 600, bucket = "b") => rl.rule(bucket, limit, windowSec, identity);

test("allows up to the limit, then blocks with a positive Retry-After inside the window", async () => {
  for (let i = 0; i < 3; i += 1) assert.equal((await rl.consume([rule("x")])).blocked, false);

  const blocked = await rl.consume([rule("x")]);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.bucket, "b");
  assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 600);
});

test("identities are independent (many different users never block each other)", async () => {
  for (let i = 0; i < 200; i += 1) assert.equal((await rl.consume([rule(`user-${i}`, 1)])).blocked, false);
  assert.equal((await rl.consume([rule("user-0", 1)])).blocked, true);
});

test("fixed window rolls over: allowed again in the next window", async () => {
  for (let i = 0; i < 3; i += 1) await rl.consume([rule("x")]);
  assert.equal((await rl.consume([rule("x")])).blocked, true);

  rl.__testing.setNow(() => T0 + 601 * 1000);
  assert.equal((await rl.consume([rule("x")])).blocked, false);
});

test("Retry-After counts down to the end of the current window", async () => {
  rl.__testing.setNow(() => T0 + 540 * 1000); // 60s before the window ends (T0 is on a 600s boundary)
  for (let i = 0; i < 3; i += 1) await rl.consume([rule("x")]);
  const blocked = await rl.consume([rule("x")]);
  assert.equal(blocked.retryAfterSec, 60);
});

test("concurrent requests never exceed the limit", async () => {
  const results = await Promise.all(Array.from({ length: 40 }, () => rl.consume([rule("burst", 5)])));
  assert.equal(results.filter((result) => !result.blocked).length, 5);
});

test("rules with no identity are skipped (no store call)", async () => {
  const result = await rl.consume([rule(null), rule(""), rule(undefined)]);
  assert.equal(result.blocked, false);
  assert.equal(store.calls.hit, 0);
});

test("rules are evaluated in order and stop at the first block", async () => {
  store.seed(rl.__testing.idFor(rule("ip", 1, 600, "first")), 1);
  const result = await rl.consume([rule("ip", 1, 600, "first"), rule("phone", 1, 600, "second")]);
  assert.equal(result.blocked, true);
  assert.equal(result.bucket, "first");
  assert.equal(store.countFor(rl.__testing.idFor(rule("phone", 1, 600, "second"))), 0);
});

// ---------------------------------------------------------------------------
// Stored keys are HMAC-hashed
// ---------------------------------------------------------------------------

test("stored ids are bucket + HMAC(secret, bucket\\nidentity) + window start: no raw identity is persisted", async () => {
  process.env.RATE_LIMIT_SECRET = "unit-test-rate-limit-secret";
  const phone = "01012345678";
  const email = "someone@example.com";
  const ip = "v4:203.0.113.7";

  await rl.consume([rule(phone, 5, 600, "lookup-phone"), rule(email, 5, 86400, "register-email"), rule(ip, 5, 600, "lookup-ip")]);

  const windowStart = Math.floor(T0 / 600000) * 600000;
  const expectedHmac = crypto.createHmac("sha256", "unit-test-rate-limit-secret").update(`lookup-phone\n${phone}`).digest("hex").slice(0, 40);
  assert.ok(store.docs.has(`lookup-phone:${expectedHmac}:${windowStart}`), "id must equal bucket:hmac:windowStart");

  const persisted = store.serialized();
  for (const secretValue of [phone, email, "203.0.113.7", "someone"]) {
    assert.equal(persisted.includes(secretValue), false, `raw value leaked into stored documents: ${secretValue}`);
  }

  const doc = [...store.docs.values()][0];
  assert.deepEqual(Object.keys(doc).sort(), ["_id", "bucket", "count", "expireAt"]);
  assert.ok(doc.expireAt instanceof Date && doc.expireAt.getTime() > T0);
});

test("the HMAC depends on the secret; RATE_LIMIT_SECRET falls back to JWT_SECRET", async () => {
  const idWithJwt = rl.__testing.idFor(rule("same-identity"));
  process.env.RATE_LIMIT_SECRET = "a-different-secret";
  const idWithOwnSecret = rl.__testing.idFor(rule("same-identity"));
  assert.notEqual(idWithJwt, idWithOwnSecret);

  delete process.env.RATE_LIMIT_SECRET;
  assert.equal(rl.__testing.idFor(rule("same-identity")), idWithJwt);
});

test("the same identity in different buckets hashes differently", () => {
  assert.notEqual(rl.__testing.idFor(rule("x", 3, 600, "one")), rl.__testing.idFor(rule("x", 3, 600, "two")));
});

// ---------------------------------------------------------------------------
// Real Mongo store logic, through a fake collection
// ---------------------------------------------------------------------------

function duplicateKey() {
  return Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
}

test("Mongo store: one atomic upsert with the {count < limit} guard and an expireAt", async () => {
  const calls = [];
  rl.__testing.setStore(null);
  rl.__testing.setCollection({
    findOneAndUpdate: async (...args) => {
      calls.push(args);
      return { count: 1 };
    }
  });

  const result = await rl.consume([rule("x", 3, 600, "b")]);
  assert.equal(result.blocked, false);
  assert.equal(calls.length, 1);

  const [filter, update, options] = calls[0];
  assert.equal(filter.count.$lt, 3);
  assert.match(filter._id, /^b:[0-9a-f]{40}:\d+$/);
  assert.deepEqual(update.$inc, { count: 1 });
  assert.equal(update.$setOnInsert.bucket, "b");
  assert.ok(update.$setOnInsert.expireAt instanceof Date && update.$setOnInsert.expireAt.getTime() > T0 + 600000);
  assert.equal(options.upsert, true);
});

test("Mongo store: E11000 at the limit means BLOCKED (after one retry)", async () => {
  let attempts = 0;
  rl.__testing.setStore(null);
  rl.__testing.setCollection({
    findOneAndUpdate: async () => {
      attempts += 1;
      throw duplicateKey();
    }
  });

  const result = await rl.consume([rule("x")]);
  assert.equal(result.blocked, true);
  assert.equal(attempts, 2);
});

test("Mongo store: a first-insert race (one E11000) is retried and ALLOWED", async () => {
  let attempts = 0;
  rl.__testing.setStore(null);
  rl.__testing.setCollection({
    findOneAndUpdate: async () => {
      attempts += 1;
      if (attempts === 1) throw duplicateKey();
      return { count: 2 };
    }
  });

  const result = await rl.consume([rule("x")]);
  assert.equal(result.blocked, false);
  assert.equal(attempts, 2);
});

// ---------------------------------------------------------------------------
// Failure counters (peek + record)
// ---------------------------------------------------------------------------

test("failure counters: blocked only once the count is AT the limit; peeking never increments", async () => {
  const failureRule = rule("ip", 3, 900, "fail");
  assert.equal((await rl.isBlocked([failureRule])).blocked, false);
  assert.equal(store.countFor(rl.__testing.idFor(failureRule)), 0);

  await rl.recordFailure([failureRule]);
  await rl.recordFailure([failureRule]);
  assert.equal((await rl.isBlocked([failureRule])).blocked, false);

  await rl.recordFailure([failureRule]);
  const result = await rl.isBlocked([failureRule]);
  assert.equal(result.blocked, true);
  assert.ok(result.retryAfterSec >= 1);
});

// ---------------------------------------------------------------------------
// Failure modes and modes
// ---------------------------------------------------------------------------

test("store error: FAIL OPEN by default (consume, isBlocked, enforceLimits, recordFailure)", async () => {
  store.fail();
  assert.equal((await rl.consume([rule("x")])).blocked, false);
  assert.equal((await rl.isBlocked([rule("x")])).blocked, false);
  await rl.enforceLimits([rule("x")]);
  await rl.recordFailure([rule("x")]); // must not throw
});

test("store error: FAIL CLOSED when asked (503, never a silent allow)", async () => {
  store.fail();
  await assert.rejects(rl.consume([rule("x")], { failClosed: true }), (error) => error.statusCode === 503);
  await assert.rejects(rl.isBlocked([rule("x")], { failClosed: true }), (error) => error.statusCode === 503);
});

test("a missing secret is a store-level error (fail open / closed like any other)", async () => {
  delete process.env.JWT_SECRET;
  try {
    assert.equal((await rl.consume([rule("x")])).blocked, false);
    await assert.rejects(rl.consume([rule("x")], { failClosed: true }), (error) => error.statusCode === 503);
  } finally {
    process.env.JWT_SECRET = "test-jwt-secret-not-real";
  }
});

test("RATE_LIMIT_MODE=off never touches the store; =log counts but never blocks; default is enforce", async () => {
  process.env.RATE_LIMIT_MODE = "off";
  for (let i = 0; i < 10; i += 1) assert.equal((await rl.consume([rule("x", 1)])).blocked, false);
  assert.equal(store.calls.hit, 0);

  process.env.RATE_LIMIT_MODE = "log";
  for (let i = 0; i < 5; i += 1) assert.equal((await rl.consume([rule("y", 1)])).blocked, false);
  assert.ok(store.calls.hit >= 5);

  process.env.RATE_LIMIT_MODE = "nonsense";
  await rl.consume([rule("z", 1)]);
  assert.equal((await rl.consume([rule("z", 1)])).blocked, true);
});

test("tooManyRequests: 429 with retryAfterSeconds and a message (string or function)", () => {
  const plain = rl.tooManyRequests(42);
  assert.equal(plain.statusCode, 429);
  assert.equal(plain.retryAfterSeconds, 42);
  assert.equal(plain.message, rl.DEFAULT_MESSAGE);
  assert.equal(rl.tooManyRequests(120, (seconds) => `wait ${seconds / 60} min`).message, "wait 2 min");
});

test("blocked/backoff logging carries no identity: only bucket and timing", async () => {
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));

  await rl.consume([rule("01012345678", 1, 600, "lookup-phone")]);
  await rl.consume([rule("01012345678", 1, 600, "lookup-phone")]);

  assert.equal(lines.length, 1);
  assert.match(lines[0], /bucket=lookup-phone retryAfter=\d+s/);
  assert.equal(lines[0].includes("01012345678"), false);
});
