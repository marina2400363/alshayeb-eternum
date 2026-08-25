const mongoose = require("mongoose");

// Pure concurrency-control anchor for Deposit approval — NOT a financial
// record and never read for money. It holds no ticketPrice, no total, no
// amount. Approving a Deposit touches this document (upsert) as the first
// write inside its transaction, so MongoDB's transaction write-conflict
// detection serializes any two concurrent approval transactions for the same
// attendee even though they target two different Deposit documents. The
// loser is aborted with a TransientTransactionError and automatically
// retried by session.withTransaction(), at which point it re-reads the
// now-committed approved total. See depositAdminRoutes.js's approve handler.
const depositApprovalLockSchema = new mongoose.Schema(
  {
    attendeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendee",
      required: true,
      unique: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("DepositApprovalLock", depositApprovalLockSchema);
