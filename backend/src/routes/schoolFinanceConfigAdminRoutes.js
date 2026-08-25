const express = require("express");
const mongoose = require("mongoose");

const School = require("../models/School");
const SchoolFinanceConfig = require("../models/SchoolFinanceConfig");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { syncSchoolFinanceSheet } = require("../services/googleSheetsSchoolFinanceSync");
const { syncFullPaymentFromSchoolSheet } = require("../services/googleSheetsFullPaymentSync");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const configs = await SchoolFinanceConfig.find({})
      .populate("schoolId", "name")
      .sort({ createdAt: 1 });

    res.json({ success: true, configs });
  })
);

router.get(
  "/:schoolId",
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      throw apiError("A valid schoolId is required.", 422);
    }

    const config = await SchoolFinanceConfig.findOne({ schoolId }).populate("schoolId", "name");
    if (!config) {
      throw apiError("No finance config found for this school.", 404);
    }

    res.json({ success: true, config });
  })
);

// Assign/update googleSheetId, tabName, and enabled for a School's finance
// sheet mapping. Upserts so the first call creates the config. Does not
// touch School.js — schoolId only references it.
router.put(
  "/:schoolId",
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      throw apiError("A valid schoolId is required.", 422);
    }

    const school = await School.findById(schoolId);
    if (!school) {
      throw apiError("School not found.", 422);
    }

    const update = {};

    if (req.body.googleSheetId !== undefined) {
      update.googleSheetId = String(req.body.googleSheetId).trim();
    }

    if (req.body.tabName !== undefined) {
      const tabName = String(req.body.tabName).trim();
      update.tabName = tabName || "Sheet1";
    }

    if (req.body.enabled !== undefined) {
      update.enabled = Boolean(req.body.enabled);
    }

    const config = await SchoolFinanceConfig.findOneAndUpdate(
      { schoolId },
      { $set: update, $setOnInsert: { schoolId } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, config });
  })
);

// Manual trigger only — no cron, no automatic hook from Deposit creation or
// approval/rejection. Delegates entirely to the existing sync service; all
// sync logic (row construction, idempotent matching, Full Payment
// preservation, etc.) lives there, not here.
router.post(
  "/:schoolId/sync",
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      throw apiError("A valid schoolId is required.", 422);
    }

    const config = await SchoolFinanceConfig.findOne({ schoolId });
    if (!config) {
      throw apiError("No finance config found for this school.", 404);
    }

    const result = await syncSchoolFinanceSheet(schoolId);
    res.json(result);
  })
);

// Manual trigger only — no cron, no automatic hook. Reads the accountant's
// manual "Full Payment" column back into MongoDB. Delegates entirely to the
// read-back service; no matching/normalization/ownership logic lives here.
router.post(
  "/:schoolId/sync-full-payment",
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      throw apiError("A valid schoolId is required.", 422);
    }

    const config = await SchoolFinanceConfig.findOne({ schoolId });
    if (!config) {
      throw apiError("No finance config found for this school.", 404);
    }

    const result = await syncFullPaymentFromSchoolSheet(schoolId);
    res.json(result);
  })
);

module.exports = router;
