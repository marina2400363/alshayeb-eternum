const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");

const Attendee = require("../models/Attendee");
const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { cleanPhone, isEgyptianPhone } = require("../utils/phone");
const { cleanEmail, isValidEmail } = require("../utils/emailAddress");
const { serializeAttendee } = require("../utils/serializers");
const { requireAdmin } = require("../middleware/requireAdmin");
const { uploadIncomerPhoto, deleteIncomerPhoto } = require("../utils/cloudinaryUpload");
const { sendSeason2RegistrationReceivedEmail } = require("../utils/season2Email");
const { MAX_CUSTOMER_UPLOAD_LABEL, MULTER_FILE_SIZE_LIMIT } = require("../utils/uploadLimits");
const { limitRequest, enforceLimits } = require("../middleware/rateLimit");
const {
  lookupRules,
  registerPreParseRules,
  registerPhoneRules,
  registerEmailRules,
  REGISTER_MESSAGE
} = require("../config/rateLimits");

const router = express.Router();

// Only engages for multipart/form-data requests (the Incomer registration
// flow). JSON requests on the same route are untouched — multer skips
// parsing when the content-type isn't multipart.
const incomerPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MULTER_FILE_SIZE_LIMIT },
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
      next(apiError(`Personal photo must be ${MAX_CUSTOMER_UPLOAD_LABEL} or smaller.`, 422));
      return;
    }

    next(apiError("Personal photo upload failed: " + error.message, 400));
  });
}

// LEGACY public serializer — used ONLY by the legacy GET /lookup below, whose
// response the Season 1 ticket / QR / guest-list / outcomer-tracking flows
// depend on (qrToken and qrId included). DO NOT EDIT this for Season 2's sake:
// Season 2 has its own minimal serializer (serializeSeason2Attendee) and its
// own endpoint (GET /season2/lookup). A previous "security" edit to this shape
// broke legitimate QR display.
//
// It strips the Incomer's personal photo and email from phone-triggered
// responses; legacy guest/outcomer records are returned unchanged.
function serializePublicAttendee(attendee) {
  const serialized = serializeAttendee(attendee);
  delete serialized.incomerPhoto;
  if (serialized.attendeeType === "incomer") {
    delete serialized.email;
  }
  return serialized;
}

// ---------------------------------------------------------------------------
// Season 2 (Marina) — minimal public shape.
//
// Season 2 customer entry only needs to know WHO the customer is. Nothing else
// leaves the server through the Season 2 endpoints: no email, school, price,
// status, payment, event, photo, QR or scan data, and no internal Mongo fields.
// ---------------------------------------------------------------------------
const SEASON2_ATTENDEE_TYPE = "incomer";

// Mirrors FULL_NAME_MAX in src/season2/features/onboarding/utils/validation.js.
const FULL_NAME_MAX_LENGTH = 80;

function serializeSeason2Attendee(attendee) {
  if (!attendee) return null;

  return {
    id: String(attendee._id),
    fullName: attendee.fullName || "",
    phone: attendee.phone || "",
    attendeeType: attendee.attendeeType
  };
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

// Season 2 (Marina): customer-entry / hydration lookup — Already Registered,
// the Details phone pre-check and Customer Area hydration.
//
//   • phone ONLY: the attendee type is fixed server-side (any `type` in the
//     query is ignored, so it can never be widened to other attendee types);
//   • identity is phoneNormalized + attendeeType "incomer" — never email;
//   • the projection and response are the minimal Season 2 shape, and nothing
//     is populated (no Event object, no sheet ids).
//
// Deliberately separate from the legacy GET /lookup above, which is untouched:
// the Season 1 QR / ticket flows still read every field it returns.
router.get(
  "/season2/lookup",
  limitRequest(lookupRules),
  asyncHandler(async (req, res) => {
    const phone = cleanPhone(req.query.phone);

    if (!phone) {
      throw apiError("Phone number is required.");
    }

    if (!isEgyptianPhone(phone)) {
      throw apiError("Enter an Egyptian phone number starting with 01 and 11 digits long.", 422);
    }

    const attendee = await Attendee.findOne({ phoneNormalized: phone, attendeeType: SEASON2_ATTENDEE_TYPE })
      .select("fullName phone attendeeType")
      .sort({ createdAt: -1 });

    if (!attendee) {
      res.json({ success: true, found: false, attendee: null });
      return;
    }

    res.json({
      success: true,
      found: true,
      attendee: serializeSeason2Attendee(attendee)
    });
  })
);

// Season 2: Incomer registration with Admin-managed School association.
// The ticket price is NEVER trusted from the request body — it is always
// snapshotted server-side from the School's current price at registration time.
//
// Email is REQUIRED customer data (reused Attendee.email — the legacy field).
// It is trimmed + lowercased before saving and is never part of identity: it
// is not unique, not used for lookup, and not used for duplicate detection.
// Identity stays phoneNormalized + attendeeType.
async function registerIncomer(req, res) {
  const fullName = String(req.body.fullName || req.body.name || "").trim();
  const phone = cleanPhone(req.body.phoneNumber || req.body.phone);
  const email = cleanEmail(req.body.email);
  const schoolId = String(req.body.schoolId || "").trim();

  if (!fullName) {
    throw apiError("Full name is required.", 422);
  }

  if (fullName.length > FULL_NAME_MAX_LENGTH) {
    throw apiError(`Full name must be ${FULL_NAME_MAX_LENGTH} characters or fewer.`, 422);
  }

  if (!phone) {
    throw apiError("Phone number is required.", 422);
  }

  if (!isEgyptianPhone(phone)) {
    throw apiError("Enter an Egyptian phone number starting with 01 and 11 digits long.", 422);
  }

  if (!email) {
    throw apiError("Email is required.", 422);
  }

  if (!isValidEmail(email)) {
    throw apiError("Enter a valid email address.", 422);
  }

  if (!schoolId || !mongoose.Types.ObjectId.isValid(schoolId)) {
    throw apiError("A valid schoolId is required.", 422);
  }

  // Rate limit per phone (attempts that passed validation), before any
  // database read, upload or email.
  await enforceLimits(registerPhoneRules(phone), { message: REGISTER_MESSAGE });

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
      attendee: serializeSeason2Attendee(existingAttendee)
    });
    return;
  }

  if (!req.file) {
    throw apiError("Personal photo is required.", 422);
  }

  // A NEW registration is about to upload a photo and send an email: limit per
  // email here (duplicates above never reach this point, and a blocked request
  // uploads nothing and emails nobody).
  await enforceLimits(registerEmailRules(email), { message: REGISTER_MESSAGE });

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
      email,
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
          attendee: serializeSeason2Attendee(raceExisting)
        });
        return;
      }
    }
    throw err;
  }

  // Email A — Registration received. Only THIS success path (a brand new
  // Attendee.create()) ever reaches here: the "duplicate" early-return above
  // and the race-recovery branch in the catch block both return before this
  // point, so a repeated/duplicate registration attempt can never re-send it.
  // Email failure must never fail the registration response — sendSeason2*
  // never throws, and the "already sent" check below is a defense-in-depth
  // guard against a future code path re-entering here.
  if (!attendee.season2EmailNotifications?.registrationSentAt) {
    const emailResult = await sendSeason2RegistrationReceivedEmail({
      attendeeId: String(attendee._id),
      email: attendee.email,
      fullName: attendee.fullName
    });

    if (emailResult.sent) {
      await Attendee.findByIdAndUpdate(attendee._id, {
        $set: { "season2EmailNotifications.registrationSentAt": new Date() }
      });
    }
  }

  res.status(201).json({
    success: true,
    message: "Incomer registered.",
    attendee: serializeSeason2Attendee(attendee)
  });
}

// The legacy (Season 1) guest/outcomer registration that used to live in this
// route — an unauthenticated upsert of Attendee documents — is retired: the
// Season 1 event data was intentionally cleared and Season 2 only registers
// Incomers. Anything that is not an Incomer now gets a stable 410 Gone.
//
// The IP ceiling runs BEFORE multipart parsing (it is the only identity known
// that early); per-phone and per-email limits run inside registerIncomer once
// the body is parsed and validated, and always before any Cloudinary upload or
// email.
router.post(
  "/register",
  limitRequest(registerPreParseRules, { message: REGISTER_MESSAGE }),
  uploadIncomerPhotoMiddleware,
  asyncHandler(async (req, res) => {
    const attendeeType = String(req.body.attendeeType || "incomer").trim().toLowerCase();

    if (attendeeType !== "incomer") {
      throw apiError("This registration is no longer available.", 410);
    }

    await registerIncomer(req, res);
  })
);

module.exports = router;
