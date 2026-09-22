// Customer-facing payment serializers. Every shape here is deliberately
// minimal — see backend/src/routes/paymentRoutes.js and depositRoutes.js for
// the full list of fields these are NOT allowed to leak (proof metadata,
// Mongo internals, admin review fields, Sheet/finance config, QR/Event
// data). Admin-facing responses never use these.

// The customer never sees a deposit history — only that ONE approved Deposit
// is awaiting their "PAYMENT CONFIRMED" acknowledgement. The id is all the
// screen needs (to acknowledge it): deliberately no amount and no review
// date, so a previous payment is never shown or datable.
function serializeCustomerPaymentConfirmation(deposit) {
  return {
    depositId: String(deposit._id)
  };
}

// Current-state only: the reason the customer's MOST RECENT request was
// rejected. Never a list — see paymentRoutes.js for when this is surfaced.
function serializeCustomerLatestRejection(deposit) {
  return {
    reason: deposit.rejectionReason || null
  };
}

// The response to a just-created Deposit (always "pending"). label comes
// from the frozen paymentOptionSnapshot, never from the live PaymentOption.
function serializeCustomerDepositCreated(deposit) {
  return {
    id: String(deposit._id),
    amount: deposit.amount,
    label: deposit.paymentOptionSnapshot?.label || null,
    status: deposit.status,
    createdAt: deposit.createdAt
  };
}

// The public PaymentOption list. No schoolId/createdAt/updatedAt/enabled/
// displayOrder — the customer only ever needs to pick from an already-
// filtered, already-ordered list.
function serializeCustomerPaymentOption(paymentOption) {
  return {
    id: String(paymentOption._id),
    amount: paymentOption.amount,
    label: paymentOption.label || null
  };
}

module.exports = {
  serializeCustomerPaymentConfirmation,
  serializeCustomerLatestRejection,
  serializeCustomerDepositCreated,
  serializeCustomerPaymentOption
};
