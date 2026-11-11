// Every School Finance sync entry point is serialized through ONE per-School
// lease (services/financeAutoSync.js) — including the admin's MANUAL Sync button,
// which used to bypass it.
//
// ISOLATED: in-memory database, fake lease-aware config store and a stateful
// fake Google Sheet. No real MongoDB, Sheets or customer data. Every
// interleaving is forced deterministically (a gate holds a sync "running"
// inside its Sheet read), never by timing luck.
//
// Run with:  npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-for-real-use";
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-key";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-secret";
process.env.GOOGLE_CLIENT_EMAIL = "qa-service-account@example.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----\\n";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const SchoolFinanceConfig = require("../src/models/SchoolFinanceConfig");
const { HEADER_ROW } = require("../src/services/googleSheetsSchoolFinanceSync");
const financeAutoSync = require("../src/services/financeAutoSync");
const { requestSchoolFinanceSync, syncSchoolFinanceManually, __testing } = financeAutoSync;
const { createMemoryDb, queryResult } = require("./support/memoryDb");
const { createFakeSpreadsheet, installFakes } = require("./support/statefulSheets");

const SHEET_A = "SERIAL-SHEET-A-test-only";
const SHEET_B = "SERIAL-SHEET-B-test-only";

let db;
let sheets;
let configs;
let pending; // promises handed to the keep-alive hook
let restorers;
let onDirtyWrite; // optional hook, see the SchoolFinanceConfig.updateOne stub
let updateOneCalls;

// --- lease-aware SchoolFinanceConfig store (same filter shapes the service uses)
const getPath = (doc, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), doc);
const setPath = (doc, path, value) => {
  const parts = path.split(".");
  let target = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof target[parts[i]] !== "object" || target[parts[i]] === null) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
};
function configMatches(doc, filter = {}) {
  if (filter.schoolId !== undefined && String(doc.schoolId) !== String(filter.schoolId)) return false;
  if (filter.enabled !== undefined && doc.enabled !== filter.enabled) return false;
  if (filter.googleSheetId && !(typeof doc.googleSheetId === "string" && doc.googleSheetId !== "")) return false;
  if ("autoSync.dirty" in filter && getPath(doc, "autoSync.dirty") !== filter["autoSync.dirty"]) return false;
  if (filter.$or) {
    const lock = getPath(doc, "autoSync.lockedUntil");
    if (!(lock == null || lock.getTime() < Date.now())) return false;
  }
  return true;
}
const applySet = (doc, update) => {
  for (const [path, value] of Object.entries(update.$set || {})) setPath(doc, path, value);
  return doc;
};

function addConfig(school, googleSheetId, overrides = {}) {
  const sp = sheets[googleSheetId];
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    schoolId: school._id,
    googleSheetId,
    tabName: "Sheet1",
    enabled: true,
    // recordSyncResult() runs at the END of every sync (success or error).
    save: async () => {
      if (sp) sp.endCritical();
      return doc;
    },
    ...overrides
  };
  configs.push(doc);
  return doc;
}

function newSheet(id) {
  sheets[id] = createFakeSpreadsheet();
  sheets[id].rows.push([...HEADER_ROW]);
  return sheets[id];
}

let clock = Date.parse("2026-10-01T10:00:00Z");
function addDeposit(attendee, { amount = 500, status = "approved" } = {}) {
  const deposit = {
    _id: new mongoose.Types.ObjectId(),
    attendeeId: attendee._id,
    amount,
    status,
    paymentProof: { url: `https://cdn.example/${amount}.png` },
    createdAt: new Date((clock += 1000)),
    ...(status === "approved" ? { reviewedAt: new Date((clock += 500)) } : {})
  };
  db.deposits.push(deposit);
  return deposit;
}
const approveNow = (deposit) => {
  deposit.status = "approved";
  deposit.reviewedAt = new Date((clock += 1000));
};

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate, label) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }
  assert.fail(`timed out waiting for: ${label}`);
}
async function settle() {
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(pending.splice(0));
    // eslint-disable-next-line no-await-in-loop
    await tick();
    if (!pending.length) return;
  }
}
const holdReads = (sp) => {
  let release;
  sp.gate = new Promise((resolve) => (release = resolve));
  return () => {
    sp.gate = null;
    release();
  };
};

test.beforeEach(() => {
  db = createMemoryDb();
  sheets = {};
  configs = [];
  pending = [];
  restorers = [];
  onDirtyWrite = null;
  updateOneCalls = 0;
  const stub = (obj, method, impl) => {
    const original = obj[method];
    obj[method] = impl;
    restorers.push(() => {
      obj[method] = original;
    });
  };
  restorers.push(installFakes(() => sheets));
  stub(SchoolFinanceConfig, "findOne", (filter = {}) => queryResult(configs.find((doc) => configMatches(doc, filter)) || null));
  stub(SchoolFinanceConfig, "findOneAndUpdate", (filter, update) => {
    const doc = configs.find((candidate) => configMatches(candidate, filter));
    return queryResult(doc ? applySet(doc, update) : null);
  });
  stub(SchoolFinanceConfig, "updateOne", async (filter, update) => {
    const doc = configs.find((candidate) => configMatches(candidate, filter));
    updateOneCalls += 1;
    // Test hook: runs exactly when a caller is about to set the dirty flag.
    if (doc && onDirtyWrite && update.$set && update.$set["autoSync.dirty"] === true) onDirtyWrite(doc);
    if (doc) applySet(doc, update);
    return { matchedCount: doc ? 1 : 0 };
  });
  __testing.setConnectedCheck(() => true);
  __testing.setKeepAlive((promise) => pending.push(promise));
  __testing.setGap(0);
  __testing.setLeaseWait(60, 2); // a waiting manual sync retries every 2ms
});
test.afterEach(() => {
  while (restorers.length) restorers.pop()();
  __testing.reset();
});

const lockOf = (config) => getPath(config, "autoSync.lockedUntil");
const dirtyOf = (config) => getPath(config, "autoSync.dirty");

// ---------------------------------------------------------------------------
// Entry-point basics
// ---------------------------------------------------------------------------

test("manual sync on a free School runs the existing sync, returns its normal result, and releases the lease", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A);
  const customer = db.addAttendee(school);
  addDeposit(customer, { amount: 700 });
  db.addAttendee(school); // unpaid: stays out

  const result = await syncSchoolFinanceManually(school._id);

  assert.equal(result.success, true);
  assert.equal(result.syncedCount, 1);
  assert.equal(result.appended, 1);
  assert.deepEqual(sp.ids(), [String(customer._id)]);
  assert.equal(lockOf(config), null, "lease released");
  assert.equal(config.lastSync.status, "success");
});

test("manual sync with no enabled sheet is skipped without touching Google, and takes no lease", async () => {
  const school = db.addSchool({ name: "S" });
  const sp = newSheet(SHEET_A);
  const disabled = addConfig(school, SHEET_A, { enabled: false });

  const result = await syncSchoolFinanceManually(school._id);
  assert.equal(result.skipped, true);
  assert.equal(sp.reads, 0);
  assert.equal(lockOf(disabled) == null, true);

  const other = db.addSchool({ name: "No config at all" });
  const noConfig = await syncSchoolFinanceManually(other._id);
  assert.equal(noConfig.skipped, true);
});

// ---------------------------------------------------------------------------
// Manual vs automatic — both orders, deterministic
// ---------------------------------------------------------------------------

test("ORDER 1: an automatic sync is running -> a manual sync WAITS (never reads the Sheet at the same time) and then runs", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A);
  const first = db.addAttendee(school);
  addDeposit(first, { amount: 100 });
  const release = holdReads(sp);

  const auto = requestSchoolFinanceSync(school._id);
  await until(() => sp.reads === 1, "the automatic sync reached the Sheet");

  const manual = syncSchoolFinanceManually(school._id);
  for (let i = 0; i < 15; i += 1) await tick(); // plenty of chances to (wrongly) overlap
  assert.equal(sp.reads, 1, "the manual sync did NOT touch the Sheet while the automatic sync was running");
  assert.equal(sp.maxCritical, 1);

  release();
  const manualResult = await manual;
  await auto;
  await settle();

  assert.equal(manualResult.success, true);
  assert.equal(sp.maxCritical, 1, "never two syncs inside the read..end window");
  assert.deepEqual(sp.ids(), [String(first._id)]);
  assert.deepEqual(sp.duplicateIds(), []);
  assert.equal(lockOf(config), null);
});

test("ORDER 2: a manual sync is running -> an approval's automatic sync is deferred, then runs; the approval is not lost", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A);
  const early = db.addAttendee(school);
  const late = db.addAttendee(school);
  addDeposit(early, { amount: 100 });
  const latePending = addDeposit(late, { amount: 300, status: "pending" });
  const release = holdReads(sp);

  const manual = syncSchoolFinanceManually(school._id);
  await until(() => sp.reads === 1, "the manual sync reached the Sheet");

  // The approval lands while the manual sync is running; its trigger must not
  // run a second concurrent sync — it leaves the dirty flag instead.
  approveNow(latePending);
  const auto = requestSchoolFinanceSync(school._id);
  for (let i = 0; i < 15; i += 1) await tick();
  assert.equal(sp.reads, 1, "the automatic sync did NOT read the Sheet while the manual sync was running");
  assert.equal(dirtyOf(config), true, "the request is remembered");

  release();
  await manual;
  await auto;
  await settle();

  assert.equal(sp.maxCritical, 1);
  assert.deepEqual(sp.ids().sort(), [String(early._id), String(late._id)].sort(), "the approval made it to the Sheet");
  assert.deepEqual(sp.duplicateIds(), []);
  assert.equal(lockOf(config), null);
  assert.ok(!dirtyOf(config), "the request was consumed");
});

test("a manual sync that cannot get the lease in time is QUEUED (not run, not lost): the running sync picks the work up", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A);
  const early = db.addAttendee(school);
  addDeposit(early, { amount: 100 });
  const release = holdReads(sp);
  __testing.setLeaseWait(3, 1); // give up quickly

  const auto = requestSchoolFinanceSync(school._id);
  await until(() => sp.reads === 1, "the automatic sync reached the Sheet");

  // A new approval lands, then the admin presses the manual button.
  const late = db.addAttendee(school);
  addDeposit(late, { amount: 300 });
  const manualResult = await syncSchoolFinanceManually(school._id);

  assert.equal(manualResult.queued, true);
  assert.equal(manualResult.skipped, true);
  assert.equal(manualResult.success, false);
  assert.match(manualResult.reason, /queued/i);
  assert.equal(sp.reads, 1, "the queued manual sync never touched the Sheet");
  assert.equal(dirtyOf(config), true, "the dirty flag guarantees a follow-up pass");

  release();
  await auto;
  await settle();

  assert.deepEqual(sp.ids().sort(), [String(early._id), String(late._id)].sort(), "nothing was lost");
  assert.deepEqual(sp.duplicateIds(), []);
  assert.equal(sp.maxCritical, 1);
  assert.equal(lockOf(config), null);
  assert.ok(!dirtyOf(config));
});

test("a request that arrives DURING a manual sync gets its own follow-up pass", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A);
  const early = db.addAttendee(school);
  addDeposit(early, { amount: 100 });
  const release = holdReads(sp);

  const manual = syncSchoolFinanceManually(school._id);
  await until(() => sp.reads === 1, "manual reached the Sheet");
  const late = db.addAttendee(school);
  addDeposit(late, { amount: 300 });
  requestSchoolFinanceSync(school._id); // sees the lease held -> dirty flag only
  await tick();
  release();
  await manual;
  await settle();

  assert.deepEqual(sp.ids().sort(), [String(early._id), String(late._id)].sort());
  assert.deepEqual(sp.duplicateIds(), []);
  assert.equal(sp.maxCritical, 1);
  assert.ok(!dirtyOf(config));
});

// ---------------------------------------------------------------------------
// Lost-wakeup regression: the lease holder finishes in the instant between a
// manual sync's last failed claim and its dirty-flag write
// ---------------------------------------------------------------------------

test("REGRESSION: the lease is released just before the manual sync sets the dirty flag -> the queued request still runs (no orphaned flag)", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A, { autoSync: { lockedUntil: new Date(Date.now() + 40 * 1000) } });
  const customer = db.addAttendee(school);
  addDeposit(customer, { amount: 100 });
  __testing.setLeaseWait(2, 1);

  // The (simulated) holder finishes — lease released, its final dirty check
  // already done — at EXACTLY the moment the manual sync writes the flag.
  onDirtyWrite = (doc) => {
    doc.autoSync.lockedUntil = null;
  };

  const result = await syncSchoolFinanceManually(school._id);
  assert.equal(result.queued, true);
  await settle();

  // Before the fix: the flag stayed set, nobody synced, the customer was missing.
  assert.deepEqual(sp.ids(), [String(customer._id)], "the queued request was acted on");
  assert.equal(sp.reads, 1, "exactly one sync ran — no loop, no repeat");
  assert.equal(sp.maxCritical, 1);
  assert.ok(!dirtyOf(config), "the flag was consumed, not orphaned");
  assert.equal(lockOf(config), null);
  assert.deepEqual(sp.duplicateIds(), []);
});

test("while the lease stays held, the follow-up request only re-marks dirty: no Sheet access, no recursion, bounded Mongo writes", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A, { autoSync: { lockedUntil: new Date(Date.now() + 40 * 1000) } });
  addDeposit(db.addAttendee(school), { amount: 100 });
  __testing.setLeaseWait(3, 1);

  const result = await syncSchoolFinanceManually(school._id);
  await settle();

  assert.equal(result.queued, true);
  assert.equal(sp.reads, 0, "never touched the Sheet while another run holds the lease");
  assert.equal(dirtyOf(config), true);
  // 1 dirty write from the manual path + 1 from the follow-up request, nothing more.
  assert.ok(updateOneCalls <= 3, `bounded Mongo writes (${updateOneCalls})`);
  assert.equal(pending.length, 0, "no sync left running in the background");
});

test("the follow-up never overlaps a sync that is genuinely still running", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A);
  const early = db.addAttendee(school);
  addDeposit(early, { amount: 100 });
  const release = holdReads(sp);
  __testing.setLeaseWait(3, 1);

  const auto = requestSchoolFinanceSync(school._id);
  await until(() => sp.reads === 1, "the automatic sync reached the Sheet");
  const manualResult = await syncSchoolFinanceManually(school._id); // queued; follow-up sees the lease held
  assert.equal(manualResult.queued, true);
  for (let i = 0; i < 15; i += 1) await tick();
  assert.equal(sp.reads, 1, "still only the original sync is inside the Sheet");

  release();
  await auto;
  await settle();
  assert.equal(sp.maxCritical, 1);
  assert.deepEqual(sp.duplicateIds(), []);
  assert.deepEqual(sp.ids(), [String(early._id)]);
  assert.ok(!dirtyOf(config));
  assert.equal(lockOf(config), null);
});

// ---------------------------------------------------------------------------
// The race that motivated this change, now prevented by serialization
// ---------------------------------------------------------------------------

for (const firstIsManual of [true, false]) {
  test(`the duplicate-row race (older registrant approved between two syncs) cannot happen: ${firstIsManual ? "manual first, automatic second" : "automatic first, manual second"}`, async () => {
    const school = db.addSchool({ name: "S", ticketPrice: 6000 });
    const sp = newSheet(SHEET_A);
    const config = addConfig(school, SHEET_A);
    const olderRegistrant = db.addAttendee(school);
    const newerRegistrant = db.addAttendee(school);
    const olderPending = addDeposit(olderRegistrant, { amount: 300, status: "pending" });
    addDeposit(newerRegistrant, { amount: 400 });
    const release = holdReads(sp);

    const runFirst = () => (firstIsManual ? syncSchoolFinanceManually(school._id) : requestSchoolFinanceSync(school._id));
    const runSecond = () => (firstIsManual ? requestSchoolFinanceSync(school._id) : syncSchoolFinanceManually(school._id));

    const first = runFirst(); // loads only the newer registrant as eligible
    await until(() => sp.reads === 1, "first sync reached the Sheet");
    approveNow(olderPending); // the older registrant is approved mid-run
    const second = runSecond();
    for (let i = 0; i < 15; i += 1) await tick();
    assert.equal(sp.reads, 1, "the second sync is held back by the lease");

    release();
    await Promise.all([first, second]);
    await settle();

    assert.equal(sp.maxCritical, 1);
    assert.deepEqual(sp.duplicateIds(), [], "no customer appears twice");
    assert.deepEqual(sp.ids().sort(), [String(olderRegistrant._id), String(newerRegistrant._id)].sort(), "no customer lost");
    assert.equal(sp.cell(olderRegistrant._id, "H"), 300);
    assert.equal(sp.cell(newerRegistrant._id, "H"), 400);
    assert.equal(lockOf(config), null);
  });
}

test("concurrent approvals + manual presses: one sync at a time, every approved customer present once, Column I intact", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A);
  const doneCustomer = db.addAttendee(school);
  addDeposit(doneCustomer, { amount: 100 });
  await syncSchoolFinanceManually(school._id);
  sp.accountantTypes(sp.rowOf(doneCustomer._id), "I", "DONE");

  const registrants = Array.from({ length: 6 }, () => db.addAttendee(school));
  const pendings = registrants.map((r) => addDeposit(r, { amount: 250, status: "pending" }));
  const unpaid = db.addAttendee(school);

  // Approve in a scrambled order, firing automatic and manual syncs together.
  const manuals = [];
  for (const index of [4, 1, 5, 0, 3, 2]) {
    approveNow(pendings[index]);
    requestSchoolFinanceSync(school._id);
    manuals.push(syncSchoolFinanceManually(school._id));
  }
  await Promise.all(manuals);
  await settle();
  // One more manual press converges whatever was still queued.
  const finalResult = await syncSchoolFinanceManually(school._id);
  await settle();

  assert.equal(finalResult.success, true);
  assert.equal(sp.maxCritical, 1, "never two syncs inside the read..end window");
  assert.deepEqual(sp.duplicateIds(), []);
  assert.deepEqual(sp.ids().sort(), [doneCustomer, ...registrants].map((c) => String(c._id)).sort());
  assert.ok(!sp.ids().includes(String(unpaid._id)));
  for (const r of registrants) assert.equal(sp.cell(r._id, "H"), 250);
  assert.deepEqual(sp.columnI(), { [String(doneCustomer._id)]: "DONE" }, "Column I still belongs to the same customer");
  assert.equal(lockOf(config), null);
});

// ---------------------------------------------------------------------------
// Failure and retry
// ---------------------------------------------------------------------------

test("a failed manual sync releases the lease; an immediate retry succeeds with no duplicates", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A);
  const customer = db.addAttendee(school);
  addDeposit(customer, { amount: 100 });

  sp.failNextRead = "Google quota exceeded";
  const failed = await syncSchoolFinanceManually(school._id);
  assert.equal(failed.success, false);
  assert.equal(config.lastSync.status, "error");
  assert.equal(lockOf(config), null, "lease released even though the sync failed");
  assert.deepEqual(sp.ids(), []);

  const retried = await syncSchoolFinanceManually(school._id);
  assert.equal(retried.success, true);
  assert.deepEqual(sp.ids(), [String(customer._id)]);
  assert.deepEqual(sp.duplicateIds(), []);
});

test("a failed write during a manual sync applies nothing; the next sync (manual or automatic) completes it", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  const customers = [db.addAttendee(school), db.addAttendee(school)];
  customers.forEach((c) => addDeposit(c, { amount: 100 }));

  sp.failNextWrite = "Backend error";
  assert.equal((await syncSchoolFinanceManually(school._id)).success, false);
  assert.deepEqual(sp.ids(), []);

  requestSchoolFinanceSync(school._id);
  await settle();
  assert.deepEqual(sp.ids().sort(), customers.map((c) => String(c._id)).sort());
  assert.deepEqual(sp.duplicateIds(), []);
});

test("a crashed sync's lease expires by itself (45s) and a manual sync can then run", async () => {
  const school = db.addSchool({ name: "S", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  const config = addConfig(school, SHEET_A, { autoSync: { lockedUntil: new Date(Date.now() + 60 * 1000) } });
  const customer = db.addAttendee(school);
  addDeposit(customer, { amount: 100 });
  __testing.setLeaseWait(2, 1);

  const blocked = await syncSchoolFinanceManually(school._id);
  assert.equal(blocked.queued, true, "a live lease blocks the manual sync");
  assert.equal(sp.reads, 0);

  config.autoSync.lockedUntil = new Date(Date.now() - 1000); // the lease expired
  const result = await syncSchoolFinanceManually(school._id);
  assert.equal(result.success, true);
  assert.deepEqual(sp.ids(), [String(customer._id)]);
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

test("School A's running sync never blocks School B's manual sync, and the Sheets stay separate", async () => {
  const schoolA = db.addSchool({ name: "A", ticketPrice: 6000 });
  const schoolB = db.addSchool({ name: "B", ticketPrice: 4500 });
  const spA = newSheet(SHEET_A);
  const spB = newSheet(SHEET_B);
  addConfig(schoolA, SHEET_A);
  addConfig(schoolB, SHEET_B);
  const inA = db.addAttendee(schoolA);
  const inB = db.addAttendee(schoolB);
  addDeposit(inA, { amount: 100 });
  addDeposit(inB, { amount: 200 });
  const release = holdReads(spA);

  const autoA = requestSchoolFinanceSync(schoolA._id);
  await until(() => spA.reads === 1, "A's sync is running");
  const resultB = await syncSchoolFinanceManually(schoolB._id);
  assert.equal(resultB.success, true, "B is not blocked by A's lease");
  assert.deepEqual(spB.ids(), [String(inB._id)]);

  release();
  await autoA;
  await settle();
  assert.deepEqual(spA.ids(), [String(inA._id)]);
  assert.deepEqual(spB.ids(), [String(inB._id)]);
});

// ---------------------------------------------------------------------------
// Entry-point audit: nothing else may reach the Sheet writer unleased
// ---------------------------------------------------------------------------

test("AUDIT: the only callers of syncSchoolFinanceSheet are the leased paths in financeAutoSync", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..", "src");
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && /\bsyncSchoolFinanceSheet\s*\(/.test(fs.readFileSync(full, "utf8"))) {
        hits.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  // the writer itself + financeAutoSync (syncSchoolFinance / reconcileSchool /
  // syncSchoolFinanceManually, each under claimLease). No route may call it directly.
  assert.deepEqual(hits.sort(), ["services/financeAutoSync.js", "services/googleSheetsSchoolFinanceSync.js"]);
});
