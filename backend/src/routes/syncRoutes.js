const express = require("express");
const Event = require("../models/Event");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { syncEventIncomers } = require("../services/googleSheetsSync");
const { importGuestListSheet, previewGuestListSheet } = require("../services/googleSheetsGuestListSync");
const { syncEventExportSheet } = require("../services/googleSheetsExportSync");
const { syncRoomsGoogleSheet } = require("../services/googleSheetsRoomsSync");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CRON ENDPOINT — called by external cron every 5 minutes
// Syncs ALL 4 directions:
//   1. Incomers    (Sheet   → MongoDB)
//   2. Guest List  (Sheet   → MongoDB)
//   3. Outcomers   (MongoDB → Sheet)
//   4. Rooms       (MongoDB → Sheet)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/cron/sync-all",
  asyncHandler(async (req, res) => {
    const results = [];

    // ── 1. Incomers (Sheet → MongoDB) ────────────────────────────────────────
    try {
      const events = await Event.find({
        googleSheetId: { $exists: true, $ne: "" }
      });
      for (const event of events) {
        try {
          const stats = await syncEventIncomers(event._id);
          results.push({ name: event.name, type: "incomers", status: "success", stats });
        } catch (err) {
          console.error(`Error syncing incomers for event ${event._id}:`, err);
          event.sync = {
            ...(event.sync || {}),
            lastSyncAt: new Date(),
            lastSyncStatus: "error",
            errorCount: (event.sync?.errorCount || 0) + 1
          };
          await event.save();
          results.push({ name: event.name, type: "incomers", status: "error", error: err.message });
        }
      }
    } catch (err) {
      results.push({ type: "incomers", status: "error", error: err.message });
    }

    // ── 2. Guest List (Sheet → MongoDB) ──────────────────────────────────────
    try {
      const glEvents = await Event.find({
        guestListSheetId: { $exists: true, $ne: "" }
      });
      for (const event of glEvents) {
        try {
          const stats = await importGuestListSheet(event._id);
          await Event.findByIdAndUpdate(event._id, {
            "guestListSync.lastAutoSyncAt": new Date(),
            "guestListSync.lastAutoSyncStatus": "success",
            "guestListSync.lastAutoSyncCreated": stats.createdCount || 0,
            "guestListSync.lastAutoSyncUpdated": stats.updatedCount || 0,
            "guestListSync.lastAutoSyncInvalid": stats.invalidCount || 0
          });
          results.push({ name: event.name, type: "guest-list", status: "success", stats });
        } catch (err) {
          console.error(`Error auto-syncing guest list for event ${event._id}:`, err);
          await Event.findByIdAndUpdate(event._id, {
            "guestListSync.lastAutoSyncAt": new Date(),
            "guestListSync.lastAutoSyncStatus": "error"
          });
          results.push({ name: event.name, type: "guest-list", status: "error", error: err.message });
        }
      }
    } catch (err) {
      results.push({ type: "guest-list", status: "error", error: err.message });
    }

    // ── 3. Outcomers (MongoDB → Sheet) ────────────────────────────────────────
    try {
      const exportEvents = await Event.find({
        exportGoogleSheetId: { $exists: true, $ne: "" }
      });
      for (const event of exportEvents) {
        try {
          await syncEventExportSheet(event._id);
          results.push({ name: event.name, type: "outcomers-export", status: "success" });
        } catch (err) {
          console.error(`Error syncing outcomers export for event ${event._id}:`, err);
          results.push({ name: event.name, type: "outcomers-export", status: "error", error: err.message });
        }
      }
    } catch (err) {
      results.push({ type: "outcomers-export", status: "error", error: err.message });
    }

    // ── 4. Rooms (MongoDB → Sheet) ─────────────────────────────────────────────
    try {
      if (process.env.ROOMS_GOOGLE_SHEET_ID) {
        const roomResult = await syncRoomsGoogleSheet();
        results.push({ type: "rooms", status: roomResult.success ? "success" : "error", message: roomResult.message, rowsCount: roomResult.rowsCount });
      } else {
        results.push({ type: "rooms", status: "skipped", message: "ROOMS_GOOGLE_SHEET_ID not configured" });
      }
    } catch (err) {
      results.push({ type: "rooms", status: "error", error: err.message });
    }

    res.json({ success: true, results });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — Manual sync endpoints
// ─────────────────────────────────────────────────────────────────────────────

// Manual incomers sync for a single event
router.post(
  "/admin/events/:id/sync",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const stats = await syncEventIncomers(req.params.id);
      res.json({ success: true, stats });
    } catch (err) {
      const event = await Event.findById(req.params.id);
      if (event) {
        event.sync = {
          ...(event.sync || {}),
          lastSyncAt: new Date(),
          lastSyncStatus: "error",
          errorCount: (event.sync?.errorCount || 0) + 1
        };
        await event.save();
      }
      throw apiError(`Sync failed: ${err.message}`, 400);
    }
  })
);

// Manual outcomers export sync for a single event
router.post(
  "/admin/events/:id/export-sync",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await syncEventExportSheet(req.params.id);
      res.json({ success: true, message: "Outcomers export sheet synced." });
    } catch (err) {
      throw apiError(`Export sync failed: ${err.message}`, 400);
    }
  })
);

// Manual rooms sync
router.post(
  "/admin/rooms/sync",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await syncRoomsGoogleSheet();
      res.json(result);
    } catch (err) {
      throw apiError(`Rooms sync failed: ${err.message}`, 400);
    }
  })
);

// Preview Guest List Google Sheet for an event
router.post(
  "/admin/events/:id/guest-list-preview",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { sheetId, tabName } = req.body || {};
    try {
      const stats = await previewGuestListSheet(req.params.id, sheetId, tabName);
      res.json({ success: true, stats });
    } catch (err) {
      throw apiError(`Preview failed: ${err.message}`, 400);
    }
  })
);

// Import Guest List Google Sheet for an event into MongoDB
router.post(
  "/admin/events/:id/guest-list-import",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { sheetId, tabName } = req.body || {};
    try {
      const stats = await importGuestListSheet(req.params.id, sheetId, tabName);
      res.json({ success: true, stats });
    } catch (err) {
      const event = await Event.findById(req.params.id);
      if (event) {
        event.guestListSync = {
          ...(event.guestListSync || {}),
          lastImportAt: new Date(),
          lastImportStatus: "error"
        };
        await event.save();
      }
      throw apiError(`Import failed: ${err.message}`, 400);
    }
  })
);

// Manual Guest List auto-sync trigger for Admin Portal
router.post(
  "/admin/events/:id/guest-list-sync",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const stats = await importGuestListSheet(req.params.id);

      const event = await Event.findById(req.params.id);
      if (event) {
        event.guestListSync = {
          ...(event.guestListSync || {}),
          lastAutoSyncAt: new Date(),
          lastAutoSyncStatus: "success",
          lastAutoSyncCreated: stats.createdCount || 0,
          lastAutoSyncUpdated: stats.updatedCount || 0,
          lastAutoSyncInvalid: stats.invalidCount || 0
        };
        await event.save();
      }

      res.json({ success: true, stats });
    } catch (err) {
      const event = await Event.findById(req.params.id);
      if (event) {
        event.guestListSync = {
          ...(event.guestListSync || {}),
          lastAutoSyncAt: new Date(),
          lastAutoSyncStatus: "error"
        };
        await event.save();
      }
      throw apiError(`Sync failed: ${err.message}`, 400);
    }
  })
);

module.exports = router;
