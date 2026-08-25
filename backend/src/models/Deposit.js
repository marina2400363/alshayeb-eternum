const mongoose = require("mongoose");

// A single historical payment deposit for an Incomer. Deposits are never
// embedded in Attendee and never overwritten — each is its own permanent
// document. Historical financial correctness depends on paymentOptionSnapshot
// and amount, which must never be recomputed from the live PaymentOption.
const MAX_ACTIVE_DEPOSITS = 5;

const depositSchema = new mongoose.Schema(
  {
    attendeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendee",
      required: true,
      index: true
    },
    paymentOptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentOption"
    },
    // Frozen at the moment the customer selects a PaymentOption. Must never
    // be re-derived from the live PaymentOption document, which Admin may
    // later edit or delete.
    paymentOptionSnapshot: {
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      label: {
        type: String,
        trim: true
      }
    },
    // The actual amount this deposit counts for financially. Independent of
    // paymentOptionSnapshot.amount so a future correction path never has to
    // touch the frozen snapshot.
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isFinite(value) && value > 0,
        message: "Deposit amount must be a positive number."
      }
    },
    paymentProof: {
      url: String,
      publicId: String,
      fileName: String,
      fileType: String,
      uploadedAt: Date
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },
    reviewedAt: {
      type: Date
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin"
    },
    rejectionReason: {
      type: String,
      trim: true
    },
    // Concurrency-safe active-deposit-slot mechanism. Present (1..5) only
    // while status is "pending" or "approved". Unset entirely (not set to
    // null) when a deposit is rejected, so the sparse unique index below
    // frees the slot for reuse while this document remains in history
    // forever. See the compound index for the actual enforcement.
    activeSlot: {
      type: Number,
      min: 1,
      max: MAX_ACTIVE_DEPOSITS
    }
  },
  { timestamps: true }
);

// Enforces "max 5 non-rejected deposits per attendee" at the database level.
// Partial: a document is only included in this index while activeSlot exists,
// so rejected deposits (activeSlot unset) never collide and are never capped.
// A partial filter is used instead of `sparse` so the exclusion rule is
// explicit ("activeSlot exists") rather than implied by the compound index's
// general sparse behavior.
depositSchema.index(
  { attendeeId: 1, activeSlot: 1 },
  {
    unique: true,
    partialFilterExpression: { activeSlot: { $exists: true } },
    name: "attendee_active_slot_unique"
  }
);

// Supports fetching an attendee's deposit history in creation order without
// a collection scan (used by financial summaries and future admin views).
depositSchema.index({ attendeeId: 1, createdAt: 1 });

const Deposit = mongoose.model("Deposit", depositSchema);
Deposit.MAX_ACTIVE_DEPOSITS = MAX_ACTIVE_DEPOSITS;

module.exports = Deposit;
