const { v2: cloudinary } = require("cloudinary");

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function configureCloudinary() {
  if (!isCloudinaryConfigured()) {
    return false;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  return true;
}

function uploadPaymentProof(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  if (!configureCloudinary()) {
    const error = new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
    error.statusCode = 503;
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "alshayeb/payment-proofs",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        width: 1200,
        crop: "limit",
        quality: "70",
        fetch_format: "auto"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

function uploadOutcomerPhoto(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  if (!configureCloudinary()) {
    const error = new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
    error.statusCode = 503;
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "alshayeb/outcomer-photos",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        width: 1200,
        crop: "limit",
        quality: "70",
        fetch_format: "auto"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

function uploadIncomerPhoto(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  if (!configureCloudinary()) {
    const error = new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
    error.statusCode = 503;
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "alshayeb/incomer-photos",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        width: 1200,
        crop: "limit",
        quality: "80",
        fetch_format: "auto"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

// Cleanup helper: removes an Incomer photo asset that was uploaded but never
// ended up attached to a saved Attendee document (e.g. a duplicate-registration
// race condition, or the create() call failing after the upload succeeded).
function deleteIncomerPhoto(publicId) {
  if (!publicId || !configureCloudinary()) {
    return Promise.resolve(null);
  }

  return cloudinary.uploader.destroy(publicId).catch((error) => {
    console.error("Failed to delete orphaned incomer photo:", publicId, error.message);
    return null;
  });
}

function uploadIncomerDepositProof(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  if (!configureCloudinary()) {
    const error = new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
    error.statusCode = 503;
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "alshayeb/incomer-deposit-proofs",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        width: 1200,
        crop: "limit",
        quality: "80",
        fetch_format: "auto"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

// Cleanup helper: removes an Incomer deposit-proof asset that was uploaded
// but never ended up attached to a saved Deposit document (e.g. all 5 active
// slots became occupied by a concurrent request, or Deposit.create() failed
// after the upload succeeded).
function deleteIncomerDepositProof(publicId) {
  if (!publicId || !configureCloudinary()) {
    return Promise.resolve(null);
  }

  return cloudinary.uploader.destroy(publicId).catch((error) => {
    console.error("Failed to delete orphaned incomer deposit proof:", publicId, error.message);
    return null;
  });
}

function uploadEventBanner(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  if (!configureCloudinary()) {
    const error = new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
    error.statusCode = 503;
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "alshayeb/event-banners",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        width: 1200,
        crop: "limit",
        quality: "80",
        fetch_format: "auto"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

function uploadRoomPaymentProof(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  if (!configureCloudinary()) {
    const error = new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
    error.statusCode = 503;
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "alshayeb/rooms-payment-proofs",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        width: 1200,
        crop: "limit",
        quality: "80",
        fetch_format: "auto"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

// ---------------------------------------------------------------------------
// Season 2 event thumbnails (Admin Events Management). Own folder, never shared
// with customer photos/proofs or the Season 1 banners above.
// ---------------------------------------------------------------------------
const SEASON2_EVENT_THUMBNAIL_FOLDER = "alshayeb/season2-event-thumbnails";

function uploadSeason2EventThumbnail(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  if (!configureCloudinary()) {
    const error = new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
    error.statusCode = 503;
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: SEASON2_EVENT_THUMBNAIL_FOLDER,
        resource_type: "image",
        unique_filename: true,
        overwrite: false,
        width: 1200,
        crop: "limit",
        quality: "80",
        fetch_format: "auto"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

// Only ever removes an asset inside the Season 2 event-thumbnail folder, so a
// bad/forged publicId can never delete a customer photo, proof or banner.
function deleteSeason2EventThumbnail(publicId) {
  if (
    !publicId ||
    typeof publicId !== "string" ||
    !publicId.startsWith(`${SEASON2_EVENT_THUMBNAIL_FOLDER}/`) ||
    publicId.includes("..") ||
    !configureCloudinary()
  ) {
    return Promise.resolve(null);
  }

  return cloudinary.uploader.destroy(publicId).catch((error) => {
    console.error("Failed to delete replaced Season 2 event thumbnail:", publicId, error.message);
    return null;
  });
}

module.exports = {
  uploadPaymentProof,
  uploadOutcomerPhoto,
  uploadIncomerPhoto,
  deleteIncomerPhoto,
  uploadIncomerDepositProof,
  deleteIncomerDepositProof,
  uploadEventBanner,
  uploadRoomPaymentProof,
  uploadSeason2EventThumbnail,
  deleteSeason2EventThumbnail,
  SEASON2_EVENT_THUMBNAIL_FOLDER
};
