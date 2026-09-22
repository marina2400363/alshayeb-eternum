const mongoose = require("mongoose");

// A single historical payment deposit for an Incomer. Deposits are never
// embedded in Attendee and never overwritten — each is its own permanent
// document. Historical financial correctness depends on paymentOptionSnapshot
// and amount, which must never be recomputed from the live PaymentOption.
//
// Legacy only: the old "max 5 active deposits" slot. New Deposits never set
// activeSlot (there is no lifetime payment limit); the field and its index
// stay so historical documents keep their meaning.
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
    // Customer-facing one-time "PAYMENT CONFIRMED" notification. Set to true
    // ONLY by the Admin approval transaction (depositAdminRoutes.js), so
    // Deposits approved before this field existed default to false and never
    // raise a notification retroactively. Cleared (and acknowledgedAt set)
    // only by the customer's own POST /api/payments/acknowledge-confirmation.
    // Purely UI state — never read by finance, Sheets or Full Payment logic.
    customerConfirmationPending: {
      type: Boolean,
      default: false
    },
    customerConfirmationAcknowledgedAt: {
      type: Date,
      default: null
    },
    // ONE current payment cycle per attendee, enforced by the partial unique
    // index below: set (always 1) while the Deposit is pending OR approved-
    // but-not-yet-acknowledged by the customer; unset on rejection or on the
    // customer's OK. A concurrent second submission collides on the index.
    activeCycle: {
      type: Number,
      enum: [1]
    },
    // LEGACY: the old 5-slot mechanism. Never set on new Deposits (see the
    // header comment); still unset on rejection so historical documents stay
    // consistent.
    activeSlot: {
      type: Number,
      min: 1,
      max: MAX_ACTIVE_DEPOSITS
    },
    // Season 2 transactional email delivery markers. Internal bookkeeping
    // only — never exposed by a customer-facing serializer (see
    // serializeCustomerDepositCreated in paymentSerializers.js, an explicit
    // allowlist that omits it).
    season2EmailNotifications: {
      proofReceivedSentAt: Date,
      approvalSentAt: Date,
      rejectionSentAt: Date
    }
  },
  { timestamps: true }
);

// LEGACY index for historical activeSlot values (new Deposits never set it,
// so it never limits new payments).
depositSchema.index(
  { attendeeId: 1, activeSlot: 1 },
  {
    unique: true,
    partialFilterExpression: { activeSlot: { $exists: true } },
    name: "attendee_active_slot_unique"
  }
);

depositSchema.index(
  { attendeeId: 1, activeCycle: 1 },
  {
    unique: true,
    partialFilterExpression: { activeCycle: { $exists: true } },
    name: "attendee_active_cycle_unique"
  }
);

// Supports fetching an attendee's deposit history in creation order without
// a collection scan (used by financial summaries and future admin views).
depositSchema.index({ attendeeId: 1, createdAt: 1 });

const Deposit = mongoose.model("Deposit", depositSchema);

module.exports = Deposit;
