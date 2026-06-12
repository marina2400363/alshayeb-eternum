const express = require("express");

const Attendee = require("../models/Attendee");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { serializeAttendee } = require("../utils/serializers");

const router = express.Router();

router.post(
  "/validate",
  asyncHandler(async (req, res) => {
    const { qrToken, qrId, markUsed = true } = req.body;

    if (!qrToken && !qrId) {
      throw apiError("qrToken or qrId is required.");
    }

    const attendee = await Attendee.findOne(
      qrToken && qrId
        ? { $or: [{ qrToken }, { qrId }] }
        : { ...(qrToken ? { qrToken } : { qrId }) }
    );

    if (!attendee) {
      res.status(404).json({
        success: true,
        valid: false,
        reason: "QR credentials were not found."
      });
      return;
    }

    if (attendee.status !== "approved") {
      res.status(403).json({
        success: true,
        valid: false,
        reason: `Attendee status is ${attendee.status}.`,
        attendee: serializeAttendee(attendee)
      });
      return;
    }

    if (markUsed) {
      attendee.status = "used";
      attendee.scannedAt = new Date();
      attendee.scanCount += 1;
      await attendee.save();
    }

    res.json({
      success: true,
      valid: true,
      message: "Access granted.",
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
