const cron = require("node-cron");
const Event = require("../models/Event");
const { syncEventIncomers } = require("./googleSheetsSync");
const { importGuestListSheet } = require("./googleSheetsGuestListSync");

function startCronJobs() {
  // Run every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    console.log("[CRON] Starting 5-minute scheduled Google Sheets Sync...");

    // ── 1. Incomers sync (existing) ──────────────────────────────────────────
    try {
      const events = await Event.find({
        googleSheetId: { $exists: true, $ne: "" }
      });

      for (const event of events) {
        try {
          console.log(`[CRON] Syncing incomers for Event: ${event.name}`);
          await syncEventIncomers(event._id);
        } catch (err) {
          console.error(`[CRON] Error syncing incomers for event ${event._id}:`, err.message);
          event.sync = {
            ...(event.sync || {}),
            lastSyncAt: new Date(),
            lastSyncStatus: "error",
            errorCount: (event.sync?.errorCount || 0) + 1
          };
          await event.save();
        }
      }
    } catch (globalErr) {
      console.error("[CRON] Global incomers sync error:", globalErr.message);
    }

    // ── 2. Guest List auto-sync ──────────────────────────────────────────────
    try {
      const glEvents = await Event.find({
        guestListSheetId: { $exists: true, $ne: "" }
      });

      for (const event of glEvents) {
        try {
          console.log(`[CRON] Auto-syncing Guest List for Event: ${event.name}`);
          const stats = await importGuestListSheet(event._id);
          // Save auto-sync stats (separate from manual import stats)
          await Event.findByIdAndUpdate(event._id, {
            "guestListSync.lastAutoSyncAt": new Date(),
            "guestListSync.lastAutoSyncStatus": "success",
            "guestListSync.lastAutoSyncCreated": stats.createdCount || 0,
            "guestListSync.lastAutoSyncUpdated": stats.updatedCount || 0,
            "guestListSync.lastAutoSyncInvalid": stats.invalidCount || 0
          });
          console.log(`[CRON] Guest List auto-sync OK for ${event.name}: +${stats.createdCount} new, ${stats.updatedCount} updated`);
        } catch (err) {
          console.error(`[CRON] Guest List auto-sync failed for event ${event._id}:`, err.message);
          await Event.findByIdAndUpdate(event._id, {
            "guestListSync.lastAutoSyncAt": new Date(),
            "guestListSync.lastAutoSyncStatus": "error"
          });
        }
      }
    } catch (globalErr) {
      console.error("[CRON] Global guest list auto-sync error:", globalErr.message);
    }

    console.log("[CRON] 5-minute scheduled sync completed.");
  });
}

module.exports = startCronJobs;
