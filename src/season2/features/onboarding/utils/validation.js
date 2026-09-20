import { isEgyptianPhone, normalizePhone } from "./phone";
import { isValidEmail, normalizeEmail } from "./email";

// Each validator returns an error string, or "" when the value is valid.
// Rules mirror the backend (attendeeRoutes.js registerIncomer / lookup); the
// backend stays the authority and its messages are still surfaced if it
// disagrees.

export const PHONE_REQUIRED = "Enter your mobile number.";
export const PHONE_INVALID = "Enter an Egyptian mobile number, like 010 1234 5678.";

export function validatePhone(value) {
  if (!normalizePhone(value)) return PHONE_REQUIRED;
  if (!isEgyptianPhone(value)) return PHONE_INVALID;
  return "";
}

export const EMAIL_REQUIRED = "Enter your email address.";
export const EMAIL_INVALID = "Enter a valid email address, like name@example.com.";

export function validateEmail(value) {
  if (!normalizeEmail(value)) return EMAIL_REQUIRED;
  if (!isValidEmail(value)) return EMAIL_INVALID;
  return "";
}

const FULL_NAME_MIN = 2;
// Mirrors FULL_NAME_MAX_LENGTH in backend/src/routes/attendeeRoutes.js
// (registerIncomer) — the server enforces the same limit.
export const FULL_NAME_MAX = 80;

export function validateFullName(value) {
  const trimmed = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "Enter your full name.";
  if (trimmed.length < FULL_NAME_MIN) return "Enter your full name.";
  if (trimmed.length > FULL_NAME_MAX) return `Keep your name under ${FULL_NAME_MAX} characters.`;
  return "";
}

export function cleanFullName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function validateSchool(schoolId, schools) {
  if (!schoolId) return "Choose your school.";
  if (!schools.some((school) => school.id === schoolId)) return "Choose your school from the list.";
  return "";
}
