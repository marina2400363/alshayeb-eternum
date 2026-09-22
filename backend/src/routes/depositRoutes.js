const express = require("express");
const multer = require("multer");

const PaymentOption = require("../models/PaymentOption");
const Deposit = require("../models/Deposit");
const FullPaymentStatus = require("../models/FullPaymentStatus");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { uploadIncomerDepositProof, deleteIncomerDepositProof } = require("../utils/cloudinaryUpload");
const { serializeCustomerDepositCreated } = require("../utils/paymentSerializers");
const { requireValidObjectId, requireValidPhone, resolveOwnedIncomer } = require("../utils/customerOwnership");
const { lockTicketPriceOnFirstDeposit } = require("../utils/ticketPriceLock");

const router = express.Router();

const depositProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.mimetype)) {
      callback(apiError("Only PNG, JPG, or JPEG payment proof images are allowed.", 422));
      return;
    }
    callback(null, true);
  }
});

function uploadDepositProofMiddleware(req, res, next) {
  depositProofUpload.single("paymentProof")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(apiError("Payment proof image must be 5MB or smaller.", 422));
      return;
    }

    next(apiError("Payment proof upload failed: " + error.message, 400));
  });
}

const CYCLE_BUSY_MESSAGE = "You already have a payment in progress.";

// Creates one Deposit for an existing Season 2 Incomer against one currently
// enabled PaymentOption of THEIR OWN School. The amount is always
// PaymentOption.amount from the database — never trusted from the request
// body — and is deliberately NOT limited by the ticket price or any
// remaining balance: Admin decides which amounts customers may pay.
//
// One payment cycle at a time: no new Deposit while a previous one is
// pending, or approved but not yet acknowledged by the customer (OK on the
// PAYMENT CONFIRMED screen). The partial unique index on
// {attendeeId, activeCycle} (see Deposit.js) is the concurrency authority.
router.post(
  "/",
  uploadDepositProofMiddleware,
  asyncHandler(async (req, res) => {
    const attendeeId = requireValidObjectId(req.body.attendeeId, "A valid attendeeId is required.");
    const paymentOptionId = requireValidObjectId(req.body.paymentOptionId, "A valid paymentOptionId is required.");
    const phone = requireValidPhone(req.body.phone);

    if (!req.file) {
      throw apiError("Payment proof image is required.", 422);
    }

    // Server-side ownership cross-check — the only access control here, since
    // there is no OTP/password/JWT for customers. Collapses "no such
    // attendee", "not an Incomer" and "phone doesn't match" into one generic
    // error so attendeeId alone can never be used as a bearer token.
    const attendee = await resolveOwnedIncomer(attendeeId, phone);

    // Full Payment is never inferred from arithmetic — it is strictly the
    // accountant's DONE column, mirrored into FullPaymentStatus by the
    // existing Sheet read-back sync (see googleSheetsFullPaymentSync.js).
    // Once confirmed, no new deposit can be created for this attendee.
    const fullPaymentStatus = await FullPaymentStatus.findOne({ attendeeId: attendee._id }).select("confirmed");
    if (fullPaymentStatus?.confirmed) {
      throw apiError("Full payment has already been confirmed.", 422);
    }

    const paymentOption = await PaymentOption.findById(paymentOptionId);
    // Same generic message for "doesn't exist", "disabled" and "belongs to a
    // different School" — a customer must never learn that a School-mismatch
    // (as opposed to disabled/missing) was the actual reason, which would
    // otherwise confirm another School's option id is valid.
    if (!paymentOption || !paymentOption.enabled || String(paymentOption.schoolId) !== String(attendee.schoolId)) {
      throw apiError("Selected payment option is not available.", 422);
    }

    // Optimistic pre-check (avoids an unnecessary Cloudinary upload). The
    // status checks also cover Deposits created before activeCycle existed.
    const cycleBusy = await Deposit.exists({
      attendeeId: attendee._id,
      $or: [
        { status: "pending" },
        { status: "approved", customerConfirmationPending: true },
        { activeCycle: { $exists: true } }
      ]
    });
    if (cycleBusy) {
      throw apiError(CYCLE_BUSY_MESSAGE, 409);
    }

    const uploadedProof = await uploadIncomerDepositProof(req.file);
    const paymentProof = {
      url: uploadedProof.secure_url || uploadedProof.url,
      publicId: uploadedProof.public_id,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      uploadedAt: new Date()
    };

    let deposit;
    try {
      deposit = await Deposit.create({
        attendeeId: attendee._id,
        paymentOptionId: paymentOption._id,
        paymentOptionSnapshot: {
          amount: paymentOption.amount,
          label: paymentOption.label
        },
        amount: paymentOption.amount,
        paymentProof,
        status: "pending",
        activeCycle: 1
      });
    } catch (err) {
      // The upload already succeeded but no Deposit ended up owning it —
      // delete the orphaned Cloudinary asset regardless of failure reason.
      await deleteIncomerDepositProof(paymentProof.publicId);
      if (err.code === 11000) {
        throw apiError(CYCLE_BUSY_MESSAGE, 409);
      }
      throw err;
    }

    // First payment request → lock the ticket price the customer had when
    // they made it (no-op if already locked). See utils/ticketPriceLock.js.
    await lockTicketPriceOnFirstDeposit(attendee._id, attendee.ticketPrice);

    res.status(201).json({
      success: true,
      message: "Deposit created.",
      deposit: serializeCustomerDepositCreated(deposit)
    });
  })
);

module.exports = router;
