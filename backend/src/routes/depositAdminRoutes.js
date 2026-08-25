const express = require("express");
const mongoose = require("mongoose");

const Attendee = require("../models/Attendee");
const Deposit = require("../models/Deposit");
const DepositApprovalLock = require("../models/DepositApprovalLock");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { calculateApprovedTotalPaid } = require("../utils/paymentCalculations");

const router = express.Router();

const ATTENDEE_POPULATE_FIELDS = "fullName phone schoolId ticketPrice attendeeType";
const PAYMENT_OPTION_POPULATE_FIELDS = "label amount enabled";

// The current admin JWT payload is { email, role } only — no Admin document
// id (admin login is env-credential based, not backed by the Admin
// collection; see adminAuthRoutes.js). reviewedBy stays unset unless/until
// that changes, exactly like Attendee.reviewedBy today, which is defined on
// the schema but never populated anywhere in the codebase either.
function resolveReviewerId(req) {
  const candidate = req.admin && (req.admin.id || req.admin._id);
  return candidate && mongoose.Types.ObjectId.isValid(candidate) ? candidate : undefined;
}

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

    const deposits = await Deposit.find(filters)
      .populate("attendeeId", ATTENDEE_POPULATE_FIELDS)
      .populate("paymentOptionId", PAYMENT_OPTION_POPULATE_FIELDS)
      .sort({ createdAt: -1 });

    res.json({ success: true, deposits });
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
      .populate("attendeeId", ATTENDEE_POPULATE_FIELDS)
      .populate("paymentOptionId", PAYMENT_OPTION_POPULATE_FIELDS);

    if (!deposit) {
      throw apiError("Deposit not found.", 404);
    }

    res.json({ success: true, deposit });
  })
);

// Approving a Deposit is wrapped in a MongoDB transaction so the
// ticketPrice invariant holds even when two DIFFERENT pending Deposits for
// the SAME attendee are approved concurrently. A transaction alone does not
// guarantee this: the two approvals write to two different Deposit
// documents, so MongoDB's write-conflict detection (the thing that would
// normally force a retry) never triggers between them on its own — both
// could read the same pre-commit approvedTotalPaid and both pass the check.
// DepositApprovalLock exists to close exactly that gap: touching it (upsert)
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

          // Serialization anchor — see comment above. Must happen before the
          // balance recalculation below so a concurrent transaction for the
          // same attendee is forced to wait/retry rather than read stale
          // data.
          await DepositApprovalLock.findOneAndUpdate(
            { attendeeId: deposit.attendeeId },
            { $set: { attendeeId: deposit.attendeeId } },
            { upsert: true, session }
          );

          const attendee = await Attendee.findById(deposit.attendeeId)
            .select("ticketPrice")
            .session(session);

          if (!attendee) {
            throw apiError("Associated attendee was not found.", 404);
          }

          if (!Number.isFinite(attendee.ticketPrice) || attendee.ticketPrice < 0) {
            throw apiError("This attendee has no valid ticket price on record.", 422);
          }

          // Recalculated fresh from MongoDB, inside this transaction
          // attempt's own snapshot, right before the decision — never
          // trusted from the request body, a cached summary, or a prior
          // (failed) attempt.
          const approvedDeposits = await Deposit.find({
            attendeeId: deposit.attendeeId,
            status: "approved"
          }).session(session);
          const approvedTotalPaid = calculateApprovedTotalPaid(approvedDeposits);

          if (approvedTotalPaid + deposit.amount > attendee.ticketPrice) {
            throw apiError(
              `Approving this deposit (${deposit.amount}) would push the approved total ` +
                `(${approvedTotalPaid}) above the ticket price (${attendee.ticketPrice}).`,
              422
            );
          }

          const setFields = { status: "approved", reviewedAt: new Date() };
          const reviewerId = resolveReviewerId(req);
          if (reviewerId) {
            setFields.reviewedBy = reviewerId;
          }

          // Still conditional on status still being "pending" as a defense-
          // in-depth guard against the same deposit being approved twice.
          // activeSlot is left untouched — an approved deposit keeps
          // occupying its slot.
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

    // $unset releases the active slot (see the partial unique index on
    // Deposit) so the customer regains one of their 5 slots. The rejected
    // document itself is kept forever — only status/activeSlot/review
    // fields change.
    const updated = await Deposit.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        $set: setFields,
        $unset: { activeSlot: 1 }
      },
      { new: true }
    );

    if (!updated) {
      throw apiError("This deposit was already reviewed.", 409);
    }

    res.json({ success: true, message: "Deposit rejected.", deposit: updated });
  })
);

module.exports = router;
