const mongoose = require("mongoose");

const hotelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Hotel name is required"],
      trim: true,
      unique: true
    },
    description: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ["available", "fully_booked", "hidden", "not_available"],
      default: "available"
    },
    startingPrice: {
      type: Number,
      default: 0
    },
    displayOrder: {
      type: Number,
      default: 999
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Hotel", hotelSchema);
