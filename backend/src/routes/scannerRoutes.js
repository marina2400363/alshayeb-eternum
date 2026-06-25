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

    if (attendee.isUsed || attendee.scannedAt || attendee.scanCount > 0) {
      res.status(403).json({
        success: true,
        valid: false,
        reason: "QR code has already been scanned.",
        attendee: serializeAttendee(attendee)
      });
      return;
    }

    let responseAttendee = attendee;

    if (markUsed) {
      // Atomic update to prevent race conditions
      const updatedAttendee = await Attendee.findOneAndUpdate(
        { _id: attendee._id, isUsed: false, scanCount: 0 },
        { 
          $set: { isUsed: true, scannedAt: new Date() },
          $inc: { scanCount: 1 }
        },
        { new: true }
      );

      if (!updatedAttendee) {
        // If it returns null, another scanner just claimed it milliseconds ago
        const doubleScannedAttendee = await Attendee.findById(attendee._id);
        res.status(403).json({
          success: true,
          valid: false,
          reason: "QR code has already been scanned.",
          attendee: serializeAttendee(doubleScannedAttendee)
        });
        return;
      }
      
      responseAttendee = updatedAttendee;
    }

    res.json({
      success: true,
      valid: true,
      message: "Access granted.",
      attendee: serializeAttendee(responseAttendee)
    });
  })
);

module.exports = router;
