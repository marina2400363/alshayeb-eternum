const express = require("express");

const Attendee = require("../models/Attendee");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { serializeAttendee } = require("../utils/serializers");
const { appendSuccessfulScanToSheet } = require("../services/googleSheetsScanLog");

const router = express.Router();

router.post(
  "/validate",
  asyncHandler(async (req, res) => {
    const { qrToken, qrId, markUsed = true } = req.body;

    if (!qrToken && !qrId) {
      throw apiError("qrToken or qrId is required.");
    }

    const query = qrToken && qrId
      ? { $or: [{ qrToken }, { qrId }] }
      : qrToken ? { qrToken } : { qrId };

    // ── FAST PATH: Atomic scan in a single database round-trip ───────────────
    // If markUsed is true, attempt the atomic claim immediately without a
    // preceding findOne. This eliminates the TOCTOU window entirely:
    // only one concurrent request can satisfy { isUsed: false, scanCount: 0 }
    // and flip it to { isUsed: true }. All others receive null and are told
    // the ticket is already scanned.
    if (markUsed) {
      // Attempt atomic claim: matches ONLY an unscanned, approved attendee.
      const claimed = await Attendee.findOneAndUpdate(
        { ...query, status: "approved", isUsed: false, scanCount: 0 },
        {
          $set: { isUsed: true, scannedAt: new Date() },
          $inc: { scanCount: 1 }
        },
        { new: true }
      );

      if (claimed) {
        // 🟢 Non-blocking Google Sheets scan log — fires and forgets.
        // The scan response is sent immediately below; if Sheets fails,
        // the MongoDB write is already committed and cannot be rolled back.
        appendSuccessfulScanToSheet(claimed).catch((sheetErr) => {
          console.error("[ScanLog] Non-blocking Sheets append failed:", sheetErr.message);
        });

        // 🟢 Clean first scan
        return res.json({
          success: true,
          valid: true,
          message: "Access granted.",
          attendee: serializeAttendee(claimed)
        });
      }

      // The atomic claim failed — determine why so we can return a meaningful message.
      const attendee = await Attendee.findOne(query);

      if (!attendee) {
        return res.status(404).json({
          success: true,
          valid: false,
          reason: "QR credentials were not found."
        });
      }

      if (attendee.isUsed || attendee.scannedAt || attendee.scanCount > 0) {
        // 🔴 Already scanned (concurrent race or repeat scan)
        return res.status(403).json({
          success: true,
          valid: false,
          reason: "QR code has already been scanned.",
          attendee: serializeAttendee(attendee)
        });
      }

      // Status is not "approved"
      return res.status(403).json({
        success: true,
        valid: false,
        reason: `Attendee status is ${attendee.status}.`,
        attendee: serializeAttendee(attendee)
      });
    }

    // ── PREVIEW PATH (markUsed = false): read-only lookup ────────────────────
    const attendee = await Attendee.findOne(query);

    if (!attendee) {
      return res.status(404).json({
        success: true,
        valid: false,
        reason: "QR credentials were not found."
      });
    }

    if (attendee.status !== "approved") {
      return res.status(403).json({
        success: true,
        valid: false,
        reason: `Attendee status is ${attendee.status}.`,
        attendee: serializeAttendee(attendee)
      });
    }

    if (attendee.isUsed || attendee.scannedAt || attendee.scanCount > 0) {
      return res.status(403).json({
        success: true,
        valid: false,
        reason: "QR code has already been scanned.",
        attendee: serializeAttendee(attendee)
      });
    }

    return res.json({
      success: true,
      valid: true,
      message: "Access granted.",
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
