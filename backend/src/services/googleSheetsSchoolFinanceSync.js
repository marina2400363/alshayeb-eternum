const { google } = require("googleapis");

const Attendee = require("../models/Attendee");
const Deposit = require("../models/Deposit");
const School = require("../models/School");
const SchoolFinanceConfig = require("../models/SchoolFinanceConfig");
const { calculateApprovedTotalPaid, calculateRemainingBalance } = require("../utils/paymentCalculations");

// System-managed columns. Column I ("Full Payment") is deliberately excluded
// from every write this service performs — it is the accountant's manually-
// edited column and must survive every normal sync.
const HEADER_ROW = [
  "Customer ID",
  "Full Name",
  "Phone",
  "School",
  "Ticket Price",
  "Deposit Summary",
  "Approved Total Paid",
  "Remaining Balance",
  "Full Payment"
];

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

function formatDepositSummary(deposits) {
  if (!deposits.length) {
    return "No deposits yet";
  }

  return deposits
    .map((deposit) => `${deposit.amount} EGP - ${deposit.status}`)
    .join("\n");
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

// Syncs one School's finance data (MongoDB -> Google Sheets only). Never
// reads financial truth back from the Sheet. Idempotent: re-running updates
// the same customer row (matched by Customer ID in column A) instead of
// duplicating it, and only ever writes columns A:H — column I is never
// touched for any row, existing or new.
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

    const attendees = await Attendee.find({ schoolId, attendeeType: "incomer" })
      .select("fullName phone ticketPrice")
      .lean();

    const attendeeIds = attendees.map((attendee) => attendee._id);
    const deposits = attendeeIds.length
      ? await Deposit.find({ attendeeId: { $in: attendeeIds } })
          .select("attendeeId amount status createdAt")
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
      const approvedTotalPaid = calculateApprovedTotalPaid(attendeeDeposits);
      const remainingBalance = calculateRemainingBalance(attendee.ticketPrice, approvedTotalPaid);

      return {
        customerId: String(attendee._id),
        values: [
          String(attendee._id),
          attendee.fullName || "",
          attendee.phone || "",
          school.name || "",
          Number.isFinite(attendee.ticketPrice) ? attendee.ticketPrice : "",
          formatDepositSummary(attendeeDeposits),
          approvedTotalPaid,
          remainingBalance
        ]
      };
    });

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheetId,
      range: quotedRange(config.tabName, "A:I")
    });
    const existingValues = existing.data.values || [];

    const willWriteHeader = existingValues.length === 0;

    // Row 1, if present, is always treated as the header and never touched
    // again — data rows start at row 2. Existing customer rows are matched
    // by Customer ID in column A so re-syncing updates in place.
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
      data.push({
        range: quotedRange(config.tabName, "A1:I1"),
        values: [HEADER_ROW]
      });
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

      // A:H only — column I (Full Payment) is never part of this range, for
      // either an existing row or a newly appended one.
      data.push({
        range: quotedRange(config.tabName, `A${targetRow}:H${targetRow}`),
        values: [row.values]
      });
    }

    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: config.googleSheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
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
  syncSchoolFinanceSheet
};
