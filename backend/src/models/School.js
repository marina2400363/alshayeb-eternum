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
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("School", schoolSchema);
