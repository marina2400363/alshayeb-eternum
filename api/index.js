const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config();

if (!process.env.MONGODB_URI) {
  require("dotenv").config({ path: path.join(__dirname, "..", "backend", ".env") });
}

const app = require("../backend/src/app");
const connectDb = require("../backend/src/config/db");

let dbPromise;

async function ensureDatabase() {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!dbPromise) {
    dbPromise = connectDb().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }

  await dbPromise;
}

module.exports = async function handler(req, res) {
  try {
    await ensureDatabase();

    if (req.url && !req.url.startsWith("/api")) {
      req.url = `/api${req.url.startsWith("/") ? "" : "/"}${req.url}`;
    }

    return app(req, res);
  } catch (error) {
    console.error("API bootstrap failed:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: false,
      message: "Backend API failed to start."
    }));
  }
};
