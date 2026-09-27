const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "School name is required"],
      trim: true,
      unique: true
    },
    ticketPrice: {
      type: Number,
      required: [true, "Ticket price is required"],
      min: 0
    },
    // Whether this School's customers see their ticket price in the Customer
    // Area. When false the customer payment API omits the amount entirely
    // (not just hidden in the UI). Defaults to true — the existing behavior.
    showTicketPriceToCustomer: {
      type: Boolean,
      default: true
    },
    // Private School Access Code (Admin-managed): the only way a new customer
    // resolves this School during registration — there is no public School
    // list or search. Stored normalized (trim + uppercase, see
    // utils/schoolAccessCode.js) so lookup is a straight equality match.
    // `sparse` lets Schools exist without a code yet (pre-migration, or before
    // an Admin has generated one) without colliding on a shared empty value.
    // NEVER exposed by any public School endpoint — only the authenticated
    // Admin School API reads or writes it.
    accessCode: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("School", schoolSchema);
