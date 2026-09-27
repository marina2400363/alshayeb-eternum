const express = require("express");

const Season2Settings = require("../models/Season2Settings");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");

// Season 2-only admin settings. Mounted (in app.js) behind requireAdmin —
// never public. Separate from the legacy /api/admin/settings (SiteSettings)
// endpoint on purpose: this never touches Rooms/Season 1 data.
const router = express.Router();

function serializeStatusCounter(doc) {
  const counter = (doc && doc.statusCounter) || {};
  return {
    accepted: counter.accepted || 0,
    rejected: counter.rejected || 0,
    pending: counter.pending || 0
  };
}

async function getOrCreateSettings() {
  const settings = await Season2Settings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return settings;
}

// A manually-typed non-negative integer only — never derived from any
// Deposit/Attendee/FullPaymentStatus record.
function parseCount(value, field) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw apiError(`${field} must be a non-negative integer.`, 422);
  }
  return value;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const settings = await getOrCreateSettings();
    res.json({ success: true, statusCounter: serializeStatusCounter(settings) });
  })
);

// Saves the Accepted/Rejected/Pending display counter as one unit (the admin
// UI has a single Save button for all three fields).
router.put(
  "/status-counter",
  asyncHandler(async (req, res) => {
    const { accepted, rejected, pending } = req.body || {};

    const statusCounter = {
      accepted: parseCount(accepted, "accepted"),
      rejected: parseCount(rejected, "rejected"),
      pending: parseCount(pending, "pending")
    };

    const settings = await Season2Settings.findOneAndUpdate(
      { key: "default" },
      { $set: { statusCounter }, $setOnInsert: { key: "default" } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, statusCounter: serializeStatusCounter(settings) });
  })
);

module.exports = router;
