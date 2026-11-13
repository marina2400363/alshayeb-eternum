const mongoose = require("mongoose");

// ADMIN-ONLY Season 2 event setup. Deliberately a separate model/collection
// from the legacy Season 1 `Event` (models/Event.js): that one is exposed by
// the public GET /api/events and its Sheet ids are read by the live sync cron.
// Nothing here is read by any customer-facing route, cron or sync, and no
// customer, payment, ticket or Outcomer data lives on this document.
const EVENT_STATUSES = ["AVAILABLE", "UNAVAILABLE", "COMING_SOON"];
const EVENT_TIMEZONE = "Africa/Cairo";

const season2EventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    // Egypt-local wall-clock values, exactly as the Admin entered them.
    eventDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    eventTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    timezone: { type: String, default: EVENT_TIMEZONE, enum: [EVENT_TIMEZONE] },
    // The same instant in UTC (computed from date + time in Africa/Cairo) so
    // events sort correctly. Always derived server-side, never client-supplied.
    startsAt: { type: Date, required: true },
    location: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
    thumbnail: {
      url: { type: String, trim: true },
      publicId: { type: String, trim: true }
    },
    // Many-to-many by reference only: nothing is written back onto School.
    schoolIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "School" }],
    // Stored for the future Outcomer phase. Nothing reads it for payments yet.
    outcomerTicketPriceEGP: { type: Number, required: true, min: 0.01 },
    status: { type: String, enum: EVENT_STATUSES, default: "COMING_SOON", required: true },
    // Event-specific Sheet configuration only (required: every event has its own
    // Sheet). A future export may only ever contain Outcomers with an APPROVED
    // ticket payment for THIS event. Not implemented in this phase. Never synced or written to.
    sheet: {
      spreadsheetId: { type: String, trim: true, required: true },
      tabName: { type: String, trim: true, default: "Sheet1" }
    }
  },
  { timestamps: true, collection: "season2events" }
);

season2EventSchema.index({ startsAt: 1 });
season2EventSchema.index({ schoolIds: 1 });
season2EventSchema.index({ "sheet.spreadsheetId": 1 }, { sparse: true });

const Season2Event = mongoose.model("Season2Event", season2EventSchema);
Season2Event.EVENT_STATUSES = EVENT_STATUSES;
Season2Event.EVENT_TIMEZONE = EVENT_TIMEZONE;

module.exports = Season2Event;
