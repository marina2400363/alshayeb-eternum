const express = require("express");

const PaymentOption = require("../models/PaymentOption");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");

const router = express.Router();

function parseAmount(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw apiError("A valid amount greater than 0 is required.");
  }
  return amount;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const paymentOptions = await PaymentOption.find({}).sort({ displayOrder: 1, createdAt: 1 });
    res.json({ success: true, paymentOptions });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const amount = parseAmount(req.body.amount);
    const label = req.body.label !== undefined ? String(req.body.label).trim() : undefined;
    const enabled = req.body.enabled !== undefined ? Boolean(req.body.enabled) : true;
    const displayOrder = req.body.displayOrder !== undefined ? Number(req.body.displayOrder) : 999;

    const paymentOption = await PaymentOption.create({
      amount,
      label,
      enabled,
      displayOrder: Number.isFinite(displayOrder) ? displayOrder : 999
    });

    res.status(201).json({ success: true, paymentOption });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const update = {};

    if (req.body.amount !== undefined) {
      update.amount = parseAmount(req.body.amount);
    }

    if (req.body.label !== undefined) {
      update.label = String(req.body.label).trim();
    }

    if (req.body.enabled !== undefined) {
      update.enabled = Boolean(req.body.enabled);
    }

    if (req.body.displayOrder !== undefined) {
      const displayOrder = Number(req.body.displayOrder);
      if (!Number.isFinite(displayOrder)) {
        throw apiError("displayOrder must be a number.");
      }
      update.displayOrder = displayOrder;
    }

    const paymentOption = await PaymentOption.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    });

    if (!paymentOption) {
      throw apiError("Payment option not found.", 404);
    }

    res.json({ success: true, paymentOption });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const paymentOption = await PaymentOption.findByIdAndDelete(req.params.id);
    if (!paymentOption) {
      throw apiError("Payment option not found.", 404);
    }
    res.json({ success: true, message: "Payment option deleted." });
  })
);

module.exports = router;
