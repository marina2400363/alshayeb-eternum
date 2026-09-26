const Attendee = require("../models/Attendee");
const Deposit = require("../models/Deposit");

// Pure, DB-free calculations so routes and the future Google Sheets sync
// compute money identically. Rejected and pending deposits never count.
function calculateApprovedTotalPaid(deposits) {
  return (deposits || [])
    .filter((deposit) => deposit.status === "approved")
    .reduce((total, deposit) => total + Number(deposit.amount || 0), 0);
}

function calculateRemainingBalance(ticketPrice, approvedTotalPaid) {
  return Math.max(Number(ticketPrice || 0) - Number(approvedTotalPaid || 0), 0);
}

// Reads Attendee.ticketPrice (Marina's registration-time snapshot) and this
// attendee's deposit history, then applies the pure functions above.
// Read-only against Attendee — never writes to it.
async function getAttendeeFinancialSummary(attendeeId) {
  const [attendee, deposits] = await Promise.all([
    Attendee.findById(attendeeId).select("ticketPrice"),
    Deposit.find({ attendeeId }).sort({ createdAt: 1 })
  ]);

  if (!attendee) {
    return null;
  }

  const approvedTotalPaid = calculateApprovedTotalPaid(deposits);
  const remainingBalance = calculateRemainingBalance(attendee.ticketPrice, approvedTotalPaid);

  return {
    ticketPrice: attendee.ticketPrice,
    approvedTotalPaid,
    remainingBalance,
    deposits
  };
}

module.exports = {
  calculateApprovedTotalPaid,
  calculateRemainingBalance,
  getAttendeeFinancialSummary
};
