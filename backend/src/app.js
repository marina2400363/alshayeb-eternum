const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const adminRoutes = require("./routes/adminRoutes");
const attendeeRoutes = require("./routes/attendeeRoutes");
const eventRoutes = require("./routes/eventRoutes");
const exportRoutes = require("./routes/exportRoutes");
const outcomerRoutes = require("./routes/outcomerRoutes");
const scannerRoutes = require("./routes/scannerRoutes");
const errorHandler = require("./middleware/errorHandler");
const notFound = require("./middleware/notFound");

const app = express();

const defaultClientOrigins = [
  "https://www.alshayebexperience.com",
  "https://alshayebexperience.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001"
];

const allowedOrigins = String(process.env.CLIENT_ORIGIN || defaultClientOrigins.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isVercelPreviewOrigin = (origin) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin || "");

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || isVercelPreviewOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ALSHAYEB ETERNUM API",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/admin", adminRoutes);
app.use("/api/attendees", attendeeRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/outcomers", outcomerRoutes);
app.use("/api/scanner", scannerRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
