const { google } = require("googleapis");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Attendee = require("../models/Attendee");
const { cleanPhone, isEgyptianPhone } = require("../utils/phone");
const { generateQrToken, generateUniqueQrId } = require("../utils/qr");

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

function getGoogleAuth() {
  if (!isGoogleConfigured()) {
    throw new Error("Google Service Account is not configured in environment variables.");
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

function extractSheetId(input) {
  if (!input) return null;
  const match = String(input).match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : String(input).trim();
}

function getColumnIndexes(headers) {
  const indexes = {};
  (headers || []).forEach((header, i) => {
    const h = String(header || "").toLowerCase().trim();
    if ((h.includes("name") || h.includes("fullName") || h.includes("full_name")) && !h.includes("school") && indexes.name === undefined) {
      indexes.name = i;
    } else if ((h.includes("phone") || h.includes("mobile") || h.includes("number") || h.includes("tel")) && indexes.phone === undefined) {
      indexes.phone = i;
    } else if ((h.includes("school") || h.includes("university") || h.includes("prom") || h.includes("college")) && indexes.school === undefined) {
      indexes.school = i;
    }
  });

  // Default fallback if headers were not named strictly
  if (indexes.name === undefined) indexes.name = 0;
  if (indexes.phone === undefined) indexes.phone = 1;
  if (indexes.school === undefined) indexes.school = 2;

  return indexes;
}

/**
 * Fetches raw values array from Google Sheets API using Service Account
 */
async function fetchSheetValues(rawSheetId, tabName = "Sheet1") {
  const sheetId = extractSheetId(rawSheetId);
  if (!sheetId) {
    throw new Error("Invalid Google Sheet ID or URL provided.");
  }

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const safeTab = tabName ? String(tabName).trim() : "Sheet1";
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${safeTab}'!A:Z`
    });

    const rows = response.data.values || [];
    return { sheetId, tabName: safeTab, rows };
  } catch (err) {
    if (err.message && err.message.includes("Unable to parse range")) {
      throw new Error(`Tab name '${safeTab}' was not found in the spreadsheet. Please check tab name.`);
    }
    throw new Error(`Google Sheets API error: ${err.message}. Make sure the sheet is shared with ${process.env.GOOGLE_CLIENT_EMAIL || "the service account"} as Editor or Viewer.`);
  }
}

/**
 * Previews a Guest List Google Sheet for an event without writing to MongoDB.
 */
async function previewGuestListSheet(eventId, sheetIdOverride, tabNameOverride) {
  const event = await Event.findById(eventId);
  if (!event) {
    throw new Error("Target Event not found.");
  }

  const targetSheetId = sheetIdOverride || event.guestListSheetId;
  const targetTabName = tabNameOverride || event.guestListTabName || "Sheet1";

  if (!targetSheetId) {
    throw new Error("No Guest List Sheet ID connected for this event. Please enter a Sheet ID first.");
  }

  const { sheetId, tabName, rows } = await fetchSheetValues(targetSheetId, targetTabName);

  if (!rows || rows.length === 0) {
    throw new Error("The specified sheet tab is completely empty.");
  }

  let headerRowIndex = 0;
  let headers = rows[0];
  let colIdx = getColumnIndexes(headers);

  // If first row looks like data, default to index 0/1/2
  const firstRowFirstVal = String(rows[0][0] || "").toLowerCase().trim();
  if (firstRowFirstVal.includes("name") || firstRowFirstVal.includes("full")) {
    headerRowIndex = 0;
  }

  const dataRows = rows.slice(headerRowIndex + 1);

  let totalRows = dataRows.length;
  let invalidPhones = 0;
  let missingNames = 0;
  let inSheetDuplicates = 0;

  const validRows = [];
  const seenSheetPhones = new Set();

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rawName = String(row[colIdx.name] || "").trim();
    const rawPhone = String(row[colIdx.phone] || "").trim();
    const rawSchool = String(row[colIdx.school] || "").trim();

    if (!rawName) {
      missingNames++;
      continue;
    }

    const phoneNormalized = cleanPhone(rawPhone);
    if (!phoneNormalized || !isEgyptianPhone(phoneNormalized)) {
      invalidPhones++;
      continue;
    }

    if (seenSheetPhones.has(phoneNormalized)) {
      inSheetDuplicates++;
      continue;
    }
    seenSheetPhones.add(phoneNormalized);

    validRows.push({
      rowIndex: i + headerRowIndex + 2,
      fullName: rawName,
      phone: rawPhone,
      phoneNormalized,
      school: rawSchool
    });
  }

  // Check how many of the valid phones already exist in MongoDB for this event
  const validPhonesList = validRows.map(r => r.phoneNormalized);
  const existingInDbDocs = await Attendee.find({
    event: event._id,
    phoneNormalized: { $in: validPhonesList }
  }).select("phoneNormalized fullName university").lean();

  const existingPhoneSet = new Set(existingInDbDocs.map(d => d.phoneNormalized));

  let existingInDb = 0;
  let willCreate = 0;
  let willUpdate = 0;

  validRows.forEach(r => {
    if (existingPhoneSet.has(r.phoneNormalized)) {
      existingInDb++;
      willUpdate++;
    } else {
      willCreate++;
    }
  });

  return {
    success: true,
    eventId: event._id,
    eventName: event.name,
    sheetId,
    tabName,
    totalRows,
    validRowsCount: validRows.length,
    invalidPhones,
    missingNames,
    inSheetDuplicates,
    existingInDb,
    willCreate,
    willUpdate,
    sampleRows: validRows.slice(0, 5)
  };
}

/**
 * Imports valid Guest List attendees from Google Sheet into MongoDB for an event.
 */
async function importGuestListSheet(eventId, sheetIdOverride, tabNameOverride) {
  const event = await Event.findById(eventId);
  if (!event) {
    throw new Error("Target Event not found.");
  }

  const targetSheetId = sheetIdOverride || event.guestListSheetId;
  const targetTabName = tabNameOverride || event.guestListTabName || "Sheet1";

  if (!targetSheetId) {
    throw new Error("No Guest List Sheet ID connected for this event. Please enter a Sheet ID first.");
  }

  const { sheetId, tabName, rows } = await fetchSheetValues(targetSheetId, targetTabName);

  if (!rows || rows.length === 0) {
    throw new Error("The specified sheet tab is completely empty.");
  }

  let headerRowIndex = 0;
  let headers = rows[0];
  let colIdx = getColumnIndexes(headers);

  const firstRowFirstVal = String(rows[0][0] || "").toLowerCase().trim();
  if (firstRowFirstVal.includes("name") || firstRowFirstVal.includes("full")) {
    headerRowIndex = 0;
  }

  const dataRows = rows.slice(headerRowIndex + 1);

  let totalRows = dataRows.length;
  let invalidPhones = 0;
  let missingNames = 0;
  let inSheetDuplicates = 0;

  const validRows = [];
  const seenSheetPhones = new Set();

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rawName = String(row[colIdx.name] || "").trim();
    const rawPhone = String(row[colIdx.phone] || "").trim();
    const rawSchool = String(row[colIdx.school] || "").trim();

    if (!rawName) {
      missingNames++;
      continue;
    }

    const phoneNormalized = cleanPhone(rawPhone);
    if (!phoneNormalized || !isEgyptianPhone(phoneNormalized)) {
      invalidPhones++;
      continue;
    }

    if (seenSheetPhones.has(phoneNormalized)) {
      inSheetDuplicates++;
      continue;
    }
    seenSheetPhones.add(phoneNormalized);

    validRows.push({
      fullName: rawName,
      phone: rawPhone,
      phoneNormalized,
      school: rawSchool
    });
  }

  let createdCount = 0;
  let updatedCount = 0;

  for (const item of validRows) {
    const existing = await Attendee.findOne({
      phoneNormalized: item.phoneNormalized,
      event: event._id
    });

    if (existing) {
      // Update safe profile fields if provided and changed
      let changed = false;
      if (item.fullName && existing.fullName !== item.fullName) {
        existing.fullName = item.fullName;
        changed = true;
      }
      if (item.school && existing.university !== item.school) {
        existing.university = item.school;
        changed = true;
      }

      if (changed) {
        await existing.save();
      }
      updatedCount++;
    } else {
      // Create new Guest List attendee with unique QR credentials
      const qrId = await generateUniqueQrId(Attendee, event.prefix);
      const qrToken = generateQrToken();

      await Attendee.create({
        fullName: item.fullName,
        phone: item.phone,
        phoneNormalized: item.phoneNormalized,
        university: item.school,
        event: event._id,
        eventName: event.name,
        attendeeType: "guest",
        accessType: "GUEST LIST",
        status: "approved",
        paymentStatus: "not_required",
        qrId,
        qrToken,
        qrStatus: "active",
        qrIssuedAt: new Date(),
        reviewedAt: new Date(),
        isUsed: false,
        scanCount: 0,
        scannedAt: null
      });

      createdCount++;
    }
  }

  // Update Event model with saved sheet ID/tab name and sync stats
  event.guestListSheetId = sheetId;
  event.guestListTabName = tabName;
  event.guestListSync = {
    lastImportAt: new Date(),
    lastImportStatus: "success",
    importedCount: createdCount + updatedCount,
    createdCount,
    updatedCount,
    invalidCount: invalidPhones + missingNames,
    duplicateCount: inSheetDuplicates
  };
  await event.save();

  console.log(`[GuestListImport] ${event.name}: Created ${createdCount}, Updated ${updatedCount}, Invalid ${invalidPhones + missingNames}, Duplicates ${inSheetDuplicates}`);

  return {
    success: true,
    eventId: event._id,
    eventName: event.name,
    sheetId,
    tabName,
    totalRows,
    importedCount: createdCount + updatedCount,
    createdCount,
    updatedCount,
    invalidCount: invalidPhones + missingNames,
    duplicateCount: inSheetDuplicates
  };
}

module.exports = {
  previewGuestListSheet,
  importGuestListSheet
};
