const express = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { requireCronSecret } = require("../middleware/requireCronSecret");
const { parseSpreadsheetId } = require("../utils/googleSheetUrl");
const { syncFullPaymentAfterSheetEdit } = require("../services/financeAutoSync");

// Endpoint for the Google Sheets INSTALLABLE on-edit trigger (see
// backend/apps-script/FullPaymentOnEdit.gs). When the accountant edits column I
// of a School's finance sheet, the sheet calls this and the existing Full
// Payment read-back runs immediately.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` only (header, never a query
// parameter), exactly like the cron endpoints — fails closed when the secret is
// unset. Nothing here is logged on success, the secret is never echoed, and the
// responses carry counts only: no customer id, name, email or sheet content.
const router = express.Router();

const MAX_SHEET_NAME_LENGTH = 100;

// POST /api/sheets/full-payment-edit
//   body: { spreadsheetId, sheetName }   — the minimum needed to find the School
//   200 { success:true, syncedCount, confirmedCount, unconfirmedCount, ... counts }
//   200 { success:true, ignored:true }   — an edit on some other tab
//   200 { success:false, skipped:true }  — School sync disabled / Google not configured
//   404                                  — no finance sheet matches this spreadsheet
//   422                                  — malformed body
//   503 + Retry-After                    — the School's lease stayed busy (retry)
//   502                                  — Google could not be read (retry)
router.post(
  "/full-payment-edit",
  requireCronSecret,
  asyncHandler(async (req, res) => {
    const spreadsheetId = parseSpreadsheetId(req.body && req.body.spreadsheetId);

    const sheetName = String((req.body && req.body.sheetName) || "").trim();
    if (!sheetName || sheetName.length > MAX_SHEET_NAME_LENGTH) {
      throw apiError("A valid sheetName is required.", 422);
    }

    const outcome = await syncFullPaymentAfterSheetEdit({ spreadsheetId, sheetName });

    if (outcome.status === "unknown-sheet") {
      throw apiError("No finance sheet matches this spreadsheet.", 404);
    }

    if (outcome.status === "ignored") {
      return res.json({ success: true, ignored: true });
    }

    if (outcome.status === "skipped") {
      return res.json({ success: false, skipped: true, reason: outcome.reason });
    }

    if (outcome.status === "busy") {
      res.set("Retry-After", "5");
      throw apiError("A sync is already running for this school. Retry shortly.", 503);
    }

    const { result } = outcome;

    if (result && result.skipped) {
      return res.json({ success: false, skipped: true, reason: result.reason });
    }

    if (!result || !result.success) {
      // The service's own message can describe Google/credential details: it is
      // deliberately not passed on, and nothing is logged here.
      throw apiError("The finance sheet could not be read.", 502);
    }

    return res.json({
      success: true,
      syncedCount: result.syncedCount,
      confirmedCount: result.confirmedCount,
      unconfirmedCount: result.unconfirmedCount,
      skippedUnknownCount: result.skippedUnknown.length,
      skippedWrongSchoolCount: result.skippedWrongSchool.length,
      duplicateCount: result.duplicateCustomerIds.length
    });
  })
);

module.exports = router;
