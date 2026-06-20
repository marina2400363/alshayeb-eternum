const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true
    },
    date: {
      type: Date
    },
    entryTime: {
      type: String,
      trim: true,
      default: "21:30"
    },
    venue: {
      type: String,
      trim: true,
      default: "ALSHAYEB ETERNUM"
    },
    status: {
      type: String,
      enum: ["available", "sold out", "not available"],
      default: "available"
    },
    schools: {
      type: [String],
      default: []
    },
    prefix: {
      type: String,
      trim: true,
      uppercase: true,
      required: true
    },
    price: {
      type: Number,
      required: true,
      default: 1800
    },
    googleSheetId: {
      type: String,
      trim: true
    },
    sync: {
      lastSyncAt: Date,
      lastSyncStatus: String,
      importedCount: { type: Number, default: 0 },
      skippedCount: { type: Number, default: 0 },
      errorCount: { type: Number, default: 0 }
    },

    capacity: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Event", eventSchema);
