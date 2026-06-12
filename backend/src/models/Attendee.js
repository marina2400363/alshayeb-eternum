const mongoose = require("mongoose");

const attendeeSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    university: {
      type: String,
      trim: true
    },
    age: {
      type: Number,
      min: 15,
      max: 40
    },
    instagram: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      trim: true
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event"
    },
    eventName: {
      type: String,
      trim: true
    },
    attendeeType: {
      type: String,
      enum: ["guest", "incomer", "outcomer"],
      default: "guest",
      index: true
    },
    accessType: {
      type: String,
      trim: true,
      default: "GENERAL"
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "used", "revoked"],
      default: "pending",
      index: true
    },
    paymentStatus: {
      type: String,
      enum: ["not_required", "pending", "under_verification", "verified", "rejected"],
      default: "pending"
    },
    paymentProof: {
      url: String,
      publicId: String,
      fileName: String,
      fileType: String,
      uploadedAt: Date
    },
    qrId: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },
    qrToken: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },
    qrIssuedAt: {
      type: Date
    },
    scannedAt: {
      type: Date
    },
    scanCount: {
      type: Number,
      default: 0
    },
    reviewedAt: {
      type: Date
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin"
    },
    rejectionReason: {
      type: String,
      trim: true
    },
    emailNotifications: {
      registrationReceivedAt: Date,
      approvedAt: Date,
      rejectedAt: Date
    }
  },
  { timestamps: true }
);

attendeeSchema.index({ phone: 1, event: 1 });

module.exports = mongoose.model("Attendee", attendeeSchema);
