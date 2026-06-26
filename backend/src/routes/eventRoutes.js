const express = require("express");

const Event = require("../models/Event");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const events = await Event.find({});
    
    // Sort events by displayOrder ascending, fallback to createdAt ascending
    events.sort((a, b) => {
      const orderA = a.displayOrder !== undefined && a.displayOrder !== null ? a.displayOrder : 999;
      const orderB = b.displayOrder !== undefined && b.displayOrder !== null ? b.displayOrder : 999;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    res.json({ success: true, events });
  })
);

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, slug, date, entryTime, venue, status, schools, prefix, price, googleSheetId, exportGoogleSheetId, capacity, displayOrder } = req.body;

    if (!name || !slug) {
      throw apiError("Event name and slug are required.");
    }
    
    if (!prefix) {
      throw apiError("Event prefix is required for QR ID generation.");
    }

    if (price === undefined || price === null) {
      throw apiError("Event price is required.");
    }

    const parsedOrder = displayOrder !== undefined && displayOrder !== "" && !isNaN(Number(displayOrder)) ? Number(displayOrder) : 999;

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
      exportGoogleSheetId,
      capacity: capacity || 0,
      displayOrder: parsedOrder
    });

    res.status(201).json({ success: true, event });
  })
);

router.put(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, slug, date, entryTime, venue, status, schools, prefix, price, googleSheetId, exportGoogleSheetId, capacity, displayOrder } = req.body;

    if (!prefix) {
      throw apiError("Event prefix is required for QR ID generation.");
    }

    if (price === undefined || price === null) {
      throw apiError("Event price is required.");
    }

    const parsedOrder = displayOrder !== undefined && displayOrder !== "" && !isNaN(Number(displayOrder)) ? Number(displayOrder) : 999;

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
        exportGoogleSheetId,
        capacity: capacity || 0,
        displayOrder: parsedOrder
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
  requireAdmin,
  asyncHandler(async (req, res) => {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      throw apiError("Event not found", 404);
    }
    res.json({ success: true, message: "Event deleted successfully." });
  })
);

module.exports = router;
