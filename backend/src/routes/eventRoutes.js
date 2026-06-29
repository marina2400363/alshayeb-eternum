const express = require("express");

const Event = require("../models/Event");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { requireAdmin, getJwtSecret } = require("../middleware/requireAdmin");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { uploadEventBanner } = require("../utils/cloudinaryUpload");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.mimetype)) {
      callback(apiError("Only PNG, JPG, or JPEG images are allowed.", 422));
      return;
    }
    callback(null, true);
  }
});

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const events = await Event.find({});
    
    // Sort events by displayOrder ascending, fallback to createdAt ascending
    events.sort((a, b) => {
      const orderA = a.displayOrder !== undefined && a.displayOrder !== null ? a.displayOrder : 999;
      const orderB = b.displayOrder !== undefined && b.displayOrder !== null ? b.displayOrder : 999;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        jwt.verify(authHeader.slice(7), getJwtSecret());
        isAdmin = true;
      } catch (err) {}
    }

    const returnedEvents = isAdmin ? events : events.map(e => ({
      _id: e._id,
      name: e.name,
      slug: e.slug,
      date: e.date,
      entryTime: e.entryTime,
      venue: e.venue,
      status: e.status,
      prefix: e.prefix,
      displayOrder: e.displayOrder,
      bannerImageUrl: e.bannerImageUrl,
      eventTypeLabel: e.eventTypeLabel,
      tagline: e.tagline,
      description: e.description,
      capacity: e.capacity,
      schools: e.schools,
      price: e.price,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt
    }));

    res.json({ success: true, events: returnedEvents });
  })
);

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, slug, date, entryTime, venue, status, schools, prefix, price, googleSheetId, exportGoogleSheetId, capacity, displayOrder, bannerImageUrl, tagline, description, eventTypeLabel } = req.body;

    if (!name || !slug) {
      throw apiError("Event name and slug are required.");
    }
    
    if (!prefix) {
      throw apiError("Event prefix is required for QR ID generation.");
    }

    if (price === undefined || price === null) {
      throw apiError("Event price is required.");
    }

    const parsedOrder = displayOrder !== undefined && displayOrder !== "" && !isNaN(Number(displayOrder)) ? Number(displayOrder) : 999;

    const event = await Event.create({
      name,
      slug,
      date,
      entryTime,
      venue,
      status,
      schools,
      prefix,
      price,
      googleSheetId,
      exportGoogleSheetId,
      capacity: capacity || 0,
      displayOrder: parsedOrder,
      bannerImageUrl,
      eventTypeLabel,
      tagline,
      description
    });

    res.status(201).json({ success: true, event });
  })
);

router.put(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, slug, date, entryTime, venue, status, schools, prefix, price, googleSheetId, exportGoogleSheetId, capacity, displayOrder, bannerImageUrl, tagline, description, eventTypeLabel } = req.body;

    if (!prefix) {
      throw apiError("Event prefix is required for QR ID generation.");
    }

    if (price === undefined || price === null) {
      throw apiError("Event price is required.");
    }

    const parsedOrder = displayOrder !== undefined && displayOrder !== "" && !isNaN(Number(displayOrder)) ? Number(displayOrder) : 999;

    const event = await Event.findByIdAndUpdate(
      req.params.id,
      {
        name,
        slug,
        date,
        entryTime,
        venue,
        status,
        schools,
        prefix,
        price,
        googleSheetId,
        exportGoogleSheetId,
        capacity: capacity || 0,
        displayOrder: parsedOrder,
        bannerImageUrl,
        eventTypeLabel,
        tagline,
        description
      },
      { new: true, runValidators: true }
    );

    if (!event) {
      throw apiError("Event not found", 404);
    }

    res.json({ success: true, event });
  })
);

router.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      throw apiError("Event not found", 404);
    }
    res.json({ success: true, message: "Event deleted successfully." });
  })
);

router.post(
  "/:id/banner",
  requireAdmin,
  upload.single("bannerImage"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw apiError("Banner image file is required.", 422);
    }
    const result = await uploadEventBanner(req.file);
    if (!result || !result.secure_url) {
      throw apiError("Failed to upload banner image to Cloudinary.", 500);
    }
    const event = await Event.findByIdAndUpdate(
      req.params.id,
      { bannerImageUrl: result.secure_url },
      { new: true, runValidators: true }
    );
    if (!event) {
      throw apiError("Event not found", 404);
    }
    res.json({ success: true, event });
  })
);

module.exports = router;
