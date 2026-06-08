const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true
    },
    date: {
      type: Date
    },
    venue: {
      type: String,
      trim: true,
      default: "ALSHAYEB ETERNUM"
    },
    fee: {
      amount: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        trim: true,
        uppercase: true,
        default: "EGP"
      }
    },
    capacity: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Event", eventSchema);
