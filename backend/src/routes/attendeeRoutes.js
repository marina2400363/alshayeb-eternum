const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");

const Attendee = require("../models/Attendee");
const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { cleanPhone, isEgyptianPhone } = require("../utils/phone");
const { generateQrToken, generateUniqueQrId } = require("../utils/qr");
const { serializeAttendee } = require("../utils/serializers");
const { requireAdmin } = require("../middleware/requireAdmin");
const { uploadIncomerPhoto, deleteIncomerPhoto } = require("../utils/cloudinaryUpload");
const Event = require("../models/Event");

const router = express.Router();

// Only engages for multipart/form-data requests (the Incomer registration
// flow). JSON requests on the same route are untouched — multer skips
// parsing when the content-type isn't multipart.
const incomerPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.mimetype)) {
      callback(apiError("Only PNG, JPG, or JPEG photos are allowed.", 422));
      return;
    }
    callback(null, true);
  }
});

function uploadIncomerPhotoMiddleware(req, res, next) {
  incomerPhotoUpload.single("incomerPhoto")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(apiError("Personal photo must be 5MB or smaller.", 422));
      return;
    }

    next(apiError("Personal photo upload failed: " + error.message, 400));
  });
}

// Public, phone-triggered responses (lookup + register-duplicate) must not
// leak the Incomer's personal photo to an unauthenticated caller who only
// knows a phone number. schoolId/ticketPrice stay — the customer/payment
// contract needs them. Admin routes still get the full serializeAttendee().
function serializePublicAttendee(attendee) {
  const serialized = serializeAttendee(attendee);
  delete serialized.incomerPhoto;
  return serialized;
}

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
      attendee: serializePublicAttendee(attendee)
    });
  })
);

// Season 2: Incomer registration with Admin-managed School association.
// The ticket price is NEVER trusted from the request body — it is always
// snapshotted server-side from the School's current price at registration time.
async function registerIncomer(req, res) {
  const fullName = String(req.body.fullName || req.body.name || "").trim();
  const phone = cleanPhone(req.body.phoneNumber || req.body.phone);
  const schoolId = String(req.body.schoolId || "").trim();

  if (!fullName) {
    throw apiError("Full name is required.", 422);
  }

  if (!phone) {
    throw apiError("Phone number is required.", 422);
  }

  if (!isEgyptianPhone(phone)) {
    throw apiError("Enter an Egyptian phone number starting with 01 and 11 digits long.", 422);
  }

  if (!schoolId || !mongoose.Types.ObjectId.isValid(schoolId)) {
    throw apiError("A valid schoolId is required.", 422);
  }

  const school = await School.findById(schoolId);
  if (!school) {
    throw apiError("Selected school was not found.", 422);
  }

  // Phase 1: an Incomer is a customer profile, not an event registration.
  // Identity is phoneNormalized + attendeeType only — event is never part of it.
  const findExisting = () =>
    Attendee.findOne({ phoneNormalized: phone, attendeeType: "incomer" }).sort({ createdAt: -1 });

  const existingAttendee = await findExisting();
  if (existingAttendee) {
    res.json({
      success: true,
      duplicate: true,
      message: "Existing registration found.",
      attendee: serializePublicAttendee(existingAttendee)
    });
    return;
  }

  if (!req.file) {
    throw apiError("Personal photo is required.", 422);
  }

  const uploadedPhoto = await uploadIncomerPhoto(req.file);
  const incomerPhoto = {
    url: uploadedPhoto.secure_url || uploadedPhoto.url,
    publicId: uploadedPhoto.public_id,
    fileName: req.file.originalname,
    fileType: req.file.mimetype,
    uploadedAt: new Date()
  };

  let attendee;
  try {
    // Phase 1: no event is assigned at registration — the event field is
    // intentionally left unset. See findExisting() above for why.
    attendee = await Attendee.create({
      fullName,
      phone,
      phoneNormalized: phone,
      attendeeType: "incomer",
      accessType: "INCOMER",
      schoolId: school._id,
      ticketPrice: school.ticketPrice,
      incomerPhoto
    });
  } catch (err) {
    // The upload already succeeded but no attendee document ended up owning
    // it — delete the orphaned Cloudinary asset either way (duplicate race
    // or any other creation failure) so no orphan image remains.
    await deleteIncomerPhoto(incomerPhoto.publicId);

    // Catch MongoDB unique index race-condition (mirrors outcomer registration).
    if (err.code === 11000) {
      const raceExisting = await findExisting();
      if (raceExisting) {
        res.json({
          success: true,
          duplicate: true,
          message: "Existing registration found.",
          attendee: serializePublicAttendee(raceExisting)
        });
        return;
      }
    }
    throw err;
  }

  res.status(201).json({
    success: true,
    message: "Incomer registered.",
    attendee: serializeAttendee(attendee)
  });
}

router.post(
  "/register",
  uploadIncomerPhotoMiddleware,
  asyncHandler(async (req, res) => {
    const attendeeTypeEarly = String(req.body.attendeeType || "incomer").trim().toLowerCase();

    if (attendeeTypeEarly === "incomer") {
      await registerIncomer(req, res);
      return;
    }

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
