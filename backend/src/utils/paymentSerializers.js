// Customer-facing payment serializers. Every shape here is deliberately
// minimal — see backend/src/routes/paymentRoutes.js and depositRoutes.js for
// the full list of fields these are NOT allowed to leak (proof metadata,
// Mongo internals, admin review fields, PaymentOption ids, Sheet/finance
// config, QR/Event data). Admin-facing responses never use these.

// One line of a customer's deposit history. label comes from the frozen
// paymentOptionSnapshot, never from the live PaymentOption — a Deposit's
// history must never change because Admin later edited/deleted an option.
function serializeCustomerDepositHistoryItem(deposit) {
  return {
    id: String(deposit._id),
    amount: deposit.amount,
    label: deposit.paymentOptionSnapshot?.label || null,
    status: deposit.status,
    createdAt: deposit.createdAt,
    rejectionReason: deposit.rejectionReason || null
  };
}

// The response to a just-created Deposit. Deliberately narrower than the
// history item above (no rejectionReason — a brand new Deposit is always
// "pending" and can't have one yet).
function serializeCustomerDepositCreated(deposit) {
  return {
    id: String(deposit._id),
    amount: deposit.amount,
    label: deposit.paymentOptionSnapshot?.label || null,
    status: deposit.status,
    createdAt: deposit.createdAt
  };
}

// The public PaymentOption list. No createdAt/updatedAt/enabled/displayOrder —
// the customer only ever needs to pick from an already-filtered, already-
// ordered list.
function serializeCustomerPaymentOption(paymentOption) {
  return {
    id: String(paymentOption._id),
    amount: paymentOption.amount,
    label: paymentOption.label || null
  };
}

module.exports = {
  serializeCustomerDepositHistoryItem,
  serializeCustomerDepositCreated,
  serializeCustomerPaymentOption
};
