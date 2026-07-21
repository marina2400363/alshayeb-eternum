const { google } = require("googleapis");
const mongoose = require("mongoose");

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

/**
 * Normalizes access type and routes to the correct Google Sheet.
 * INCOMER, COMMITTEE -> Incomers Sheet
 * OUTCOMER, GUEST LIST, or Unknown -> Outcomers Sheet
 */
function getRoutingInfo(accessType) {
  const type = String(accessType || "").toUpperCase().trim();
  
  if (type.includes("INCOMER") || type.includes("COMMITTEE")) {
    return {
      type: "incomer",
      sheetId: "1NVi8BN5vq3mWuEDXEmiQDyRjvGZz3-Jj5fwqfcHGfZ4"
    };
  }
  
  // Fallback / Outcomer routing
  return {
    type: "outcomer",
    sheetId: "1QNKur0_BCPmdERZk4je1Jbtt-Ljy-55NQqkeiozBrH4"
  };
}

/**
 * Appends a successful scan to the appropriate Google Spreadsheet.
 * This function should be called asynchronously without blocking the main thread.
 * 
 * Required Columns:
 * - Ticket ID
 * - Access Type
 * - School
 * - Phone Number
 * - Full Name
 * - Event
 * - Scan Time
 * - Client Photo (outcomers only)
 */
async function appendSuccessfulScanToSheet(attendee) {
  try {
    if (!isGoogleConfigured()) {
      console.warn("Skipping scan logging: Google Service Account not configured.");
      return;
    }

    const routing = getRoutingInfo(attendee.accessType || attendee.attendeeType);
    const sheetId = routing.sheetId;

    const ticketId = attendee.qrId || attendee._id.toString();
    const accessType = (attendee.accessType || attendee.attendeeType || "UNKNOWN").toUpperCase();
    const school = attendee.university || attendee.school || "-";
    const phone = attendee.phone || attendee.phoneNumber || "-";
    const fullName = attendee.fullName || attendee.name || "-";
    const eventName = attendee.eventName || "-";
    
    // Format scan time using local timezone for readability if possible, or ISO.
    // Using simple ISO format mapped to local or just ISO string.
    const scanTime = attendee.scannedAt ? new Date(attendee.scannedAt).toLocaleString("en-GB") : new Date().toLocaleString("en-GB");

    // Client Photo (only applicable/required for outcomers, but we include it if it's the outcomer sheet)
    const photoUrl = attendee.outcomerPhoto?.url || "";

    const row = [
      ticketId,
      accessType,
      school,
      phone,
      fullName,
      eventName,
      scanTime
    ];

    // Outcomers sheet has an 8th column for Photo
    if (routing.type === "outcomer") {
      row.push(photoUrl);
    }

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A:Z", // Append to the first available row in the sheet
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [row]
      }
    });

    console.log(`Scan Logged Successfully: ${fullName} (${accessType}) -> Sheet ${routing.type}`);

  } catch (err) {
    // We catch and log here to prevent unhandled promise rejections
    // from crashing the node process, ensuring this remains non-blocking.
    console.error("Non-blocking Google Sheets append failed:", err.message);
  }
}

module.exports = {
  appendSuccessfulScanToSheet
};
