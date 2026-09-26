const { rule, recordFailure } = require("../middleware/rateLimit");
const { getClientIpKey } = require("../utils/clientIp");
const { cleanPhone, isEgyptianPhone } = require("../utils/phone");
const { resolveOwnedIncomer, OWNERSHIP_ERROR_MESSAGE, OWNERSHIP_ERROR_STATUS } = require("../utils/customerOwnership");

// Every rate limit in one place. Windows are in seconds.
//
// Shared mobile carrier IPs are common in Egypt, so IDENTITY keys (phone,
// attendeeId, email) are the primary limits and the per-IP rules are only broad
// flood ceilings sized for many real users behind one address. The only tight
// IP rules count FAILURES (wrong admin password, wrong attendeeId+phone pair),
// which legitimate users almost never produce.

const MINUTE = 60;
const HOUR = 60 * MINUTE;

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const ipIdentity = (req) => getClientIpKey(req);

function attendeeIdentity(value) {
  const id = String(value || "").trim().toLowerCase();
  return OBJECT_ID_PATTERN.test(id) ? id : null;
}

function phoneIdentity(value) {
  const phone = cleanPhone(value);
  return phone && isEgyptianPhone(phone) ? phone : null;
}

const LIMITS = {
  adminLoginFailuresPerIp: { limit: 5, windowSec: 15 * MINUTE },
  adminLoginFailuresGlobal: { limit: 30, windowSec: 15 * MINUTE },

  lookupPerPhone: { limit: 15, windowSec: 10 * MINUTE },
  lookupIpCeiling: { limit: 300, windowSec: 10 * MINUTE },

  registerIpCeiling: { limit: 300, windowSec: HOUR },
  registerPerPhone: { limit: 6, windowSec: HOUR },
  registerPerEmail: { limit: 3, windowSec: 24 * HOUR },

  summaryPerAttendee: { limit: 60, windowSec: 5 * MINUTE },
  summaryIpCeiling: { limit: 600, windowSec: 10 * MINUTE },
  optionsPerAttendee: { limit: 60, windowSec: 5 * MINUTE },
  optionsIpCeiling: { limit: 600, windowSec: 10 * MINUTE },
  acknowledgePerAttendee: { limit: 20, windowSec: 10 * MINUTE },

  // Shared by summary, options, acknowledge and deposit submission.
  ownershipFailuresPerIp: { limit: 20, windowSec: 10 * MINUTE },

  depositIpCeiling: { limit: 200, windowSec: HOUR },
  depositPerAttendee: { limit: 5, windowSec: HOUR }
};

const make = (bucket, key, identity) => rule(bucket, LIMITS[key].limit, LIMITS[key].windowSec, identity);

// --- Admin login (fail closed; counts FAILED logins only) ------------------
// Unknown IP still gets a bucket here (unlike customer routes) so a missing
// header can never disable the brute-force guard.
const adminLoginFailureRules = (req) => [
  make("admin-login-fail-ip", "adminLoginFailuresPerIp", ipIdentity(req) || "unknown"),
  make("admin-login-fail-global", "adminLoginFailuresGlobal", "all")
];

const adminLoginMessage = (retryAfterSec) =>
  `Too many login attempts. Try again in ${Math.max(1, Math.ceil(retryAfterSec / 60))} minutes.`;

// --- Season 2 lookup -------------------------------------------------------
const lookupRules = (req) => [
  make("lookup-ip", "lookupIpCeiling", ipIdentity(req)),
  make("lookup-phone", "lookupPerPhone", phoneIdentity(req.query && req.query.phone))
];

// --- Season 2 registration -------------------------------------------------
const registerPreParseRules = (req) => [make("register-ip", "registerIpCeiling", ipIdentity(req))];
const registerPhoneRules = (phone) => [make("register-phone", "registerPerPhone", phone)];
const registerEmailRules = (email) => [make("register-email", "registerPerEmail", email)];
const REGISTER_MESSAGE = "Too many registration attempts. Please try again later.";

// --- Customer payment endpoints -------------------------------------------
const summaryRules = (req) => [
  make("summary-ip", "summaryIpCeiling", ipIdentity(req)),
  make("summary-attendee", "summaryPerAttendee", attendeeIdentity(req.body && req.body.attendeeId))
];
const optionsRules = (req) => [
  make("options-ip", "optionsIpCeiling", ipIdentity(req)),
  make("options-attendee", "optionsPerAttendee", attendeeIdentity(req.body && req.body.attendeeId))
];
const acknowledgeRules = (req) => [
  make("ack-attendee", "acknowledgePerAttendee", attendeeIdentity(req.body && req.body.attendeeId))
];
const ownershipFailureRules = (req) => [make("ownership-fail-ip", "ownershipFailuresPerIp", ipIdentity(req))];

// --- Deposit submission ----------------------------------------------------
const depositPreParseRules = (req) => [make("deposit-ip", "depositIpCeiling", ipIdentity(req))];
const depositAttendeeRules = (attendeeId) => [make("deposit-attendee", "depositPerAttendee", attendeeIdentity(attendeeId))];

// resolveOwnedIncomer, but a genuine ownership mismatch also counts toward the
// caller IP's shared failure bucket (validation errors do not).
async function resolveOwnedIncomerCounted(req, attendeeId, phone) {
  try {
    return await resolveOwnedIncomer(attendeeId, phone);
  } catch (error) {
    if (error && error.statusCode === OWNERSHIP_ERROR_STATUS && error.message === OWNERSHIP_ERROR_MESSAGE) {
      await recordFailure(ownershipFailureRules(req));
    }
    throw error;
  }
}

module.exports = {
  LIMITS,
  adminLoginFailureRules,
  adminLoginMessage,
  lookupRules,
  registerPreParseRules,
  registerPhoneRules,
  registerEmailRules,
  REGISTER_MESSAGE,
  summaryRules,
  optionsRules,
  acknowledgeRules,
  ownershipFailureRules,
  depositPreParseRules,
  depositAttendeeRules,
  resolveOwnedIncomerCounted
};
