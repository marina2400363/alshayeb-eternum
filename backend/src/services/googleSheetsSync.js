const { parse } = require("csv-parse/sync");
const Attendee = require("../models/Attendee");
const Event = require("../models/Event");
const { cleanPhone } = require("../utils/phone");
const { generateQrToken, generateUniqueQrId } = require("../utils/qr");

// Define required columns (case-insensitive fuzzy match logic)
function getColumnIndexes(headers) {
  const indexes = {};
  headers.forEach((header, i) => {
    const h = (header || "").toString().toLowerCase().trim();
    if (h.includes("name") && !h.includes("instagram")) indexes.name = i;
    else if (h.includes("phone") || h.includes("mobile")) indexes.phone = i;
    else if (h.includes("email")) indexes.email = i;
    else if (h.includes("instagram") || h.includes("ig")) indexes.instagram = i;
    else if (h.includes("gender")) indexes.gender = i;
    else if (h.includes("school") || h.includes("university") || h.includes("prom")) indexes.university = i;
    else if (h.includes("notes") || h.includes("remark")) indexes.notes = i;
  });
  return indexes;
}

function extractSheetId(input) {
  if (!input) return null;
  const match = input.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : input.trim();
}

async function syncEventIncomers(eventId) {
  const event = await Event.findById(eventId);
  if (!event || !event.googleSheetId) {
    throw new Error("Event or Google Sheet ID not found");
  }

  const sheetId = extractSheetId(event.googleSheetId);
  if (!sheetId) {
    throw new Error("Invalid Google Sheet ID or URL");
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

  let rows = [];
  try {
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }
    const csvData = await response.text();
    
    // If it's an HTML page (like a login redirect), throw an error.
    if (csvData.trim().toLowerCase().startsWith("<!doctype html>") || csvData.trim().toLowerCase().startsWith("<html")) {
      throw new Error("Received HTML instead of CSV. Please make sure 'General access' is set to 'Anyone with the link'.");
    }

    rows = parse(csvData, {
      skip_empty_lines: true
    });
  } catch (err) {
    throw new Error(`Failed to fetch or parse published CSV: ${err.message}. Make sure the sheet is published to the web or viewable by anyone with the link.`);
  }

  if (!rows || rows.length < 2) {
    return { imported: 0, skipped: 0, errors: 0 };
  }

  let headerRowIndex = -1;
  let headers = [];
  let colIdx = {};

  // Scan the first 10 rows to find the one containing the "phone" column
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const tempColIdx = getColumnIndexes(rows[i]);
    if (tempColIdx.phone !== undefined) {
      headerRowIndex = i;
      headers = rows[i];
      colIdx = tempColIdx;
      break;
    }
  }

  if (headerRowIndex === -1 || colIdx.phone === undefined) {
    throw new Error("Could not find a 'phone' column in the sheet");
  }

  let imported = 0;
  let skipped = 0;
  let updatedCount = 0;
  let errors = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    try {
      const row = rows[i];
      const rawPhone = row[colIdx.phone];
      if (!rawPhone) {
        skipped++;
        continue;
      }

      const phoneNormalized = cleanPhone(rawPhone);
      if (!phoneNormalized) {
        skipped++;
        continue;
      }

      const fullName = row[colIdx.name] || "Unknown Name";
      const email = row[colIdx.email] || "";
      const instagram = row[colIdx.instagram] || "";
      const gender = row[colIdx.gender] ? row[colIdx.gender].toLowerCase() : undefined;
      const university = row[colIdx.university] || "";
      const notes = row[colIdx.notes] || "";

      const existing = await Attendee.findOne({ phoneNormalized, event: eventId });
      if (existing) {
        // If they already exist, fill in any missing fields from the sheet
        let updated = false;
        if (!existing.university && university) { existing.university = university; updated = true; }
        if (!existing.email && email) { existing.email = email; updated = true; }
        if (!existing.instagram && instagram) { existing.instagram = instagram; updated = true; }
        if (!existing.fullName || existing.fullName === "Unknown Name") {
            if (fullName && fullName !== "Unknown Name") { existing.fullName = fullName; updated = true; }
        }
        
        if (updated) { await existing.save(); updatedCount++; }
        skipped++;
        continue;
      }

      const qrId = await generateUniqueQrId(Attendee, event.prefix);
      const qrToken = generateQrToken();

      await Attendee.create({
        fullName,
        phone: rawPhone,
        phoneNormalized,
        email,
        instagram,
        gender: ["male", "female"].includes(gender) ? gender : undefined,
        university,
        notes,
        event: eventId,
        eventName: event.name,
        attendeeType: "incomer",
        accessType: "INCOMER",
        status: "approved",
        paymentStatus: "not_required",
        qrId,
        qrToken,
        qrStatus: "active",
        qrIssuedAt: new Date(),
        reviewedAt: new Date()
      });

      imported++;
    } catch (e) {
      console.error(`Error importing row ${i}:`, e);
      errors++;
    }
  }

  event.sync = {
    lastSyncAt: new Date(),
    lastSyncStatus: "success",
    importedCount: (event.sync?.importedCount || 0) + imported,
    skippedCount: (event.sync?.skippedCount || 0) + skipped,
    errorCount: (event.sync?.errorCount || 0) + errors
  };
  await event.save();

  return { imported, skipped, errors, debug: { headers: headers.slice(0,10), colIdx, updatedCount } };
}

module.exports = {
  syncEventIncomers
};
