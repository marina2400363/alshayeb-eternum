const Attendee = require("../models/Attendee");
const Deposit = require("../models/Deposit");

// Ticket-price lock rule (Season 2 Incomers):
//   • no Deposit yet  → the customer's ticketPrice follows their School's
//     current price (Admin price changes are copied onto them);
//   • first Deposit   → the price the customer had when they made that first
//     payment request is locked forever (any later status — pending,
//     approved or rejected — keeps it locked).
//
// Both functions below only ever touch documents whose ticketPriceLocked is
// not true, and MongoDB applies each single-document update atomically, so
// a School price change racing a customer's first payment always resolves
// to one consistent outcome: the lock wins, at the price the customer had
// when they made the request.

// Called right after the customer's first Deposit has been created. A no-op
// for anyone already locked (a second payment, or a concurrent request that
// locked first).
async function lockTicketPriceOnFirstDeposit(attendeeId, ticketPriceAtRequest) {
  return Attendee.updateOne(
    { _id: attendeeId, ticketPriceLocked: { $ne: true } },
    {
      $set: {
        ticketPriceLocked: true,
        ticketPriceLockedAt: new Date(),
        ticketPrice: ticketPriceAtRequest
      }
    }
  );
}

// Called after Admin changes a School's ticketPrice. Copies the new price
// onto that School's Incomers who have never made a payment request.
//
// Incomers who already have a Deposit but aren't flagged (Deposits created
// before the lock existed) are locked at their CURRENT price instead of
// being repriced — "at least one Deposit" is what locks, whatever the flag
// says.
async function applySchoolTicketPrice(schoolId, ticketPrice) {
  const unlocked = await Attendee.find({
    schoolId,
    attendeeType: "incomer",
    ticketPriceLocked: { $ne: true }
  }).select("_id");
  const unlockedIds = unlocked.map((attendee) => attendee._id);
  if (unlockedIds.length === 0) return { repriced: 0, locked: 0 };

  const withDeposits = await Deposit.distinct("attendeeId", { attendeeId: { $in: unlockedIds } });
  const hasDeposit = new Set(withDeposits.map(String));
  const repriceIds = unlockedIds.filter((id) => !hasDeposit.has(String(id)));

  const [repriced, locked] = await Promise.all([
    repriceIds.length
      ? Attendee.updateMany({ _id: { $in: repriceIds }, ticketPriceLocked: { $ne: true } }, { $set: { ticketPrice } })
      : { modifiedCount: 0 },
    withDeposits.length
      ? Attendee.updateMany(
          { _id: { $in: withDeposits }, ticketPriceLocked: { $ne: true } },
          { $set: { ticketPriceLocked: true, ticketPriceLockedAt: new Date() } }
        )
      : { modifiedCount: 0 }
  ]);

  return { repriced: repriced.modifiedCount || 0, locked: locked.modifiedCount || 0 };
}

module.exports = { lockTicketPriceOnFirstDeposit, applySchoolTicketPrice };
