const mongoose = require("mongoose");
const { nanoid } = require("nanoid");

const roomReservationSchema = new mongoose.Schema(
  {
    reservationId: {
      type: String,
      unique: true,
      default: () => nanoid(8).toUpperCase()
    },
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true
    },
    roomTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoomType",
      required: true
    },
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true
    },
    emailAddress: {
      type: String,
      trim: true
    },
    nationality: {
      type: String,
      default: "Egyptian"
    },
    nationalId: {
      type: String,
      required: [true, "National ID is required"],
      trim: true,
      validate: {
        validator: function(v) {
          return /^\d{14}$/.test(v);
        },
        message: props => `${props.value} is not a valid 14-digit National ID!`
      }
    },
    checkInDate: {
      type: Date,
      required: true
    },
    checkOutDate: {
      type: Date,
      required: true
    },
    stayDuration: {
      type: Number,
      required: true
    },
    pricePerNight: {
      type: Number,
      required: true
    },
    totalAmount: {
      type: Number,
      required: true
    },
    paymentStatus: {
      type: String,
      enum: ["not_uploaded", "under_verification", "verified", "rejected"],
      default: "not_uploaded"
    },
    reservationStatus: {
      type: String,
      enum: ["pending_review", "confirmed", "declined", "cancelled"],
      default: "pending_review"
    },
    paymentProofUrl: {
      type: String
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("RoomReservation", roomReservationSchema);
