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
const settingsRoutes = require("./routes/settingsRoutes");
const syncRoutes = require("./routes/syncRoutes");
const errorHandler = require("./middleware/errorHandler");
const notFound = require("./middleware/notFound");

const app = express();

const defaultClientOrigins = [
  "https://www.alshayebexperience.com",
  "https://alshayebexperience.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3005",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3005"
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

app.get("/api/export-debug", async (req, res) => {
  try {
    const isConfigured = Boolean(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
    if (!isConfigured) {
      return res.json({ success: false, error: "Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY in Vercel." });
    }
    
    const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
    const { google } = require("googleapis");
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    
    await auth.authorize();
    res.json({ success: true, message: "Google Authentication is fully working!" });
  } catch (err) {
    res.json({ success: false, error: err.message, stack: err.stack });
  }
});

app.use("/api/settings", settingsRoutes);
app.use("/api", syncRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
