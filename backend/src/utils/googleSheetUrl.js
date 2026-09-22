const apiError = require("./apiError");

// Google spreadsheet ids are URL-safe base64-ish strings (today 44 chars, but
// the length is not contractual). Bounded generously and validated by shape
// only — never by calling Google.
const SPREADSHEET_ID_PATTERN = /^[a-zA-Z0-9-_]{20,120}$/;
// Also matches the account-switcher form, /spreadsheets/u/0/d/<ID>.
const SPREADSHEET_URL_PATTERN = /\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/;

const INVALID_MESSAGE =
  "Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/…) or the spreadsheet ID itself.";

// Accepts either a full Google Sheets URL or a bare spreadsheet ID and
// returns the canonical id. Admin never has to extract it by hand, and the
// server never trusts the frontend to have done it.
//
// Accepted:
//   https://docs.google.com/spreadsheets/d/<ID>/edit
//   https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
//   https://docs.google.com/spreadsheets/u/0/d/<ID>/edit?usp=sharing
//   <ID>
//
// Rejected (422): empty, whitespace-only, a non-Sheets Google URL (Docs,
// Forms, Drive), any other URL, and anything that isn't a plausible id.
//
// Deliberately offline: whether the sheet exists and whether the service
// account can reach it is proven by an actual sync, not by saving a link.
function parseSpreadsheetId(rawValue) {
  const value = String(rawValue ?? "").trim();

  if (!value) {
    throw apiError(INVALID_MESSAGE, 422);
  }

  // Anything URL-shaped must be a real Google Sheets URL: the right host
  // (when one is present) AND the /spreadsheets/d/<id> path.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes("/") || value.includes(".")) {
    const host = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
    if (host.includes(".") && host.toLowerCase().replace(/:\d+$/, "") !== "docs.google.com") {
      throw apiError(INVALID_MESSAGE, 422);
    }

    const match = value.match(SPREADSHEET_URL_PATTERN);
    if (!match || !SPREADSHEET_ID_PATTERN.test(match[1])) {
      throw apiError(INVALID_MESSAGE, 422);
    }
    return match[1];
  }

  if (!SPREADSHEET_ID_PATTERN.test(value)) {
    throw apiError(INVALID_MESSAGE, 422);
  }

  return value;
}

// The canonical Admin-only link for a stored id. Never shown to customers.
function buildSpreadsheetUrl(spreadsheetId) {
  return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null;
}

module.exports = { parseSpreadsheetId, buildSpreadsheetUrl, INVALID_MESSAGE };
