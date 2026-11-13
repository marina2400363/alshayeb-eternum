const express = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const {
  getDepositDetails,
  listFullPayments,
  markDone,
  revokeDone
} = require("../services/fullPaymentAdminService");

// ADMIN-ONLY, MANUAL Full Payments. Mounted (in app.js) behind requireAdmin at
// /api/admin/season2-full-payments: there is no public route here. Customers are
// always addressed by id, never by name or row position. Nothing on this router
// reads or compares an amount to decide anything, and nothing here writes to
// Attendee, Deposit, School or Google Sheets.
const router = express.Router();

// One page of ALL customers. Query: page, pageSize (25 default, 50 max), q,
// customerType=all|incomer|outcomer, schoolId, eventId, manual=all|done|not_done.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await listFullPayments(req.query)) });
  })
);

// Customer, financial summary and full deposit history for ONE customer.
router.get(
  "/:id/deposits",
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await getDepositDetails(req.params.id)) });
  })
);

// Manually mark ONE customer's Full Payment DONE. Idempotent.
router.post(
  "/:id/done",
  asyncHandler(async (req, res) => {
    const result = await markDone(req.params.id, req.admin);
    res.json({ success: true, ...result });
  })
);

// Manually revoke ONE customer's DONE. Idempotent.
router.post(
  "/:id/revoke",
  asyncHandler(async (req, res) => {
    const result = await revokeDone(req.params.id, req.admin);
    res.json({ success: true, ...result });
  })
);

module.exports = router;
