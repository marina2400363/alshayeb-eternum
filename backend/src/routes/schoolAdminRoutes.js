const express = require("express");

const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");

const router = express.Router();

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

    const school = await School.create({ name, ticketPrice });
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

    const school = await School.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    });

    if (!school) {
      throw apiError("School not found.", 404);
    }

    res.json({ success: true, school });
  })
);

module.exports = router;
