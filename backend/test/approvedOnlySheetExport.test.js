// Approved-payments-only School Finance Sheet export.
//
// ISOLATED: no real MongoDB, Google Sheets or customer data is touched. Models
// run on the in-memory database (test/support/memoryDb.js) and the googleapis
// client is replaced by a STATEFUL fake spreadsheet that actually applies
// every write (so row positions, Column I and duplicates can be asserted), can
// be made to fail, and can hold reads at a barrier so overlapping syncs can be
// forced to read the same snapshot before either writes.
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
const { google } = require("googleapis");

const SchoolFinanceConfig = require("../src/models/SchoolFinanceConfig");
const { syncSchoolFinanceSheet, HEADER_ROW } = require("../src/services/googleSheetsSchoolFinanceSync");
const { createMemoryDb, queryResult } = require("./support/memoryDb");

const SHEET_A = "SHEET-A-test-only";
const SHEET_B = "SHEET-B-test-only";

let db;
let sheets; // spreadsheetId -> fake spreadsheet
let configs;
let restoreGoogle;
let restoreConfig;

const { createFakeSpreadsheet, installFakes } = require("./support/statefulSheets");

function installConfigStore() {
  const original = SchoolFinanceConfig.findOne;
  SchoolFinanceConfig.findOne = (filter = {}) =>
    queryResult(configs.find((doc) => String(doc.schoolId) === String(filter.schoolId)) || null);
  return () => {
    SchoolFinanceConfig.findOne = original;
  };
}

function addConfig(school, googleSheetId) {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    schoolId: school._id,
    googleSheetId,
    tabName: "Sheet1",
    enabled: true,
    save: async () => doc
  };
  configs.push(doc);
  return doc;
}

let clock = Date.parse("2026-10-01T10:00:00Z");
function addDeposit(attendee, { amount = 500, status = "approved" } = {}) {
  const deposit = {
    _id: new mongoose.Types.ObjectId(),
    attendeeId: attendee._id,
    amount,
    status,
    paymentProof: { url: `https://cdn.example/${amount}-${status}.png`, publicId: "never-in-the-sheet" },
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

const newSheet = (id, withHeader = true) => {
  sheets[id] = createFakeSpreadsheet();
  if (withHeader) sheets[id].rows.push([...HEADER_ROW]);
  return sheets[id];
};

test.beforeEach(() => {
  db = createMemoryDb();
  sheets = {};
  configs = [];
  restoreGoogle = installFakes(() => sheets);
  restoreConfig = installConfigStore();
});
test.afterEach(() => {
  db.restore();
  restoreGoogle();
  restoreConfig();
});

const sync = (school) => syncSchoolFinanceSheet(school._id);

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

test("only customers with at least ONE approved payment are exported; everyone stays registered", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);

  const registeredOnly = db.addAttendee(school);
  const pendingOnly = db.addAttendee(school);
  const rejectedOnly = db.addAttendee(school);
  const oneApproved = db.addAttendee(school);
  const multiApproved = db.addAttendee(school);
  const approvedPlusPending = db.addAttendee(school);
  const approvedPlusRejected = db.addAttendee(school);

  addDeposit(pendingOnly, { amount: 100, status: "pending" });
  addDeposit(rejectedOnly, { amount: 100, status: "rejected" });
  addDeposit(oneApproved, { amount: 500 });
  addDeposit(multiApproved, { amount: 500 });
  addDeposit(multiApproved, { amount: 1000 });
  addDeposit(approvedPlusPending, { amount: 500 });
  addDeposit(approvedPlusPending, { amount: 777, status: "pending" });
  addDeposit(approvedPlusRejected, { amount: 500 });
  addDeposit(approvedPlusRejected, { amount: 888, status: "rejected" });

  const result = await sync(school);
  assert.equal(result.success, true);
  assert.equal(result.syncedCount, 4);

  const inSheet = new Set(sp.ids());
  for (const excluded of [registeredOnly, pendingOnly, rejectedOnly]) {
    assert.equal(inSheet.has(String(excluded._id)), false, "never exported");
  }
  for (const included of [oneApproved, multiApproved, approvedPlusPending, approvedPlusRejected]) {
    assert.equal(inSheet.has(String(included._id)), true, "exported");
  }
  assert.equal(inSheet.size, 4);

  // Approved data only.
  assert.equal(sp.cell(multiApproved._id, "F"), "500, 1000");
  assert.equal(sp.cell(multiApproved._id, "G"), 2);
  assert.equal(sp.cell(multiApproved._id, "H"), 1500);
  assert.equal(sp.cell(approvedPlusPending._id, "H"), 500, "the pending 777 is not counted");
  assert.equal(sp.cell(approvedPlusRejected._id, "H"), 500, "the rejected 888 is not counted");
  assert.ok(!JSON.stringify(sp.rows).includes("777") && !JSON.stringify(sp.rows).includes("888"));
  assert.ok(!JSON.stringify(sp.rows).includes("pending.png") && !JSON.stringify(sp.rows).includes("rejected.png"));

  // MongoDB / Admin Dashboard still hold EVERY customer and EVERY deposit.
  assert.equal(db.attendees.length, 7);
  assert.equal(db.deposits.length, 9);
});

test("a School with nobody eligible writes no customer rows (and does not fail)", async () => {
  const school = db.addSchool({ name: "Empty", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  addDeposit(db.addAttendee(school), { status: "pending" });
  db.addAttendee(school);

  const result = await sync(school);
  assert.equal(result.success, true);
  assert.equal(result.syncedCount, 0);
  assert.deepEqual(sp.ids(), []);
  assert.equal(sp.batchCalls, 0, "nothing to write");
});

test("the FIRST approval makes the customer appear; later approvals update the SAME row (no duplicate)", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  const customer = db.addAttendee(school);
  const first = addDeposit(customer, { amount: 500, status: "pending" });

  await sync(school);
  assert.deepEqual(sp.ids(), [], "pending only: not exported");

  approveNow(first);
  await sync(school);
  assert.deepEqual(sp.ids(), [String(customer._id)]);
  const rowAfterFirst = sp.rowOf(customer._id);
  assert.equal(sp.cell(customer._id, "H"), 500);

  addDeposit(customer, { amount: 1000, status: "pending" });
  await sync(school);
  assert.equal(sp.cell(customer._id, "H"), 500, "a new pending payment changes nothing");

  const second = db.deposits[db.deposits.length - 1];
  approveNow(second);
  await sync(school);
  assert.equal(sp.rowOf(customer._id), rowAfterFirst, "same row");
  assert.equal(sp.cell(customer._id, "F"), "500, 1000");
  assert.equal(sp.cell(customer._id, "G"), 2);
  assert.equal(sp.cell(customer._id, "H"), 1500);
  assert.deepEqual(sp.duplicateIds(), []);
  assert.equal(sp.ids().length, 1);
});

// ---------------------------------------------------------------------------
// Existing Sheet rows and Column I
// ---------------------------------------------------------------------------

test("existing unpaid rows are NOT removed or rewritten; their Column I is untouched; approved rows update in place", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);

  const unpaidWithDone = db.addAttendee(school);
  const approved = db.addAttendee(school);
  const unpaidWithText = db.addAttendee(school);
  const unpaidBlank = db.addAttendee(school);
  addDeposit(approved, { amount: 500 });

  // A live-like sheet: every customer already has a row (old behavior).
  sp.rows.push(
    [String(unpaidWithDone._id), "n1", "p", "S", 6000, "", 0, 0, "DONE", "", "", ""],
    [String(approved._id), "old", "p", "S", 6000, "", 0, 0, "waiting", "", "", ""],
    [String(unpaidWithText._id), "n3", "p", "S", 6000, "", 0, 0, "check with bank", "", "", ""],
    [String(unpaidBlank._id), "n4", "p", "S", 6000, "", 0, 0, "", "", "", ""]
  );
  const unpaidRowsBefore = JSON.stringify([2, 4, 5].map((n) => sp.rows[n - 1]));

  const result = await sync(school);
  assert.equal(result.success, true);
  assert.equal(result.updated, 1);
  assert.equal(result.appended, 0);

  assert.equal(sp.rows.length, 5, "no row added or removed");
  assert.equal(JSON.stringify([2, 4, 5].map((n) => sp.rows[n - 1])), unpaidRowsBefore, "unpaid rows are byte-for-byte untouched");
  assert.equal(sp.rowOf(approved._id), 3, "approved customer updated IN PLACE");
  assert.equal(sp.cell(approved._id, "H"), 500);
  assert.equal(sp.cell(approved._id, "I"), "waiting", "Column I of the updated row is untouched");
  assert.deepEqual(sp.columnI(), {
    [String(unpaidWithDone._id)]: "DONE",
    [String(approved._id)]: "waiting",
    [String(unpaidWithText._id)]: "check with bank"
  });
  assert.deepEqual(sp.duplicateIds(), []);
});

test("an existing unpaid row that later gets its first approval is updated in place (Column I kept, no duplicate)", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  const customer = db.addAttendee(school);
  const other = db.addAttendee(school);
  addDeposit(other, { amount: 500 });
  const pending = addDeposit(customer, { amount: 700, status: "pending" });
  sp.rows.push(
    [String(customer._id), "n", "p", "S", 6000, "", 0, 0, "DONE", "", "", ""],
    [String(other._id), "n", "p", "S", 6000, "", 0, 0, "", "", "", ""]
  );

  await sync(school);
  assert.equal(sp.cell(customer._id, "H"), 0, "still unpaid, row untouched");

  approveNow(pending);
  await sync(school);
  assert.equal(sp.rowOf(customer._id), 2);
  assert.equal(sp.cell(customer._id, "H"), 700);
  assert.equal(sp.cell(customer._id, "I"), "DONE");
  assert.deepEqual(sp.duplicateIds(), []);
  assert.equal(sp.ids().length, 2);
});

test("Column I stays attached to its Customer ID while new approved customers are appended around it", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);

  const a = db.addAttendee(school);
  addDeposit(a, { amount: 500 });
  await sync(school);
  sp.accountantTypes(sp.rowOf(a._id), "I", "DONE");

  const later = [];
  for (let i = 0; i < 4; i += 1) {
    const c = db.addAttendee(school);
    addDeposit(c, { amount: 100 * (i + 1) });
    later.push(c);
    await sync(school);
  }

  assert.equal(sp.cell(a._id, "I"), "DONE");
  assert.deepEqual(sp.columnI(), { [String(a._id)]: "DONE" }, "nobody else ever gained a Column I value");
  assert.deepEqual(sp.duplicateIds(), []);
  assert.equal(sp.ids().length, 5);
});

test("re-syncing is idempotent: nothing changes, nothing is duplicated", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  for (let i = 0; i < 3; i += 1) addDeposit(db.addAttendee(school), { amount: 100 + i });
  await sync(school);
  const first = JSON.stringify(sp.rows);
  await sync(school);
  await sync(school);
  assert.equal(JSON.stringify(sp.rows), first);
  assert.deepEqual(sp.duplicateIds(), []);
});

// ---------------------------------------------------------------------------
// Isolation, failure and retry
// ---------------------------------------------------------------------------

test("School sheets stay isolated: each sheet holds only its own School's approved customers", async () => {
  const schoolA = db.addSchool({ name: "A", ticketPrice: 6000 });
  const schoolB = db.addSchool({ name: "B", ticketPrice: 4500 });
  const spA = newSheet(SHEET_A);
  const spB = newSheet(SHEET_B);
  addConfig(schoolA, SHEET_A);
  addConfig(schoolB, SHEET_B);

  const inA = db.addAttendee(schoolA);
  const unpaidA = db.addAttendee(schoolA);
  const inB = db.addAttendee(schoolB);
  const unpaidB = db.addAttendee(schoolB);
  addDeposit(inA, { amount: 500 });
  addDeposit(inB, { amount: 800 });

  await Promise.all([sync(schoolA), sync(schoolB)]);

  assert.deepEqual(spA.ids(), [String(inA._id)]);
  assert.deepEqual(spB.ids(), [String(inB._id)]);
  assert.ok(!spA.ids().includes(String(unpaidA._id)) && !spB.ids().includes(String(unpaidB._id)));
});

test("a Google read failure writes nothing, reports the error, and a retry converges", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  const customer = db.addAttendee(school);
  addDeposit(customer, { amount: 500 });

  sp.failNextRead = "Quota exceeded";
  const failed = await sync(school);
  assert.equal(failed.success, false);
  assert.deepEqual(sp.ids(), []);

  const retried = await sync(school);
  assert.equal(retried.success, true);
  assert.deepEqual(sp.ids(), [String(customer._id)]);
  assert.deepEqual(sp.duplicateIds(), []);
});

test("a Google write failure applies nothing (atomic batch); the retry completes without duplicates", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  const customers = [db.addAttendee(school), db.addAttendee(school)];
  customers.forEach((c) => addDeposit(c, { amount: 500 }));

  sp.failNextWrite = "Backend error";
  assert.equal((await sync(school)).success, false);
  assert.deepEqual(sp.ids(), []);

  assert.equal((await sync(school)).success, true);
  assert.deepEqual(sp.ids().sort(), customers.map((c) => String(c._id)).sort());
  assert.deepEqual(sp.duplicateIds(), []);
});

// ---------------------------------------------------------------------------
// Overlapping syncs (the manual Sync button does NOT take the per-School
// lease, so a manual sync can overlap an automatic one)
// ---------------------------------------------------------------------------

test("two overlapping syncs of the same state: no duplicate rows, Column I intact", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  const existing = db.addAttendee(school);
  addDeposit(existing, { amount: 500 });
  await sync(school);
  sp.accountantTypes(sp.rowOf(existing._id), "I", "DONE");

  const fresh = [db.addAttendee(school), db.addAttendee(school), db.addAttendee(school)];
  fresh.forEach((c) => addDeposit(c, { amount: 200 }));

  sp.barrier = { count: 2, waiting: [] }; // both read before either writes
  await Promise.all([sync(school), sync(school)]);
  sp.barrier = null;

  assert.deepEqual(sp.duplicateIds(), []);
  assert.equal(sp.ids().length, 4);
  assert.equal(sp.cell(existing._id, "I"), "DONE");
  assert.deepEqual(Object.keys(sp.columnI()), [String(existing._id)]);
  for (const c of fresh) assert.equal(sp.cell(c._id, "H"), 200);
});

for (const reverse of [false, true]) {
  test(`overlapping syncs where an OLDER registrant is approved between them (${reverse ? "later sync writes first" : "earlier sync writes first"}): no duplicates, no lost customer`, async () => {
    const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
    const sp = newSheet(SHEET_A);
    addConfig(school, SHEET_A);

    const olderRegistrant = db.addAttendee(school); // registered first…
    const newerRegistrant = db.addAttendee(school); // …registered second
    const olderPending = addDeposit(olderRegistrant, { amount: 300, status: "pending" });
    addDeposit(newerRegistrant, { amount: 400 }); // approved first

    // Sync 1 loads its data (only the newer registrant is eligible) and reaches
    // the sheet read, where it waits…
    sp.barrier = { count: 2, waiting: [], reverse };
    const first = sync(school);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    // …the older registrant's payment is approved, then a second sync starts.
    approveNow(olderPending);
    const second = sync(school);
    await Promise.all([first, second]);
    sp.barrier = null;

    assert.deepEqual(sp.duplicateIds(), [], "no customer may appear twice");
    assert.deepEqual(sp.ids().sort(), [String(olderRegistrant._id), String(newerRegistrant._id)].sort(), "both eligible customers present");
    assert.equal(sp.cell(olderRegistrant._id, "H"), 300);
    assert.equal(sp.cell(newerRegistrant._id, "H"), 400);
  });
}

test("serialized syncs (the automatic path, which holds the lease) never misalign rows", async () => {
  const school = db.addSchool({ name: "Test School", ticketPrice: 6000 });
  const sp = newSheet(SHEET_A);
  addConfig(school, SHEET_A);
  const registrants = Array.from({ length: 6 }, () => db.addAttendee(school));
  const pendings = registrants.map((r) => addDeposit(r, { amount: 100, status: "pending" }));

  // Approve in a scrambled order, syncing after each approval.
  for (const index of [4, 1, 5, 0, 3, 2]) {
    approveNow(pendings[index]);
    await sync(school);
    assert.deepEqual(sp.duplicateIds(), []);
  }
  assert.equal(sp.ids().length, 6);
  for (const r of registrants) assert.equal(sp.cell(r._id, "H"), 100);
});
