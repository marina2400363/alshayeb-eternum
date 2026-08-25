const express = require("express");

const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// Public: list schools for the Incomer registration dropdown.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const schools = await School.find({}).sort({ name: 1 });
    res.json({ success: true, schools });
  })
);

module.exports = router;
