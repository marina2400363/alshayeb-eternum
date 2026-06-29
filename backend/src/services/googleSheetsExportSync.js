const { google } = require("googleapis");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Attendee = require("../models/Attendee");

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

function getGoogleAuth() {
  if (!isGoogleConfigured()) {
    throw new Error("Google Service Account is not configured in .env");
  }

  // Handle newlines and accidental surrounding quotes securely
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

/**
 * Syncs the confirmed outcomers to the specified event's export sheet.
 * @param {string} eventId
 */
async function syncEventExportSheet(eventId) {
  try {
    if (!isGoogleConfigured()) {
      console.log("Skipping export sync: Google Service Account not configured.");
      return;
    }

    let event;
    const actualEventId = typeof eventId === 'object' && eventId !== null && eventId._id ? eventId._id.toString() : String(eventId);

    if (mongoose.Types.ObjectId.isValid(actualEventId)) {
      event = await Event.findById(actualEventId);
    }
    if (!event) {
      event = await Event.findOne({ name: new RegExp(`^${actualEventId}$`, 'i') });
    }
    if (!event) {
      console.error(`Export sync failed: Event ${actualEventId} not found.`);
      return;
    }

    const sheetId = event.exportGoogleSheetId;
    if (!sheetId) {
      // Event has no export sheet configured
      return;
    }

    // Prepare query for Confirmed Outcomers ONLY
    // Status MUST be approved or confirmed
    // Payment status MUST be verified if price > 0
    const query = {
      event: event._id,
      attendeeType: "outcomer",
      status: { $in: ["approved", "confirmed", "active", "verified"] }
    };

    if (event.price > 0) {
      query.paymentStatus = { $in: ["verified", "confirmed", "approved"] };
    }

    const attendees = await Attendee.find(query).sort({ updatedAt: -1 });

    // Format headers
    const headers = [
      "Ticket ID",
      "Name",
      "Phone Number",
      "School",
      "Access Type",
      "Status",
      "Personal Photo",
      "Payment Proof",
      "Date Approved"
    ];

    // Format rows
    const rows = [headers];

    for (const attendee of attendees) {
      rows.push([
        attendee.qrId || "",
        attendee.fullName || attendee.name || "",
        attendee.phone || attendee.phoneNumber || "",
        attendee.university || attendee.school || "",
        attendee.accessType || "OUTCOMER",
        attendee.status || "",
        attendee.outcomerPhoto?.url || "",
        attendee.paymentProof?.url || "",
        attendee.updatedAt ? attendee.updatedAt.toISOString().split("T")[0] : ""
      ]);
    }

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Write new data into A1 (overwrites existing rows)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: rows
      }
    });

    // Clear any leftover data BELOW the newly written rows
    const lastRow = rows.length;
    await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: `A${lastRow + 1}:Z`
    });

    console.log(`Successfully synced ${attendees.length} confirmed outcomers to export sheet for event ${event.name}.`);

  } catch (err) {
    console.error(`Failed to sync export sheet for event ${eventId}:`, err);
  }
}

module.exports = {
  syncEventExportSheet
};
