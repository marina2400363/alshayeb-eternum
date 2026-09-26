const express = require("express");
const mongoose = require("mongoose");

const School = require("../models/School");
const SchoolFinanceConfig = require("../models/SchoolFinanceConfig");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { syncSchoolFinanceSheet } = require("../services/googleSheetsSchoolFinanceSync");
const { syncFullPaymentFromSchoolSheet } = require("../services/googleSheetsFullPaymentSync");
const { parseSpreadsheetId } = require("../utils/googleSheetUrl");

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

// Assign/update the Google Sheet, tabName and enabled flag for a School's
// finance sheet mapping. Upserts so the first call creates the config. Does
// not touch School.js — schoolId only references it.
//
// Admin may paste the FULL Google Sheets URL or the bare spreadsheet id
// (either as googleSheetUrl or googleSheetId): the server normalizes it to
// the canonical id and refuses anything else with a 422. The link is never
// fetched here — access is proven by running a sync.
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

    const rawSheet = req.body.googleSheetUrl !== undefined ? req.body.googleSheetUrl : req.body.googleSheetId;
    if (rawSheet !== undefined) {
      // An explicitly empty value clears the mapping (School not configured).
      update.googleSheetId = String(rawSheet).trim() === "" ? "" : parseSpreadsheetId(rawSheet);
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

// Manual RECOVERY trigger (Mongo -> Sheet). The sheet is also refreshed
// automatically after registrations, approvals and School price/name changes
// (services/financeAutoSync.js) and reconciled by the scheduled cron; this
// button stays for admin recovery. Delegates entirely to the existing sync
// service; all sync logic (row construction, idempotent matching, Full Payment
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

// Manual BACKUP trigger. The accountant's "Full Payment" column (I) is read
// back into MongoDB automatically by the scheduled cron on every cycle
// (services/financeAutoSync.js); this button is only for recovery. Delegates
// entirely to the read-back service; no matching/normalization/ownership logic
// lives here.
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
