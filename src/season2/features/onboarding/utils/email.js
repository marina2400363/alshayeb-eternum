// Practical email handling for the registration flow. Mirrors
// backend/src/utils/emailAddress.js exactly, so the customer is never told
// "valid" here and "invalid" by the server (the backend stays the authority).
//
// Deliberately simple — one "@", a non-empty local part, a dotted domain with
// no empty labels. Not RFC 5322.
//
// Email is customer DATA only. It is never used to log in, look anyone up or
// detect duplicates: identity is the phone number (phoneNormalized + incomer).

export const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// trim + lowercase — what is sent and stored.
export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}
