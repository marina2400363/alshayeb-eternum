const express = require("express");
const mongoose = require("mongoose");

const Attendee = require("../models/Attendee");
const Deposit = require("../models/Deposit");
const DepositApprovalLock = require("../models/DepositApprovalLock");
const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { sendSeason2PaymentConfirmedEmail, sendSeason2PaymentRejectedEmail } = require("../utils/season2Email");
const { requestSchoolFinanceSync } = require("../services/financeAutoSync");

const router = express.Router();

// incomerPhoto.url: the customer's registration photo URL (text only) so the
// Admin details view can lazy-load a small preview. The image itself is never
// loaded by the list — only by the details panel — and publicId is not selected.
const ATTENDEE_POPULATE_FIELDS = "fullName phone schoolId ticketPrice ticketPriceLocked attendeeType incomerPhoto.url";
const PAYMENT_OPTION_POPULATE_FIELDS = "label amount enabled";

// Nested populate so the Admin Portal's Deposit Review can show the
// customer's School name without a second round-trip or a client-side join
// against the schools list. Additive only — every field the flat
// ATTENDEE_POPULATE_FIELDS select already returned is unchanged; schoolId
// simply becomes a populated {_id, name} object instead of a bare ObjectId.
const ATTENDEE_POPULATE = {
  path: "attendeeId",
  select: ATTENDEE_POPULATE_FIELDS,
  populate: { path: "schoolId", select: "name" }
};

// The current admin JWT payload is { email, role } only — no Admin document
// id (admin login is env-credential based, not backed by the Admin
// collection; see adminAuthRoutes.js). reviewedBy stays unset unless/until
// that changes, exactly like Attendee.reviewedBy today, which is defined on
// the schema but never populated anywhere in the codebase either.
function resolveReviewerId(req) {
  const candidate = req.admin && (req.admin.id || req.admin._id);
  return candidate && mongoose.Types.ObjectId.isValid(candidate) ? candidate : undefined;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePaging(query) {
  const page = query.page === undefined || query.page === "" ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined || query.pageSize === "" ? DEFAULT_PAGE_SIZE : Number(query.pageSize);

  if (!Number.isInteger(page) || page < 1) {
    throw apiError("page must be a whole number of 1 or more.", 422);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw apiError(`pageSize must be a whole number from 1 to ${MAX_PAGE_SIZE}.`, 422);
  }
  return { page, pageSize };
}

// The Admin's free-text search: the customer's name, phone or School name —
// the same three things the Deposits page has always searched. It runs on the
// server so it covers EVERY deposit, not just the page currently on screen.
async function findAttendeeIdsMatching(q) {
  const pattern = { $regex: escapeRegExp(q), $options: "i" };
  const matchingSchools = await School.find({ name: pattern }).select("_id").lean();

  const clauses = [{ fullName: pattern }];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3) {
    clauses.push({ phoneNormalized: { $regex: escapeRegExp(digits) } }, { phone: { $regex: escapeRegExp(digits) } });
  }
  if (matchingSchools.length) {
    clauses.push({ schoolId: { $in: matchingSchools.map((school) => school._id) } });
  }

  const attendees = await Attendee.find({ $or: clauses }).select("_id").lean();
  return attendees.map((attendee) => attendee._id);
}

// One page of deposits (newest first) plus the total for the current filter.
// Query: status, attendeeId, q (name/phone/School), page, pageSize (default 25,
// max 100). Nothing about a single deposit's shape has changed — only how many
// are returned per request.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = {};

    const status = String(req.query.status || "").trim().toLowerCase();
    if (status) {
      if (!["pending", "approved", "rejected"].includes(status)) {
        throw apiError("Invalid status filter.", 422);
      }
      filters.status = status;
    }

    const attendeeId = String(req.query.attendeeId || "").trim();
    if (attendeeId) {
      if (!mongoose.Types.ObjectId.isValid(attendeeId)) {
        throw apiError("A valid attendeeId is required.", 422);
      }
      filters.attendeeId = attendeeId;
    }

    const { page, pageSize } = parsePaging(req.query);

    const q = String(req.query.q || "").trim().slice(0, MAX_SEARCH_LENGTH);
    if (q) {
      let matchingIds = await findAttendeeIdsMatching(q);
      if (attendeeId) {
        matchingIds = matchingIds.filter((id) => String(id) === attendeeId);
      }
      filters.attendeeId = { $in: matchingIds };
    }

    const [total, deposits] = await Promise.all([
      Deposit.countDocuments(filters),
      Deposit.find(filters)
        .populate(ATTENDEE_POPULATE)
        .populate("paymentOptionId", PAYMENT_OPTION_POPULATE_FIELDS)
        // _id breaks ties so a page boundary can never repeat or skip a deposit.
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
    ]);

    res.json({
      success: true,
      deposits,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw apiError("A valid deposit id is required.", 422);
    }

    const deposit = await Deposit.findById(id)
      .populate(ATTENDEE_POPULATE)
      .populate("paymentOptionId", PAYMENT_OPTION_POPULATE_FIELDS);

    if (!deposit) {
      throw apiError("Deposit not found.", 404);
    }

    res.json({ success: true, deposit });
  })
);

// Approving a Deposit is wrapped in a MongoDB transaction, and approvals for
// the SAME attendee are serialized through DepositApprovalLock. (The ticket
// price is no longer a payment ceiling — see the product-rule note inside
// the handler — but approvals of one attendee's Deposits still never
// interleave.) A transaction alone does not serialize them: two approvals
// write to two different Deposit documents, so MongoDB's write-conflict
// detection never triggers between them on its own. DepositApprovalLock
// closes that gap: touching it (upsert)
// as the transaction's first write gives the two transactions a shared
// document to collide on. Once that lock document exists, a losing
// transaction is aborted with a TransientTransactionError, which
// session.withTransaction() retries automatically.
//
// But the very FIRST time a given attendee is ever locked, there is no
// document yet for the two transactions to collide on as a write conflict —
// both can attempt the upsert's insert path, and the loser can surface a
// plain E11000 duplicate-key error instead of a transient one, which
// withTransaction() does not retry on its own. MAX_LOCK_CONFLICT_ATTEMPTS
// below is a small, bounded outer retry specifically for that first-use
// race: on E11000 it starts an entirely fresh transaction (new session, new
// reads, new recalculation) rather than reusing anything from the failed
// attempt.
const MAX_LOCK_CONFLICT_ATTEMPTS = 3;

router.put(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw apiError("A valid deposit id is required.", 422);
    }

    let result;
    let resultAttendee;

    for (let attempt = 1; attempt <= MAX_LOCK_CONFLICT_ATTEMPTS; attempt += 1) {
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          const deposit = await Deposit.findById(id).session(session);
          if (!deposit) {
            throw apiError("Deposit not found.", 404);
          }

          if (deposit.status !== "pending") {
            throw apiError("Only pending deposits can be approved.", 409);
          }

          // Serialization anchor — see comment above. Taken before anything
          // else is read so concurrent approvals for the same attendee are
          // forced to wait/retry rather than act on stale data.
          await DepositApprovalLock.findOneAndUpdate(
            { attendeeId: deposit.attendeeId },
            { $set: { attendeeId: deposit.attendeeId } },
            { upsert: true, session }
          );

          // email/fullName: read-only, needed only for the Email C dispatch
          // after this transaction commits — never written, never part of
          // the approval decision itself.
          const attendee = await Attendee.findById(deposit.attendeeId).select("_id email fullName schoolId").session(session);

          if (!attendee) {
            throw apiError("Associated attendee was not found.", 404);
          }
          resultAttendee = attendee;

          // Product rule: the ticket price is NOT a payment ceiling. Admin
          // configures which amounts customers may pay (an option may even
          // exceed the ticket price), so approval never compares approved
          // totals against it. Full Payment is decided only by the
          // accountant's DONE (FullPaymentStatus).

          // customerConfirmation*: raises the customer's one-time "PAYMENT
          // CONFIRMED" notification in the same atomic write as the approval,
          // so it can never exist without the approval (or vice versa).
          const setFields = {
            status: "approved",
            reviewedAt: new Date(),
            customerConfirmationPending: true,
            customerConfirmationAcknowledgedAt: null
          };
          const reviewerId = resolveReviewerId(req);
          if (reviewerId) {
            setFields.reviewedBy = reviewerId;
          }

          // Still conditional on status still being "pending" as a defense-
          // in-depth guard against the same deposit being approved twice.
          // activeCycle is left set until the customer acknowledges the
          // confirmation — only then may they pay again.
          const updated = await Deposit.findOneAndUpdate(
            { _id: id, status: "pending" },
            { $set: setFields },
            { new: true, session }
          );

          if (!updated) {
            throw apiError("This deposit was already reviewed.", 409);
          }

          result = updated;
        });

        break;
      } catch (err) {
        if (err.code === 11000 && attempt < MAX_LOCK_CONFLICT_ATTEMPTS) {
          continue;
        }
        throw err;
      } finally {
        await session.endSession();
      }
    }

    // Email C — Payment confirmed. Only a successful pending -> approved
    // transition reaches here: the transaction throws 404/409 above for
    // every other case, so a retried/duplicate approve request never
    // re-sends this. Email failure must never fail the approval response —
    // sendSeason2* never throws.
    if (!result.season2EmailNotifications?.approvalSentAt) {
      const emailResult = await sendSeason2PaymentConfirmedEmail({
        depositId: String(result._id),
        email: resultAttendee?.email,
        fullName: resultAttendee?.fullName
      });

      if (emailResult.sent) {
        await Deposit.findByIdAndUpdate(result._id, {
          $set: { "season2EmailNotifications.approvalSentAt": new Date() }
        });
      }
    }

    // An approval changes the sheet's Approved Payments / Number of Payments /
    // Total Paid / Payment Proof Link. Fire-and-forget: the approval above is
    // already committed and this can never fail or roll it back. (Rejection
    // changes nothing the sheet shows — approved-only columns — so it does not
    // trigger a sync.)
    requestSchoolFinanceSync(resultAttendee?.schoolId);

    res.json({ success: true, message: "Deposit approved.", deposit: result });
  })
);

router.put(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw apiError("A valid deposit id is required.", 422);
    }

    const deposit = await Deposit.findById(id);
    if (!deposit) {
      throw apiError("Deposit not found.", 404);
    }

    if (deposit.status !== "pending") {
      throw apiError("Only pending deposits can be rejected.", 409);
    }

    const rejectionReason =
      String(req.body.rejectionReason || req.body.reason || "").trim() || "Rejected by admin.";

    const setFields = { status: "rejected", reviewedAt: new Date(), rejectionReason };
    const reviewerId = resolveReviewerId(req);
    if (reviewerId) {
      setFields.reviewedBy = reviewerId;
    }

    // $unset releases the payment cycle (see Deposit.js) so the customer can
    // pay again, plus the legacy activeSlot. The rejected document itself is
    // kept forever — only status/markers/review fields change.
    const updated = await Deposit.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        $set: setFields,
        $unset: { activeSlot: 1, activeCycle: 1 }
      },
      { new: true }
    );

    if (!updated) {
      throw apiError("This deposit was already reviewed.", 409);
    }

    // Email D — Payment needs attention. Only a successful pending ->
    // rejected transition reaches here: the 404/409 guards above throw for
    // every other case, so a retried/duplicate reject request never
    // re-sends this. Email failure must never fail the rejection response —
    // sendSeason2* never throws. rejectionReason is HTML-escaped inside the
    // template (see season2Email.js).
    if (!updated.season2EmailNotifications?.rejectionSentAt) {
      const rejectedAttendee = await Attendee.findById(updated.attendeeId).select("email fullName");
      const emailResult = await sendSeason2PaymentRejectedEmail({
        depositId: String(updated._id),
        email: rejectedAttendee?.email,
        fullName: rejectedAttendee?.fullName,
        rejectionReason
      });

      if (emailResult.sent) {
        await Deposit.findByIdAndUpdate(updated._id, {
          $set: { "season2EmailNotifications.rejectionSentAt": new Date() }
        });
      }
    }

    res.json({ success: true, message: "Deposit rejected.", deposit: updated });
  })
);

module.exports = router;
