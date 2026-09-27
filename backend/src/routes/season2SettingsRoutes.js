const express = require("express");

const Season2Settings = require("../models/Season2Settings");
const asyncHandler = require("../middleware/asyncHandler");

// Public, read-only. Exposes ONLY the three manually-set display counters —
// never the admin document itself, never any other Season 2 settings field.
const router = express.Router();

router.get(
  "/status-counter",
  asyncHandler(async (req, res) => {
    const settings = await Season2Settings.findOne({ key: "default" }).select("statusCounter");
    const counter = (settings && settings.statusCounter) || {};

    res.json({
      success: true,
      accepted: counter.accepted || 0,
      rejected: counter.rejected || 0,
      pending: counter.pending || 0
    });
  })
);

module.exports = router;
