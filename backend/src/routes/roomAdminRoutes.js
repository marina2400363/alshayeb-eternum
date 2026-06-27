const express = require("express");
const Hotel = require("../models/Hotel");
const RoomType = require("../models/RoomType");
const RoomReservation = require("../models/RoomReservation");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");

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

    const reservation = await RoomReservation.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate("hotelId", "name").populate("roomTypeId", "name");

    if (!reservation) throw apiError("Reservation not found.", 404);
    res.json({ success: true, reservation });
  })
);

module.exports = router;
