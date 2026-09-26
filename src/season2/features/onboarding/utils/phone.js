// Client mirror of backend/src/utils/phone.js (cleanPhone / isEgyptianPhone).
// The backend is the authority — this exists so the customer gets an instant,
// friendly answer and so we always send the same normalized form the backend
// stores in phoneNormalized.

// Egyptian keyboards commonly type Arabic-Indic (٠-٩) or Persian (۰-۹)
// digits. The backend strips every non-ASCII digit, which would silently turn
// such input into an empty phone — so convert them first.
function toAsciiDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizePhone(value) {
  let cleaned = toAsciiDigits(value).replace(/\D/g, "");

  if (cleaned.startsWith("20") && cleaned.length >= 12) {
    cleaned = `0${cleaned.slice(2)}`;
  } else if (cleaned.startsWith("1") && cleaned.length === 10) {
    cleaned = `0${cleaned}`;
  }

  return cleaned;
}

export function isEgyptianPhone(value) {
  return /^01[0-9]{9}$/.test(normalizePhone(value));
}

// Live input filter: keep only what a phone field should ever contain, so
// pasted text like "+20 101 234 5678" or "(010) 1234-5678" stays readable.
export function sanitizePhoneInput(value) {
  return toAsciiDigits(value).replace(/[^\d+\s-]/g, "").slice(0, 20);
}

// 01012345678 → 010 1234 5678 (display only; never sent to the API).
export function formatPhoneDisplay(value) {
  const digits = normalizePhone(value);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
}

// 01012345678 → 010 •••• 5678 — for showing an identity without exposing the
// full number on screen.
export function maskPhone(value) {
  const digits = normalizePhone(value);
  if (digits.length !== 11) return "";
  return `${digits.slice(0, 3)} •••• ${digits.slice(7)}`;
}
