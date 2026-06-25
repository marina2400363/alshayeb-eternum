function errorHandler(error, req, res, next) {
  let statusCode = error.statusCode || 500;
  let isCustomError = !!error.statusCode;
  let message = error.message;

  if (error.name === "CastError") {
    statusCode = 400;
    isCustomError = true;
    message = "Invalid ID format.";
  } else if (error.name === "ValidationError") {
    statusCode = 400;
    isCustomError = true;
    message = "Validation failed.";
  }

  console.error("BACKEND ERROR:", error);

  const isDev = process.env.NODE_ENV === "development";
  const safeMessage = isCustomError ? message : "An internal server error occurred.";

  res.status(statusCode).json({
    success: false,
    message: isDev ? (message || "Something went wrong.") : safeMessage,
    ...(error.details ? { details: error.details } : {}),
    ...(isDev ? { stack: error.stack } : {})
  });
}

module.exports = errorHandler;
