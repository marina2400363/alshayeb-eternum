const jwt = require("jsonwebtoken");
const apiError = require("../utils/apiError");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set.");
  }
  return secret;
}

/**
 * Express middleware that enforces admin authentication.
 * Reads the Bearer token from the Authorization header,
 * verifies it against JWT_SECRET, and attaches the decoded
 * payload to req.admin.
 */
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(apiError("Admin authentication required.", 401));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.admin = payload;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(apiError("Admin session has expired. Please log in again.", 401));
    }
    return next(apiError("Invalid admin token.", 401));
  }
}

module.exports = { requireAdmin, getJwtSecret };
