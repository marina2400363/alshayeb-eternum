const express = require("express");
const Event = require("../models/Event");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { syncEventIncomers } = require("../services/googleSheetsSync");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

// Cron Endpoint (GET) to sync all active events that have a Google Sheet ID.
// Intended to be called by an external cron service every 5 minutes.
router.get(
  "/cron/sync-all",
  asyncHandler(async (req, res) => {
    const results = [];
    
    // 1. Sync Incomers
    const events = await Event.find({
      googleSheetId: { $exists: true, $ne: "" }
    });
    for (const event of events) {
      try {
        const stats = await syncEventIncomers(event._id);
        results.push({ eventId: event._id, name: event.name, type: "incomers", status: "success", stats });
      } catch (err) {
        console.error(`Error syncing incomers for event ${event._id}:`, err);
        event.sync = {
          ...(event.sync || {}),
          lastSyncAt: new Date(),
          lastSyncStatus: "error",
          errorCount: (event.sync?.errorCount || 0) + 1
        };
        await event.save();
        results.push({ eventId: event._id, name: event.name, type: "incomers", status: "error", error: err.message });
      }
    }

    // 2. Sync Guest Lists
    const { importGuestListSheet } = require("../services/googleSheetsGuestListSync");
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
        results.push({ eventId: event._id, name: event.name, type: "guest-list", status: "success", stats });
      } catch (err) {
        console.error(`Error auto-syncing guest list for event ${event._id}:`, err);
        await Event.findByIdAndUpdate(event._id, {
          "guestListSync.lastAutoSyncAt": new Date(),
          "guestListSync.lastAutoSyncStatus": "error"
        });
        results.push({ eventId: event._id, name: event.name, type: "guest-list", status: "error", error: err.message });
      }
    }

    res.json({ success: true, results });
  })
);

const { previewGuestListSheet, importGuestListSheet } = require("../services/googleSheetsGuestListSync");

// Manual sync endpoint for Admin Portal (Incomers)
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

// Manual auto-sync trigger for Admin Portal (Guest List)
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
