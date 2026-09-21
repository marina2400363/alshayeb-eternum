const mongoose = require("mongoose");

const Attendee = require("../models/Attendee");
const apiError = require("./apiError");
const { cleanPhone } = require("./phone");

// Same message and status for every ownership-mismatch reason (attendee not
// found, wrong attendeeType, phone doesn't match) so a caller can never learn
// which half of the {attendeeId, phone} pair was wrong. This is the ONLY
// access control on Sandra's customer-facing payment endpoints — there is no
// OTP/password/JWT for customers, so collapsing the failure modes here is
// what keeps attendeeId from being a bare, guessable bearer token.
const OWNERSHIP_ERROR_MESSAGE = "We couldn't verify this account. Check your details and try again.";
const OWNERSHIP_ERROR_STATUS = 404;

function requireValidObjectId(value, message) {
  const id = String(value || "").trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw apiError(message, 422);
  }
  return id;
}

function requireValidPhone(value) {
  const phone = cleanPhone(value);
  if (!phone) {
    throw apiError("A valid phone number is required.", 422);
  }
  return phone;
}

// Loads the Attendee for attendeeId and verifies it is an Incomer whose
// phoneNormalized matches the given (already-normalized) phone. Throws the
// same generic, customer-safe error for every mismatch reason.
async function resolveOwnedIncomer(attendeeId, phone) {
  const attendee = await Attendee.findById(attendeeId);

  if (!attendee || attendee.attendeeType !== "incomer" || attendee.phoneNormalized !== phone) {
    throw apiError(OWNERSHIP_ERROR_MESSAGE, OWNERSHIP_ERROR_STATUS);
  }

  return attendee;
}

module.exports = {
  OWNERSHIP_ERROR_MESSAGE,
  OWNERSHIP_ERROR_STATUS,
  requireValidObjectId,
  requireValidPhone,
  resolveOwnedIncomer
};
