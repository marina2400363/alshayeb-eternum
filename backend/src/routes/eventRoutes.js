const express = require("express");

const Event = require("../models/Event");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const events = await Event.find({}).sort({ date: 1, createdAt: -1 });
    res.json({ success: true, events });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, slug, date, venue, fee, capacity, isActive } = req.body;

    if (!name || !slug) {
      throw apiError("Event name and slug are required.");
    }

    const event = await Event.create({
      name,
      slug,
      date,
      venue,
      fee,
      capacity,
      isActive
    });

    res.status(201).json({ success: true, event });
  })
);

module.exports = router;
