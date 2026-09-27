const mongoose = require("mongoose");

// Season 2-only settings, kept separate from the legacy SiteSettings document
// (Rooms/Season 1) so nothing here can ever touch that data. Singleton
// document (key: "default") — extend with new fields as Season 2 grows.
//
// statusCounter is manually admin-typed display copy for the Customer Area's
// Accepted/Rejected/Pending counter. It is NEVER derived from Deposit,
// Attendee, FullPaymentStatus or any other Season 2 record — the admin sets
// the numbers, the customer API only reads them back.
const season2SettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "default"
    },
    statusCounter: {
      accepted: { type: Number, default: 0, min: 0 },
      rejected: { type: Number, default: 0, min: 0 },
      pending: { type: Number, default: 0, min: 0 }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Season2Settings", season2SettingsSchema);
