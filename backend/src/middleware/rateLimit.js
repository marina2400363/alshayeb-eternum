const crypto = require("crypto");
const mongoose = require("mongoose");

const apiError = require("../utils/apiError");

// Mongo-backed FIXED-WINDOW rate limiter, safe on Vercel/serverless because
// the counters live in the database, not in instance memory.
//
//   collection : ratelimits   (one small document per bucket+identity+window)
//   _id        : "<bucket>:<hmac(identity)>:<windowStartMs>"
//   fields     : count, bucket, expireAt        (TTL index on expireAt)
//
// Identities (phone, email, attendeeId, IP) are NEVER stored: only an HMAC of
// them (keyed with RATE_LIMIT_SECRET, falling back to JWT_SECRET), so the
// collection holds no PII and cannot be reversed by anyone without the key.
//
// The check-and-increment is ONE atomic upsert:
//     findOneAndUpdate({ _id, count: { $lt: limit } }, { $inc: { count: 1 } }, { upsert: true })
// Under the limit it matches (or inserts) and increments. At the limit the
// filter no longer matches, the upsert tries to insert the same _id, and Mongo
// answers E11000 — that is the "blocked" signal, with no write performed. A
// first-request race (two inserts of a brand-new _id) also produces E11000, so
// it is retried once before being treated as blocked.
//
// FAILURE MODE: a store error never blocks customers (fail open). Callers that
// must not fail open (admin login) pass failClosed: true.
//
// MODE (RATE_LIMIT_MODE): "enforce" (default) | "log" (count + log, never
// block) | "off".

const COLLECTION = "ratelimits";
const TTL_GRACE_MS = 60 * 1000;
const DEFAULT_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";
const UNAVAILABLE_MESSAGE = "This service is temporarily unavailable. Please try again shortly.";

function getMode() {
  const mode = String(process.env.RATE_LIMIT_MODE || "enforce").trim().toLowerCase();
  return ["enforce", "log", "off"].includes(mode) ? mode : "enforce";
}

function getSecret() {
  const secret = process.env.RATE_LIMIT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("no rate-limit secret configured");
  return secret;
}

// ---------------------------------------------------------------------------
// Test hooks (never used in production code paths)
// ---------------------------------------------------------------------------
let storeOverride = null;
let collectionOverride = null;
let nowFn = () => Date.now();

// ---------------------------------------------------------------------------
// Mongo store
// ---------------------------------------------------------------------------
function collection() {
  if (collectionOverride) return collectionOverride;
  // Not connected: fail fast instead of letting Mongoose buffer the command.
  if (mongoose.connection.readyState !== 1) throw new Error("database not connected");
  return mongoose.connection.db.collection(COLLECTION);
}

const isDuplicateKey = (error) => Boolean(error) && error.code === 11000;

const mongoStore = {
  async hit({ id, bucket, limit, expireAt }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await collection().findOneAndUpdate(
          { _id: id, count: { $lt: limit } },
          { $inc: { count: 1 }, $setOnInsert: { bucket, expireAt } },
          { upsert: true, returnDocument: "after", projection: { count: 1 } }
        );
        return { allowed: true };
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        if (attempt === 1) return { allowed: false };
      }
    }
    return { allowed: false };
  },

  async count(id) {
    const doc = await collection().findOne({ _id: id }, { projection: { count: 1 } });
    return doc && typeof doc.count === "number" ? doc.count : 0;
  },

  async record({ id, bucket, expireAt }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await collection().updateOne({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { bucket, expireAt } }, { upsert: true });
        return;
      } catch (error) {
        if (!isDuplicateKey(error) || attempt === 1) throw error;
      }
    }
  }
};

const activeStore = () => storeOverride || mongoStore;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// identity === null/"" means "this request has no such identity" -> rule skipped.
function rule(bucket, limit, windowSec, identity) {
  return { bucket, limit, windowSec, identity };
}

function resolve(inputRule) {
  const windowMs = inputRule.windowSec * 1000;
  const now = nowFn();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const digest = crypto
    .createHmac("sha256", getSecret())
    .update(`${inputRule.bucket}\n${inputRule.identity}`)
    .digest("hex")
    .slice(0, 40);

  return {
    id: `${inputRule.bucket}:${digest}:${windowStart}`,
    bucket: inputRule.bucket,
    limit: inputRule.limit,
    expireAt: new Date(windowEnd + TTL_GRACE_MS),
    retryAfterSec: Math.max(1, Math.ceil((windowEnd - now) / 1000))
  };
}

function activeRules(rules) {
  return (rules || []).filter((candidate) => candidate && candidate.identity);
}

function tooManyRequests(retryAfterSec, message = DEFAULT_MESSAGE) {
  const error = apiError(typeof message === "function" ? message(retryAfterSec) : message, 429);
  error.retryAfterSeconds = retryAfterSec;
  return error;
}

let lastStoreErrorLogAt = 0;
const STORE_ERROR_LOG_INTERVAL_MS = 30 * 1000;

function logStoreError(error) {
  // At most one line per interval (a store outage must not flood the logs), and
  // name/code only: never the message (it could echo connection details).
  const now = nowFn();
  if (now - lastStoreErrorLogAt < STORE_ERROR_LOG_INTERVAL_MS) return;
  lastStoreErrorLogAt = now;
  console.error(`[rate-limit] store error: ${(error && (error.code || error.name)) || "unknown"}`);
}

const lastBlockedLogAt = new Map();
const BLOCKED_LOG_INTERVAL_MS = 15 * 1000;

function logBlocked(bucket, retryAfterSec, mode) {
  // At most one line per bucket per interval per instance (an attack must not
  // flood the logs). Bucket name + timing only: no identity, no raw key, no PII.
  const now = nowFn();
  if (now - (lastBlockedLogAt.get(bucket) || 0) < BLOCKED_LOG_INTERVAL_MS) return;
  lastBlockedLogAt.set(bucket, now);
  console.warn(`[rate-limit] ${mode === "log" ? "would block" : "blocked"} bucket=${bucket} retryAfter=${retryAfterSec}s`);
}

function unavailable() {
  return apiError(UNAVAILABLE_MESSAGE, 503);
}

// ---------------------------------------------------------------------------
// Core operations. Each returns { blocked, retryAfterSec, bucket }.
// ---------------------------------------------------------------------------

// Atomic check-and-increment for every rule, stopping at the first block.
async function consume(rules, { failClosed = false } = {}) {
  const mode = getMode();
  if (mode === "off") return { blocked: false };

  try {
    for (const inputRule of activeRules(rules)) {
      const resolved = resolve(inputRule);
      const { allowed } = await activeStore().hit(resolved);
      if (!allowed) {
        logBlocked(resolved.bucket, resolved.retryAfterSec, mode);
        if (mode === "enforce") return { blocked: true, retryAfterSec: resolved.retryAfterSec, bucket: resolved.bucket };
      }
    }
    return { blocked: false };
  } catch (error) {
    logStoreError(error);
    if (failClosed) throw unavailable();
    return { blocked: false };
  }
}

// Read-only: is any rule already AT its limit? (used for failure counters).
async function isBlocked(rules, { failClosed = false } = {}) {
  const mode = getMode();
  if (mode === "off") return { blocked: false };

  try {
    for (const inputRule of activeRules(rules)) {
      const resolved = resolve(inputRule);
      const current = await activeStore().count(resolved.id);
      if (current >= resolved.limit) {
        logBlocked(resolved.bucket, resolved.retryAfterSec, mode);
        if (mode === "enforce") return { blocked: true, retryAfterSec: resolved.retryAfterSec, bucket: resolved.bucket };
      }
    }
    return { blocked: false };
  } catch (error) {
    logStoreError(error);
    if (failClosed) throw unavailable();
    return { blocked: false };
  }
}

// Unconditional increment (a failure happened). Never throws.
async function recordFailure(rules) {
  if (getMode() === "off") return;

  try {
    for (const inputRule of activeRules(rules)) {
      await activeStore().record(resolve(inputRule));
    }
  } catch (error) {
    logStoreError(error);
  }
}

// ---------------------------------------------------------------------------
// Express helpers
// ---------------------------------------------------------------------------

// Use inside a handler (e.g. after multipart parsing): throws a 429 error.
async function enforceLimits(rules, { failClosed = false, message } = {}) {
  const result = await consume(rules, { failClosed });
  if (result.blocked) throw tooManyRequests(result.retryAfterSec, message);
}

// Middleware: atomically counts each request against the rules.
function limitRequest(buildRules, options = {}) {
  return async (req, res, next) => {
    try {
      await enforceLimits(buildRules(req), options);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Middleware: rejects when a FAILURE counter is already at its limit. Pair
// with recordFailure(...) at the point the failure actually happens.
function guardFailures(buildRules, { failClosed = false, message } = {}) {
  return async (req, res, next) => {
    try {
      const result = await isBlocked(buildRules(req), { failClosed });
      if (result.blocked) throw tooManyRequests(result.retryAfterSec, message);
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  rule,
  consume,
  isBlocked,
  recordFailure,
  enforceLimits,
  limitRequest,
  guardFailures,
  tooManyRequests,
  DEFAULT_MESSAGE,
  COLLECTION,
  __testing: {
    setStore(store) {
      storeOverride = store;
    },
    setCollection(fake) {
      collectionOverride = fake;
    },
    setNow(fn) {
      nowFn = fn || (() => Date.now());
    },
    idFor(inputRule) {
      return resolve(inputRule).id;
    },
    mongoStore,
    reset() {
      storeOverride = null;
      collectionOverride = null;
      nowFn = () => Date.now();
      lastStoreErrorLogAt = 0;
      lastBlockedLogAt.clear();
    }
  }
};
