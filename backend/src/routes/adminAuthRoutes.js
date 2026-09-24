const express = require("express");
const jwt = require("jsonwebtoken");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { getJwtSecret } = require("../middleware/requireAdmin");
const { guardFailures, recordFailure } = require("../middleware/rateLimit");
const { adminLoginFailureRules, adminLoginMessage } = require("../config/rateLimits");

const router = express.Router();

// Token validity: 8 hours — enough for a full event day.
const TOKEN_EXPIRY = "8h";

// Brute-force guard for the single admin credential. Counts FAILED logins only
// (per IP and globally); if the limiter store is unavailable it FAILS CLOSED
// (503) — the one place in the app where that is the right trade.
const loginFailureGuard = guardFailures(adminLoginFailureRules, {
  failClosed: true,
  message: adminLoginMessage
});

router.post(
  "/login",
  loginFailureGuard,
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      throw apiError("Email and password are required.", 400);
    }

    const configuredEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const configuredPassword = String(process.env.ADMIN_PASSWORD || "");

    if (!configuredEmail || !configuredPassword) {
      // Missing env config — fail safely without leaking why
      throw apiError("Admin authentication is not configured.", 503);
    }

    if (email !== configuredEmail || password !== configuredPassword) {
      await recordFailure(adminLoginFailureRules(req));
      throw apiError("Invalid admin email or password.", 401);
    }

    const payload = { email, role: "admin" };
    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });

    res.json({
      success: true,
      token,
      expiresIn: TOKEN_EXPIRY
    });
  })
);

module.exports = router;
