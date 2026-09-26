// Customer upload ceiling: 4 MB (below Vercel's ~4.5 MB request-body limit),
// enforced with a clear 422 by the two Season 2 upload routes, and never
// reaching Cloudinary when rejected. Real Express app on the in-memory
// database; no live Mongo/Cloudinary/Resend.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const resendPkg = require("resend");

const app = require("../src/app");
const rl = require("../src/middleware/rateLimit");
const { MAX_CUSTOMER_UPLOAD_BYTES, MAX_CUSTOMER_UPLOAD_LABEL, MULTER_FILE_SIZE_LIMIT } = require("../src/utils/uploadLimits");
const { createMemoryDb } = require("./support/memoryDb");
const { MemoryRateLimitStore } = require("./support/rateLimitMemoryStore");

const MB = 1024 * 1024;
let db;
let restoreResend;
let restoreConsole;

test.beforeEach(() => {
  db = createMemoryDb();
  rl.__testing.reset();
  rl.__testing.setStore(new MemoryRateLimitStore());

  const originalResend = resendPkg.Resend;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "test-resend-key";
  resendPkg.Resend = class FakeResend {
    get emails() {
      return { send: async () => ({ data: { id: "fake" }, error: null }) };
    }
  };
  restoreResend = () => {
    resendPkg.Resend = originalResend;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  };

  const original = { warn: console.warn, error: console.error };
  console.warn = () => {};
  console.error = () => {};
  restoreConsole = () => Object.assign(console, original);
});

test.afterEach(() => {
  restoreConsole();
  restoreResend();
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

const file = (bytes, type = "image/png", name = "upload.png") => new Blob([new Uint8Array(bytes)], { type });
const parse = async (res) => ({ status: res.status, body: await res.json() });

function register(base, school, bytes, overrides = {}) {
  const form = new FormData();
  const fields = { fullName: "Marina Adel", phone: "01012345678", email: "marina@example.com", schoolId: String(school._id), ...overrides };
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append("incomerPhoto", file(bytes), "photo.png");
  return fetch(`${base}/api/attendees/register`, { method: "POST", body: form }).then(parse);
}

function submitDeposit(base, school, attendee, bytes) {
  const form = new FormData();
  form.append("attendeeId", String(attendee._id));
  form.append("phone", attendee.phoneNormalized);
  form.append("paymentOptionId", String(db.optionOf(school, 500)._id));
  form.append("paymentProof", file(bytes), "proof.png");
  return fetch(`${base}/api/deposits`, { method: "POST", body: form }).then(parse);
}

test("the customer upload ceiling is 4 MB, safely below Vercel's ~4.5 MB request-body limit", () => {
  assert.equal(MAX_CUSTOMER_UPLOAD_BYTES, 4 * MB);
  assert.equal(MAX_CUSTOMER_UPLOAD_LABEL, "4MB");
  assert.equal(MULTER_FILE_SIZE_LIMIT, 4 * MB + 1, "multer rejects size === limit, so it needs limit+1 for '4MB or smaller' to hold");
  // headroom for the multipart fields and boundaries inside Vercel's 4.5 MB body cap
  assert.ok(MAX_CUSTOMER_UPLOAD_BYTES <= 4.5 * MB - 256 * 1024);
});

test("the frontend's optimized-upload targets never exceed what the backend accepts", () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, "..", "..", "src", "season2", "features", relative), "utf8");
  const photo = read("onboarding/utils/photo.js").match(/MAX_UPLOAD_PHOTO_BYTES = ([\d.]+) \* 1024 \* 1024/);
  const proof = read("payments/utils/proof.js").match(/MAX_UPLOAD_PROOF_BYTES = ([\d.]+) \* 1024 \* 1024/);

  assert.ok(photo && proof, "frontend upload targets must be discoverable");
  assert.ok(Number(photo[1]) * MB <= MAX_CUSTOMER_UPLOAD_BYTES);
  assert.ok(Number(proof[1]) * MB <= MAX_CUSTOMER_UPLOAD_BYTES);
});

test("registration photo: exactly 4 MB is accepted; one byte over is a clear 422 and never uploaded", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });

  await withServer(async (base) => {
    const ok = await register(base, school, MAX_CUSTOMER_UPLOAD_BYTES);
    assert.equal(ok.status, 201);
    assert.equal(db.uploads.length, 1);

    const tooBig = await register(base, school, MAX_CUSTOMER_UPLOAD_BYTES + 1, { phone: "01023456789", email: "other@example.com" });
    assert.equal(tooBig.status, 422);
    assert.equal(tooBig.body.message, "Personal photo must be 4MB or smaller.");
    assert.equal(db.uploads.length, 1, "an oversize photo must never reach Cloudinary");
    assert.equal(db.attendees.length, 1);

    // the previous 5 MB-era size is now rejected too
    const fiveMb = await register(base, school, 5 * MB - 1, { phone: "01034567890", email: "third@example.com" });
    assert.equal(fiveMb.status, 422);
    assert.match(fiveMb.body.message, /4MB or smaller/);
  });
});

test("payment proof: exactly 4 MB is accepted; one byte over is a clear 422 and never uploaded", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500] });
  const attendee = db.addAttendee(school);

  await withServer(async (base) => {
    const tooBig = await submitDeposit(base, school, attendee, MAX_CUSTOMER_UPLOAD_BYTES + 1);
    assert.equal(tooBig.status, 422);
    assert.equal(tooBig.body.message, "Payment proof image must be 4MB or smaller.");
    assert.equal(db.uploads.length, 0);
    assert.equal(db.deposits.length, 0);

    const ok = await submitDeposit(base, school, attendee, MAX_CUSTOMER_UPLOAD_BYTES);
    assert.equal(ok.status, 201);
    assert.equal(db.uploads.length, 1);
    assert.equal(db.deposits.length, 1);
  });
});

test("type validation is unchanged: non-image uploads are still rejected with the existing messages", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500] });
  const attendee = db.addAttendee(school);

  await withServer(async (base) => {
    const form = new FormData();
    form.append("attendeeId", String(attendee._id));
    form.append("phone", attendee.phoneNormalized);
    form.append("paymentOptionId", String(db.optionOf(school, 500)._id));
    form.append("paymentProof", new Blob([new Uint8Array(10)], { type: "application/pdf" }), "proof.pdf");
    const res = await fetch(`${base}/api/deposits`, { method: "POST", body: form }).then(parse);
    // existing behaviour (untouched by the size change): a rejected type comes back as 400 with the upload prefix
    assert.equal(res.status, 400);
    assert.equal(res.body.message, "Payment proof upload failed: Only PNG, JPG, or JPEG payment proof images are allowed.");
    assert.equal(db.uploads.length, 0);
  });
});
