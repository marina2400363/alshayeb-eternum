const express = require("express");

const Deposit = require("../models/Deposit");
const FullPaymentStatus = require("../models/FullPaymentStatus");
const PaymentOption = require("../models/PaymentOption");
const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const {
  serializeCustomerLatestRejection,
  serializeCustomerPaymentConfirmation,
  serializeCustomerPaymentOption
} = require("../utils/paymentSerializers");
const { requireValidObjectId, requireValidPhone } = require("../utils/customerOwnership");
const { limitRequest, guardFailures } = require("../middleware/rateLimit");
const {
  summaryRules,
  optionsRules,
  acknowledgeRules,
  ownershipFailureRules,
  resolveOwnedIncomerCounted
} = require("../config/rateLimits");

const router = express.Router();

// Rate limits (see config/rateLimits.js): identity (attendeeId) is the primary
// key; the IP rules are broad flood ceilings plus a tight counter of ownership
// FAILURES (wrong attendeeId+phone pair), which is shared by every customer
// payment endpoint. The failure guard runs first so a blocked IP costs no
// further database work.
const ownershipFailureGuard = guardFailures(ownershipFailureRules);

// Public, but NOT open lookup-by-id: the request body must carry the
// customer's own {attendeeId, phone} (the same pair the Season 2 session
// already holds), and resolveOwnedIncomer() verifies they belong together
// before anything is read. phone is deliberately in the body, not a query
// string, so it never lands in server/proxy access logs.
//
// Product rules:
//   • CURRENT state only — never payment history, paid, remaining or
//     progress;
//   • the ticket price is returned only when the customer's School shows it
//     (School.showTicketPriceToCustomer). When hidden, the amount is absent
//     from the response altogether, not just hidden in the UI.
//
// paymentStatus (what the normal screen shows once any one-time
// paymentConfirmation has been acknowledged):
//   "full_payment_complete" — accountant DONE (FullPaymentStatus.confirmed)
//   "under_review"          — a Deposit is pending
//   "awaiting_confirmation" — approved, customer hasn't pressed OK yet
//   "ready"                 — the customer may choose a Payment Option now
router.post(
  "/customer-summary",
  ownershipFailureGuard,
  limitRequest(summaryRules),
  asyncHandler(async (req, res) => {
    const attendeeId = requireValidObjectId(req.body.attendeeId, "A valid attendeeId is required.");
    const phone = requireValidPhone(req.body.phone);

    const attendee = await resolveOwnedIncomerCounted(req, attendeeId, phone);

    const [deposits, fullPaymentStatus, school] = await Promise.all([
      Deposit.find({ attendeeId: attendee._id }).sort({ createdAt: 1 }),
      FullPaymentStatus.findOne({ attendeeId: attendee._id }).select("confirmed"),
      attendee.schoolId ? School.findById(attendee.schoolId).select("showTicketPriceToCustomer") : null
    ]);

    // Never inferred from arithmetic — strictly the accountant's DONE column.
    const fullPaymentConfirmed = Boolean(fullPaymentStatus?.confirmed);
    const hasPendingPayment = deposits.some((deposit) => deposit.status === "pending");
    const awaitingConfirmation = deposits.some(
      (deposit) => deposit.status === "approved" && deposit.customerConfirmationPending === true
    );

    // Oldest-approved first, one at a time: after the customer acknowledges
    // it, the next refetch returns the next one (if any).
    const unacknowledged = deposits
      .filter((deposit) => deposit.status === "approved" && deposit.customerConfirmationPending === true)
      .sort((a, b) => approvalTime(a) - approvalTime(b));
    const paymentConfirmation = unacknowledged.length
      ? serializeCustomerPaymentConfirmation(unacknowledged[0])
      : null;

    let paymentStatus = "ready";
    if (fullPaymentConfirmed) paymentStatus = "full_payment_complete";
    else if (hasPendingPayment) paymentStatus = "under_review";
    else if (awaitingConfirmation) paymentStatus = "awaiting_confirmation";

    // Current-state only: surfaced while the customer's MOST RECENT request
    // is the rejected one and they can pay again.
    const newestDeposit = deposits[deposits.length - 1];
    const latestRejection =
      paymentStatus === "ready" && newestDeposit?.status === "rejected"
        ? serializeCustomerLatestRejection(newestDeposit)
        : null;

    // Missing field (Schools created before the setting existed) = shown,
    // the existing behavior.
    const ticketPriceVisible = school?.showTicketPriceToCustomer !== false;

    // Deliberately minimal: paymentStatus already tells the UI everything
    // it renders, so no separate fullPaymentConfirmed/hasPendingPayment flag
    // is sent (both are still computed above to derive paymentStatus).
    const summary = {
      ticketPriceVisible,
      paymentStatus,
      paymentConfirmation,
      latestRejection
    };
    if (ticketPriceVisible) {
      summary.ticketPrice = attendee.ticketPrice;
    }

    res.json({ success: true, summary });
  })
);

function approvalTime(deposit) {
  const time = new Date(deposit.reviewedAt || deposit.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

// School-specific Payment Options for the calling customer. Ownership is the
// same {attendeeId, phone} pair as every other payment endpoint; the
// customer never states their own schoolId — it is read server-side from the
// attendee record so a customer can never browse another School's list.
//
// Every ENABLED option of the School is returned, whatever its amount: the
// options are not filtered by any remaining balance or by the ticket price
// (Admin decides what customers may pay).
router.post(
  "/customer-options",
  ownershipFailureGuard,
  limitRequest(optionsRules),
  asyncHandler(async (req, res) => {
    const attendeeId = requireValidObjectId(req.body.attendeeId, "A valid attendeeId is required.");
    const phone = requireValidPhone(req.body.phone);

    const attendee = await resolveOwnedIncomerCounted(req, attendeeId, phone);

    const fullPaymentStatus = await FullPaymentStatus.findOne({ attendeeId: attendee._id }).select("confirmed");
    if (fullPaymentStatus?.confirmed) {
      // Full Payment confirmed: no new payment is possible, so no option is
      // ever worth offering — matches the deposit-creation guard.
      res.json({ success: true, paymentOptions: [] });
      return;
    }

    const paymentOptions = await PaymentOption.find({ schoolId: attendee.schoolId, enabled: true }).sort({
      displayOrder: 1,
      createdAt: 1
    });

    res.json({
      success: true,
      paymentOptions: paymentOptions.map(serializeCustomerPaymentOption)
    });
  })
);

// The customer's "OK" on the one-time PAYMENT CONFIRMED screen. Same
// {attendeeId, phone} ownership check as every other customer payment
// endpoint, and the Deposit filter is additionally scoped to that attendee,
// so one customer can never acknowledge another customer's Deposit.
//
// Acknowledging also closes the payment cycle (unsets activeCycle), which is
// what lets the customer make their next payment.
//
// Idempotent: a repeat call for a Deposit this customer already acknowledged
// returns success without rewriting acknowledgedAt. "Doesn't exist", "not
// yours" and "not an approved confirmation" share one generic 404 so the
// endpoint can't be used to probe Deposit ids.
router.post(
  "/acknowledge-confirmation",
  ownershipFailureGuard,
  limitRequest(acknowledgeRules),
  asyncHandler(async (req, res) => {
    const attendeeId = requireValidObjectId(req.body.attendeeId, "A valid attendeeId is required.");
    const phone = requireValidPhone(req.body.phone);
    const depositId = requireValidObjectId(req.body.depositId, "A valid depositId is required.");

    const attendee = await resolveOwnedIncomerCounted(req, attendeeId, phone);

    const acknowledged = await Deposit.findOneAndUpdate(
      {
        _id: depositId,
        attendeeId: attendee._id,
        status: "approved",
        customerConfirmationPending: true
      },
      {
        $set: {
          customerConfirmationPending: false,
          customerConfirmationAcknowledgedAt: new Date()
        },
        $unset: { activeCycle: 1 }
      },
      { new: true }
    );

    if (!acknowledged) {
      const alreadyAcknowledged = await Deposit.findOne({
        _id: depositId,
        attendeeId: attendee._id,
        status: "approved",
        customerConfirmationPending: false,
        customerConfirmationAcknowledgedAt: { $ne: null }
      }).select("_id");

      if (!alreadyAcknowledged) {
        throw apiError("Payment confirmation not found.", 404);
      }
    }

    res.json({ success: true });
  })
);

module.exports = router;
