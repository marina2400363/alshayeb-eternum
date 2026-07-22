const express = require("express");
const Hotel = require("../models/Hotel");
const RoomType = require("../models/RoomType");
const RoomReservation = require("../models/RoomReservation");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const multer = require("multer");
const { sendRoomStatusEmail } = require("../utils/email");
const { syncRoomsGoogleSheet } = require("../services/googleSheetsRoomsSync");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!["image/png", "image/jpeg", "image/jpg", "application/pdf"].includes(file.mimetype)) {
      callback(apiError("Only PNG, JPG, JPEG or PDF files are allowed.", 422));
      return;
    }
    callback(null, true);
  }
});

// Get available hotels
router.get(
  "/hotels",
  asyncHandler(async (req, res) => {
    const hotels = await Hotel.find({ status: { $ne: "hidden" } }).sort({ displayOrder: 1, createdAt: -1 });
    res.json({ success: true, hotels });
  })
);

// Get available room types for a hotel
router.get(
  "/hotels/:hotelId/room-types",
  asyncHandler(async (req, res) => {
    const roomTypes = await RoomType.find({ hotelId: req.params.hotelId, status: { $ne: "hidden" } }).sort({ displayOrder: 1, createdAt: -1 });
    res.json({ success: true, roomTypes });
  })
);

// Create a reservation
router.post(
  "/reservations",
  asyncHandler(async (req, res) => {
    const { hotelId, roomTypeId, fullName, phoneNumber, nationalId, emailAddress, checkInDate, checkOutDate } = req.body;

    if (!hotelId || !roomTypeId || !fullName || !phoneNumber || !nationalId || !checkInDate || !checkOutDate) {
      throw apiError("Please provide all required fields.");
    }

    const cleanFullName = fullName.trim().replace(/\s+/g, ' ');
    if (!/^[a-zA-Z\s]+$/.test(cleanFullName) || cleanFullName.length < 3 || cleanFullName.length > 100) {
      throw apiError("Please enter a valid full name.");
    }

    if (!/^01\d{9}$/.test(phoneNumber)) {
      throw apiError("Please enter a valid Egyptian mobile number.");
    }

    if (!/^\d{14}$/.test(nationalId)) {
      throw apiError("National ID must be exactly 14 digits.");
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
      throw apiError("Invalid dates provided.");
    }

    if (checkOut <= checkIn) {
      throw apiError("Check-out date must be after check-in date.");
    }

    const diffTime = Math.abs(checkOut - checkIn);
    const stayDuration = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const roomType = await RoomType.findById(roomTypeId);
    if (!roomType) {
      throw apiError("Room type not found.");
    }

    if (roomType.hotelId.toString() !== hotelId) {
      throw apiError("Room type does not belong to the selected hotel.");
    }

    const totalAmount = roomType.pricePerNight * stayDuration;

    const reservation = await RoomReservation.create({
      hotelId,
      roomTypeId,
      fullName,
      phoneNumber,
      nationalId,
      emailAddress,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      stayDuration,
      pricePerNight: roomType.pricePerNight,
      totalAmount,
      nationality: "Egyptian"
    });

    // Sync to Google Sheets synchronously so Vercel doesn't freeze
    try {
      await syncRoomsGoogleSheet();
    } catch (err) {
      console.error("Sync trigger failed on creation", err);
    }

    res.status(201).json({ success: true, reservation });
  })
);

// Upload payment proof for a reservation
router.post(
  "/reservations/:id/proof",
  upload.single("paymentProof"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw apiError("Payment proof file is required.", 422);
    }

    const { uploadRoomPaymentProof } = require("../utils/cloudinaryUpload");
    const result = await uploadRoomPaymentProof(req.file);

    if (!result || !result.secure_url) {
      throw apiError("Failed to upload payment proof to Cloudinary.", 500);
    }

    const reservation = await RoomReservation.findByIdAndUpdate(
      req.params.id,
      {
        paymentProofUrl: result.secure_url,
        paymentStatus: "under_verification"
      },
      { new: true, runValidators: true }
    );

    if (!reservation) {
      throw apiError("Reservation not found", 404);
    }

    const populatedReservation = await RoomReservation.findById(req.params.id)
      .populate("hotelId", "name")
      .populate("roomTypeId", "name");

    // Send email synchronously so Vercel doesn't freeze
    if (populatedReservation && populatedReservation.emailAddress) {
      const formatDate = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const formatCurrency = (amount) => Number(amount).toLocaleString('en-US');
      
      const subject = "ALSHAYEB Rooms Reservation Under Review";
      const message = `Dear ${populatedReservation.fullName},

We have received your payment proof via Instapay. Your reservation request is currently under review.

Reservation Details:
• Reservation ID: ${populatedReservation.reservationId}
• Hotel: ${populatedReservation.hotelId?.name || "N/A"}
• Room Type: ${populatedReservation.roomTypeId?.name || "N/A"}
• Check-in: ${formatDate(populatedReservation.checkInDate)}
• Check-out: ${formatDate(populatedReservation.checkOutDate)}
• Stay Duration: ${populatedReservation.stayDuration} night(s)
• Total Amount: ${formatCurrency(populatedReservation.totalAmount)} EGP
• Date Requested: ${formatDate(populatedReservation.createdAt)}
• Status: Under Review

We will notify you once your reservation has been confirmed by our team.`;

      try {
        await sendRoomStatusEmail(populatedReservation, subject, message);
      } catch (err) {
        console.error("Email send trigger failed", err);
      }
    }

    // Sync to Google Sheets synchronously so Vercel doesn't freeze
    try {
      await syncRoomsGoogleSheet();
    } catch (err) {
      console.error("Sync trigger failed on payment proof", err);
    }

    res.json({ success: true, reservation });
  })
);

// Force Google Sheets Sync (For debugging, temporarily public)
router.get(
  "/force-sync",
  asyncHandler(async (req, res) => {
    try {
      const result = await syncRoomsGoogleSheet();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message, stack: error.stack });
    }
  })
);

// Get my reservations by phone number
router.post(
  "/my-reservations",
  asyncHandler(async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) throw apiError("Phone number is required.");

    const { cleanPhone } = require("../utils/phone");
    const normalizedPhone = cleanPhone(phoneNumber);
    
    // Check both exact match and normalized match, just in case
    const reservations = await RoomReservation.find({ 
      $or: [
        { phoneNumber: phoneNumber },
        { phoneNumber: normalizedPhone }
      ]
    })
      .populate("hotelId", "name")
      .populate("roomTypeId", "name")
      .sort({ createdAt: -1 });

    res.json({ success: true, reservations });
  })
);

module.exports = router;
