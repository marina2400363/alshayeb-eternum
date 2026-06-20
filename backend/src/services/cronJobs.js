const cron = require("node-cron");
const Event = require("../models/Event");
const { syncEventIncomers } = require("./googleSheetsSync");

function startCronJobs() {
  // Run every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    console.log("[CRON] Starting 5-minute scheduled Google Sheets Sync...");
    try {
      const events = await Event.find({
        googleSheetId: { $exists: true, $ne: "" }
      });

      for (const event of events) {
        try {
          console.log(`[CRON] Syncing incomers for Event: ${event.name}`);
          await syncEventIncomers(event._id);
        } catch (err) {
          console.error(`[CRON] Error syncing event ${event._id}:`, err.message);
          event.sync = {
            ...(event.sync || {}),
            lastSyncAt: new Date(),
            lastSyncStatus: "error",
            errorCount: (event.sync?.errorCount || 0) + 1
          };
          await event.save();
        }
      }
      console.log("[CRON] 5-minute scheduled sync completed.");
    } catch (globalErr) {
      console.error("[CRON] Global sync error:", globalErr.message);
    }
  });
}

module.exports = startCronJobs;
