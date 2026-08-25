const mongoose = require("mongoose");

// Generic, Admin-controlled payment option. No fixed types (no full_ticket,
// half_ticket, or percentage calculations) — the financial meaning is the
// numeric `amount` alone. Deposits must snapshot this data at selection time
// so editing/deleting a PaymentOption later never changes historical Deposits.
const paymentOptionSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      trim: true
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      validate: {
        validator: (value) => Number.isFinite(value) && value > 0,
        message: "Amount must be a positive number."
      }
    },
    enabled: {
      type: Boolean,
      default: true
    },
    displayOrder: {
      type: Number,
      default: 999
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentOption", paymentOptionSchema);
