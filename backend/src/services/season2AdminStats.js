const mongoose = require("mongoose");

const Attendee = require("../models/Attendee");
const Deposit = require("../models/Deposit");
const FullPaymentStatus = require("../models/FullPaymentStatus");
const School = require("../models/School");
const apiError = require("../utils/apiError");
const { cleanPhone } = require("../utils/phone");
const { calculateApprovedTotalPaid } = require("../utils/paymentCalculations");

// Read-only reporting for the Season 2 Admin Dashboard and Registered
// Customers page. Everything is computed in MongoDB (aggregation pipelines
// and counts) — never by loading every Attendee and every Deposit into memory.
//
// Sources of truth (nothing here writes, and nothing is re-derived):
//   • the Attendee collection is the source for "who is registered" — a
//     customer with zero Deposits is still a customer;
//   • Deposit.status === "approved" is the only thing that counts as a
//     payment (pending/rejected never touch a count or an amount);
//   • FullPaymentStatus.confirmed (the accountant's DONE) is the only source
//     of "Full Payment Complete" — never inferred from deposit totals.

const SEASON2_ATTENDEE_FILTER = { attendeeType: "incomer" };

// "Registered today" means today in Egypt, not in the server's (UTC) clock.
const REPORTING_TIME_ZONE = "Africa/Cairo";

const RECENT_LIMIT = 8;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;

// ---------------------------------------------------------------------------
// Time zone helper
// ---------------------------------------------------------------------------

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const value = {};
  for (const part of parts) value[part.type] = Number(part.value);
  return value;
}

// Offset (ms) of `timeZone` from UTC at the instant `date`.
function zoneOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The instant at which the calendar day (year, month, day) begins in the zone.
function startOfZonedDay(year, month, day, timeZone = REPORTING_TIME_ZONE) {
  const guess = Date.UTC(year, month - 1, day);
  // Two passes so a day whose offset differs from the guess's (DST change) is exact.
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

function startOfToday(now = new Date(), timeZone = REPORTING_TIME_ZONE) {
  const p = zonedParts(now, timeZone);
  return startOfZonedDay(p.year, p.month, p.day, timeZone);
}

// ---------------------------------------------------------------------------
// Shared pipeline pieces
// ---------------------------------------------------------------------------

// Per-attendee APPROVED deposit stats. Index-backed on Deposit.attendeeId, and
// the $group collapses any number of approved deposits into ONE row per
// attendee — which is what makes "customers with approved payments" a count of
// unique attendees.
function approvedStatsLookup() {
  return {
    $lookup: {
      from: Deposit.collection.name,
      localField: "_id",
      foreignField: "attendeeId",
      pipeline: [
        { $match: { status: "approved" } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$amount" } } }
      ],
      as: "approvedStats"
    }
  };
}

// The accountant's confirmation (unique index on FullPaymentStatus.attendeeId).
function fullPaymentLookup() {
  return {
    $lookup: {
      from: FullPaymentStatus.collection.name,
      localField: "_id",
      foreignField: "attendeeId",
      pipeline: [{ $match: { confirmed: true } }, { $project: { _id: 1 } }],
      as: "fullPayment"
    }
  };
}

function derivedFields() {
  return {
    $addFields: {
      approvedPaymentCount: { $ifNull: [{ $arrayElemAt: ["$approvedStats.count", 0] }, 0] },
      approvedTotalPaid: { $ifNull: [{ $arrayElemAt: ["$approvedStats.total", 0] }, 0] },
      fullPaymentComplete: { $gt: [{ $size: "$fullPayment" }, 0] }
    }
  };
}

const CUSTOMER_ROW_PROJECTION = {
  fullName: 1,
  phone: 1,
  email: 1,
  ticketPrice: 1,
  schoolId: 1,
  createdAt: 1,
  // Text URL only — the browser asks Cloudinary for a small rendition lazily.
  // publicId is never selected.
  photoUrl: "$incomerPhoto.url",
  approvedPaymentCount: 1,
  approvedTotalPaid: 1,
  fullPaymentComplete: 1
};

async function loadSchoolNames() {
  const schools = await School.find({}).select("name").sort({ name: 1 }).lean();
  return { schools, nameById: new Map(schools.map((school) => [String(school._id), school.name])) };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function emptySchoolRow(schoolId, schoolName) {
  return {
    schoolId,
    schoolName,
    totalRegistered: 0,
    noApprovedPayment: 0,
    withApprovedPayment: 0,
    fullPaymentComplete: 0,
    pendingDeposits: 0,
    approvedDeposits: 0,
    rejectedDeposits: 0,
    totalApprovedAmount: 0
  };
}

async function getDashboard({ now = new Date() } = {}) {
  const todayStart = startOfToday(now);

  const registrationsPipeline = [
    { $match: SEASON2_ATTENDEE_FILTER },
    approvedStatsLookup(),
    fullPaymentLookup(),
    derivedFields(),
    {
      $group: {
        _id: "$schoolId",
        registered: { $sum: 1 },
        registeredToday: { $sum: { $cond: [{ $gte: ["$createdAt", todayStart] }, 1, 0] } },
        withApproved: { $sum: { $cond: [{ $gt: ["$approvedPaymentCount", 0] }, 1, 0] } },
        fullPayment: { $sum: { $cond: ["$fullPaymentComplete", 1, 0] } }
      }
    }
  ];

  // Deposits of Season 2 Incomers only (an orphan or non-Incomer attendee's
  // deposits are dropped by the inner $match + $unwind), grouped per school and
  // status. `amount` is summed for every status but only the approved sum is
  // ever reported.
  const depositsPipeline = [
    {
      $lookup: {
        from: Attendee.collection.name,
        localField: "attendeeId",
        foreignField: "_id",
        pipeline: [{ $match: SEASON2_ATTENDEE_FILTER }, { $project: { schoolId: 1 } }],
        as: "attendee"
      }
    },
    { $unwind: "$attendee" },
    {
      $group: {
        _id: { schoolId: "$attendee.schoolId", status: "$status" },
        count: { $sum: 1 },
        amount: { $sum: "$amount" }
      }
    }
  ];

  const [{ schools, nameById }, registrationRows, depositRows, recent] = await Promise.all([
    loadSchoolNames(),
    Attendee.aggregate(registrationsPipeline),
    Deposit.aggregate(depositsPipeline),
    getRecentActivity()
  ]);

  const rowsBySchool = new Map();
  const rowFor = (schoolId) => {
    const key = schoolId ? String(schoolId) : "none";
    if (!rowsBySchool.has(key)) {
      rowsBySchool.set(
        key,
        emptySchoolRow(schoolId ? key : null, schoolId ? nameById.get(key) || "Unknown school" : "No school")
      );
    }
    return rowsBySchool.get(key);
  };

  // Every existing School is listed even with zero registrations.
  schools.forEach((school) => rowFor(school._id));

  let registeredToday = 0;
  for (const group of registrationRows) {
    const row = rowFor(group._id);
    row.totalRegistered = group.registered;
    row.withApprovedPayment = group.withApproved;
    row.noApprovedPayment = group.registered - group.withApproved;
    row.fullPaymentComplete = group.fullPayment;
    registeredToday += group.registeredToday;
  }

  for (const group of depositRows) {
    const row = rowFor(group._id.schoolId);
    if (group._id.status === "pending") row.pendingDeposits += group.count;
    if (group._id.status === "rejected") row.rejectedDeposits += group.count;
    if (group._id.status === "approved") {
      row.approvedDeposits += group.count;
      row.totalApprovedAmount += group.amount;
    }
  }

  // Schools by name (already sorted); the catch-all "No school" row (only ever
  // present when an Incomer's school no longer exists) goes last.
  const schoolRows = Array.from(rowsBySchool.values()).filter((row) => row.schoolId !== null || row.totalRegistered > 0 || row.approvedDeposits > 0);
  schoolRows.sort((a, b) => (a.schoolId === null) - (b.schoolId === null) || a.schoolName.localeCompare(b.schoolName));

  const sum = (key) => schoolRows.reduce((total, row) => total + row[key], 0);
  const totalRegistered = sum("totalRegistered");
  const withApprovedPayment = sum("withApprovedPayment");

  return {
    generatedAt: now.toISOString(),
    kpis: {
      totalRegisteredIncomers: totalRegistered,
      registeredToday,
      customersWithNoApprovedPayment: totalRegistered - withApprovedPayment,
      customersWithApprovedPayment: withApprovedPayment,
      fullPaymentComplete: sum("fullPaymentComplete"),
      pendingDeposits: sum("pendingDeposits"),
      approvedDeposits: sum("approvedDeposits"),
      rejectedDeposits: sum("rejectedDeposits"),
      totalApprovedAmount: sum("totalApprovedAmount"),
      // Every School. There is no inactive/archived state on a School, so this is
      // deliberately not called "active".
      totalSchools: schools.length
    },
    schools: schoolRows,
    recent
  };
}

// The newest Deposits of Season 2 Incomers only (same population as every KPI).
// The pipeline is pull-based, so after the (slim, projected) sort the $lookup
// runs only for as many deposits as it takes to find RECENT_LIMIT Incomer ones.
function recentIncomerDepositsPipeline(match, sortField) {
  return [
    ...(match ? [{ $match: match }] : []),
    { $project: { attendeeId: 1, amount: 1, status: 1, createdAt: 1, reviewedAt: 1, updatedAt: 1 } },
    { $sort: { [sortField]: -1, _id: -1 } },
    {
      $lookup: {
        from: Attendee.collection.name,
        localField: "attendeeId",
        foreignField: "_id",
        pipeline: [{ $match: SEASON2_ATTENDEE_FILTER }, { $project: { fullName: 1 } }],
        as: "attendee"
      }
    },
    { $unwind: "$attendee" },
    { $limit: RECENT_LIMIT }
  ];
}

// Three small, capped lists built from existing timestamps only — no audit log.
async function getRecentActivity() {
  const [registrations, submissions, approvals, { nameById }] = await Promise.all([
    Attendee.find(SEASON2_ATTENDEE_FILTER)
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_LIMIT)
      .select("fullName schoolId createdAt")
      .lean(),
    Deposit.aggregate(recentIncomerDepositsPipeline(null, "createdAt")).allowDiskUse(true),
    Deposit.aggregate(recentIncomerDepositsPipeline({ status: "approved" }, "reviewedAt")).allowDiskUse(true),
    loadSchoolNames()
  ]);

  const schoolOf = (schoolId) => (schoolId ? nameById.get(String(schoolId)) || null : null);
  const depositRow = (deposit, extra) => ({
    id: String(deposit._id),
    attendeeId: String(deposit.attendeeId),
    fullName: deposit.attendee.fullName,
    amount: deposit.amount,
    ...extra
  });

  return {
    registrations: registrations.map((attendee) => ({
      id: String(attendee._id),
      fullName: attendee.fullName,
      schoolName: schoolOf(attendee.schoolId),
      at: attendee.createdAt
    })),
    depositSubmissions: submissions.map((deposit) => depositRow(deposit, { status: deposit.status, at: deposit.createdAt })),
    approvedPayments: approvals.map((deposit) => depositRow(deposit, { at: deposit.reviewedAt || deposit.updatedAt }))
  };
}

// ---------------------------------------------------------------------------
// Registered Customers — list
// ---------------------------------------------------------------------------

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDay(value, label) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw apiError(`${label} must be a date like 2026-09-30.`, 422);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw apiError(`${label} must be a real calendar date.`, 422);
  }
  return { year, month, day };
}

function parseCustomerQuery(query = {}) {
  const pageSize = query.pageSize === undefined || query.pageSize === "" ? DEFAULT_PAGE_SIZE : Number(query.pageSize);
  const page = query.page === undefined || query.page === "" ? 1 : Number(query.page);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw apiError(`pageSize must be a whole number from 1 to ${MAX_PAGE_SIZE}.`, 422);
  }
  if (!Number.isInteger(page) || page < 1) {
    throw apiError("page must be a whole number of 1 or more.", 422);
  }

  const q = String(query.q || "").trim().slice(0, MAX_SEARCH_LENGTH);

  const schoolId = String(query.schoolId || "").trim();
  if (schoolId && !mongoose.Types.ObjectId.isValid(schoolId)) {
    throw apiError("schoolId is not a valid id.", 422);
  }

  const payment = String(query.payment || "").trim().toLowerCase();
  if (payment && !["approved", "none"].includes(payment)) {
    throw apiError('payment must be "approved" or "none".', 422);
  }

  const fullPayment = String(query.fullPayment || "").trim().toLowerCase();
  if (fullPayment && !["complete", "incomplete"].includes(fullPayment)) {
    throw apiError('fullPayment must be "complete" or "incomplete".', 422);
  }

  const from = parseDay(query.from, "from");
  const to = parseDay(query.to, "to");

  return { page, pageSize, q, schoolId, payment, fullPayment, from, to };
}

function buildSearchClauses(q) {
  if (!q) return null;

  const pattern = { $regex: escapeRegExp(q), $options: "i" };
  const clauses = [{ fullName: pattern }, { email: pattern }];

  // Phone: match the digits typed, and the normalised form of what was typed
  // (so "+20 101 234 5678" finds "01012345678").
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3) {
    const normalised = cleanPhone(q);
    const digitPatterns = new Set([digits, normalised].filter((value) => value.length >= 3));
    for (const digitsPattern of digitPatterns) {
      clauses.push({ phoneNormalized: { $regex: escapeRegExp(digitsPattern) } });
      clauses.push({ phone: { $regex: escapeRegExp(digitsPattern) } });
    }
  }

  // Customer ID: a full 24-hex id or a leading part of one (an ObjectId prefix
  // is a contiguous _id range, so this stays index-backed).
  if (/^[0-9a-f]{6,24}$/i.test(q)) {
    const hex = q.toLowerCase();
    clauses.push({
      _id: {
        $gte: new mongoose.Types.ObjectId(hex.padEnd(24, "0")),
        $lte: new mongoose.Types.ObjectId(hex.padEnd(24, "f"))
      }
    });
  }

  return clauses;
}

function buildCustomerFilters(params) {
  const match = { ...SEASON2_ATTENDEE_FILTER };

  if (params.schoolId) match.schoolId = new mongoose.Types.ObjectId(params.schoolId);

  if (params.from || params.to) {
    match.createdAt = {};
    if (params.from) match.createdAt.$gte = startOfZonedDay(params.from.year, params.from.month, params.from.day);
    if (params.to) {
      // Inclusive of the whole "to" day: everything before the next day starts.
      const next = new Date(Date.UTC(params.to.year, params.to.month - 1, params.to.day + 1));
      match.createdAt.$lt = startOfZonedDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
    }
  }

  const search = buildSearchClauses(params.q);
  if (search) match.$or = search;

  // Filters that depend on a customer's payments can only be applied after the
  // per-attendee lookups.
  const derived = {};
  if (params.payment === "approved") derived.approvedPaymentCount = { $gt: 0 };
  if (params.payment === "none") derived.approvedPaymentCount = 0;
  if (params.fullPayment === "complete") derived.fullPaymentComplete = true;
  if (params.fullPayment === "incomplete") derived.fullPaymentComplete = false;

  return { match, derived };
}

const CUSTOMER_SORT = { createdAt: -1, _id: -1 };

function serializeCustomerRow(row, nameById) {
  return {
    id: String(row._id),
    fullName: row.fullName,
    phone: row.phone,
    email: row.email || null,
    ticketPrice: row.ticketPrice ?? null,
    schoolId: row.schoolId ? String(row.schoolId) : null,
    schoolName: row.schoolId ? nameById.get(String(row.schoolId)) || null : null,
    registeredAt: row.createdAt,
    photoUrl: row.photoUrl || null,
    approvedPaymentCount: row.approvedPaymentCount,
    approvedTotalPaid: row.approvedTotalPaid,
    fullPaymentComplete: Boolean(row.fullPaymentComplete)
  };
}

// Every registered Incomer, sourced from the Attendee collection. A customer
// with no Deposits at all is listed like any other (zero count, zero paid).
async function listCustomers(rawQuery = {}) {
  const params = parseCustomerQuery(rawQuery);
  const { match, derived } = buildCustomerFilters(params);
  const skip = (params.page - 1) * params.pageSize;
  const hasDerivedFilter = Object.keys(derived).length > 0;

  const rowStages = [
    { $sort: CUSTOMER_SORT },
    { $skip: skip },
    { $limit: params.pageSize }
  ];
  const decorate = [approvedStatsLookup(), fullPaymentLookup(), derivedFields()];
  const project = { $project: CUSTOMER_ROW_PROJECTION };

  let total;
  let rows;

  if (!hasDerivedFilter) {
    // Common case: page first, then look up payments for just that page.
    [total, rows] = await Promise.all([
      Attendee.countDocuments(match),
      Attendee.aggregate([{ $match: match }, ...rowStages, ...decorate, project, { $sort: CUSTOMER_SORT }])
    ]);
  } else {
    const [result] = await Attendee.aggregate([
      { $match: match },
      ...decorate,
      { $match: derived },
      {
        $facet: {
          rows: [...rowStages, project],
          total: [{ $count: "n" }]
        }
      }
    ]);
    rows = result.rows;
    total = result.total[0]?.n || 0;
  }

  const { nameById } = await loadSchoolNames();

  return {
    customers: rows.map((row) => serializeCustomerRow(row, nameById)),
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize))
    }
  };
}

// ---------------------------------------------------------------------------
// Registered Customers — detail
// ---------------------------------------------------------------------------

const DETAIL_ATTENDEE_FIELDS =
  "fullName phone email ticketPrice ticketPriceLocked schoolId createdAt incomerPhoto.url";

// Full details for ONE customer, loaded only when a row is opened. Works for a
// customer with no Deposits (empty history). Returns null when the id is not a
// Season 2 Incomer.
async function getCustomerDetail(id) {
  const attendee = await Attendee.findOne({ _id: id, ...SEASON2_ATTENDEE_FILTER })
    .select(DETAIL_ATTENDEE_FIELDS)
    .lean();
  if (!attendee) return null;

  const [school, deposits, fullPayment] = await Promise.all([
    attendee.schoolId ? School.findById(attendee.schoolId).select("name").lean() : null,
    Deposit.find({ attendeeId: attendee._id })
      .sort({ createdAt: -1, _id: -1 })
      .select("amount paymentOptionSnapshot status createdAt reviewedAt rejectionReason paymentProof.url")
      .lean(),
    FullPaymentStatus.findOne({ attendeeId: attendee._id }).select("confirmed confirmedAt lastSyncedAt").lean()
  ]);

  const approved = deposits.filter((deposit) => deposit.status === "approved");

  return {
    id: String(attendee._id),
    fullName: attendee.fullName,
    phone: attendee.phone,
    email: attendee.email || null,
    schoolId: attendee.schoolId ? String(attendee.schoolId) : null,
    schoolName: school?.name || null,
    ticketPrice: attendee.ticketPrice ?? null,
    ticketPriceLocked: Boolean(attendee.ticketPriceLocked),
    registeredAt: attendee.createdAt,
    photoUrl: attendee.incomerPhoto?.url || null,
    approvedPaymentCount: approved.length,
    approvedTotalPaid: calculateApprovedTotalPaid(deposits),
    fullPayment: {
      complete: Boolean(fullPayment?.confirmed),
      confirmedAt: fullPayment?.confirmedAt || null,
      lastSyncedAt: fullPayment?.lastSyncedAt || null
    },
    deposits: deposits.map((deposit) => ({
      id: String(deposit._id),
      amount: deposit.amount,
      label: deposit.paymentOptionSnapshot?.label || null,
      status: deposit.status,
      submittedAt: deposit.createdAt,
      reviewedAt: deposit.reviewedAt || null,
      rejectionReason: deposit.rejectionReason || null,
      // Text URL only: the panel links to it, it never loads the image itself.
      proofUrl: deposit.paymentProof?.url || null
    }))
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  REPORTING_TIME_ZONE,
  getCustomerDetail,
  getDashboard,
  listCustomers,
  parseCustomerQuery,
  startOfToday,
  startOfZonedDay
};
