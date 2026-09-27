const express = require("express");
const jwt = require("jsonwebtoken");

const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { getJwtSecret } = require("../middleware/requireAdmin");
const { normalizeAccessCode, SCHOOL_ACCESS_TOKEN_PURPOSE, SCHOOL_ACCESS_TOKEN_TTL } = require("../utils/schoolAccessCode");
const { limitRequest, enforceLimits } = require("../middleware/rateLimit");
const { schoolAccessIpRules, schoolAccessCodeRules, SCHOOL_ACCESS_MESSAGE } = require("../config/rateLimits");

const router = express.Router();

// Public: resolve a School Access Code to a School, for the New Incomer
// registration flow. There is no public School list or search — this is the
// ONLY way the customer's browser ever learns a School's name, and only after
// a correct code. On success it hands back a short-lived, signed token that
// the registration endpoint (attendeeRoutes.js) trusts INSTEAD OF any
// customer-provided schoolId; the token is the sole way a registration can
// ever be associated with a School.
const INVALID_CODE_MESSAGE = "Invalid access code.";

function issueSchoolAccessToken(schoolId) {
  return jwt.sign({ schoolId: String(schoolId), purpose: SCHOOL_ACCESS_TOKEN_PURPOSE }, getJwtSecret(), {
    expiresIn: SCHOOL_ACCESS_TOKEN_TTL
  });
}

router.post(
  "/verify",
  limitRequest(schoolAccessIpRules),
  asyncHandler(async (req, res) => {
    const normalized = normalizeAccessCode(req.body.code);

    if (!normalized) {
      throw apiError(INVALID_CODE_MESSAGE, 422);
    }

    // Counts EVERY attempt against this code (right or wrong) — throttles
    // brute force against one code regardless of the outcome.
    await enforceLimits(schoolAccessCodeRules(normalized), { message: SCHOOL_ACCESS_MESSAGE });

    // A defensive equality check, not just findOne: the Access Code must
    // resolve to EXACTLY one School. A unique index keeps this from ever
    // happening in practice, but an ambiguous match is treated as invalid
    // rather than silently picking one.
    const matches = await School.find({ accessCode: normalized }).select("_id name");

    if (matches.length !== 1) {
      throw apiError(INVALID_CODE_MESSAGE, 422);
    }

    const school = matches[0];
    const schoolAccessToken = issueSchoolAccessToken(school._id);

    res.json({ success: true, schoolAccessToken, schoolName: school.name });
  })
);

module.exports = router;
