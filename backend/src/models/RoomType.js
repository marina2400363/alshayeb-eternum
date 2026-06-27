const mongoose = require("mongoose");

const roomTypeSchema = new mongoose.Schema(
  {
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true
    },
    name: {
      type: String,
      required: [true, "Room type name is required"],
      trim: true
    },
    capacity: {
      type: Number,
      required: true,
      default: 2
    },
    breakfastIncluded: {
      type: Boolean,
      default: false
    },
    pricePerNight: {
      type: Number,
      required: [true, "Price per night is required"]
    },
    status: {
      type: String,
      enum: ["available", "fully_booked", "hidden", "not_available"],
      default: "available"
    },
    displayOrder: {
      type: Number,
      default: 999
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("RoomType", roomTypeSchema);
