// Automatic, non-blocking Mongo -> Sheet finance sync, driven through the REAL
// routes (registration, admin approve/reject, deposit submission, School edit,
// scheduled cron) on the in-memory database. No live Mongo, Google, Cloudinary
// or Resend: the Sheets client and the SchoolFinanceConfig store are faked, and
// the keep-alive hook (waitUntil on Vercel) is captured so tests can await the
// background work AFTER checking that the HTTP response did not wait for it.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_EMAIL = "qa-service-account@example.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----\\n";
process.env.CRON_SECRET = "test-cron-secret-0123456789abcdef";
process.env.RATE_LIMIT_MODE = "off";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const resendPkg = require("resend");
const { google } = require("googleapis");

const app = require("../src/app");
const SchoolFinanceConfig = require("../src/models/SchoolFinanceConfig");
const FullPaymentStatus = require("../src/models/FullPaymentStatus");
const Event = require("../src/models/Event");
const autoSync = require("../src/services/financeAutoSync");
const { HEADER_ROW: HEADER } = require("../src/services/googleSheetsSchoolFinanceSync");
const { createMemoryDb, queryResult } = require("./support/memoryDb");

const SHEET_ID = "1AbCdEf123456789_ABCDEFGHIJKLMNOPQRSTUVWX";
const adminHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ email: "admin@example.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" })}`
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let db;
let sheet;
let configs;
let pending;
let restorers;
let restoreConsole;
let logged;
let fullPaymentWrites; // attendee ids written to FullPaymentStatus
let emailCalls; // every email the fake Resend was asked to send

const setPath = (doc, path, value) => {
  const parts = path.split(".");
  let target = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof target[parts[i]] !== "object" || target[parts[i]] === null) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
};
const getPath = (doc, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), doc);

// The handful of filter shapes financeAutoSync uses.
function configMatches(doc, filter = {}) {
  if (filter.schoolId !== undefined && String(doc.schoolId) !== String(filter.schoolId)) return false;
  if (filter.enabled !== undefined && doc.enabled !== filter.enabled) return false;
  if (filter.googleSheetId && !(typeof doc.googleSheetId === "string" && doc.googleSheetId !== "")) return false;
  if ("autoSync.dirty" in filter && getPath(doc, "autoSync.dirty") !== filter["autoSync.dirty"]) return false;
  if (filter.$or) {
    const now = Date.now();
    const lock = getPath(doc, "autoSync.lockedUntil");
    const free = lock == null || lock.getTime() < now;
    if (!free) return false;
  }
  return true;
}

function installStores() {
  const stub = (obj, method, impl) => {
    const original = obj[method];
    obj[method] = impl;
    restorers.push(() => {
      obj[method] = original;
    });
  };
  const apply = (doc, update) => {
    for (const [path, value] of Object.entries(update.$set || {})) setPath(doc, path, value);
    return doc;
  };

  stub(SchoolFinanceConfig, "find", (filter = {}) => queryResult(configs.filter((doc) => configMatches(doc, filter))));
  stub(SchoolFinanceConfig, "findOne", (filter = {}) => queryResult(configs.find((doc) => configMatches(doc, filter)) || null));
  stub(SchoolFinanceConfig, "findOneAndUpdate", (filter, update) => {
    if (configs.failWrites) return Promise.reject(new Error("mongo down"));
    const doc = configs.find((candidate) => configMatches(candidate, filter));
    return queryResult(doc ? apply(doc, update) : null);
  });
  stub(SchoolFinanceConfig, "updateOne", async (filter, update) => {
    if (configs.failWrites) throw new Error("mongo down");
    const doc = configs.find((candidate) => configMatches(candidate, filter));
    if (doc) apply(doc, update);
    return { matchedCount: doc ? 1 : 0 };
  });
  stub(Event, "find", () => queryResult([]));

  // FullPaymentStatus (the Sheet -> Mongo direction), on db.fullPayments, with
  // real dotted-path $set semantics so completionSentAt is stored nested.
  stub(FullPaymentStatus, "find", (filter = {}) => {
    const ids = filter.attendeeId?.$in?.map(String) || null;
    return queryResult(db.fullPayments.filter((doc) => !ids || ids.includes(String(doc.attendeeId))));
  });
  stub(FullPaymentStatus, "findOneAndUpdate", (filter, update) => {
    fullPaymentWrites.push(String(filter.attendeeId));
    let doc = db.fullPayments.find((candidate) => String(candidate.attendeeId) === String(filter.attendeeId));
    if (!doc) {
      doc = { attendeeId: filter.attendeeId, ...(update.$setOnInsert || {}) };
      db.fullPayments.push(doc);
    }
    for (const [path, value] of Object.entries(update.$set || {})) setPath(doc, path, value);
    return queryResult(doc);
  });
}

// Fake Google Sheets: records every call; `get` can be gated (held open) or made to fail.
function installSheets() {
  const state = { rows: [], reads: 0, writes: [], gate: null, failWith: null };
  const originalSheets = google.sheets;
  const originalJwt = google.auth.JWT;
  google.auth.JWT = function FakeJWT() {};
  google.sheets = () => ({
    spreadsheets: {
      values: {
        get: async () => {
          state.reads += 1;
          if (state.gate) await state.gate;
          if (state.failWith) throw new Error(state.failWith);
          return { data: { values: state.rows.map((row) => [...row]) } };
        },
        batchUpdate: async ({ requestBody }) => {
          state.writes.push(requestBody.data);
          return { data: {} };
        }
      }
    }
  });
  restorers.push(() => {
    google.sheets = originalSheets;
    google.auth.JWT = originalJwt;
  });
  return state;
}

function installFakeResend() {
  const original = resendPkg.Resend;
  process.env.RESEND_API_KEY = "test-resend-key";
  resendPkg.Resend = class FakeResend {
    get emails() {
      return {
        send: async (payload, options) => {
          emailCalls.push({ payload, options });
          return { data: { id: "fake" }, error: null };
        }
      };
    }
  };
  restorers.push(() => {
    resendPkg.Resend = original;
    delete process.env.RESEND_API_KEY;
  });
}

test.beforeEach(() => {
  db = createMemoryDb();
  configs = [];
  pending = [];
  restorers = [];
  logged = [];
  fullPaymentWrites = [];
  emailCalls = [];
  installStores();
  sheet = installSheets();
  installFakeResend();

  autoSync.__testing.setConnectedCheck(() => true);
  autoSync.__testing.setGap(0);
  autoSync.__testing.setKeepAlive((promise) => pending.push(promise));
  delete process.env.FINANCE_AUTO_SYNC;

  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = (...args) => logged.push(args.join(" "));
  restoreConsole = () => Object.assign(console, original);
});

test.afterEach(() => {
  restoreConsole();
  while (restorers.length) restorers.pop()();
  autoSync.__testing.reset();
  db.restore();
});

const settle = async () => {
  while (pending.length) await pending.shift(); // eslint-disable-line no-await-in-loop
};

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const parse = async (res) => ({ status: res.status, body: await res.json() });

function addConfig(school, overrides = {}) {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    schoolId: school._id,
    googleSheetId: SHEET_ID,
    tabName: "Sheet1",
    enabled: true,
    save: async () => doc,
    ...overrides
  };
  configs.push(doc);
  return doc;
}

function register(base, school, overrides = {}) {
  const form = new FormData();
  const fields = { fullName: "Marina Adel", phone: "01012345678", email: "marina@example.com", schoolId: String(school._id), ...overrides };
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append("incomerPhoto", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "photo.png");
  return fetch(`${base}/api/attendees/register`, { method: "POST", body: form }).then(parse);
}

function addDeposit(attendee, { amount = 500, status = "pending", proofUrl = "https://cdn.example/proof.png" } = {}) {
  const deposit = {
    _id: new mongoose.Types.ObjectId(),
    attendeeId: attendee._id,
    amount,
    status,
    customerConfirmationPending: false,
    customerConfirmationAcknowledgedAt: null,
    paymentProof: { url: proofUrl, publicId: "pid" },
    activeCycle: status === "pending" ? 1 : undefined,
    createdAt: new Date(Date.parse("2026-09-01T10:00:00Z") + db.deposits.length * 1000)
  };
  db.deposits.push(deposit);
  return deposit;
}

const approve = (base, deposit) =>
  fetch(`${base}/api/admin/deposits/${deposit._id}/approve`, { method: "PUT", headers: adminHeaders() }).then(parse);
const reject = (base, deposit) =>
  fetch(`${base}/api/admin/deposits/${deposit._id}/reject`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify({ rejectionReason: "Unclear." })
  }).then(parse);

const allWrittenRanges = () => sheet.writes.flatMap((data) => data.map((entry) => entry.range.split("!")[1]));
const rangeCoversColumnI = (range) => {
  const [from, to] = range.split(":").map((part) => part.replace(/\d+/g, ""));
  return from <= "I" && "I" <= to;
};
const writtenRowFor = (id) => {
  for (const data of sheet.writes) for (const entry of data) if (String(entry.values[0][0]) === String(id)) return entry.values[0];
  return null;
};

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

test("registration triggers a NON-BLOCKING sync of that School's sheet", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const config = addConfig(school);

  // Hold the sheet read open: if the HTTP response waited for the sync, this
  // request could never complete.
  let release;
  sheet.gate = new Promise((resolve) => (release = resolve));

  await withServer(async (base) => {
    const res = await register(base, school);
    assert.equal(res.status, 201, "the response must not wait for Google");
    assert.equal(sheet.writes.length, 0, "the sheet has not been written yet — the sync is still running in the background");
    assert.equal(pending.length, 1, "exactly one background sync was registered with the keep-alive hook");

    release();
    await settle();
  });

  assert.equal(sheet.reads, 1);
  const row = writtenRowFor(db.attendees[0]._id);
  assert.ok(row, "the new customer reached the sheet");
  assert.equal(row[1], "Marina Adel");
  assert.equal(config.lastSync.status, "success");
  assert.equal(getPath(config, "autoSync.lockedUntil"), null, "the lease is released after the run");
  assert.ok(allWrittenRanges().every((range) => /^A\d+:H\d+$|^J\d+:L\d+$|^A1:L1$/.test(range)), "column I is never written");
});

test("approving a Deposit syncs the sheet AUTOMATICALLY (no manual button): amounts, count, total and ALL approved proof links", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school, { fullName: "Marina", email: "m@example.com" });
  addConfig(school);
  addDeposit(customer, { amount: 500, status: "approved", proofUrl: "https://cdn.example/first-approved.png" });
  addDeposit(customer, { amount: 300, status: "rejected", proofUrl: "https://cdn.example/rejected.png" });
  const deposit = addDeposit(customer, { amount: 1000, proofUrl: "https://cdn.example/second-approved.png" });

  await withServer(async (base) => {
    const res = await approve(base, deposit);
    assert.equal(res.status, 200);
    assert.equal(res.body.deposit.status, "approved");
    await settle(); // the sync ran in the background; nobody pressed a sync button
  });

  assert.equal(sheet.reads, 1);
  const row = writtenRowFor(customer._id);
  assert.equal(row[5], "500, 1000", "Approved Payments");
  assert.equal(row[6], 2, "Number of Payments");
  assert.equal(row[7], 1500, "Total Paid");
  const links = sheet.writes.flat().find((entry) => /J\d+:L\d+$/.test(entry.range));
  assert.equal(
    links.values[0][2],
    "https://cdn.example/first-approved.png, https://cdn.example/second-approved.png",
    "Payment Proof Links: every approved proof, oldest first, never the rejected one"
  );
});

test("changes that do NOT alter what the sheet shows do not trigger a sync: rejection, and a new pending submission", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);
  addConfig(school);
  const pendingDeposit = addDeposit(customer, { amount: 500 });

  await withServer(async (base) => {
    assert.equal((await reject(base, pendingDeposit)).status, 200);

    // a customer submitting a payment proof (creates a pending Deposit)
    const form = new FormData();
    form.append("attendeeId", String(customer._id));
    form.append("phone", customer.phoneNormalized);
    form.append("paymentOptionId", String(db.optionOf(school, 500)._id));
    form.append("paymentProof", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "proof.png");
    assert.equal((await fetch(`${base}/api/deposits`, { method: "POST", body: form }).then(parse)).status, 201);
    await settle();
  });

  assert.equal(pending.length, 0);
  assert.equal(sheet.reads, 0, "approved-only columns are unchanged by a rejection or a pending submission");
  assert.equal(sheet.writes.length, 0);
});

test("a School price or name change triggers a sync; a visibility-only change does not", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  db.addAttendee(school);
  addConfig(school);

  const put = (base, body) =>
    fetch(`${base}/api/admin/schools/${school._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify(body)
    }).then(parse);

  await withServer(async (base) => {
    assert.equal((await put(base, { showTicketPriceToCustomer: false })).status, 200);
    await settle();
    assert.equal(sheet.reads, 0, "visibility only: nothing on the sheet changes");

    assert.equal((await put(base, { ticketPrice: 7000 })).status, 200);
    await settle();
    assert.equal(sheet.reads, 1);

    assert.equal((await put(base, { name: "Heliopolis West" })).status, 200);
    await settle();
    assert.equal(sheet.reads, 2);
  });
});

test("a School with no enabled sheet costs no Google call; FINANCE_AUTO_SYNC=off disables it entirely", async () => {
  const noConfig = db.addSchool({ name: "No sheet", ticketPrice: 6000 });
  const disabled = db.addSchool({ name: "Disabled", ticketPrice: 6000 });
  const off = db.addSchool({ name: "Off", ticketPrice: 6000 });
  addConfig(disabled, { enabled: false });
  addConfig(off);

  await withServer(async (base) => {
    assert.equal((await register(base, noConfig, { phone: "01011111111", email: "a@example.com" })).status, 201);
    assert.equal((await register(base, disabled, { phone: "01022222222", email: "b@example.com" })).status, 201);
    await settle();
    assert.equal(sheet.reads, 0);

    process.env.FINANCE_AUTO_SYNC = "off";
    assert.equal((await register(base, off, { phone: "01033333333", email: "c@example.com" })).status, 201);
    assert.equal(pending.length, 0, "nothing is even scheduled when switched off");
  });
  assert.equal(sheet.reads, 0);
});

test("when the database is not connected nothing is scheduled (never blocks or errors)", async () => {
  autoSync.__testing.setConnectedCheck(() => false);
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  addConfig(school);

  await withServer(async (base) => {
    assert.equal((await register(base, school)).status, 201);
  });
  assert.equal(pending.length, 0);
  assert.equal(sheet.reads, 0);
});

// ---------------------------------------------------------------------------
// A Sheet / store failure NEVER fails or rolls back the business operation
// ---------------------------------------------------------------------------

test("Sheet failure does not fail registration: 201, the customer is in Mongo, the failure is recorded", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const config = addConfig(school);
  sheet.failWith = "The caller does not have permission";

  await withServer(async (base) => {
    const res = await register(base, school);
    assert.equal(res.status, 201);
    await settle();
  });

  assert.equal(db.attendees.length, 1, "the Mongo write is intact");
  assert.equal(config.lastSync.status, "error");
  assert.equal(getPath(config, "autoSync.lockedUntil"), null, "the lease is released even after a failed sync");
});

test("Sheet failure does not fail or roll back an approval", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);
  const config = addConfig(school);
  const deposit = addDeposit(customer, { amount: 500 });
  sheet.failWith = "Quota exceeded";

  await withServer(async (base) => {
    const res = await approve(base, deposit);
    assert.equal(res.status, 200);
    assert.equal(res.body.deposit.status, "approved");
    await settle();
  });

  const stored = db.deposits.find((candidate) => String(candidate._id) === String(deposit._id));
  assert.equal(stored.status, "approved", "still approved in Mongo");
  assert.equal(stored.customerConfirmationPending, true);
  assert.equal(config.lastSync.status, "error");
});

test("even a failing config store cannot fail the operation, and nothing unhandled escapes", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  addConfig(school);
  configs.failWrites = true;

  let unhandled = 0;
  const onUnhandled = () => (unhandled += 1);
  process.on("unhandledRejection", onUnhandled);
  try {
    await withServer(async (base) => {
      assert.equal((await register(base, school)).status, 201);
      await settle();
    });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }

  assert.equal(unhandled, 0);
  assert.ok(logged.some((line) => line.startsWith("[finance-auto-sync] failed")), "a minimal failure line is logged");
  assert.ok(logged.every((line) => !/mongo down|qa-service-account|marina@example\.com/.test(line)), "no messages, credentials or PII in the log");
});

// ---------------------------------------------------------------------------
// No duplicate / unnecessary syncs
// ---------------------------------------------------------------------------

test("a burst of triggers coalesces: 10 changes during one run cause ONE follow-up run, not 10", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  addConfig(school);

  let release;
  sheet.gate = new Promise((resolve) => (release = resolve));

  const first = autoSync.requestSchoolFinanceSync(school._id);
  await new Promise((resolve) => setImmediate(resolve)); // let the first run take the lease and reach Google
  assert.equal(sheet.reads, 1, "the first run is in flight");

  const burst = Array.from({ length: 9 }, () => autoSync.requestSchoolFinanceSync(school._id));
  const results = await Promise.all(burst);
  assert.ok(results.every((result) => result.ran === false), "triggers during a run only mark the School dirty");
  assert.equal(sheet.reads, 1, "still a single sync in flight");

  sheet.gate = null;
  release();
  await first;

  assert.equal(sheet.reads, 2, "exactly one follow-up run picked up all 9 changes");
  assert.equal(getPath(configs[0], "autoSync.dirty"), false);
  assert.equal(getPath(configs[0], "autoSync.lockedUntil"), null);
});

test("sequential changes are each synced (no lost update), and the run count is bounded", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  addConfig(school);

  for (let i = 0; i < 4; i += 1) {
    const result = await autoSync.requestSchoolFinanceSync(school._id);
    assert.equal(result.ran, true);
  }
  assert.equal(sheet.reads, 4, "each change after the previous run finished gets its own sync");

  // Perpetually dirty: a run never loops more than MAX_ROUNDS times.
  configs[0].autoSync.dirty = true;
  const orig = SchoolFinanceConfig.findOneAndUpdate;
  SchoolFinanceConfig.findOneAndUpdate = (filter, update) => {
    if ("autoSync.dirty" in filter) return queryResult({ dirty: true });
    return orig(filter, update);
  };
  const before = sheet.reads;
  try {
    await autoSync.__testing.syncSchoolFinance(school._id, { nested: true });
  } finally {
    SchoolFinanceConfig.findOneAndUpdate = orig;
  }
  assert.ok(sheet.reads - before <= 3, "bounded rounds");
});

test("cross-instance lease: a School locked by another run is not synced (marked dirty); an expired lease is taken over", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const config = addConfig(school);

  config.autoSync = { lockedUntil: new Date(Date.now() + 60000), dirty: false };
  const busy = await autoSync.requestSchoolFinanceSync(school._id);
  assert.equal(busy.ran, false);
  assert.equal(sheet.reads, 0, "another instance is already syncing this School");
  assert.equal(config.autoSync.dirty, true, "…and will pick this change up");

  config.autoSync = { lockedUntil: new Date(Date.now() - 1000), dirty: false };
  const takeover = await autoSync.requestSchoolFinanceSync(school._id);
  assert.equal(takeover.ran, true, "a crashed run's expired lease never blocks the School forever");
  assert.equal(sheet.reads, 1);
});

test("different Schools sync independently (one School's lease never blocks another)", async () => {
  const a = db.addSchool({ name: "A", ticketPrice: 6000 });
  const b = db.addSchool({ name: "B", ticketPrice: 6000 });
  const configA = addConfig(a);
  addConfig(b);
  configA.autoSync = { lockedUntil: new Date(Date.now() + 60000) };

  assert.equal((await autoSync.requestSchoolFinanceSync(a._id)).ran, false);
  assert.equal((await autoSync.requestSchoolFinanceSync(b._id)).ran, true);
});

// ---------------------------------------------------------------------------
// Scheduled cron = backup / reconciliation
// ---------------------------------------------------------------------------

test("the scheduled cron also reconciles every enabled School sheet (backup for the automatic sync)", async () => {
  const a = db.addSchool({ name: "A", ticketPrice: 6000 });
  const b = db.addSchool({ name: "B", ticketPrice: 6000 });
  const off = db.addSchool({ name: "Off", ticketPrice: 6000 });
  addConfig(a);
  addConfig(b);
  addConfig(off, { enabled: false });
  db.addAttendee(a);
  db.addAttendee(b);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/cron/sync-all`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).then(parse);
    assert.equal(res.status, 200);
    const finance = res.body.results.find((entry) => entry.type === "school-finance");
    assert.equal(finance.status, "success");
    assert.equal(finance.schools, 2, "only enabled configs");
    assert.equal(finance.fullPaymentRead, 2, "column I is read back for every enabled School too");
  });

  assert.equal(sheet.reads, 4, "per School: one read for the Mongo -> Sheet refresh + one for the DONE read-back");
  // Only a brand-new sheet's header (A1:L1) may span I; no data row ever does.
  assert.ok(allWrittenRanges().every((range) => range === "A1:L1" || !rangeCoversColumnI(range)), "column I never written by the cron");
});

test("the manual Sync button still works (admin recovery)", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  addConfig(school);
  db.addAttendee(school);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/admin/school-finance-config/${school._id}/sync`, { method: "POST", headers: adminHeaders() }).then(parse);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.syncedCount, 1);
  });
});

test("the existing payment flow is unchanged by the auto-sync hooks (submit -> approve -> acknowledge -> pay again)", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);
  addConfig(school);

  await withServer(async (base) => {
    const submit = () => {
      const form = new FormData();
      form.append("attendeeId", String(customer._id));
      form.append("phone", customer.phoneNormalized);
      form.append("paymentOptionId", String(db.optionOf(school, 500)._id));
      form.append("paymentProof", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "proof.png");
      return fetch(`${base}/api/deposits`, { method: "POST", body: form }).then(parse);
    };

    const first = await submit();
    assert.equal(first.status, 201);
    assert.equal((await submit()).status, 409, "one payment cycle at a time, exactly as before");

    assert.equal((await approve(base, db.deposits[0])).status, 200);
    await settle();

    const ack = await fetch(`${base}/api/payments/acknowledge-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId: String(customer._id), phone: customer.phoneNormalized, depositId: String(db.deposits[0]._id) })
    }).then(parse);
    assert.equal(ack.status, 200);
    assert.equal((await submit()).status, 201, "the customer can pay again after acknowledging");
  });
});

// ---------------------------------------------------------------------------
// Sheet -> Mongo: the accountant's DONE is read AUTOMATICALLY by the cron
// ---------------------------------------------------------------------------

const cron = (base) =>
  fetch(`${base}/api/cron/sync-all`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).then(parse);

const completionEmails = () => emailCalls.filter((call) => call.options?.idempotencyKey?.startsWith("season2-full-payment"));
const statusOf = (customer) => db.fullPayments.find((doc) => String(doc.attendeeId) === String(customer._id));

// A sheet row as the accountant sees it: A:L, with the Full Payment cell in I.
const sheetRow = (customer, fullPaymentCell) => [
  String(customer._id), "N", "P", "S", 6000, "", 0, 0, fullPaymentCell, "e@example.com", "", ""
];

test("the cron reads column I automatically: an exact trimmed, case-insensitive DONE confirms and sends the completion email ONCE", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const done = db.addAttendee(school, { email: "done@example.com", fullName: "Done Person" });
  const notDone = db.addAttendee(school, { email: "no@example.com" });
  const garbage = db.addAttendee(school, { email: "g@example.com" });
  const blank = db.addAttendee(school, { email: "b@example.com" });
  addConfig(school);
  sheet.rows = [
    HEADER,
    sheetRow(done, "  dOnE \n"),
    sheetRow(notDone, "NOT DONE"),
    sheetRow(garbage, "done!"),
    sheetRow(blank, "")
  ];

  await withServer(async (base) => {
    const res = await cron(base);
    assert.equal(res.status, 200);
  });

  assert.equal(statusOf(done).confirmed, true);
  assert.ok(statusOf(done).confirmedAt instanceof Date);
  for (const customer of [notDone, garbage, blank]) assert.equal(statusOf(customer).confirmed, false);

  assert.equal(completionEmails().length, 1, "exactly one Full Payment Complete email");
  assert.ok(JSON.stringify(completionEmails()[0].payload).includes("done@example.com"), "sent to the completed customer only");
  assert.ok(statusOf(done).season2EmailNotifications.completionSentAt instanceof Date);
});

test("future cron runs do NOT resend the email and do nothing for an already-completed customer", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const done = db.addAttendee(school, { email: "done@example.com" });
  addConfig(school);
  sheet.rows = [HEADER, sheetRow(done, "DONE")];

  await withServer(async (base) => {
    await cron(base);
    assert.equal(completionEmails().length, 1);
    const writesAfterFirst = fullPaymentWrites.length;

    // three more scheduled cycles with the same sheet
    await cron(base);
    await cron(base);
    await cron(base);

    assert.equal(completionEmails().length, 1, "never resent");
    assert.equal(fullPaymentWrites.length, writesAfterFirst, "an unchanged, already-completed row is not even rewritten");
  });
  assert.equal(statusOf(done).confirmed, true);
});

test("a customer already completed in Mongo is untouched: no write, no email", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const done = db.addAttendee(school, { email: "done@example.com" });
  addConfig(school);
  const completedAt = new Date("2026-09-10T10:00:00Z");
  db.fullPayments.push({ attendeeId: done._id, confirmed: true, confirmedAt: completedAt, lastSheetValue: "DONE" });
  sheet.rows = [HEADER, sheetRow(done, "DONE")];

  await withServer(async (base) => {
    await cron(base);
  });

  assert.equal(fullPaymentWrites.length, 0);
  assert.equal(completionEmails().length, 0);
  assert.equal(statusOf(done).confirmedAt, completedAt);
});

test("DONE cleared and re-entered flips the status back and forth but the email is still sent only once", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const customer = db.addAttendee(school, { email: "c@example.com" });
  addConfig(school);

  await withServer(async (base) => {
    sheet.rows = [HEADER, sheetRow(customer, "DONE")];
    await cron(base);
    assert.equal(statusOf(customer).confirmed, true);

    sheet.rows = [HEADER, sheetRow(customer, "")];
    await cron(base);
    assert.equal(statusOf(customer).confirmed, false, "a cleared DONE is honoured");

    sheet.rows = [HEADER, sheetRow(customer, "done")];
    await cron(base);
    assert.equal(statusOf(customer).confirmed, true);
  });

  assert.equal(completionEmails().length, 1, "completionSentAt guards the re-entered DONE");
});

test("the cron never writes column I while it reads it (Mongo -> Sheet leaves the accountant cell alone)", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const customer = db.addAttendee(school);
  addConfig(school);
  sheet.rows = [HEADER, sheetRow(customer, "DONE")];

  await withServer(async (base) => {
    await cron(base);
  });

  assert.ok(sheet.writes.length > 0, "the Mongo -> Sheet refresh ran");
  assert.ok(allWrittenRanges().every((range) => !rangeCoversColumnI(range)));
  assert.ok(!JSON.stringify(sheet.writes).includes("DONE"));
});

test("one School's sheet failing does not stop the others, and the cron still answers 200", async () => {
  const a = db.addSchool({ name: "A", ticketPrice: 6000 });
  const b = db.addSchool({ name: "B", ticketPrice: 6000 });
  const customerB = db.addAttendee(b, { email: "b@example.com" });
  addConfig(a, { googleSheetId: "BROKEN-SHEET" });
  addConfig(b);
  sheet.rows = [HEADER, sheetRow(customerB, "DONE")];

  // fail every read for the first School's sheet id only
  const realSheets = google.sheets;
  google.sheets = (options) => {
    const client = realSheets(options);
    const get = client.spreadsheets.values.get;
    client.spreadsheets.values.get = async (args) => {
      if (args.spreadsheetId === "BROKEN-SHEET") throw new Error("The caller does not have permission");
      return get(args);
    };
    return client;
  };

  try {
    await withServer(async (base) => {
      const res = await cron(base);
      assert.equal(res.status, 200);
      const finance = res.body.results.find((entry) => entry.type === "school-finance");
      assert.equal(finance.schools, 2);
    });
  } finally {
    google.sheets = realSheets;
  }

  assert.equal(statusOf(customerB).confirmed, true, "School B's DONE was still applied");
  assert.equal(completionEmails().length, 1);
});

test("the cron skips a School whose lease is held (never overlaps an automatic sync or another cycle)", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const customer = db.addAttendee(school, { email: "c@example.com" });
  const config = addConfig(school);
  config.autoSync = { lockedUntil: new Date(Date.now() + 60000), dirty: false };
  sheet.rows = [HEADER, sheetRow(customer, "DONE")];

  await withServer(async (base) => {
    const res = await cron(base);
    const finance = res.body.results.find((entry) => entry.type === "school-finance");
    assert.equal(finance.busy, 1);
  });

  assert.equal(sheet.reads, 0, "neither direction ran while another pass held the lease");
  assert.equal(completionEmails().length, 0);
  assert.equal(config.autoSync.dirty, true, "the change is remembered for the next pass");
});

test("the manual Sync Full Payment button still works as a backup, and shares the same once-only email guard", async () => {
  const school = db.addSchool({ name: "Heliopolis", ticketPrice: 6000 });
  const customer = db.addAttendee(school, { email: "c@example.com" });
  addConfig(school);
  sheet.rows = [HEADER, sheetRow(customer, "DONE")];

  await withServer(async (base) => {
    await cron(base); // automatic first
    assert.equal(completionEmails().length, 1);

    const manual = await fetch(`${base}/api/admin/school-finance-config/${school._id}/sync-full-payment`, {
      method: "POST",
      headers: adminHeaders()
    }).then(parse);
    assert.equal(manual.status, 200);
    assert.equal(manual.body.success, true);
    assert.equal(manual.body.confirmedCount, 1);
  });

  assert.equal(completionEmails().length, 1, "the button cannot send a second email");
});
