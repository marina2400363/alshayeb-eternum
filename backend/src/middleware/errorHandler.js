function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode || 500;
  console.error("BACKEND ERROR:", error);

  res.status(statusCode).json({
    success: false,
    message: error.message || "Something went wrong.",
    ...(error.details ? { details: error.details } : {}),
    ...(process.env.NODE_ENV === "development" ? { stack: error.stack } : {})
  });
}

module.exports = errorHandler;
