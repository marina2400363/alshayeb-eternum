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
    },
    // Season 2 "Full Payment Complete" email delivery marker. Set only after
    // the false -> true transition's send succeeds — a repeated true -> true
    // sync must never re-send, and this is the durable guard for that.
    season2EmailNotifications: {
      completionSentAt: Date
    },
    // ADMIN PORTAL decision (Full Payments page): the sole authority for a Full
    // Payment DONE going forward. Absent on every pre-existing record (those
    // were mirrored from the old Sheet column and are left exactly as they
    // are). `decision` is the LATEST manual decision; `auditLog` is the
    // append-only history of every manual change (who, what, when). A record
    // with an Admin decision can never be changed by the legacy Sheet read-back.
    decision: {
      source: { type: String, enum: ["admin"] },
      by: { type: String, trim: true },
      at: Date
    },
    auditLog: {
      type: [
        {
          _id: false,
          action: { type: String, enum: ["marked_done", "revoked_done"], required: true },
          by: { type: String, trim: true },
          at: { type: Date, required: true }
        }
      ],
      default: undefined
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("FullPaymentStatus", fullPaymentStatusSchema);
