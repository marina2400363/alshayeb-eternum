const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");

const Season2Event = require("../models/Season2Event");
const School = require("../models/School");
const SchoolFinanceConfig = require("../models/SchoolFinanceConfig");
const LegacyEvent = require("../models/Event");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { parseSpreadsheetId, buildSpreadsheetUrl } = require("../utils/googleSheetUrl");
const { MULTER_FILE_SIZE_LIMIT, MAX_CUSTOMER_UPLOAD_LABEL } = require("../utils/uploadLimits");
const { uploadSeason2EventThumbnail, deleteSeason2EventThumbnail } = require("../utils/cloudinaryUpload");
const {
  requiredText,
  parseEventDate,
  parseEventTime,
  cairoLocalToUtc,
  parseTicketPrice,
  parseStatus,
  parseSchoolIds,
  parseTabName
} = require("../utils/season2EventValidation");

// ADMIN-ONLY Events Management. Mounted in app.js behind requireAdmin at
// /api/admin/season2-events. There is no public route here, no customer data,
// no Google API call and no Sheet write: the Sheet is only a stored reference.
const router = express.Router();

const THUMBNAIL_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

const thumbnailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MULTER_FILE_SIZE_LIMIT, files: 1 },
  fileFilter(req, file, callback) {
    if (!THUMBNAIL_MIME_TYPES.includes(file.mimetype)) {
      callback(apiError("Only PNG, JPG or WebP images are allowed.", 422));
      return;
    }
    callback(null, true);
  }
});

function receiveThumbnail(req, res, next) {
  thumbnailUpload.single("thumbnail")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? `The thumbnail must be ${MAX_CUSTOMER_UPLOAD_LABEL} or smaller.`
          : "Upload a single image in the thumbnail field.";
      return next(apiError(message, 422));
    }
    return next(error);
  });
}

// The server never trusts the browser's mimetype alone: check the real bytes.
function looksLikeSupportedImage(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return isPng || isJpeg || isWebp;
}

function assertValidObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw apiError("A valid event id is required.", 422);
  }
}

async function assertSchoolsExist(schoolIds) {
  if (!schoolIds.length) return;
  const found = await School.countDocuments({ _id: { $in: schoolIds } });
  if (found !== schoolIds.length) {
    throw apiError("One or more selected Schools do not exist.", 422);
  }
}

// An event Sheet must be its own Sheet: never a School Finance Sheet, never one
// the legacy (Season 1) sync cron reads, never another event's Sheet.
async function assertSheetIsDedicated(spreadsheetId, ownEventId) {
  const [financeClash, legacyClash, eventClash] = await Promise.all([
    SchoolFinanceConfig.exists({ googleSheetId: spreadsheetId }),
    LegacyEvent.exists({
      $or: [{ googleSheetId: spreadsheetId }, { exportGoogleSheetId: spreadsheetId }, { guestListSheetId: spreadsheetId }]
    }),
    Season2Event.exists({
      "sheet.spreadsheetId": spreadsheetId,
      ...(ownEventId ? { _id: { $ne: ownEventId } } : {})
    })
  ]);

  if (financeClash) {
    throw apiError("This Sheet is already used as a School Finance Sheet. Each event needs its own separate Sheet.", 409);
  }
  if (legacyClash) {
    throw apiError("This Sheet is already used by an existing (Season 1) event. Each event needs its own separate Sheet.", 409);
  }
  if (eventClash) {
    throw apiError(SHEET_ALREADY_ASSIGNED_MESSAGE, 409);
  }
}

const SHEET_ALREADY_ASSIGNED_MESSAGE =
  "This Sheet is already assigned to another event. Each event needs its own Sheet.";

// Saves an event; a duplicate-key error on the Sheet index (two Admins saving the
// same Sheet at once) becomes the same clear 409 as the pre-check.
async function saveEvent(event) {
  try {
    await event.save();
  } catch (error) {
    if (error && error.code === 11000 && /spreadsheetId/i.test(String(error.message) + JSON.stringify(error.keyPattern || {}))) {
      throw apiError(SHEET_ALREADY_ASSIGNED_MESSAGE, 409);
    }
    throw error;
  }
}

function serialize(event, schoolNames) {
  const plain = typeof event.toObject === "function" ? event.toObject() : event;
  const schoolIds = (plain.schoolIds || []).map(String);
  const spreadsheetId = plain.sheet?.spreadsheetId || null;

  return {
    _id: String(plain._id),
    name: plain.name,
    eventDate: plain.eventDate,
    eventTime: plain.eventTime,
    timezone: plain.timezone,
    startsAt: plain.startsAt,
    location: plain.location,
    thumbnailUrl: plain.thumbnail?.url || null,
    schoolIds,
    // Name only — never an Access Code or any other School field.
    schools: schoolIds.map((id) => ({ _id: id, name: schoolNames.get(id) || "Unknown School" })),
    outcomerTicketPriceEGP: plain.outcomerTicketPriceEGP,
    status: plain.status,
    sheet: {
      spreadsheetId,
      tabName: plain.sheet?.tabName || "Sheet1",
      url: buildSpreadsheetUrl(spreadsheetId)
    },
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt
  };
}

async function loadSchoolNames(events) {
  const ids = [...new Set(events.flatMap((event) => (event.schoolIds || []).map(String)))];
  if (!ids.length) return new Map();
  const schools = await School.find({ _id: { $in: ids } }).select("name");
  return new Map(schools.map((school) => [String(school._id), school.name]));
}

async function respondWith(res, event, status = 200) {
  const names = await loadSchoolNames([event]);
  res.status(status).json({ success: true, event: serialize(event, names) });
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status !== undefined && req.query.status !== "") {
      filter.status = parseStatus(String(req.query.status));
    }
    const events = await Season2Event.find(filter).sort({ startsAt: 1 });
    const names = await loadSchoolNames(events);
    res.json({ success: true, events: events.map((event) => serialize(event, names)) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const event = await Season2Event.findById(req.params.id);
    if (!event) throw apiError("Event not found.", 404);
    await respondWith(res, event);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const eventDate = parseEventDate(body.eventDate);
    const eventTime = parseEventTime(body.eventTime);
    const schoolIds = body.schoolIds === undefined ? [] : parseSchoolIds(body.schoolIds);
    await assertSchoolsExist(schoolIds);

    if (body.sheetUrl === undefined || String(body.sheetUrl).trim() === "") {
      throw apiError("A dedicated Google Sheet link or ID is required for every event.", 422);
    }
    const sheet = { spreadsheetId: parseSpreadsheetId(body.sheetUrl), tabName: parseTabName(body.sheetTabName) };
    await assertSheetIsDedicated(sheet.spreadsheetId, null);

    const event = new Season2Event({
      name: requiredText(body.name, "Event name", 2, 120),
      eventDate,
      eventTime,
      startsAt: cairoLocalToUtc(eventDate, eventTime),
      location: requiredText(body.location, "Event location", 2, 200),
      schoolIds,
      outcomerTicketPriceEGP: parseTicketPrice(body.outcomerTicketPriceEGP),
      status: body.status === undefined || body.status === "" ? "COMING_SOON" : parseStatus(body.status),
      sheet
    });
    await saveEvent(event);

    await respondWith(res, event, 201);
  })
);

// Partial update: only the fields present in the body change. Required fields
// can be replaced but never blanked.
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const body = req.body || {};
    const event = await Season2Event.findById(req.params.id);
    if (!event) throw apiError("Event not found.", 404);

    if (body.name !== undefined) event.name = requiredText(body.name, "Event name", 2, 120);
    if (body.location !== undefined) event.location = requiredText(body.location, "Event location", 2, 200);
    if (body.outcomerTicketPriceEGP !== undefined) {
      event.outcomerTicketPriceEGP = parseTicketPrice(body.outcomerTicketPriceEGP);
    }
    if (body.status !== undefined) event.status = parseStatus(body.status);

    if (body.eventDate !== undefined || body.eventTime !== undefined) {
      const eventDate = body.eventDate !== undefined ? parseEventDate(body.eventDate) : event.eventDate;
      const eventTime = body.eventTime !== undefined ? parseEventTime(body.eventTime) : event.eventTime;
      event.eventDate = eventDate;
      event.eventTime = eventTime;
      event.startsAt = cairoLocalToUtc(eventDate, eventTime);
    }

    if (body.schoolIds !== undefined) {
      const schoolIds = parseSchoolIds(body.schoolIds);
      await assertSchoolsExist(schoolIds);
      event.schoolIds = schoolIds;
    }

    if (body.sheetTabName !== undefined) {
      event.sheet = { ...(event.sheet?.toObject?.() || event.sheet || {}), tabName: parseTabName(body.sheetTabName) };
    }

    if (body.sheetUrl !== undefined) {
      const current = event.sheet?.toObject?.() || event.sheet || {};
      if (String(body.sheetUrl).trim() === "") {
        throw apiError("A dedicated Google Sheet link or ID is required for every event.", 422);
      }
      const spreadsheetId = parseSpreadsheetId(body.sheetUrl);
      if (spreadsheetId !== current.spreadsheetId) {
        await assertSheetIsDedicated(spreadsheetId, event._id);
      }
      event.sheet = { ...current, spreadsheetId };
    }

    await saveEvent(event);
    await respondWith(res, event);
  })
);

// Multipart: field "thumbnail". Replaces the stored thumbnail; the previous
// asset is removed only if it lives in the Season 2 event-thumbnail folder.
router.post(
  "/:id/thumbnail",
  receiveThumbnail,
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    if (!req.file) throw apiError("A thumbnail image is required.", 422);
    if (!looksLikeSupportedImage(req.file.buffer)) {
      throw apiError("The file is not a valid PNG, JPG or WebP image.", 422);
    }

    const event = await Season2Event.findById(req.params.id);
    if (!event) throw apiError("Event not found.", 404);

    const result = await uploadSeason2EventThumbnail(req.file);
    if (!result || !result.secure_url || !result.public_id) {
      throw apiError("The thumbnail could not be uploaded. Please try again.", 502);
    }

    const previousPublicId = event.thumbnail?.publicId;
    event.thumbnail = { url: result.secure_url, publicId: result.public_id };

    try {
      await event.save();
    } catch (error) {
      await deleteSeason2EventThumbnail(result.public_id);
      throw error;
    }

    if (previousPublicId && previousPublicId !== result.public_id) {
      await deleteSeason2EventThumbnail(previousPublicId);
    }

    await respondWith(res, event);
  })
);

module.exports = router;
