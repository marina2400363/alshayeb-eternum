// Stateful fake Google Sheets for the finance-sync tests: it APPLIES every
// write (so row positions, Column I and duplicates can be asserted), can be made
// to fail, and can hold reads at a barrier so overlapping syncs read the same
// snapshot before either writes. Not a test file (no .test.js suffix).

const assert = require("node:assert/strict");
const { google } = require("googleapis");

const colIndex = (letters) => letters.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

// A stateful fake of ONE spreadsheet tab. Column I is only ever changed by
// `accountantTypes` (the test playing the accountant), never by a sync.
function createFakeSpreadsheet() {
  const sp = {
    rows: [], // rows[0] is row 1; each row is a sparse array of cells
    reads: 0,
    batchCalls: 0,
    failNextRead: null,
    failNextWrite: null,
    barrier: null, // { count, waiting: [], released }
    gate: null, // a Promise: every read waits for it (holds a sync "running")
    critical: 0, // syncs currently between their read and their end
    maxCritical: 0, // the most syncs EVER inside that window at once
    endCritical() {
      sp.critical = Math.max(0, sp.critical - 1);
    },
    accountantTypes(rowNumber, columnLetter, value) {
      const row = (sp.rows[rowNumber - 1] = sp.rows[rowNumber - 1] || []);
      row[colIndex(columnLetter)] = value;
    },
    ids() {
      return sp.rows.slice(1).map((row) => (row && row[0]) || "").filter(Boolean);
    },
    rowOf(id) {
      const index = sp.rows.findIndex((row, i) => i > 0 && row && row[0] === String(id));
      return index === -1 ? null : index + 1;
    },
    cell(id, letter) {
      const n = sp.rowOf(id);
      return n === null ? undefined : (sp.rows[n - 1] || [])[colIndex(letter)];
    },
    // Anything that was ever typed into column I, keyed by Customer ID.
    columnI() {
      const out = {};
      sp.rows.slice(1).forEach((row) => {
        if (row && row[8] !== undefined && row[8] !== "") out[row[0] || `#row-without-id`] = row[8];
      });
      return out;
    },
    duplicateIds() {
      const seen = new Set();
      const dups = [];
      for (const id of sp.ids()) {
        if (seen.has(id)) dups.push(id);
        seen.add(id);
      }
      return dups;
    }
  };
  return sp;
}

function applyWrite(sp, range, values) {
  const match = String(range).split("!")[1].match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  assert.ok(match, `unexpected range ${range}`);
  const [, from, fromRow, to, toRow] = match;
  assert.equal(fromRow, toRow, "the sync only writes single-row ranges");
  const start = colIndex(from);
  const end = colIndex(to);
  // The accountant's column I (index 8) must NEVER be inside a written range.
  assert.ok(!(start <= 8 && 8 <= end), `a sync wrote a range that covers column I: ${range}`);
  const row = (sp.rows[Number(fromRow) - 1] = sp.rows[Number(fromRow) - 1] || []);
  values[0].forEach((value, offset) => {
    row[start + offset] = value;
  });
}

function installFakes(getSheets) {
  const originalSheets = google.sheets;
  const originalJwt = google.auth.JWT;
  google.auth.JWT = function FakeJWT() {};
  google.sheets = () => ({
    spreadsheets: {
      values: {
        get: async ({ spreadsheetId }) => {
          const sp = getSheets()[spreadsheetId];
          sp.reads += 1;
          sp.critical += 1;
          sp.maxCritical = Math.max(sp.maxCritical, sp.critical);
          // Yield once so an (illegal) overlapping sync would get its chance.
          await new Promise((resolve) => setImmediate(resolve));
          if (sp.failNextRead) {
            const message = sp.failNextRead;
            sp.failNextRead = null;
            throw new Error(message);
          }
          // Snapshot at read time (Sheets returns "" for interior blanks, and
          // trims trailing blanks).
          const snapshot = sp.rows.map((row) => {
            if (!row) return [];
            const copy = [];
            for (let i = 0; i < row.length; i += 1) copy[i] = row[i] === undefined ? "" : row[i];
            while (copy.length && copy[copy.length - 1] === "") copy.pop();
            return copy;
          });
          if (sp.gate) await sp.gate;
          if (sp.barrier) {
            await new Promise((resolve) => {
              sp.barrier.waiting.push(resolve);
              if (sp.barrier.waiting.length >= sp.barrier.count) {
                if (sp.barrier.reverse) {
                  // The LATER read is released first and the EARLIER one is held
                  // back, so the later sync writes its rows first.
                  const [earlier, ...rest] = sp.barrier.waiting;
                  rest.forEach((release) => release());
                  setTimeout(earlier, 20);
                } else {
                  sp.barrier.waiting.forEach((release) => release());
                }
              }
            });
          }
          return { data: { values: snapshot } };
        },
        batchUpdate: async ({ spreadsheetId, requestBody }) => {
          const sp = getSheets()[spreadsheetId];
          sp.batchCalls += 1;
          if (sp.failNextWrite) {
            const message = sp.failNextWrite;
            sp.failNextWrite = null;
            throw new Error(message); // atomic: nothing from this call is applied
          }
          for (const entry of requestBody.data) applyWrite(sp, entry.range, entry.values);
          return { data: {} };
        }
      }
    }
  });
  return () => {
    google.sheets = originalSheets;
    google.auth.JWT = originalJwt;
  };
}


module.exports = { createFakeSpreadsheet, installFakes, colIndex };
