const express = require("express");

const Attendee = require("../models/Attendee");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { sendStatusEmail } = require("../utils/email");
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

    const previousStatus = attendee.status;
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

    if (previousStatus !== "approved" && !attendee.emailNotifications?.approvedAt) {
      const emailSent = await sendStatusEmail(
        attendee,
        "ALSHAYEB ETERNUM application approved",
        "Application approved and QR pass available."
      );

      if (emailSent) {
        attendee.emailNotifications = {
          ...attendee.emailNotifications,
          approvedAt: new Date()
        };
        await attendee.save();
      }
    }

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

    const previousStatus = attendee.status;
    attendee.status = "rejected";
    attendee.paymentStatus = req.body.paymentStatus || "rejected";
    attendee.rejectionReason = req.body.reason || "Rejected by admin.";
    attendee.reviewedAt = new Date();

    await attendee.save();

    if (previousStatus !== "rejected" && !attendee.emailNotifications?.rejectedAt) {
      const emailSent = await sendStatusEmail(
        attendee,
        "ALSHAYEB ETERNUM application declined",
        "Application declined."
      );

      if (emailSent) {
        attendee.emailNotifications = {
          ...attendee.emailNotifications,
          rejectedAt: new Date()
        };
        await attendee.save();
      }
    }

    res.json({
      success: true,
      message: "Attendee rejected.",
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
