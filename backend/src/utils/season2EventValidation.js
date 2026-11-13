const mongoose = require("mongoose");
const apiError = require("./apiError");

const EVENT_STATUSES = ["AVAILABLE", "UNAVAILABLE", "COMING_SOON"];
const EVENT_TIMEZONE = "Africa/Cairo";
const MAX_TICKET_PRICE_EGP = 1000000;

function requiredText(value, label, min, max) {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    throw apiError(`${label} is required (${min}-${max} characters).`, 422);
  }
  return text;
}

function parseEventDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw apiError("Event date must be a valid date (YYYY-MM-DD).", 422);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw apiError("Event date must be a valid date (YYYY-MM-DD).", 422);
  }
  if (year < 2020 || year > 2100) throw apiError("Event date is out of range.", 422);
  return text;
}

function parseEventTime(value) {
  const text = String(value ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw apiError("Event time must be a valid time (HH:mm, Egypt time).", 422);
  }
  return text;
}

// Offset of Africa/Cairo from UTC at a given instant, in ms (handles DST).
function cairoOffsetMs(instantMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(instantMs));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return localAsUtc - Math.floor(instantMs / 1000) * 1000;
}

// "2026-07-01" + "21:30" in Egypt local time -> the UTC Date of that instant.
// No dependency: the offset is read from Intl, and refined once so it is also
// right on the day Egypt's clocks change.
function cairoLocalToUtc(eventDate, eventTime) {
  const [year, month, day] = eventDate.split("-").map(Number);
  const [hour, minute] = eventTime.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClockAsUtc - cairoOffsetMs(wallClockAsUtc);
  instant = wallClockAsUtc - cairoOffsetMs(instant);
  return new Date(instant);
}

function parseTicketPrice(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw apiError("Outcomer ticket price is required.", 422);
  }
  const price = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(price) || price <= 0 || price > MAX_TICKET_PRICE_EGP) {
    throw apiError(`Outcomer ticket price must be greater than 0 and at most ${MAX_TICKET_PRICE_EGP} EGP.`, 422);
  }
  if (Number(price.toFixed(2)) !== price) {
    throw apiError("Outcomer ticket price can have at most 2 decimal places.", 422);
  }
  return price;
}

function parseStatus(value) {
  if (!EVENT_STATUSES.includes(value)) {
    throw apiError(`Status must be one of: ${EVENT_STATUSES.join(", ")}.`, 422);
  }
  return value;
}

// Returns a de-duplicated array of valid ObjectId strings. Existence in the
// School collection is checked separately by the route.
function parseSchoolIds(value) {
  if (!Array.isArray(value)) throw apiError("schoolIds must be a list of School ids.", 422);
  const seen = new Set();
  for (const raw of value) {
    const id = String(raw ?? "");
    if (!mongoose.Types.ObjectId.isValid(id) || !/^[a-f0-9]{24}$/i.test(id)) {
      throw apiError("schoolIds contains an invalid School id.", 422);
    }
    seen.add(id.toLowerCase());
  }
  return [...seen];
}

function parseTabName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "Sheet1";
  if (text.length > 100) throw apiError("Sheet tab name is too long.", 422);
  return text;
}

module.exports = {
  EVENT_STATUSES,
  EVENT_TIMEZONE,
  requiredText,
  parseEventDate,
  parseEventTime,
  cairoLocalToUtc,
  parseTicketPrice,
  parseStatus,
  parseSchoolIds,
  parseTabName
};
