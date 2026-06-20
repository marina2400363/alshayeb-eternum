const { google } = require("googleapis");
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

async function syncEventIncomers(eventId) {
  const event = await Event.findById(eventId);
  if (!event || !event.googleSheetId) {
    throw new Error("Event or Google Sheet ID not found");
  }

  // Setup Auth
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  const sheets = google.sheets({ version: "v4", auth });

  let rows = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: event.googleSheetId,
      range: "A:Z"
    });
    rows = response.data.values;
  } catch (err) {
    throw new Error(`Google Sheets API Error: ${err.message}`);
  }

  if (!rows || rows.length < 2) {
    return { imported: 0, skipped: 0, errors: 0 };
  }

  const headers = rows[0];
  const colIdx = getColumnIndexes(headers);

  if (colIdx.phone === undefined) {
    throw new Error("Could not find a 'phone' column in the sheet");
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 1; i < rows.length; i++) {
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

      const existing = await Attendee.findOne({ phoneNormalized, event: eventId });
      if (existing) {
        skipped++;
        continue;
      }

      const fullName = row[colIdx.name] || "Unknown Name";
      const email = row[colIdx.email] || "";
      const instagram = row[colIdx.instagram] || "";
      const gender = row[colIdx.gender] ? row[colIdx.gender].toLowerCase() : undefined;
      const university = row[colIdx.university] || "";
      const notes = row[colIdx.notes] || "";

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

  return { imported, skipped, errors };
}

module.exports = {
  syncEventIncomers
};
