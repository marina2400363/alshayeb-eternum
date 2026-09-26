const { google } = require("googleapis");

const Attendee = require("../models/Attendee");
const Deposit = require("../models/Deposit");
const School = require("../models/School");
const SchoolFinanceConfig = require("../models/SchoolFinanceConfig");
const { calculateApprovedTotalPaid } = require("../utils/paymentCalculations");

// Final sheet layout (A:L). Column I ("Full Payment") sits in the MIDDLE of the
// system columns on purpose: it is the accountant's manually-edited column and
// must survive every sync, so every write below is split around it — A:H and
// J:L, never I. (It is read back, never written, by
// googleSheetsFullPaymentSync.js, which reads column I by position.)
//
//   A Customer ID          F Approved Payments   J Email
//   B Full Name            G Number of Payments  K Customer Photo Link
//   C Phone                H Total Paid          L Payment Proof Links
//   D School               I Full Payment  (accountant-owned — never written)
//   E Ticket Price
const HEADER_ROW = [
  "Customer ID",
  "Full Name",
  "Phone",
  "School",
  "Ticket Price",
  "Approved Payments",
  "Number of Payments",
  "Total Paid",
  "Full Payment",
  "Email",
  "Customer Photo Link",
  "Payment Proof Links"
];

const SYSTEM_HEADERS_A_TO_H = HEADER_ROW.slice(0, 8);
const SYSTEM_HEADERS_J_TO_L = HEADER_ROW.slice(9, 12);

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

// Column F — APPROVED amounts only, oldest first, e.g. "500, 1000, 2000".
// Pending and rejected Deposits are deliberately absent.
function formatApprovedPayments(deposits) {
  const approved = deposits.filter((deposit) => deposit.status === "approved");
  if (!approved.length) return "";
  return approved.map((deposit) => deposit.amount).join(", ");
}

// Column G — how many APPROVED Deposits (integer; 0 when none).
function countApprovedPayments(deposits) {
  return deposits.filter((deposit) => deposit.status === "approved").length;
}

// Column L — the payment-proof image URLs of ALL the customer's APPROVED
// Deposits, oldest first (deposits arrive oldest-first), comma-separated: the
// same chronological order and separator as column F, so the Nth link is the
// proof for the Nth amount. Pending and rejected proofs are never included;
// blank when nothing is approved. Only existing Cloudinary URLs are written:
// nothing is uploaded or copied. (An approved Deposit that has no proof URL on
// file simply contributes no link.)
function formatApprovedProofLinks(deposits) {
  return deposits
    .filter((deposit) => deposit.status === "approved" && deposit.paymentProof && deposit.paymentProof.url)
    .map((deposit) => deposit.paymentProof.url)
    .join(", ");
}

function quotedRange(tabName, a1Range) {
  return `'${String(tabName).replace(/'/g, "''")}'!${a1Range}`;
}

async function recordSyncResult(config, status, message, syncedCount) {
  config.lastSync = {
    at: new Date(),
    status,
    message,
    syncedCount: syncedCount !== undefined ? syncedCount : config.lastSync?.syncedCount
  };
  await config.save();
}

const headerMatches = (headerRow, startIndex, expected) =>
  expected.every((title, offset) => String(headerRow[startIndex + offset] || "").trim() === title);

// Syncs one School's finance data (MongoDB -> Google Sheets only). MongoDB is
// the source of truth and financial truth is never read back from the Sheet.
// Idempotent: re-running updates the same customer row (matched by Customer ID
// in column A) instead of duplicating it. Writes A:H and J:L only — column I
// (Full Payment) is never part of any written range, for an existing row or a
// newly appended one.
async function syncSchoolFinanceSheet(schoolId) {
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
    const school = await School.findById(schoolId).select("name").lean();
    if (!school) {
      const reason = "School referenced by this finance config no longer exists.";
      await recordSyncResult(config, "skipped", reason);
      return { success: false, skipped: true, reason };
    }

    // ticketPrice is the CUSTOMER's own price (locked at their first payment
    // request) — never the School's current price. Sorted so that new rows are
    // assigned in a stable order even if two syncs ever overlap.
    const attendees = await Attendee.find({ schoolId, attendeeType: "incomer" })
      .select("fullName phone ticketPrice email incomerPhoto.url")
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const attendeeIds = attendees.map((attendee) => attendee._id);
    const deposits = attendeeIds.length
      ? await Deposit.find({ attendeeId: { $in: attendeeIds } })
          .select("attendeeId amount status createdAt paymentProof.url")
          .sort({ createdAt: 1 })
          .lean()
      : [];

    const depositsByAttendee = new Map();
    for (const deposit of deposits) {
      const key = String(deposit.attendeeId);
      if (!depositsByAttendee.has(key)) {
        depositsByAttendee.set(key, []);
      }
      depositsByAttendee.get(key).push(deposit);
    }

    const rows = attendees.map((attendee) => {
      const attendeeDeposits = depositsByAttendee.get(String(attendee._id)) || [];

      return {
        customerId: String(attendee._id),
        // A:H
        values: [
          String(attendee._id),
          attendee.fullName || "",
          attendee.phone || "",
          school.name || "",
          Number.isFinite(attendee.ticketPrice) ? attendee.ticketPrice : "",
          formatApprovedPayments(attendeeDeposits),
          countApprovedPayments(attendeeDeposits),
          calculateApprovedTotalPaid(attendeeDeposits)
        ],
        // J:L (column I sits between the two ranges and is never written)
        extraValues: [
          attendee.email || "",
          (attendee.incomerPhoto && attendee.incomerPhoto.url) || "",
          formatApprovedProofLinks(attendeeDeposits)
        ]
      };
    });

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheetId,
      range: quotedRange(config.tabName, "A:L")
    });
    const existingValues = existing.data.values || [];

    const willWriteHeader = existingValues.length === 0;

    // Row 1, if present, is the header — data rows start at row 2. Existing
    // customer rows are matched by Customer ID in column A so re-syncing
    // updates in place.
    const rowIndexByCustomerId = new Map();
    existingValues.slice(1).forEach((row, i) => {
      const customerId = row[0];
      if (customerId) {
        rowIndexByCustomerId.set(customerId, i + 2);
      }
    });

    let nextAppendRow = willWriteHeader ? 2 : existingValues.length + 1;

    const data = [];

    if (willWriteHeader) {
      // A brand-new sheet gets the whole header, including "Full Payment" in I.
      data.push({
        range: quotedRange(config.tabName, "A1:L1"),
        values: [HEADER_ROW]
      });
    } else {
      // An existing sheet built before this layout (e.g. with a "Payment State"
      // column) has its SYSTEM headers refreshed in place. I1 is never touched.
      const headerRow = existingValues[0] || [];
      if (!headerMatches(headerRow, 0, SYSTEM_HEADERS_A_TO_H)) {
        data.push({ range: quotedRange(config.tabName, "A1:H1"), values: [SYSTEM_HEADERS_A_TO_H] });
      }
      if (!headerMatches(headerRow, 9, SYSTEM_HEADERS_J_TO_L)) {
        data.push({ range: quotedRange(config.tabName, "J1:L1"), values: [SYSTEM_HEADERS_J_TO_L] });
      }
    }

    let updatedCount = 0;
    let appendedCount = 0;

    for (const row of rows) {
      const existingRow = rowIndexByCustomerId.get(row.customerId);
      const targetRow = existingRow || nextAppendRow;

      if (existingRow) {
        updatedCount += 1;
      } else {
        appendedCount += 1;
        nextAppendRow += 1;
      }

      data.push({
        range: quotedRange(config.tabName, `A${targetRow}:H${targetRow}`),
        values: [row.values]
      });
      data.push({
        range: quotedRange(config.tabName, `J${targetRow}:L${targetRow}`),
        values: [row.extraValues]
      });
    }

    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: config.googleSheetId,
        requestBody: {
          // RAW, not USER_ENTERED: Sheets must never re-parse what we send.
          // Egyptian phone numbers are strings starting with 0
          // ("01012345678"), which USER_ENTERED coerces into numbers and
          // strips the leading zero. Numbers (ticket price, count, total) still
          // land as numbers under RAW. URLs stay the exact stored string.
          valueInputOption: "RAW",
          data
        }
      });
    }

    await recordSyncResult(config, "success", null, rows.length);

    return {
      success: true,
      syncedCount: rows.length,
      updated: updatedCount,
      appended: appendedCount
    };
  } catch (err) {
    await recordSyncResult(config, "error", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  syncSchoolFinanceSheet,
  HEADER_ROW
};
