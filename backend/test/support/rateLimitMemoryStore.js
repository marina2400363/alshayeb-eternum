// In-memory stand-in for the `ratelimits` collection, implementing the same
// store contract as the Mongo store in src/middleware/rateLimit.js
// (hit / count / record) with the same semantics: hit() is an atomic
// check-and-increment that reports "not allowed" once a bucket is AT its limit.
//
// Not a test file itself (no .test.js suffix) — `npm test` never runs it.

class MemoryRateLimitStore {
  constructor() {
    this.docs = new Map();
    this.failWith = null;
    this.calls = { hit: 0, count: 0, record: 0 };
  }

  fail(error = new Error("store down")) {
    this.failWith = error;
    return this;
  }

  heal() {
    this.failWith = null;
  }

  _guard() {
    if (this.failWith) throw this.failWith;
  }

  async hit({ id, bucket, limit, expireAt }) {
    this.calls.hit += 1;
    this._guard();
    const doc = this.docs.get(id);
    if (doc && doc.count >= limit) return { allowed: false };
    if (doc) doc.count += 1;
    else this.docs.set(id, { _id: id, bucket, count: 1, expireAt });
    return { allowed: true };
  }

  async count(id) {
    this.calls.count += 1;
    this._guard();
    const doc = this.docs.get(id);
    return doc ? doc.count : 0;
  }

  async record({ id, bucket, expireAt }) {
    this.calls.record += 1;
    this._guard();
    const doc = this.docs.get(id);
    if (doc) doc.count += 1;
    else this.docs.set(id, { _id: id, bucket, count: 1, expireAt });
  }

  // Pre-load a bucket to `count` (used to test ceilings without thousands of requests).
  seed(id, count) {
    this.docs.set(id, { _id: id, bucket: id.split(":")[0], count, expireAt: new Date(Date.now() + 3600 * 1000) });
  }

  countFor(id) {
    const doc = this.docs.get(id);
    return doc ? doc.count : 0;
  }

  // Everything that would be persisted, as one string (for "no PII stored" checks).
  serialized() {
    return JSON.stringify([...this.docs.values()]);
  }
}

module.exports = { MemoryRateLimitStore };
