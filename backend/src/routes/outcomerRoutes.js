const express = require("express");
const multer = require("multer");

const Attendee = require("../models/Attendee");
const Event = require("../models/Event");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { cleanPhone, isEgyptianPhone } = require("../utils/phone");
const { serializeAttendee } = require("../utils/serializers");
const { sendStatusEmail } = require("../utils/email");
const { uploadPaymentProof, uploadOutcomerPhoto } = require("../utils/cloudinaryUpload");

const router = express.Router();
const allowedPaymentProofTypes = new Set(["image/png", "image/jpeg", "image/jpg"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter(req, file, callback) {
    if (!allowedPaymentProofTypes.has(file.mimetype)) {
      callback(apiError("Only PNG, JPG, or JPEG payment screenshots are allowed.", 422));
      return;
    }

    callback(null, true);
  }
});

function uploadPaymentProofMiddleware(req, res, next) {
  upload.single("paymentProof")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(apiError("Payment screenshot must be 5MB or smaller.", 422));
      return;
    }

    next(apiError("Payment screenshot upload failed: " + error.message, 400));
  });
}

function uploadOutcomerPhotoMiddleware(req, res, next) {
  upload.single("outcomerPhoto")(req, res, (error) => {
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

function validateRegistration(body) {
  const errors = {};
  const fullName = String(body.fullName || body.name || "").trim();
  const phone = cleanPhone(body.phoneNumber || body.phone);
  const email = String(body.email || "").trim();
  const university = String(body.schoolOrOriginProm || body.university || body.school || "").trim();
  const age = String(body.age || "").trim();
  const instagram = String(body.instagramUsername || body.instagram || "").trim();
  const gender = String(body.gender || "").trim().toLowerCase();

  if (!fullName) {
    errors.fullName = "Full name is required.";
  } else if (fullName.length < 3) {
    errors.fullName = "Full name must be at least 3 characters.";
  } else if (!/^[a-zA-Z\s]+$/.test(fullName)) {
    errors.fullName = "Full name can contain letters and spaces only.";
  }

  if (!phone) {
    errors.phone = "Phone number is required.";
  } else if (!isEgyptianPhone(phone)) {
    errors.phone = "Enter an Egyptian phone number starting with 01 and 11 digits long.";
  }

  if (!email) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!gender) {
    errors.gender = "Gender is required.";
  } else if (gender !== "male" && gender !== "female") {
    errors.gender = "Gender must be male or female.";
  }

  if (!university) {
    errors.schoolOrOriginProm = "School / Origin Prom is required.";
  }

  if (!age) {
    errors.age = "Age is required.";
  } else if (!/^\d+$/.test(age) || Number(age) < 15 || Number(age) > 40) {
    errors.age = "Age must be a number between 15 and 40.";
  }

  if (!instagram) {
    errors.instagramUsername = "Instagram username is required.";
  } else if (/\s/.test(instagram)) {
    errors.instagramUsername = "Instagram username cannot contain spaces.";
  }

  return {
    errors,
    values: {
      fullName,
      phone,
      email,
      gender,
      university,
      age: Number(age),
      instagram
    }
  };
}

router.post(
  "/register",
  uploadOutcomerPhotoMiddleware,
  asyncHandler(async (req, res) => {
    const { errors, values } = validateRegistration(req.body);

    if (Object.keys(errors).length > 0) {
      const error = apiError("Registration validation failed.", 422);
      error.details = errors;
      throw error;
    }

    let event = null;
    if (req.body.eventId) {
      const mongoose = require("mongoose");
      if (mongoose.Types.ObjectId.isValid(req.body.eventId)) {
        event = await Event.findById(req.body.eventId);
      }
      // If it's not a valid ObjectId, we safely ignore it and rely on eventName.
    }

    const existingAttendee = await Attendee.findOne({ 
      phoneNormalized: values.phone,
      event: event?._id
    }).sort({ createdAt: -1 });

    const handleDuplicate = (existing) => {
      const status = String(existing.status || "").toLowerCase();
      const nextAction = status === "approved"
        ? "ticket"
        : status === "rejected"
          ? "rejected"
          : "track";

      res.json({
        success: true,
        duplicate: true,
        nextAction,
        message: "Existing registration found.",
        attendee: serializeAttendee(existing)
      });
    };

    if (existingAttendee) {
      handleDuplicate(existingAttendee);
      return;
    }

    if (!req.file) {
      throw apiError("Personal photo is strictly required.", 422);
    }

    const uploadedPhoto = await uploadOutcomerPhoto(req.file);
    const outcomerPhoto = {
      url: uploadedPhoto.secure_url || uploadedPhoto.url,
      publicId: uploadedPhoto.public_id,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      uploadedAt: new Date()
    };

    let attendee;
    try {
      attendee = await Attendee.create({
        ...values,
        phoneNormalized: values.phone,
        event: event?._id,
        eventName: event?.name || req.body.eventName,
        attendeeType: "outcomer",
        accessType: "OUTCOMER",
        status: "pending",
        paymentStatus: (event && event.price > 0) ? "pending" : "not_required",
        outcomerPhoto,
        registrationReceivedAt: new Date()
      });
    } catch (err) {
      // Catch MongoDB unique index race-condition
      if (err.code === 11000) {
        const raceConditionExisting = await Attendee.findOne({ 
          phoneNormalized: values.phone,
          event: event?._id
        }).sort({ createdAt: -1 });
        
        if (raceConditionExisting) {
          handleDuplicate(raceConditionExisting);
          return;
        }
      }
      throw err;
    }

    // Send application submitted email non-blocking
    sendStatusEmail(
      attendee,
      "Your Application Has Been Received",
      "Your application has been successfully submitted.\nYour status is now under review.\nYou can track your application status anytime through the ALSHAYEB platform using your phone number.\nWe will notify you once a decision has been made."
    );

    // Save timestamp regardless of immediate success so we don't duplicate on retries
    attendee.emailNotifications = {
      ...attendee.emailNotifications,
      registrationReceivedAt: new Date()
    };
    await attendee.save();

    res.status(201).json({
      success: true,
      message: "Outcomer request submitted for review.",
      attendee: serializeAttendee(attendee)
    });
  })
);

router.post(
  "/payment-proof",
  uploadPaymentProofMiddleware,
  asyncHandler(async (req, res) => {
    const { attendeeId } = req.body;

    if (!attendeeId) {
      throw apiError("attendeeId is required.");
    }

    if (!req.file) {
      throw apiError("Payment proof screenshot is required.", 422);
    }

    const uploadedProof = await uploadPaymentProof(req.file);

    const attendee = await Attendee.findByIdAndUpdate(
      attendeeId,
      {
        paymentStatus: "under_verification",
        paymentProof: {
          url: uploadedProof.secure_url || uploadedProof.url,
          publicId: uploadedProof.public_id,
          fileName: req.file.originalname,
          fileType: req.file.mimetype,
          uploadedAt: new Date()
        }
      },
      { new: true }
    );

    if (!attendee) {
      throw apiError("Attendee was not found.", 404);
    }

    res.json({
      success: true,
      message: "Payment proof placeholder saved.",
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
