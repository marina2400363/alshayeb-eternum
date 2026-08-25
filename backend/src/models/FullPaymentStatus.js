const mongoose = require("mongoose");

// Sandra-owned mirror of the accountant's manual "Full Payment" column from
// the School finance Google Sheet. This is a read-back CACHE of a human
// decision made in Sheets — MongoDB stores it so application logic never has
// to query Google Sheets directly, but the Sheet cell itself remains the
// human source of truth for this specific confirmation. Separate from
// Attendee.js on purpose.
const fullPaymentStatusSchema = new mongoose.Schema(
  {
    attendeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendee",
      required: true,
      unique: true
    },
    confirmed: {
      type: Boolean,
      default: false
    },
    // Set when confirmed transitions from false/absent to true, and left
    // unchanged on repeated "still true" syncs or when it becomes false
    // again — it records when the accountant's DONE was first observed, not
    // a running timestamp of every sync.
    confirmedAt: {
      type: Date
    },
    lastSyncedAt: {
      type: Date
    },
    // The raw (trimmed) Sheet cell value as last read, for admin visibility
    // into what actually produced the current `confirmed` state.
    lastSheetValue: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("FullPaymentStatus", fullPaymentStatusSchema);
