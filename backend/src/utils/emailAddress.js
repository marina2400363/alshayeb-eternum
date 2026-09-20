// Practical email handling for customer data (Season 2 Incomer registration).
//
// Deliberately simple — this is a sanity check, not RFC 5322: one "@", a
// non-empty local part, and a dotted domain with no empty labels. The
// frontend (src/season2/features/onboarding/utils/email.js) mirrors this
// exactly so a customer is never told "valid" by one side and "invalid" by
// the other.
//
// Email is customer DATA only. It is never used for identity, lookup or
// duplicate detection (that stays phoneNormalized + attendeeType).

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// trim + lowercase — what gets stored.
function cleanEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = cleanEmail(value);
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

module.exports = {
  MAX_EMAIL_LENGTH,
  cleanEmail,
  isValidEmail
};
