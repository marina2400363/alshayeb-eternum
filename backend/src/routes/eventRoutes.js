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
    const { name, slug, date, entryTime, venue, status, schools, prefix, price, googleSheetId, capacity } = req.body;

    if (!name || !slug) {
      throw apiError("Event name and slug are required.");
    }
    
    if (!prefix) {
      throw apiError("Event prefix is required for QR ID generation.");
    }

    if (price === undefined || price === null) {
      throw apiError("Event price is required.");
    }

    const event = await Event.create({
      name,
      slug,
      date,
      entryTime,
      venue,
      status,
      schools,
      prefix,
      price,
      googleSheetId,
      capacity
    });

    res.status(201).json({ success: true, event });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { name, slug, date, entryTime, venue, status, schools, prefix, price, googleSheetId, capacity } = req.body;

    if (!prefix) {
      throw apiError("Event prefix is required for QR ID generation.");
    }

    if (price === undefined || price === null) {
      throw apiError("Event price is required.");
    }

    const event = await Event.findByIdAndUpdate(
      req.params.id,
      {
        name,
        slug,
        date,
        entryTime,
        venue,
        status,
        schools,
        prefix,
        price,
        googleSheetId,
        capacity
      },
      { new: true, runValidators: true }
    );

    if (!event) {
      throw apiError("Event not found", 404);
    }

    res.json({ success: true, event });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      throw apiError("Event not found", 404);
    }
    res.json({ success: true, message: "Event deleted successfully." });
  })
);

module.exports = router;
