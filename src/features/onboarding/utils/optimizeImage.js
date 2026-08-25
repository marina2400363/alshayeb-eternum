// Browser-side image compression, extracted from the existing pattern used
// for payment-screenshot uploads (src/App.js, handleScreenshotUpload).
// Same canvas-based resize/compress approach, no new dependency.
//
// Tuned for a personal profile photo rather than a screenshot: larger max
// dimension and higher JPEG quality so the customer stays identifiable.
const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_QUALITY = 0.8;

function optimizeImage(file, options = {}) {
  const maxDimension = options.maxDimension || DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image compression failed"))),
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image load failed"));
    };

    img.src = objectUrl;
  });
}

// Returns a File ready for upload. Falls back to the original file if
// compression fails for any reason, so the customer is never blocked.
export async function optimizeImageFile(file, options = {}) {
  try {
    const blob = await optimizeImage(file, options);
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file;
  }
}
