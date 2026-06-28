const express = require("express");
const Hotel = require("../models/Hotel");
const RoomType = require("../models/RoomType");
const RoomReservation = require("../models/RoomReservation");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { sendRoomStatusEmail } = require("../utils/email");
const { syncRoomsGoogleSheet } = require("../services/googleSheetsRoomsSync");

const router = express.Router();

// --- HOTELS ---
router.get(
  "/hotels",
  asyncHandler(async (req, res) => {
    const hotels = await Hotel.find({}).sort({ displayOrder: 1, createdAt: -1 });
    res.json({ success: true, hotels });
  })
);

router.post(
  "/hotels",
  asyncHandler(async (req, res) => {
    const { name, description, status, startingPrice, displayOrder } = req.body;
    if (!name) throw apiError("Hotel name is required.");
    
    const hotel = await Hotel.create({
      name,
      description,
      status,
      startingPrice: Number(startingPrice) || 0,
      displayOrder: Number(displayOrder) || 999
    });
    res.status(201).json({ success: true, hotel });
  })
);

router.put(
  "/hotels/:id",
  asyncHandler(async (req, res) => {
    const { name, description, status, startingPrice, displayOrder } = req.body;
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      {
        name,
        description,
        status,
        startingPrice: Number(startingPrice) || 0,
        displayOrder: Number(displayOrder) || 999
      },
      { new: true, runValidators: true }
    );
    if (!hotel) throw apiError("Hotel not found.", 404);
    res.json({ success: true, hotel });
  })
);

router.delete(
  "/hotels/:id",
  asyncHandler(async (req, res) => {
    const hotel = await Hotel.findByIdAndDelete(req.params.id);
    if (!hotel) throw apiError("Hotel not found.", 404);
    await RoomType.deleteMany({ hotelId: req.params.id });
    res.json({ success: true, message: "Hotel deleted." });
  })
);

// --- ROOM TYPES ---
router.get(
  "/room-types",
  asyncHandler(async (req, res) => {
    const roomTypes = await RoomType.find({}).sort({ displayOrder: 1, createdAt: -1 });
    res.json({ success: true, roomTypes });
  })
);

router.post(
  "/room-types",
  asyncHandler(async (req, res) => {
    const { hotelId, name, description, capacity, breakfastIncluded, pricePerNight, status, displayOrder } = req.body;
    if (!hotelId || !name || pricePerNight === undefined) throw apiError("Hotel, Name, and Price are required.");
    
    const roomType = await RoomType.create({
      hotelId,
      name,
      description,
      capacity: Number(capacity) || 2,
      breakfastIncluded: Boolean(breakfastIncluded),
      pricePerNight: Number(pricePerNight),
      status,
      displayOrder: Number(displayOrder) || 999
    });
    res.status(201).json({ success: true, roomType });
  })
);

router.put(
  "/room-types/:id",
  asyncHandler(async (req, res) => {
    const { hotelId, name, description, capacity, breakfastIncluded, pricePerNight, status, displayOrder } = req.body;
    const roomType = await RoomType.findByIdAndUpdate(
      req.params.id,
      {
        hotelId,
        name,
        description,
        capacity: Number(capacity) || 2,
        breakfastIncluded: Boolean(breakfastIncluded),
        pricePerNight: Number(pricePerNight),
        status,
        displayOrder: Number(displayOrder) || 999
      },
      { new: true, runValidators: true }
    );
    if (!roomType) throw apiError("Room type not found.", 404);
    res.json({ success: true, roomType });
  })
);

router.delete(
  "/room-types/:id",
  asyncHandler(async (req, res) => {
    const roomType = await RoomType.findByIdAndDelete(req.params.id);
    if (!roomType) throw apiError("Room type not found.", 404);
    res.json({ success: true, message: "Room type deleted." });
  })
);

// --- RESERVATIONS ---
router.get(
  "/reservations",
  asyncHandler(async (req, res) => {
    const reservations = await RoomReservation.find({})
      .populate("hotelId", "name")
      .populate("roomTypeId", "name")
      .sort({ createdAt: -1 });
    res.json({ success: true, reservations });
  })
);

router.put(
  "/reservations/:id/status",
  asyncHandler(async (req, res) => {
    const { paymentStatus, reservationStatus } = req.body;
    const updateData = {};
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (reservationStatus) updateData.reservationStatus = reservationStatus;

    const existingReservation = await RoomReservation.findById(req.params.id);
    if (!existingReservation) throw apiError("Reservation not found.", 404);
    
    const oldStatus = existingReservation.reservationStatus;

    const reservation = await RoomReservation.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate("hotelId", "name").populate("roomTypeId", "name");

    res.json({ success: true, reservation });

    // Send emails asynchronously
    if (reservationStatus && oldStatus !== reservationStatus && reservation.emailAddress) {
      const formatDate = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const formatCurrency = (amount) => Number(amount).toLocaleString('en-US');
      
      let subject = "";
      let message = "";

      if (reservationStatus === "confirmed") {
        subject = "ALSHAYEB Rooms Reservation Confirmed";
        message = `Dear ${reservation.fullName},

We are thrilled to inform you that your reservation request has been officially confirmed!

Reservation Details:
• Reservation ID: ${reservation.reservationId}
• Hotel: ${reservation.hotelId?.name || "N/A"}
• Room Type: ${reservation.roomTypeId?.name || "N/A"}
• Check-in: ${formatDate(reservation.checkInDate)}
• Check-out: ${formatDate(reservation.checkOutDate)}
• Stay Duration: ${reservation.stayDuration} night(s)
• Total Amount: ${formatCurrency(reservation.totalAmount)} EGP
• Status: Confirmed

We look forward to welcoming you to the ALSHAYEB Experience.`;
      } else if (reservationStatus === "declined") {
        subject = "ALSHAYEB Rooms Reservation Update";
        message = `Dear ${reservation.fullName},

We regret to inform you that your reservation request has been declined.

Reservation Details:
• Reservation ID: ${reservation.reservationId}
• Hotel: ${reservation.hotelId?.name || "N/A"}
• Room Type: ${reservation.roomTypeId?.name || "N/A"}
• Check-in: ${formatDate(reservation.checkInDate)}
• Check-out: ${formatDate(reservation.checkOutDate)}
• Status: Declined

If you have any questions or concerns, please contact our support team.`;
      }

      if (message) {
        sendRoomStatusEmail(reservation, subject, message).catch(err => console.error("Admin email trigger failed", err));
      }
    }

    // Sync to Google Sheets asynchronously (trigger regardless of whether emails sent, to capture any status changes)
    syncRoomsGoogleSheet().catch(err => console.error("Sync trigger failed on admin update", err));
  })
);

module.exports = router;
