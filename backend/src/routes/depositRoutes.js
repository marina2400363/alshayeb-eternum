const express = require("express");
const multer = require("multer");

const PaymentOption = require("../models/PaymentOption");
const Deposit = require("../models/Deposit");
const FullPaymentStatus = require("../models/FullPaymentStatus");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { uploadIncomerDepositProof, deleteIncomerDepositProof } = require("../utils/cloudinaryUpload");
const { getAttendeeFinancialSummary } = require("../utils/paymentCalculations");
const { serializeCustomerDepositCreated } = require("../utils/paymentSerializers");
const { requireValidObjectId, requireValidPhone, resolveOwnedIncomer } = require("../utils/customerOwnership");

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

// Attempts to insert a Deposit into an available active slot (1..MAX). The
// MongoDB partial unique index on {attendeeId, activeSlot} is the actual
// authority here — a duplicate-key error means a concurrent request already
// claimed that slot, so we just try the next one. Returns null (not a throw)
// when every slot is occupied, so the caller can clean up the already-
// uploaded Cloudinary asset before responding.
async function claimActiveSlot(depositData) {
  const maxSlots = Deposit.MAX_ACTIVE_DEPOSITS;

  for (let slot = 1; slot <= maxSlots; slot += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const deposit = await Deposit.create({ ...depositData, activeSlot: slot });
      return deposit;
    } catch (err) {
      if (err.code === 11000) {
        continue;
      }
      throw err;
    }
  }

  return null;
}

// Creates one Deposit for an existing Season 2 Incomer against one currently
// enabled PaymentOption. The amount is always PaymentOption.amount from the
// database — never trusted from the request body.
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
    // Once confirmed, no new deposit can be created for this attendee,
    // regardless of remaining/ticketPrice math or active-slot count.
    const fullPaymentStatus = await FullPaymentStatus.findOne({ attendeeId: attendee._id }).select("confirmed");
    if (fullPaymentStatus?.confirmed) {
      throw apiError("Full payment has already been confirmed.", 422);
    }

    if (!Number.isFinite(attendee.ticketPrice) || attendee.ticketPrice < 0) {
      throw apiError("This attendee has no valid ticket price on record.", 422);
    }

    const paymentOption = await PaymentOption.findById(paymentOptionId);
    // Same generic message for "doesn't exist", "disabled" and "belongs to a
    // different School" — a customer must never learn that a School-mismatch
    // (as opposed to disabled/missing) was the actual reason, which would
    // otherwise confirm another School's option id is valid.
    if (!paymentOption || !paymentOption.enabled || String(paymentOption.schoolId) !== String(attendee.schoolId)) {
      throw apiError("Selected payment option is not available.", 422);
    }

    const { remainingBalance } = await getAttendeeFinancialSummary(attendeeId);

    if (paymentOption.amount > remainingBalance) {
      throw apiError(
        `Selected amount (${paymentOption.amount}) exceeds the remaining balance (${remainingBalance}).`,
        422
      );
    }

    // Optimistic pre-check only, to avoid an unnecessary Cloudinary upload
    // when the account is already visibly full. The partial unique index
    // inside claimActiveSlot() below is the actual concurrency authority.
    const activeSlotCount = await Deposit.countDocuments({
      attendeeId,
      activeSlot: { $exists: true }
    });

    if (activeSlotCount >= Deposit.MAX_ACTIVE_DEPOSITS) {
      throw apiError("This attendee already has the maximum of 5 active deposits.", 422);
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
      deposit = await claimActiveSlot({
        attendeeId,
        paymentOptionId: paymentOption._id,
        paymentOptionSnapshot: {
          amount: paymentOption.amount,
          label: paymentOption.label
        },
        amount: paymentOption.amount,
        paymentProof,
        status: "pending"
      });
    } catch (err) {
      // The upload already succeeded but no Deposit ended up owning it —
      // delete the orphaned Cloudinary asset regardless of failure reason.
      await deleteIncomerDepositProof(paymentProof.publicId);
      throw err;
    }

    if (!deposit) {
      await deleteIncomerDepositProof(paymentProof.publicId);
      throw apiError("This attendee already has the maximum of 5 active deposits.", 422);
    }

    res.status(201).json({
      success: true,
      message: "Deposit created.",
      deposit: serializeCustomerDepositCreated(deposit)
    });
  })
);

module.exports = router;
