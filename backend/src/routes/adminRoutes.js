const express = require("express");

const Attendee = require("../models/Attendee");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { generateQrToken, generateUniqueQrId } = require("../utils/qr");
const { serializeAttendee } = require("../utils/serializers");

const router = express.Router();

router.patch(
  "/attendees/:id/approve",
  asyncHandler(async (req, res) => {
    const attendee = await Attendee.findById(req.params.id);

    if (!attendee) {
      throw apiError("Attendee was not found.", 404);
    }

    attendee.status = "approved";
    attendee.paymentStatus = req.body.paymentStatus || "verified";
    attendee.rejectionReason = undefined;
    attendee.reviewedAt = new Date();

    if (!attendee.qrId) {
      attendee.qrId = await generateUniqueQrId(Attendee);
    }

    if (!attendee.qrToken) {
      attendee.qrToken = generateQrToken();
      attendee.qrIssuedAt = new Date();
    }

    await attendee.save();

    res.json({
      success: true,
      message: "Attendee approved and QR credentials issued.",
      attendee: serializeAttendee(attendee)
    });
  })
);

router.patch(
  "/attendees/:id/reject",
  asyncHandler(async (req, res) => {
    const attendee = await Attendee.findById(req.params.id);

    if (!attendee) {
      throw apiError("Attendee was not found.", 404);
    }

    attendee.status = "rejected";
    attendee.paymentStatus = req.body.paymentStatus || "rejected";
    attendee.rejectionReason = req.body.reason || "Rejected by admin.";
    attendee.reviewedAt = new Date();

    await attendee.save();

    res.json({
      success: true,
      message: "Attendee rejected.",
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
