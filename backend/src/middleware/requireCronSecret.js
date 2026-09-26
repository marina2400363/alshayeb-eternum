const crypto = require("crypto");

const apiError = require("../utils/apiError");

// Guards the public-by-URL sync triggers (GET /api/cron/sync-all and
// GET /api/rooms/force-sync). The secret is accepted ONLY as
//     Authorization: Bearer <CRON_SECRET>
// never as a query parameter (URLs end up in logs and referrers), and it is
// never logged. Fails closed when CRON_SECRET is unset or too short to be a
// real secret, so a misconfigured deployment can never leave the endpoints open.

const MIN_SECRET_LENGTH = 16;

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();

function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return next(apiError("This endpoint is not configured.", 503));
  }

  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);

  // Compare fixed-length digests in constant time.
  if (!match || !crypto.timingSafeEqual(digest(match[1].trim()), digest(secret))) {
    return next(apiError("Unauthorized.", 401));
  }

  return next();
}

module.exports = { requireCronSecret, MIN_SECRET_LENGTH };
