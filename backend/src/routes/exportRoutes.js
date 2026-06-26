const express = require("express");

const Attendee = require("../models/Attendee");
const asyncHandler = require("../middleware/asyncHandler");
const { serializeAttendee } = require("../utils/serializers");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

router.get(
  "/attendees",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const attendees = await Attendee.find({}).sort({ eventName: 1, createdAt: -1 });

    res.json({
      success: true,
      attendees: attendees.map(serializeAttendee)
    });
  })
);

module.exports = router;
