const mongoose = require("mongoose");

const Attendee = require("../models/Attendee");
const Deposit = require("../models/Deposit");
const FullPaymentStatus = require("../models/FullPaymentStatus");
const School = require("../models/School");
const apiError = require("../utils/apiError");
const { calculateApprovedTotalPaid } = require("../utils/paymentCalculations");
const { approvedStatsLookup, buildSearchClauses } = require("./season2AdminStats");

// ADMIN-ONLY, MANUAL Full Payment management.
//
// The one rule of this module: NOTHING here ever decides, suggests or derives a
// Full Payment from money. The Ticket Price and the approved total are returned
// as plain numbers for the Admin to compare with their own eyes; DONE is set
// only by an explicit Admin request (markDone) and cleared only by an explicit,
// separate Admin request (revokeDone). No amount, count or price is compared
// anywhere in this file.
//
// Nothing here writes to Attendee, Deposit, School or any Sheet, and nothing
// sends an email or notification. The only collection written is
// FullPaymentStatus (the existing Full Payment record).

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 100;

// Customer types. Only Incomers exist today. An Outcomer entry is registered
// here (disabled) so a later phase can switch it on by supplying its match
// filter and event field — no Outcomer record is ever invented or listed
// before registration exists.
const CUSTOMER_TYPES = {
  incomer: { enabled: true, match: { attendeeType: "incomer" } },
  outcomer: { enabled: false }
};

const CUSTOMER_SORT = { createdAt: -1, _id: -1 };

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

function parseObjectId(value, label) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^[a-f0-9]{24}$/i.test(text) || !mongoose.Types.ObjectId.isValid(text)) {
    throw apiError(`${label} is not a valid id.`, 422);
  }
  return text;
}

function parseListQuery(query = {}) {
  const pageSize = query.pageSize === undefined || query.pageSize === "" ? DEFAULT_PAGE_SIZE : Number(query.pageSize);
  const page = query.page === undefined || query.page === "" ? 1 : Number(query.page);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw apiError(`pageSize must be a whole number from 1 to ${MAX_PAGE_SIZE}.`, 422);
  }
  if (!Number.isInteger(page) || page < 1) {
    throw apiError("page must be a whole number of 1 or more.", 422);
  }

  const customerType = String(query.customerType || "all").trim().toLowerCase();
  if (!["all", "incomer", "outcomer"].includes(customerType)) {
    throw apiError('customerType must be "all", "incomer" or "outcomer".', 422);
  }

  const manual = String(query.manual || "all").trim().toLowerCase();
  if (!["all", "done", "not_done"].includes(manual)) {
    throw apiError('manual must be "all", "done" or "not_done".', 422);
  }

  return {
    page,
    pageSize,
    q: String(query.q || "").trim().slice(0, MAX_SEARCH_LENGTH),
    customerType,
    manual,
    schoolId: parseObjectId(query.schoolId, "schoolId"),
    eventId: parseObjectId(query.eventId, "eventId")
  };
}

// ---------------------------------------------------------------------------
// List (one page, all customers)
// ---------------------------------------------------------------------------

// The manual decision for each customer (unique index on
// FullPaymentStatus.attendeeId). Only what the row needs.
function manualDecisionLookup() {
  return {
    $lookup: {
      from: FullPaymentStatus.collection.name,
      localField: "_id",
      foreignField: "attendeeId",
      pipeline: [
        { $match: { confirmed: true } },
        { $project: { _id: 0, confirmedAt: 1, "decision.by": 1, "decision.at": 1 } }
      ],
      as: "manualDecision"
    }
  };
}

function derivedFields() {
  return {
    $addFields: {
      approvedTotalPaid: { $ifNull: [{ $arrayElemAt: ["$approvedStats.total", 0] }, 0] },
      isDone: { $gt: [{ $size: "$manualDecision" }, 0] }
    }
  };
}

const ROW_PROJECTION = {
  fullName: 1,
  phone: 1,
  schoolId: 1,
  ticketPrice: 1,
  createdAt: 1,
  approvedTotalPaid: 1,
  isDone: 1,
  doneAt: { $arrayElemAt: ["$manualDecision.confirmedAt", 0] },
  doneBy: { $arrayElemAt: ["$manualDecision.decision.by", 0] }
};

function serializeRow(row, nameById) {
  return {
    id: String(row._id),
    fullName: row.fullName,
    phone: row.phone,
    customerType: "incomer",
    schoolId: row.schoolId ? String(row.schoolId) : null,
    schoolName: row.schoolId ? nameById.get(String(row.schoolId)) || null : null,
    eventId: null,
    eventName: null,
    // The customer's OWN stored price (locked at their first payment request),
    // never assumed from the School.
    ticketPrice: row.ticketPrice ?? null,
    // Informational only. Approved deposits; never used to decide anything.
    approvedTotalPaid: row.approvedTotalPaid,
    manualStatus: row.isDone ? "DONE" : "NOT_DONE",
    doneAt: row.isDone ? row.doneAt || null : null,
    doneBy: row.isDone ? row.doneBy || null : null
  };
}

function emptyPage(params, extra = {}) {
  return {
    customers: [],
    pagination: { page: params.page, pageSize: params.pageSize, total: 0, totalPages: 1 },
    outcomers: { available: CUSTOMER_TYPES.outcomer.enabled },
    ...extra
  };
}

// Every registered customer, sourced from the Attendee collection (a customer
// with no deposits is listed like any other). Searching, filtering, counting
// and paging all happen in MongoDB; only the requested page is returned, with
// just the summary a row needs — never any deposit history.
async function listFullPayments(rawQuery = {}) {
  const params = parseListQuery(rawQuery);

  // Outcomers: nothing to list until Outcomer registration exists. An event
  // filter only applies to Outcomers, so it also yields nothing today.
  if (params.customerType === "outcomer" || params.eventId) {
    return emptyPage(params);
  }

  const match = { ...CUSTOMER_TYPES.incomer.match };
  if (params.schoolId) match.schoolId = new mongoose.Types.ObjectId(params.schoolId);
  const search = buildSearchClauses(params.q);
  if (search) match.$or = search;

  const skip = (params.page - 1) * params.pageSize;
  const rowStages = [{ $sort: CUSTOMER_SORT }, { $skip: skip }, { $limit: params.pageSize }];
  const decorate = [approvedStatsLookup(), manualDecisionLookup(), derivedFields()];
  const project = { $project: ROW_PROJECTION };

  let total;
  let rows;

  if (params.manual === "all") {
    // Common case: page first, then look up payments for just that page.
    [total, rows] = await Promise.all([
      Attendee.countDocuments(match),
      Attendee.aggregate([{ $match: match }, ...rowStages, ...decorate, project, { $sort: CUSTOMER_SORT }])
    ]);
  } else {
    // The DONE / NOT DONE filter depends on the decision lookup, so it runs first.
    const [result] = await Attendee.aggregate([
      { $match: match },
      manualDecisionLookup(),
      { $addFields: { isDone: { $gt: [{ $size: "$manualDecision" }, 0] } } },
      { $match: { isDone: params.manual === "done" } },
      {
        $facet: {
          rows: [...rowStages, approvedStatsLookup(), derivedFields(), project, { $sort: CUSTOMER_SORT }],
          total: [{ $count: "n" }]
        }
      }
    ]);
    rows = result.rows;
    total = result.total[0]?.n || 0;
  }

  const schools = await School.find({}).select("name").lean();
  const nameById = new Map(schools.map((school) => [String(school._id), school.name]));

  return {
    customers: rows.map((row) => serializeRow(row, nameById)),
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize))
    },
    outcomers: { available: CUSTOMER_TYPES.outcomer.enabled }
  };
}

// ---------------------------------------------------------------------------
// One customer's deposits (loaded only when a row is expanded)
// ---------------------------------------------------------------------------

async function loadIncomer(id, fields) {
  if (!/^[a-f0-9]{24}$/i.test(String(id || "")) || !mongoose.Types.ObjectId.isValid(id)) {
    throw apiError("A valid customer id is required.", 422);
  }
  const attendee = await Attendee.findOne({ _id: id, ...CUSTOMER_TYPES.incomer.match }).select(fields).lean();
  if (!attendee) throw apiError("Customer not found.", 404);
  return attendee;
}

function manualState(status) {
  const done = Boolean(status && status.confirmed);
  return {
    manualStatus: done ? "DONE" : "NOT_DONE",
    doneAt: done ? status.confirmedAt || null : null,
    doneBy: done ? status.decision?.by || null : null
  };
}

async function getDepositDetails(id) {
  const attendee = await loadIncomer(id, "fullName phone schoolId ticketPrice");

  const [school, deposits, status] = await Promise.all([
    attendee.schoolId ? School.findById(attendee.schoolId).select("name").lean() : null,
    // Oldest first, so "Deposit #1" is the customer's first deposit.
    Deposit.find({ attendeeId: attendee._id })
      .sort({ createdAt: 1, _id: 1 })
      .select("amount status createdAt reviewedAt rejectionReason paymentProof.url")
      .lean(),
    FullPaymentStatus.findOne({ attendeeId: attendee._id }).select("confirmed confirmedAt decision.by").lean()
  ]);

  return {
    customer: {
      id: String(attendee._id),
      fullName: attendee.fullName,
      phone: attendee.phone,
      customerType: "incomer",
      schoolId: attendee.schoolId ? String(attendee.schoolId) : null,
      schoolName: school?.name || null,
      eventName: null
    },
    summary: {
      ticketPrice: attendee.ticketPrice ?? null,
      // APPROVED deposits only (the existing shared calculation).
      approvedTotalPaid: calculateApprovedTotalPaid(deposits),
      ...manualState(status)
    },
    deposits: deposits.map((deposit, index) => ({
      id: String(deposit._id),
      number: index + 1,
      amount: deposit.amount,
      status: deposit.status,
      submittedAt: deposit.createdAt,
      approvedAt: deposit.status === "approved" ? deposit.reviewedAt || null : null,
      rejectedAt: deposit.status === "rejected" ? deposit.reviewedAt || null : null,
      rejectionReason: deposit.status === "rejected" ? deposit.rejectionReason || null : null,
      // Text URL only; the Cloudinary publicId is never selected.
      proofUrl: deposit.paymentProof?.url || null
    }))
  };
}

// ---------------------------------------------------------------------------
// Manual decisions
// ---------------------------------------------------------------------------

function adminLabel(admin) {
  return String(admin?.email || "admin").slice(0, 200);
}

async function currentState(attendeeId) {
  const status = await FullPaymentStatus.findOne({ attendeeId }).select("confirmed confirmedAt decision.by").lean();
  return manualState(status);
}

// Mark ONE customer's Full Payment DONE. No amount is read or compared. Safe to
// repeat and safe under simultaneous requests: a single conditional upsert only
// succeeds when the customer is not already DONE; a repeat (or the loser of a
// race) changes nothing and appends no audit entry. No email or notification is
// sent. Only this customer's own record is addressed, by id.
async function markDone(id, admin) {
  const attendee = await loadIncomer(id, "_id");
  const now = new Date();
  const by = adminLabel(admin);

  let changed = true;
  try {
    await FullPaymentStatus.updateOne(
      { attendeeId: attendee._id, confirmed: { $ne: true } },
      {
        $set: { confirmed: true, confirmedAt: now, decision: { source: "admin", by, at: now } },
        $push: { auditLog: { action: "marked_done", by, at: now } }
      },
      { upsert: true }
    );
  } catch (error) {
    // The unique attendeeId index rejects the upsert when the customer is
    // already DONE (or another request just made them DONE): nothing to do.
    if (error && error.code === 11000) {
      changed = false;
    } else {
      throw error;
    }
  }

  return { changed, ...(await currentState(attendee._id)) };
}

// Revoke ONE customer's DONE (Admin-only, individually confirmed in the UI,
// audited). Existing DONE statuses are never reset automatically; this runs
// only on an explicit request for this one customer.
async function revokeDone(id, admin) {
  const attendee = await loadIncomer(id, "_id");
  const now = new Date();
  const by = adminLabel(admin);

  const result = await FullPaymentStatus.updateOne(
    { attendeeId: attendee._id, confirmed: true },
    {
      $set: { confirmed: false, decision: { source: "admin", by, at: now } },
      $push: { auditLog: { action: "revoked_done", by, at: now } }
    }
  );

  return { changed: result.modifiedCount > 0, ...(await currentState(attendee._id)) };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  getDepositDetails,
  listFullPayments,
  markDone,
  parseListQuery,
  revokeDone
};
