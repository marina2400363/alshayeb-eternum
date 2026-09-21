const express = require("express");

const PaymentOption = require("../models/PaymentOption");
const FullPaymentStatus = require("../models/FullPaymentStatus");
const asyncHandler = require("../middleware/asyncHandler");
const { getAttendeeFinancialSummary } = require("../utils/paymentCalculations");
const { serializeCustomerDepositHistoryItem, serializeCustomerPaymentOption } = require("../utils/paymentSerializers");
const { requireValidObjectId, requireValidPhone, resolveOwnedIncomer } = require("../utils/customerOwnership");

const router = express.Router();

// Public, but NOT open lookup-by-id: the request body must carry the
// customer's own {attendeeId, phone} (the same pair the Season 2 session
// already holds), and resolveOwnedIncomer() verifies they belong together
// before anything is read. phone is deliberately in the body, not a query
// string, so it never lands in server/proxy access logs.
//
// Product rule: the customer sees FULL TICKET PRICE only — never paid /
// remaining / payment-progress. approvedTotal and remainingBalance are still
// computed internally (see getAttendeeFinancialSummary below) for the
// deposit-creation guard and the customer-options filter, but neither number
// is ever put in a response.
router.post(
  "/customer-summary",
  asyncHandler(async (req, res) => {
    const attendeeId = requireValidObjectId(req.body.attendeeId, "A valid attendeeId is required.");
    const phone = requireValidPhone(req.body.phone);

    const attendee = await resolveOwnedIncomer(attendeeId, phone);

    const [financial, fullPaymentStatus] = await Promise.all([
      getAttendeeFinancialSummary(attendee._id),
      FullPaymentStatus.findOne({ attendeeId: attendee._id }).select("confirmed")
    ]);

    // activeSlot is present (1..5) only on pending/approved deposits — see
    // Deposit.js — so counting by its presence mirrors the same "active"
    // definition the 5-slot cap and the deposit-creation route use.
    const activeDepositCount = financial.deposits.filter((deposit) => deposit.activeSlot != null).length;

    res.json({
      success: true,
      summary: {
        ticketPrice: financial.ticketPrice,
        activeDepositCount,
        // Never inferred from approvedTotal/ticketPrice arithmetic — this is
        // strictly the accountant's DONE column, mirrored via
        // FullPaymentStatus by the existing Sheet read-back sync.
        fullPaymentConfirmed: Boolean(fullPaymentStatus?.confirmed),
        deposits: financial.deposits.map(serializeCustomerDepositHistoryItem)
      }
    });
  })
);

// School-specific Payment Options for the calling customer — replaces the
// old global GET /api/payment-options (removed: Season 2 options are no
// longer a single shared list, they belong to exactly one School). Ownership
// is the same {attendeeId, phone} pair as every other payment endpoint; the
// customer never states their own schoolId — it is read server-side from
// the attendee record so a customer can never browse another School's list.
router.post(
  "/customer-options",
  asyncHandler(async (req, res) => {
    const attendeeId = requireValidObjectId(req.body.attendeeId, "A valid attendeeId is required.");
    const phone = requireValidPhone(req.body.phone);

    const attendee = await resolveOwnedIncomer(attendeeId, phone);

    const fullPaymentStatus = await FullPaymentStatus.findOne({ attendeeId: attendee._id }).select("confirmed");
    if (fullPaymentStatus?.confirmed) {
      // Full Payment confirmed: no new payment is possible, so no option is
      // ever worth offering — matches the deposit-creation guard.
      res.json({ success: true, paymentOptions: [] });
      return;
    }

    const { remainingBalance } = await getAttendeeFinancialSummary(attendee._id);

    const paymentOptions = await PaymentOption.find({ schoolId: attendee.schoolId, enabled: true }).sort({
      displayOrder: 1,
      createdAt: 1
    });

    // Filtered by the customer's own current remaining balance so the
    // frontend never needs to know that number itself (kept internal — see
    // customer-summary above). POST /api/deposits still re-validates this
    // authoritatively; this filter is a UX convenience, not the real guard.
    const availableOptions = paymentOptions.filter((option) => option.amount <= remainingBalance);

    res.json({
      success: true,
      paymentOptions: availableOptions.map(serializeCustomerPaymentOption)
    });
  })
);

module.exports = router;
