const { google } = require("googleapis");
const mongoose = require("mongoose");

const Attendee = require("../models/Attendee");
const SchoolFinanceConfig = require("../models/SchoolFinanceConfig");
const FullPaymentStatus = require("../models/FullPaymentStatus");

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

function getGoogleAuth() {
  if (!isGoogleConfigured()) {
    throw new Error("Google Service Account is not configured in .env");
  }

  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

function quotedRange(tabName, a1Range) {
  return `'${String(tabName).replace(/'/g, "''")}'!${a1Range}`;
}

// Only exact, normalized "DONE" means confirmed. Everything else — blank,
// partial matches, other text — means not confirmed. Trim + case-insensitive
// only; no fuzzy matching.
function normalizeFullPaymentCell(rawValue) {
  return String(rawValue || "").trim().toUpperCase() === "DONE";
}

// Reads the accountant's manual "Full Payment" column (I) from one School's
// finance sheet and mirrors it into FullPaymentStatus. Read-only against
// Google Sheets — never writes a cell. MongoDB deposit/ticket data is never
// touched here; this only ever writes FullPaymentStatus documents.
async function syncFullPaymentFromSchoolSheet(schoolId) {
  const config = await SchoolFinanceConfig.findOne({ schoolId });

  if (!config) {
    return { success: false, skipped: true, reason: "No finance config exists for this school." };
  }

  if (!config.enabled) {
    return { success: false, skipped: true, reason: "Finance sync is disabled for this school." };
  }

  if (!config.googleSheetId) {
    return { success: false, skipped: true, reason: "No googleSheetId configured for this school." };
  }

  if (!isGoogleConfigured()) {
    return { success: false, skipped: true, reason: "Google Service Account is not configured." };
  }

  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheetId,
      range: quotedRange(config.tabName, "A:I")
    });

    const values = response.data.values || [];
    // Row 1 is always treated as the header, matching the write-sync
    // service's own convention — never read as a data row.
    const dataRows = values.slice(1);

    const idOccurrences = new Map();
    for (const row of dataRows) {
      const customerId = String(row[0] || "").trim();
      if (!customerId) continue;
      idOccurrences.set(customerId, (idOccurrences.get(customerId) || 0) + 1);
    }

    const duplicateIds = new Set(
      [...idOccurrences.entries()].filter(([, count]) => count > 1).map(([id]) => id)
    );

    const candidateRows = [];
    const unknownIds = [];

    for (const row of dataRows) {
      const customerId = String(row[0] || "").trim();
      if (!customerId) continue;
      if (duplicateIds.has(customerId)) continue; // reported separately, never applied

      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        unknownIds.push(customerId);
        continue;
      }

      candidateRows.push({ customerId, sheetValue: row[8] !== undefined ? row[8] : "" });
    }

    const attendees = candidateRows.length
      ? await Attendee.find({ _id: { $in: candidateRows.map((r) => r.customerId) } })
          .select("attendeeType schoolId")
          .lean()
      : [];
    const attendeeMap = new Map(attendees.map((a) => [String(a._id), a]));

    const wrongSchoolIds = [];
    const toApply = [];

    for (const candidate of candidateRows) {
      const attendee = attendeeMap.get(candidate.customerId);

      if (!attendee || attendee.attendeeType !== "incomer") {
        unknownIds.push(candidate.customerId);
        continue;
      }

      if (String(attendee.schoolId) !== String(schoolId)) {
        wrongSchoolIds.push(candidate.customerId);
        continue;
      }

      toApply.push({
        attendeeId: candidate.customerId,
        confirmed: normalizeFullPaymentCell(candidate.sheetValue),
        sheetValue: String(candidate.sheetValue || "")
      });
    }

    const existingStatuses = toApply.length
      ? await FullPaymentStatus.find({ attendeeId: { $in: toApply.map((r) => r.attendeeId) } }).lean()
      : [];
    const existingMap = new Map(existingStatuses.map((s) => [String(s.attendeeId), s]));

    const now = new Date();
    let confirmedCount = 0;
    let unconfirmedCount = 0;

    for (const item of toApply) {
      const existing = existingMap.get(item.attendeeId);
      const wasConfirmed = existing ? existing.confirmed : false;

      // Only bump confirmedAt on a false/absent -> true transition; leave it
      // untouched on a true -> true re-sync or a true -> false reversal, so
      // it records when DONE was first observed rather than every sync run.
      const confirmedAt = item.confirmed
        ? (wasConfirmed ? existing.confirmedAt : now)
        : (existing ? existing.confirmedAt : undefined);

      // eslint-disable-next-line no-await-in-loop
      await FullPaymentStatus.findOneAndUpdate(
        { attendeeId: item.attendeeId },
        {
          $set: {
            confirmed: item.confirmed,
            confirmedAt,
            lastSyncedAt: now,
            lastSheetValue: item.sheetValue
          },
          $setOnInsert: { attendeeId: item.attendeeId }
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );

      if (item.confirmed) {
        confirmedCount += 1;
      } else {
        unconfirmedCount += 1;
      }
    }

    return {
      success: true,
      syncedCount: toApply.length,
      confirmedCount,
      unconfirmedCount,
      skippedUnknown: unknownIds,
      skippedWrongSchool: wrongSchoolIds,
      duplicateCustomerIds: [...duplicateIds]
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  syncFullPaymentFromSchoolSheet
};
