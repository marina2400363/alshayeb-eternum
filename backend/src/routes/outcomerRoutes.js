const express = require("express");

const Attendee = require("../models/Attendee");
const Event = require("../models/Event");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { cleanPhone, isEgyptianPhone } = require("../utils/phone");
const { serializeAttendee } = require("../utils/serializers");

const router = express.Router();

function validateRegistration(body) {
  const errors = {};
  const fullName = String(body.fullName || body.name || "").trim();
  const phone = cleanPhone(body.phone);
  const email = String(body.email || "").trim();
  const university = String(body.university || body.school || "").trim();
  const age = String(body.age || "").trim();
  const instagram = String(body.instagram || "").trim();

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

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!university) {
    errors.university = "University / School is required.";
  }

  if (!age) {
    errors.age = "Age is required.";
  } else if (!/^\d+$/.test(age) || Number(age) < 15 || Number(age) > 40) {
    errors.age = "Age must be a number between 15 and 40.";
  }

  if (instagram && /\s/.test(instagram)) {
    errors.instagram = "Instagram cannot contain spaces.";
  }

  return {
    errors,
    values: {
      fullName,
      phone,
      email,
      university,
      age: Number(age),
      instagram
    }
  };
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { errors, values } = validateRegistration(req.body);

    if (Object.keys(errors).length > 0) {
      const error = apiError("Registration validation failed.", 422);
      error.details = errors;
      throw error;
    }

    let event = null;
    if (req.body.eventId) {
      event = await Event.findById(req.body.eventId);
      if (!event) {
        throw apiError("Selected event was not found.", 404);
      }
    }

    const attendee = await Attendee.create({
      ...values,
      notes: req.body.notes,
      event: event?._id,
      eventName: event?.name || req.body.eventName,
      attendeeType: "outcomer",
      accessType: "OUTCOMER",
      status: "pending",
      paymentStatus: "pending"
    });

    res.status(201).json({
      success: true,
      message: "Outcomer request submitted for review.",
      attendee: serializeAttendee(attendee)
    });
  })
);

router.post(
  "/payment-proof",
  asyncHandler(async (req, res) => {
    const { attendeeId, fileName, fileType, placeholderUrl } = req.body;

    if (!attendeeId) {
      throw apiError("attendeeId is required.");
    }

    if (!fileName) {
      throw apiError("Payment proof file name is required.");
    }

    const attendee = await Attendee.findByIdAndUpdate(
      attendeeId,
      {
        paymentStatus: "under_verification",
        paymentProof: {
          fileName,
          fileType,
          placeholderUrl,
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
