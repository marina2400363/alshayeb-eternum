// In-memory stand-in for the handful of Mongoose statics the payment routes
// use, so tests can drive REAL routes end to end (submit → approve →
// acknowledge → pay again) with no live Mongo, Cloudinary or Sheets.
//
// It deliberately mirrors the database rules the routes rely on:
//   • Deposit partial unique index {attendeeId, activeCycle} (and the legacy
//     activeSlot one) → E11000;
//   • atomic single-document conditional updates (filter + $set/$unset/$inc).
//
// Not a test file itself (no .test.js suffix) — `npm test` never runs it.

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");

const Attendee = require("../../src/models/Attendee");
const Deposit = require("../../src/models/Deposit");
const DepositApprovalLock = require("../../src/models/DepositApprovalLock");
const FullPaymentStatus = require("../../src/models/FullPaymentStatus");
const PaymentOption = require("../../src/models/PaymentOption");
const School = require("../../src/models/School");

function queryResult(value) {
  const promise = Promise.resolve(value);
  promise.select = () => queryResult(value);
  promise.sort = () => queryResult(value);
  promise.populate = () => queryResult(value);
  promise.session = () => queryResult(value);
  promise.lean = () => queryResult(value);
  return promise;
}

function sameValue(actual, expected) {
  if (expected === null) return actual == null;
  if (typeof expected === "boolean" || typeof expected === "number") return actual === expected;
  return String(actual) === String(expected);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some((clause) => matches(doc, clause));
    const actual = doc[key];
    if (expected && typeof expected === "object" && !(expected instanceof mongoose.Types.ObjectId)) {
      if ("$ne" in expected) return !sameValue(actual, expected.$ne);
      if ("$exists" in expected) return (actual !== undefined) === Boolean(expected.$exists);
      if ("$in" in expected) return expected.$in.some((value) => sameValue(actual, value));
    }
    return sameValue(actual, expected);
  });
}

// Mirrors Mongo's dotted-path $set semantics (e.g. "a.b.c") so a write to a
// nested field creates the intermediate object instead of setting a literal
// key named "a.b.c" on the document.
function setPath(doc, path, value) {
  const parts = path.split(".");
  let target = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (target[key] === undefined || target[key] === null || typeof target[key] !== "object") {
      target[key] = {};
    }
    target = target[key];
  }
  target[parts[parts.length - 1]] = value;
}

function applyUpdate(doc, update) {
  for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
  for (const key of Object.keys(update.$unset || {})) delete doc[key];
  for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value;
  // Plain-object updates (no operators) behave like $set.
  if (!Object.keys(update).some((key) => key.startsWith("$"))) Object.assign(doc, update);
  return doc;
}

function duplicateKeyError(index) {
  const error = new Error(`E11000 duplicate key error index: ${index}`);
  error.code = 11000;
  return error;
}

function createMemoryDb() {
  const db = {
    attendees: [],
    schools: [],
    deposits: [],
    paymentOptions: [],
    fullPayments: [],
    uploads: [],
    destroyed: []
  };
  const restorers = [];
  let clock = Date.parse("2026-09-01T09:00:00Z");
  const tick = () => new Date((clock += 1000));

  function stub(obj, method, impl) {
    const original = obj[method];
    obj[method] = impl;
    restorers.push(() => {
      obj[method] = original;
    });
  }

  function assertDepositIndexes(candidate) {
    for (const field of ["activeCycle", "activeSlot"]) {
      if (candidate[field] === undefined) continue;
      const clash = db.deposits.some(
        (doc) => doc !== candidate && String(doc.attendeeId) === String(candidate.attendeeId) && doc[field] === candidate[field]
      );
      if (clash) throw duplicateKeyError(`attendee_${field}_unique`);
    }
  }

  // --- Attendee -----------------------------------------------------------
  stub(Attendee, "findById", (id) => queryResult(db.attendees.find((doc) => String(doc._id) === String(id)) || null));
  stub(Attendee, "find", (filter = {}) => queryResult(db.attendees.filter((doc) => matches(doc, filter))));
  stub(Attendee, "findOne", (filter = {}) => queryResult(db.attendees.find((doc) => matches(doc, filter)) || null));
  stub(Attendee, "updateOne", async (filter, update) => {
    const doc = db.attendees.find((candidate) => matches(candidate, filter));
    if (doc) applyUpdate(doc, update);
    return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
  });
  stub(Attendee, "updateMany", async (filter, update) => {
    const docs = db.attendees.filter((candidate) => matches(candidate, filter));
    docs.forEach((doc) => applyUpdate(doc, update));
    return { matchedCount: docs.length, modifiedCount: docs.length };
  });
  stub(Attendee, "findByIdAndUpdate", (id, update) => {
    const doc = db.attendees.find((candidate) => String(candidate._id) === String(id));
    return queryResult(doc ? applyUpdate(doc, update) : null);
  });
  // Mirrors the production {phoneNormalized, event} unique index: Season 2
  // Incomers register with no event field, so two concurrent registrations
  // for the same phone collide the same way two null `event`s would under a
  // non-sparse unique index in real MongoDB.
  function assertAttendeeIndexes(candidate) {
    if (candidate.attendeeType !== "incomer" || candidate.event !== undefined) return;
    const clash = db.attendees.some(
      (doc) =>
        doc !== candidate &&
        doc.attendeeType === "incomer" &&
        doc.event === undefined &&
        doc.phoneNormalized === candidate.phoneNormalized
    );
    if (clash) throw duplicateKeyError("phoneNormalized_1_event_1");
  }
  stub(Attendee, "create", async (data) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...data, createdAt: tick() };
    assertAttendeeIndexes(doc);
    db.attendees.push(doc);
    return doc;
  });

  // --- School -------------------------------------------------------------
  stub(School, "findById", (id) => queryResult(db.schools.find((doc) => String(doc._id) === String(id)) || null));
  stub(School, "find", (filter = {}) => queryResult(db.schools.filter((doc) => matches(doc, filter))));
  stub(School, "findByIdAndUpdate", (id, update) => {
    const doc = db.schools.find((candidate) => String(candidate._id) === String(id));
    return queryResult(doc ? applyUpdate(doc, update) : null);
  });

  // --- Deposit ------------------------------------------------------------
  const sortedDeposits = (filter) =>
    db.deposits.filter((doc) => matches(doc, filter)).sort((a, b) => a.createdAt - b.createdAt);
  stub(Deposit, "find", (filter = {}) => queryResult(sortedDeposits(filter)));
  stub(Deposit, "findOne", (filter = {}) => queryResult(sortedDeposits(filter)[0] || null));
  stub(Deposit, "findById", (id) => queryResult(db.deposits.find((doc) => String(doc._id) === String(id)) || null));
  stub(Deposit, "countDocuments", async (filter = {}) => sortedDeposits(filter).length);
  stub(Deposit, "exists", (filter = {}) => queryResult(sortedDeposits(filter)[0] ? { _id: sortedDeposits(filter)[0]._id } : null));
  stub(Deposit, "distinct", async (field, filter = {}) => {
    const seen = new Map();
    for (const doc of sortedDeposits(filter)) seen.set(String(doc[field]), doc[field]);
    return [...seen.values()];
  });
  stub(Deposit, "create", async (data) => {
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      customerConfirmationPending: false,
      customerConfirmationAcknowledgedAt: null,
      ...data,
      createdAt: tick()
    };
    assertDepositIndexes(doc);
    db.deposits.push(doc);
    return doc;
  });
  stub(Deposit, "findOneAndUpdate", (filter, update) => {
    const doc = db.deposits.find((candidate) => matches(candidate, filter));
    return queryResult(doc ? applyUpdate(doc, update) : null);
  });
  stub(Deposit, "findByIdAndUpdate", (id, update) => {
    const doc = db.deposits.find((candidate) => String(candidate._id) === String(id));
    return queryResult(doc ? applyUpdate(doc, update) : null);
  });

  // --- PaymentOption ----------------------------------------------------
  stub(PaymentOption, "findById", (id) =>
    queryResult(db.paymentOptions.find((doc) => String(doc._id) === String(id)) || null)
  );
  stub(PaymentOption, "find", (filter = {}) =>
    queryResult(
      db.paymentOptions
        .filter((doc) => matches(doc, filter))
        .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt - b.createdAt)
    )
  );

  // --- FullPaymentStatus --------------------------------------------------
  stub(FullPaymentStatus, "findOne", (filter = {}) =>
    queryResult(db.fullPayments.find((doc) => matches(doc, filter)) || null)
  );
  stub(FullPaymentStatus, "find", (filter = {}) => queryResult(db.fullPayments.filter((doc) => matches(doc, filter))));
  stub(FullPaymentStatus, "findOneAndUpdate", (filter, update) => {
    let doc = db.fullPayments.find((candidate) => matches(candidate, filter));
    if (!doc) {
      doc = { ...(update.$setOnInsert || {}) };
      db.fullPayments.push(doc);
    }
    applyUpdate(doc, update);
    return queryResult(doc);
  });

  // --- Approval transaction plumbing -------------------------------------
  stub(DepositApprovalLock, "findOneAndUpdate", () => queryResult({}));
  stub(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => fn(),
    endSession: async () => {}
  }));

  // --- Cloudinary ---------------------------------------------------------
  stub(cloudinary.uploader, "upload_stream", (options, callback) => ({
    end: () => {
      const publicId = `alshayeb/incomer-deposit-proofs/proof-${db.uploads.length + 1}`;
      db.uploads.push(publicId);
      setImmediate(() => callback(null, { secure_url: `https://cloudinary.example/${publicId}.png`, public_id: publicId }));
    }
  }));
  stub(cloudinary.uploader, "destroy", async (publicId) => {
    db.destroyed.push(publicId);
    return { result: "ok" };
  });

  // --- Fixtures -----------------------------------------------------------
  // options: amounts (numbers) or { amount, label, enabled } objects.
  db.addSchool = ({ name = "School", ticketPrice, options = [], showTicketPriceToCustomer = true } = {}) => {
    const school = { _id: new mongoose.Types.ObjectId(), name, ticketPrice, showTicketPriceToCustomer };
    db.schools.push(school);
    options.forEach((option, index) => db.addOption(school, option, index + 1));
    return school;
  };

  db.addOption = (school, option, displayOrder = db.paymentOptions.length + 1) => {
    const fields = typeof option === "number" ? { amount: option } : option;
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      schoolId: school._id,
      label: null,
      enabled: true,
      displayOrder,
      createdAt: tick(),
      ...fields
    };
    db.paymentOptions.push(doc);
    return doc;
  };

  db.optionOf = (school, amount) =>
    db.paymentOptions.find((doc) => String(doc.schoolId) === String(school._id) && doc.amount === amount);

  let phoneCounter = 0;
  db.addAttendee = (school, overrides = {}) => {
    phoneCounter += 1;
    const attendee = {
      _id: new mongoose.Types.ObjectId(),
      attendeeType: "incomer",
      phoneNormalized: `0101234${String(5600 + phoneCounter).padStart(4, "0")}`,
      ticketPrice: school ? school.ticketPrice : 0,
      ticketPriceLocked: false,
      ticketPriceLockedAt: null,
      schoolId: school ? school._id : undefined,
      ...overrides
    };
    db.attendees.push(attendee);
    return attendee;
  };

  db.restore = () => {
    while (restorers.length) restorers.pop()();
  };

  return db;
}

module.exports = { createMemoryDb, queryResult };
