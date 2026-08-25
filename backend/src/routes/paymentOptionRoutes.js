const express = require("express");

const PaymentOption = require("../models/PaymentOption");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// Public: enabled payment options only, in Admin-configured order.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const paymentOptions = await PaymentOption.find({ enabled: true }).sort({ displayOrder: 1, createdAt: 1 });
    res.json({ success: true, paymentOptions });
  })
);

module.exports = router;
