import { optimizeProofImage } from "./proofImage";

// Payment-proof rules. The backend accepts PNG/JPG/JPEG up to 4MB (see
// backend/src/routes/depositRoutes.js), but the serverless request-body
// ceiling is lower than that, so the *optimized* proof is held to a safer
// target — mirrors the shape of Marina's onboarding/utils/photo.js.
export const ACCEPTED_PROOF_TYPES = ["image/png", "image/jpeg", "image/jpg"];
export const ACCEPTED_PROOF_EXTENSIONS = [".png", ".jpg", ".jpeg"];
export const PROOF_ACCEPT_ATTRIBUTE = "image/png,image/jpeg";

export const MAX_RAW_PROOF_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_PROOF_BYTES = 4 * 1024 * 1024;

// Proof screenshots are mostly flat UI (text + solid color blocks), so the
// first attempt at a larger, higher-quality target almost always clears the
// ceiling — the smaller fallbacks exist for the rare huge raw screenshot.
export const COMPRESSION_ATTEMPTS = [
  { maxDimension: 1600, quality: 0.85 },
  { maxDimension: 1280, quality: 0.75 },
  { maxDimension: 1000, quality: 0.65 }
];

export const PROOF_ERRORS = {
  unsupported: "Please choose a JPG or PNG screenshot.",
  tooLarge: "That image is too large. Please choose one under 15MB.",
  unreadable: "We couldn't read that image. Please choose another one.",
  stillTooLarge: "We couldn't shrink that image enough. Please choose another one."
};

// Returns an error string, or "" when the file may be processed.
export function validateProofFile(file) {
  if (!file) return "Add your payment proof to continue.";

  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  const hasAllowedExtension = ACCEPTED_PROOF_EXTENSIONS.some((ext) => name.endsWith(ext));

  // Some pickers report no MIME type; fall back to the extension only then.
  const typeAllowed = type ? ACCEPTED_PROOF_TYPES.includes(type) : hasAllowedExtension;

  if (!typeAllowed) return PROOF_ERRORS.unsupported;
  if (file.size > MAX_RAW_PROOF_BYTES) return PROOF_ERRORS.tooLarge;
  return "";
}

// Resolves { file } on success or { error } on failure — never throws, so the
// UI can always let the customer pick another screenshot.
export async function processProof(file, { attempts = COMPRESSION_ATTEMPTS, compress = optimizeProofImage } = {}) {
  const invalid = validateProofFile(file);
  if (invalid) return { error: invalid };

  let lastBlob = null;

  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      lastBlob = await compress(file, attempt);
    } catch {
      return { error: PROOF_ERRORS.unreadable };
    }

    if (lastBlob.size <= MAX_UPLOAD_PROOF_BYTES) {
      const jpegName = String(file.name || "payment-proof").replace(/\.[^.]+$/, "") + ".jpg";
      return { file: new File([lastBlob], jpegName, { type: "image/jpeg" }) };
    }
  }

  return { error: PROOF_ERRORS.stillTooLarge };
}
