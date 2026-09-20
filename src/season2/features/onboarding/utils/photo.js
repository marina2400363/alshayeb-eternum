import { optimizeImage } from "./optimizeImage";

// Personal-photo rules. The backend accepts PNG/JPG/JPEG up to 5MB, but the
// serverless request-body ceiling is lower than that, so the *optimized*
// photo is held to a safer target. HEIC/HEIF are deliberately not accepted —
// no reliance on a browser or OS converting them.
export const ACCEPTED_PHOTO_TYPES = ["image/png", "image/jpeg", "image/jpg"];
export const ACCEPTED_PHOTO_EXTENSIONS = [".png", ".jpg", ".jpeg"];
export const PHOTO_ACCEPT_ATTRIBUTE = "image/png,image/jpeg";

export const MAX_RAW_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_PHOTO_BYTES = 3.5 * 1024 * 1024;

// Progressively smaller attempts until the result fits under the upload
// ceiling. The first attempt almost always succeeds for a phone photo.
export const COMPRESSION_ATTEMPTS = [
  { maxDimension: 1280, quality: 0.8 },
  { maxDimension: 1024, quality: 0.7 },
  { maxDimension: 800, quality: 0.6 }
];

export const PHOTO_ERRORS = {
  unsupported: "Please choose a JPG or PNG photo.",
  tooLarge: "That photo is too large. Please choose one under 15MB.",
  unreadable: "We couldn't read that image. Please choose another photo.",
  stillTooLarge: "We couldn't shrink that photo enough. Please choose another one."
};

// Returns an error string, or "" when the file may be processed.
export function validatePhotoFile(file) {
  if (!file) return "Add your photo to continue.";

  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  const hasAllowedExtension = ACCEPTED_PHOTO_EXTENSIONS.some((ext) => name.endsWith(ext));

  // Some pickers report no MIME type; fall back to the extension only then.
  const typeAllowed = type ? ACCEPTED_PHOTO_TYPES.includes(type) : hasAllowedExtension;

  if (!typeAllowed) return PHOTO_ERRORS.unsupported;
  if (file.size > MAX_RAW_PHOTO_BYTES) return PHOTO_ERRORS.tooLarge;
  return "";
}

// Resolves { file } on success or { error } on failure — never throws, so the
// UI can always let the customer pick another photo.
export async function processPhoto(file, { attempts = COMPRESSION_ATTEMPTS, compress = optimizeImage } = {}) {
  const invalid = validatePhotoFile(file);
  if (invalid) return { error: invalid };

  let lastBlob = null;

  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      lastBlob = await compress(file, attempt);
    } catch {
      return { error: PHOTO_ERRORS.unreadable };
    }

    if (lastBlob.size <= MAX_UPLOAD_PHOTO_BYTES) {
      const jpegName = String(file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
      return { file: new File([lastBlob], jpegName, { type: "image/jpeg" }) };
    }
  }

  return { error: PHOTO_ERRORS.stillTooLarge };
}
