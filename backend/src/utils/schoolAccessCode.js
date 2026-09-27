const crypto = require("crypto");

// Unambiguous alphabet: no 0/O, 1/I/L — a code read aloud or copied by hand
// must never be misread.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

// Random School access code, e.g. "7KXQPMTZ".
function generateAccessCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

// Case-insensitive, whitespace-insensitive comparison: trim + uppercase.
function normalizeAccessCode(raw) {
  return String(raw || "").trim().toUpperCase();
}

// A custom code an Admin types in: letters/digits only, a sane length.
const ACCESS_CODE_PATTERN = /^[A-Z0-9]{4,32}$/;

// Shared between schoolAccessRoutes.js (issues the token after a valid code)
// and attendeeRoutes.js (the only consumer — registration trusts THIS token,
// never a customer-provided schoolId).
const SCHOOL_ACCESS_TOKEN_PURPOSE = "school-access";
const SCHOOL_ACCESS_TOKEN_TTL = "2h";

module.exports = {
  generateAccessCode,
  normalizeAccessCode,
  ACCESS_CODE_PATTERN,
  SCHOOL_ACCESS_TOKEN_PURPOSE,
  SCHOOL_ACCESS_TOKEN_TTL
};
