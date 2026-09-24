/**
 * ALSHAYEB Season 2 — Full Payment auto-detect for a School finance sheet.
 *
 * When the accountant edits column I ("Full Payment") of the finance sheet, this
 * tells the backend to read the sheet back straight away, so an exact DONE takes
 * effect within seconds — nobody has to press "Sync Full Payment".
 *
 * The backend does ALL the work (DONE detection, FullPaymentStatus, the "Full
 * Payment Complete" email, sent once). This script only says "column I changed".
 *
 * It uses an INSTALLABLE on-edit trigger (`handleFullPaymentEdit`, created by
 * `installFullPaymentTrigger`) — NOT the simple `onEdit` trigger, which cannot
 * make authenticated web requests. The function is deliberately not named
 * `onEdit`, so it can never run twice as both a simple and an installable trigger.
 *
 * SECRETS: nothing secret is in this file or in any cell. The backend URL and the
 * secret live in Script Properties (Project Settings -> Script properties):
 *     BACKEND_URL  https://www.alshayebexperience.com/api/sheets/full-payment-edit
 *     CRON_SECRET  the same value as the CRON_SECRET environment variable on Vercel
 *
 * @OnlyCurrentDoc
 */

var FP_FULL_PAYMENT_COLUMN = 9; // column I
var FP_HEADER_ROWS = 1; // row 1 is the header
var FP_DIRTY_KEY = 'fullPaymentDirty';
var FP_MAX_ATTEMPTS = 3;
var FP_MAX_PASSES = 3;
var FP_LOCK_WAIT_MS = 30000;

/**
 * Installable on-edit handler. Runs for every edit of the spreadsheet, so it
 * returns immediately unless the edit touched column I below the header.
 */
function handleFullPaymentEdit(e) {
  if (!isRelevantFullPaymentEdit_(e)) return;

  // Mark "an edit needs a read-back", then let ONE execution at a time deliver
  // it. Twenty quick edits (or a paste over many rows) cost a couple of calls,
  // not twenty: an execution that finds the mark already cleared has nothing to do.
  var cache = CacheService.getScriptCache();
  cache.put(FP_DIRTY_KEY, '1', 120);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(FP_LOCK_WAIT_MS)) {
    console.warn('Full Payment sync: another execution is delivering; it will pick this edit up.');
    return;
  }

  try {
    var spreadsheetId = e.source.getId();
    var sheetName = e.range.getSheet().getName();
    var passes = 0;
    while (cache.get(FP_DIRTY_KEY) && passes < FP_MAX_PASSES) {
      cache.remove(FP_DIRTY_KEY); // anything edited from here on marks it again
      notifyBackend_(spreadsheetId, sheetName);
      passes += 1;
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * True only when the edited range includes column I AND is below the header.
 * (A paste over I2:I40, or over A2:L40, counts; an edit of column B, or of the
 * header row, does not.)
 */
function isRelevantFullPaymentEdit_(e) {
  if (!e || !e.range || !e.source) return false;
  var range = e.range;
  if (range.getColumn() > FP_FULL_PAYMENT_COLUMN) return false;
  if (range.getLastColumn() < FP_FULL_PAYMENT_COLUMN) return false;
  if (range.getLastRow() <= FP_HEADER_ROWS) return false;
  return true;
}

/**
 * Tells the backend which spreadsheet/tab changed. Retries only when a retry can
 * help (a 5xx or a network error). Never logs the secret or the response body.
 * Returns true on a 2xx.
 */
function notifyBackend_(spreadsheetId, sheetName) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('BACKEND_URL');
  var secret = props.getProperty('CRON_SECRET');
  if (!url || !secret) {
    console.error('Full Payment sync: set the BACKEND_URL and CRON_SECRET script properties.');
    return false;
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify({ spreadsheetId: spreadsheetId, sheetName: sheetName }),
    muteHttpExceptions: true,
    followRedirects: false // a redirect means a wrong URL; never forward the secret elsewhere
  };

  for (var attempt = 1; attempt <= FP_MAX_ATTEMPTS; attempt += 1) {
    try {
      var code = UrlFetchApp.fetch(url, options).getResponseCode();
      if (code >= 200 && code < 300) {
        console.log('Full Payment sync OK (HTTP ' + code + ').');
        return true;
      }
      console.error('Full Payment sync failed: HTTP ' + code + ' (attempt ' + attempt + ' of ' + FP_MAX_ATTEMPTS + ').');
      if (code < 500) return false; // wrong secret / URL / sheet: retrying cannot fix it
    } catch (err) {
      console.error('Full Payment sync request error (attempt ' + attempt + '): ' + (err && err.name));
    }
    if (attempt < FP_MAX_ATTEMPTS) Utilities.sleep(3000 * attempt);
  }
  return false;
}

/**
 * ONE-TIME SETUP: run this once from the Apps Script editor (and approve the
 * permission prompt). It creates the installable on-edit trigger for THIS
 * spreadsheet, and is safe to run again (it never creates a second trigger).
 */
function installFullPaymentTrigger() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var existing = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'handleFullPaymentEdit';
  });
  if (existing.length) {
    console.log('The Full Payment on-edit trigger is already installed.');
    return;
  }
  ScriptApp.newTrigger('handleFullPaymentEdit').forSpreadsheet(spreadsheet).onEdit().create();
  console.log('Installed the Full Payment on-edit trigger.');
}

/**
 * ONE-TIME CHECK: run this after setting the two script properties. It asks the
 * backend to read THIS sheet back once. Success looks like "Full Payment sync OK
 * (HTTP 200)" in the execution log; HTTP 401 = wrong CRON_SECRET, HTTP 404 = this
 * spreadsheet is not linked to a School in the Finance screen. (The check uses the
 * tab you currently have open, which must be the School's finance tab.)
 */
function testFullPaymentBackend() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var ok = notifyBackend_(spreadsheet.getId(), spreadsheet.getActiveSheet().getName());
  console.log(ok ? 'Backend check passed.' : 'Backend check FAILED — see the messages above.');
}
