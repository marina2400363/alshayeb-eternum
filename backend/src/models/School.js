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
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("School", schoolSchema);
