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
    eventTypeLabel: {
      type: String,
      trim: true,
      default: "PROM"
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
    exportGoogleSheetId: {
      type: String,
      trim: true
    },
    guestListSheetId: {
      type: String,
      trim: true
    },
    guestListTabName: {
      type: String,
      trim: true,
      default: "Sheet1"
    },
    sync: {
      lastSyncAt: Date,
      lastSyncStatus: String,
      importedCount: { type: Number, default: 0 },
      skippedCount: { type: Number, default: 0 },
      errorCount: { type: Number, default: 0 }
    },
    guestListSync: {
      lastImportAt: Date,
      lastImportStatus: String,
      importedCount: { type: Number, default: 0 },
      createdCount: { type: Number, default: 0 },
      updatedCount: { type: Number, default: 0 },
      invalidCount: { type: Number, default: 0 },
      duplicateCount: { type: Number, default: 0 }
    },
    bannerImageUrl: {
      type: String,
      trim: true
    },
    tagline: {
      type: String,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },

    capacity: {
      type: Number,
      default: 0
    },
    displayOrder: {
      type: Number,
      default: 999
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Event", eventSchema);
