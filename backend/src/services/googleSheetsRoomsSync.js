const { google } = require("googleapis");
const RoomReservation = require("../models/RoomReservation");

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
  try {
    const sheetId = process.env.ROOMS_GOOGLE_SHEET_ID;
    if (!sheetId) {
      console.log("Skipping Rooms export sync: ROOMS_GOOGLE_SHEET_ID is not configured");
      return;
    }

    if (!isGoogleConfigured()) {
      console.log("Skipping Rooms export sync: Google Service Account not configured");
      return;
    }

    // Query all reservations and populate hotel and room type
    const reservations = await RoomReservation.find({})
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

    // Clear existing data ONLY in columns A:R
    // This allows the admin to write manual notes in columns S, T, etc.
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: "A:R"
    });

    // Write new data into A1 (which spans up to R depending on rows structure)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: rows
      }
    });

    console.log(`Successfully synced ${reservations.length} Rooms reservations to Google Sheet.`);

  } catch (err) {
    // Catch all errors safely to prevent booking flows from blocking
    console.error("Failed to sync Rooms Google Sheet:", err.message);
  }
}

module.exports = {
  syncRoomsGoogleSheet
};
