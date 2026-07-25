const express = require("express");

const Attendee = require("../models/Attendee");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { cleanPhone, isEgyptianPhone } = require("../utils/phone");
const { generateQrToken, generateUniqueQrId } = require("../utils/qr");
const { serializeAttendee } = require("../utils/serializers");
const { requireAdmin } = require("../middleware/requireAdmin");
const Event = require("../models/Event");

const router = express.Router();

function buildPublicQuery(query) {
  const filters = {};
  const attendeeType = String(query.attendeeType || query.type || "").trim().toLowerCase();
  const status = String(query.status || "").trim().toLowerCase();

  if (attendeeType) {
    filters.attendeeType = attendeeType;
  }

  if (status) {
    filters.status = status;
  }

  return filters;
}

// Admin-only: list all attendees. Public users must not enumerate the database.
router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const attendees = await Attendee.find(buildPublicQuery(req.query)).sort({ createdAt: -1 });

    res.json({
      success: true,
      attendees: attendees.map(serializeAttendee)
    });
  })
);

// Public-only: return a minimal list of approved guests for the frontend marquee
router.get(
  "/public-list",
  asyncHandler(async (req, res) => {
    const attendees = await Attendee.find({ status: "approved" }, "name eventName -_id")
      .sort({ createdAt: -1 })
      .limit(300);

    res.json({
      success: true,
      attendees: attendees.map(a => ({
        name: a.name,
        event: a.eventName
      }))
    });
  })
);

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

    const expectedType = req.query.type;
    const query = { phoneNormalized: phone };
    if (expectedType) {
      query.attendeeType = expectedType;
    }

    const attendee = await Attendee.findOne(query).sort({ createdAt: -1 }).populate("event");

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

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const fullName = String(req.body.fullName || req.body.name || "").trim();
    const phone = cleanPhone(req.body.phoneNumber || req.body.phone);
    const email = String(req.body.email || "").trim().toLowerCase();
    const university = String(req.body.schoolOrOriginProm || req.body.university || req.body.school || "").trim();
    const attendeeType = String(req.body.attendeeType || "incomer").trim().toLowerCase();
    const accessType = String(req.body.accessType || attendeeType).trim().toUpperCase();

    if (!fullName) {
      throw apiError("Full name is required.", 422);
    }

    if (!phone) {
      throw apiError("Phone number is required.", 422);
    }

    if (!isEgyptianPhone(phone)) {
      throw apiError("Enter an Egyptian phone number starting with 01 and 11 digits long.", 422);
    }

    if (!["guest", "incomer", "outcomer"].includes(attendeeType)) {
      throw apiError("attendeeType must be guest, incomer, or outcomer.", 422);
    }

    const attendee = await Attendee.findOneAndUpdate(
      { phone, attendeeType },
      {
        $set: {
          fullName,
          email,
          university,
          age: req.body.age,
          instagram: req.body.instagramUsername || req.body.instagram,
          notes: req.body.notes,
          eventName: req.body.eventName || req.body.prom || req.body.event,
          attendeeType,
          accessType,
          // SECURITY: status and paymentStatus are NEVER accepted from the request body
          // on this public endpoint. They are always forced to safe defaults.
          status: "pending",
          paymentStatus: "not_required"
        }
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    if (attendee.status === "approved") {
      if (!attendee.qrId) {
        let prefix = "ALSHAYEB-";
        if (attendee.event) {
          const ev = await Event.findById(attendee.event);
          if (ev && ev.prefix) prefix = ev.prefix;
        }
        attendee.qrId = await generateUniqueQrId(Attendee, prefix);
      }

      if (!attendee.qrToken) {
        attendee.qrToken = generateQrToken();
        attendee.qrIssuedAt = new Date();
      }

      await attendee.save();
    }

    res.status(201).json({
      success: true,
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
