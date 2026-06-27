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

module.exports = {
  uploadPaymentProof,
  uploadOutcomerPhoto,
  uploadEventBanner,
  uploadRoomPaymentProof
};
