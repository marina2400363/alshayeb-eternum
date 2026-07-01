const { google } = require("googleapis");
const RoomReservation = require("../models/RoomReservation");
const Hotel = require("../models/Hotel");
const RoomType = require("../models/RoomType");

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
 * Syncs the Rooms Reservations to the dedicated Google Sheet.
 * Completely independent of the QR/Event system.
 */
async function syncRoomsGoogleSheet() {
    const sheetId = process.env.ROOMS_GOOGLE_SHEET_ID;
    if (!sheetId) {
      return { success: false, message: "ROOMS_GOOGLE_SHEET_ID is not configured in environment" };
    }

    if (!isGoogleConfigured()) {
      return { success: false, message: "Google Service Account is not configured in environment" };
    }

    // Query only confirmed reservations and populate hotel and room type
    const reservations = await RoomReservation.find({ reservationStatus: 'confirmed' })
      .populate("hotelId", "name")
      .populate("roomTypeId", "name")
      .sort({ createdAt: -1 });

    // Format headers
    const headers = [
      "Reservation ID",      // A
      "Created At",          // B
      "Full Name",           // C
      "Phone Number",        // D
      "National ID",         // E
      "Email Address",       // F
      "Nationality",         // G
      "Hotel",               // H
      "Room Type",           // I
      "Check-in",            // J
      "Check-out",           // K
      "Stay Duration (Nights)",// L
      "Price Per Night",     // M
      "Total Amount",        // N
      "Payment Method",      // O
      "Payment Status",      // P
      "Reservation Status",  // Q
      "Payment Proof URL"    // R
    ];

    // Format rows
    const rows = [headers];

    for (const r of reservations) {
      rows.push([
        r.reservationId || "",
        r.createdAt ? r.createdAt.toISOString() : "",
        r.fullName || "",
        r.phoneNumber || "",
        r.nationalId || "",
        r.emailAddress || "",
        r.nationality || "",
        r.hotelId?.name || "N/A",
        r.roomTypeId?.name || "N/A",
        r.checkInDate ? r.checkInDate.toISOString().split("T")[0] : "",
        r.checkOutDate ? r.checkOutDate.toISOString().split("T")[0] : "",
        r.stayDuration || 0,
        r.pricePerNight || 0,
        r.totalAmount || 0,
        "Instapay", // Fixed to Instapay per requirements
        r.paymentStatus || "",
        r.reservationStatus || "",
        r.paymentProofUrl || ""
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

    // Clear any leftover data BELOW the newly written rows in columns A:R ONLY
    // This allows the admin to write manual notes in columns S, T, etc.
    const lastRow = rows.length;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `A${lastRow + 1}:R`
    });

    return { success: true, message: `Successfully synced ${reservations.length} Rooms reservations to Google Sheet.`, rowsCount: reservations.length };
}

module.exports = {
  syncRoomsGoogleSheet
};
