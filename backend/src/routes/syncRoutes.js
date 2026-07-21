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
    const events = await Event.find({
      googleSheetId: { $exists: true, $ne: "" }
    });

    const results = [];
    for (const event of events) {
      try {
        const stats = await syncEventIncomers(event._id);
        results.push({ eventId: event._id, name: event.name, status: "success", stats });
      } catch (err) {
        // We log the error but continue syncing other events
        console.error(`Error syncing event ${event._id}:`, err);
        
        event.sync = {
          ...(event.sync || {}),
          lastSyncAt: new Date(),
          lastSyncStatus: "error",
          errorCount: (event.sync?.errorCount || 0) + 1
        };
        await event.save();

        results.push({ eventId: event._id, name: event.name, status: "error", error: err.message });
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

module.exports = router;
