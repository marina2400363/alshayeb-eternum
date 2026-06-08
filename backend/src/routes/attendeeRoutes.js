const express = require("express");

const Attendee = require("../models/Attendee");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { cleanPhone, isEgyptianPhone } = require("../utils/phone");
const { serializeAttendee } = require("../utils/serializers");

const router = express.Router();

router.get(
  "/lookup",
  asyncHandler(async (req, res) => {
    const phone = cleanPhone(req.query.phone);

    if (!phone) {
      throw apiError("Phone number is required.");
    }

    if (!isEgyptianPhone(phone)) {
      throw apiError("Enter an Egyptian phone number starting with 01 and 11 digits long.", 422);
    }

    const attendee = await Attendee.findOne({ phone }).sort({ createdAt: -1 });

    if (!attendee) {
      res.json({ success: true, found: false, attendee: null });
      return;
    }

    res.json({
      success: true,
      found: true,
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
