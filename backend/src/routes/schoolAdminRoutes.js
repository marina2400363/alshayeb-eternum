const express = require("express");

const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { applySchoolTicketPrice } = require("../utils/ticketPriceLock");
const { requestSchoolFinanceSync } = require("../services/financeAutoSync");

const router = express.Router();

function parseVisibility(value) {
  if (typeof value !== "boolean") {
    throw apiError("showTicketPriceToCustomer must be true or false.", 422);
  }
  return value;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const schools = await School.find({}).sort({ name: 1 });
    res.json({ success: true, schools });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const ticketPrice = Number(req.body.ticketPrice);

    if (!name) {
      throw apiError("School name is required.");
    }

    if (!Number.isFinite(ticketPrice) || ticketPrice < 0) {
      throw apiError("A valid ticket price is required.");
    }

    const fields = { name, ticketPrice };
    if (req.body.showTicketPriceToCustomer !== undefined) {
      fields.showTicketPriceToCustomer = parseVisibility(req.body.showTicketPriceToCustomer);
    }

    const school = await School.create(fields);
    res.status(201).json({ success: true, school });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const update = {};

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        throw apiError("School name is required.");
      }
      update.name = name;
    }

    if (req.body.ticketPrice !== undefined) {
      const ticketPrice = Number(req.body.ticketPrice);
      if (!Number.isFinite(ticketPrice) || ticketPrice < 0) {
        throw apiError("A valid ticket price is required.");
      }
      update.ticketPrice = ticketPrice;
    }

    // Visibility only — never touches any price or financial data.
    if (req.body.showTicketPriceToCustomer !== undefined) {
      update.showTicketPriceToCustomer = parseVisibility(req.body.showTicketPriceToCustomer);
    }

    const school = await School.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    });

    if (!school) {
      throw apiError("School not found.", 404);
    }

    // New price reaches this School's customers who have not made a payment
    // request yet; customers with a locked price keep theirs (see
    // utils/ticketPriceLock.js).
    if (update.ticketPrice !== undefined) {
      await applySchoolTicketPrice(school._id, school.ticketPrice);
    }

    // The sheet shows the School name (D) and each customer's ticket price (E):
    // refresh it after a price or name change. Fire-and-forget (never awaited).
    if (update.ticketPrice !== undefined || update.name !== undefined) {
      requestSchoolFinanceSync(school._id);
    }

    res.json({ success: true, school });
  })
);

module.exports = router;
