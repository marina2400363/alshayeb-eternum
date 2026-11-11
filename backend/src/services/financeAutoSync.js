const mongoose = require("mongoose");

const SchoolFinanceConfig = require("../models/SchoolFinanceConfig");
const { syncSchoolFinanceSheet } = require("./googleSheetsSchoolFinanceSync");
const { syncFullPaymentFromSchoolSheet } = require("./googleSheetsFullPaymentSync");

// Automatic, NON-BLOCKING Mongo -> Google Sheet finance sync.
//
// MongoDB stays the source of truth; this only asks the EXISTING sync service
// (syncSchoolFinanceSheet — no second implementation) to refresh a School's
// sheet after a change that the sheet shows. The caller never awaits it and it
// can never fail or roll back the business operation: every error is caught
// and logged (no PII), and the manual Sync button plus the scheduled
// reconciliation remain as recovery paths.
//
// SERVERLESS (Vercel): work left running after the response can be frozen, so
// the promise is handed to waitUntil() (from @vercel/functions), which keeps
// the function alive until the sync settles WITHOUT delaying the response. Off
// Vercel it is a harmless no-op and the promise simply runs.
//
// NO DUPLICATE / HEAVY SYNCS: each sync rewrites the whole School sheet, so
// triggers are coalesced across ALL instances through a short lease stored on
// the School's SchoolFinanceConfig:
//   • the first trigger claims the lease and syncs;
//   • triggers that arrive while a sync is running only set a dirty flag;
//   • the running sync loops (bounded) while the flag is set, so a burst of N
//     changes costs a handful of syncs, not N. A tiny gap between rounds keeps
//     Google's per-minute write quota safe.
// A School with no enabled sheet config costs one cheap indexed query.

const LEASE_MS = 45 * 1000;
const MAX_ROUNDS = 3;
const DEFAULT_GAP_MS = 1500;

// How long a sheet-edit read-back waits for the per-School lease (another sync
// or a cron pass holding it): a few short tries, well inside a serverless call.
const DEFAULT_LEASE_ATTEMPTS = 4;
const DEFAULT_LEASE_WAIT_MS = 1500;

let gapMs = DEFAULT_GAP_MS;
let leaseAttempts = DEFAULT_LEASE_ATTEMPTS;
let leaseWaitMs = DEFAULT_LEASE_WAIT_MS;
let connectedCheck = () => mongoose.connection.readyState === 1;
let keepAlive = (promise) => {
  try {
    // eslint-disable-next-line global-require
    require("@vercel/functions").waitUntil(promise);
  } catch (error) {
    // Not on Vercel / package unavailable: the promise still runs on its own.
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logFailure(error) {
  // Name/code only — never the message (could carry sheet/credential details).
  console.error(`[finance-auto-sync] failed: ${(error && (error.code || error.name)) || "unknown"}`);
}

function isEnabled() {
  return String(process.env.FINANCE_AUTO_SYNC || "on").trim().toLowerCase() !== "off";
}

// Takes the per-School lease. Resolves the config when claimed, null when the
// School has no enabled sheet or another run currently holds the lease.
function claimLease(schoolId) {
  const now = Date.now();
  return SchoolFinanceConfig.findOneAndUpdate(
    {
      schoolId,
      enabled: true,
      googleSheetId: { $exists: true, $ne: "" },
      $or: [{ "autoSync.lockedUntil": null }, { "autoSync.lockedUntil": { $lt: new Date(now) } }]
    },
    { $set: { "autoSync.lockedUntil": new Date(now + LEASE_MS) } },
    { new: true }
  );
}

// Runs (or coalesces into) the finance sync for one School. Never throws.
async function syncSchoolFinance(schoolId, { rounds = MAX_ROUNDS, nested = false } = {}) {
  try {
    const claimed = await claimLease(schoolId);

    if (!claimed) {
      // Either nothing to sync (no enabled sheet) or a run is in progress: leave
      // a marker so that run does one more pass. Harmless when there's no config.
      await SchoolFinanceConfig.updateOne({ schoolId, enabled: true }, { $set: { "autoSync.dirty": true } });
      return { ran: false };
    }

    let syncs = 0;
    try {
      for (let round = 0; round < rounds; round += 1) {
        // Anything requested BEFORE this sync starts is covered by it, so the
        // flag is cleared first; a change that lands mid-run sets it again.
        // eslint-disable-next-line no-await-in-loop
        await SchoolFinanceConfig.updateOne({ schoolId }, { $set: { "autoSync.dirty": false } });
        // eslint-disable-next-line no-await-in-loop
        await syncSchoolFinanceSheet(schoolId);
        syncs += 1;

        // eslint-disable-next-line no-await-in-loop
        const pending = await SchoolFinanceConfig.findOneAndUpdate(
          { schoolId, "autoSync.dirty": true },
          { $set: { "autoSync.lockedUntil": new Date(Date.now() + LEASE_MS) } }
        );
        if (!pending) break;
        // eslint-disable-next-line no-await-in-loop
        if (gapMs > 0) await sleep(gapMs);
      }
    } finally {
      // Release even if a sync threw. If changes are still pending after the
      // last round, the scheduled reconciliation (or the next change) covers them.
      await SchoolFinanceConfig.updateOne({ schoolId }, { $set: { "autoSync.lockedUntil": null } });
    }

    // A change that arrived after the last dirty check but before the lease was
    // released only left the flag set (its trigger saw the lease held): give it
    // exactly one more pass instead of waiting for the reconciliation.
    if (!nested) {
      const leftover = await SchoolFinanceConfig.findOne({ schoolId, "autoSync.dirty": true }).select("_id");
      if (leftover) {
        const extra = await syncSchoolFinance(schoolId, { rounds: 1, nested: true });
        return { ran: true, syncs: syncs + (extra.syncs || 0) };
      }
    }

    return { ran: true, syncs };
  } catch (error) {
    logFailure(error);
    return { ran: false, error: true };
  }
}

// The entry point routes call AFTER their Mongo work succeeded. Returns the
// promise (for tests) but callers must NOT await it. Never throws.
function requestSchoolFinanceSync(schoolId) {
  if (!schoolId || !isEnabled() || !connectedCheck()) return Promise.resolve({ ran: false, skipped: true });

  const work = syncSchoolFinance(schoolId).catch((error) => {
    logFailure(error);
    return { ran: false, error: true };
  });

  keepAlive(work);
  return work;
}

// The admin's MANUAL "Sync" button (Mongo -> Sheet), serialized through the SAME
// per-School lease and dirty flag as every automatic sync — no second lock. A
// manual sync used to bypass the lease, so it could read and write the Sheet at
// the same time as an automatic sync (overlapping snapshots can append the same
// row twice). Now:
//   • lease free  -> runs the EXISTING sync (syncSchoolFinanceSheet) under it and
//                    returns that sync's own result, exactly as before;
//   • lease held  -> waits a few short tries (the running sync is normally
//                    seconds); if it is still running, the request is NOT lost
//                    and NOT run concurrently: the dirty flag is set, so the
//                    running sync (or the pass right after it) re-syncs the
//                    School, and the admin is told it is queued;
//   • no enabled sheet -> the sync's own "skipped" result (it never reaches Google).
async function syncSchoolFinanceManually(schoolId) {
  for (let attempt = 0; attempt < leaseAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const claimed = await claimLease(schoolId);

    if (claimed) {
      let result;
      try {
        // Everything requested BEFORE this sync starts is covered by it; a change
        // that lands mid-run sets the flag again (same rule as syncSchoolFinance).
        await SchoolFinanceConfig.updateOne({ schoolId }, { $set: { "autoSync.dirty": false } });
        result = await syncSchoolFinanceSheet(schoolId);
      } finally {
        await SchoolFinanceConfig.updateOne({ schoolId }, { $set: { "autoSync.lockedUntil": null } });
      }

      // A registration/approval that arrived during this run only left the flag
      // set: give it its own pass (fire-and-forget, like every other trigger).
      const leftover = await SchoolFinanceConfig.findOne({ schoolId, "autoSync.dirty": true }).select("_id");
      if (leftover) requestSchoolFinanceSync(schoolId);

      return result;
    }

    // Not claimed: either nothing to sync here, or another run holds the lease.
    // eslint-disable-next-line no-await-in-loop
    const config = await SchoolFinanceConfig.findOne({ schoolId });
    if (!config || !config.enabled || !config.googleSheetId) return syncSchoolFinanceSheet(schoolId);

    // eslint-disable-next-line no-await-in-loop
    if (attempt < leaseAttempts - 1 && leaseWaitMs > 0) await sleep(leaseWaitMs);
  }

  await SchoolFinanceConfig.updateOne({ schoolId, enabled: true }, { $set: { "autoSync.dirty": true } });
  // Close the lost-wakeup window: the running sync may have RELEASED its lease
  // (and already done its final dirty check) between our last failed claim and
  // the flag write above, which would leave the flag set with nobody to act on
  // it. requestSchoolFinanceSync either claims the now-free lease and syncs
  // (fire-and-forget), or sees it still held and just re-sets the same flag. It
  // never calls back into this function, so there is no recursion, and it takes
  // the same lease, so it can never overlap another sync.
  requestSchoolFinanceSync(schoolId);
  return {
    success: false,
    skipped: true,
    queued: true,
    reason: "Another sync is already running for this School. Your request is queued and runs right after it — nothing is lost."
  };
}

// One scheduled reconciliation pass for ONE School, in both directions, under
// the same per-School lease the automatic sync uses (so cron cycles never
// overlap each other or an automatic sync — which also keeps the DONE read-back
// from running twice at once):
//   1. Mongo -> Sheet: refresh the School's rows (A:H and J:L; never column I);
//   2. Sheet -> Mongo: read the accountant's column I. An exact, trimmed,
//      case-insensitive DONE updates FullPaymentStatus and sends the "full
//      payment complete" email ONCE. All of that is the EXISTING read-back
//      service (syncFullPaymentFromSchoolSheet) — nothing is duplicated here.
async function reconcileSchool(schoolId) {
  try {
    const claimed = await claimLease(schoolId);
    if (!claimed) {
      await SchoolFinanceConfig.updateOne({ schoolId, enabled: true }, { $set: { "autoSync.dirty": true } });
      return { status: "busy" };
    }

    let write;
    let fullPayment;
    try {
      write = await syncSchoolFinanceSheet(schoolId);
      fullPayment = await syncFullPaymentFromSchoolSheet(schoolId);
    } finally {
      await SchoolFinanceConfig.updateOne({ schoolId }, { $set: { "autoSync.lockedUntil": null } });
    }

    // Changes that arrived while this pass held the lease left the dirty flag
    // set: give them one more Mongo -> Sheet pass.
    const leftover = await SchoolFinanceConfig.findOne({ schoolId, "autoSync.dirty": true }).select("_id");
    if (leftover) await syncSchoolFinance(schoolId, { rounds: 1, nested: true });

    return {
      status: write && write.success === false && !write.skipped ? "error" : "success",
      write: { success: Boolean(write && write.success), skipped: Boolean(write && write.skipped) },
      fullPayment: {
        success: Boolean(fullPayment && fullPayment.success),
        skipped: Boolean(fullPayment && fullPayment.skipped),
        rowsDone: (fullPayment && fullPayment.confirmedCount) || 0
      }
    };
  } catch (error) {
    logFailure(error);
    return { status: "error" };
  }
}

// Scheduled reconciliation (the GitHub cron -> /api/cron/sync-all): every
// enabled School, both directions, within a time budget so it fits a serverless
// invocation. This is what makes the accountant's DONE take effect on its own —
// the manual "Sync Full Payment" button is only a backup.
async function reconcileAllSchoolFinance({ timeBudgetMs = 15000 } = {}) {
  if (!connectedCheck()) return [];
  const deadline = Date.now() + timeBudgetMs;
  const configs = await SchoolFinanceConfig.find({ enabled: true, googleSheetId: { $exists: true, $ne: "" } }).select("schoolId");
  const results = [];

  for (const config of configs) {
    if (Date.now() >= deadline) {
      results.push({ schoolId: String(config.schoolId), status: "deferred" });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const outcome = await reconcileSchool(config.schoolId);
    results.push({ schoolId: String(config.schoolId), ...outcome });
  }

  return results;
}

// The accountant just edited column I of a School's finance sheet (Google
// Sheets installable on-edit trigger -> POST /api/sheets/full-payment-edit).
// Reads the sheet back RIGHT NOW instead of waiting for a scheduled pass.
//
// This is the EXISTING read-back (syncFullPaymentFromSchoolSheet) and nothing
// else — no DONE parsing, no FullPaymentStatus rules and no email logic live
// here. Only the Sheet -> Mongo read runs (never the Mongo -> Sheet rewrite,
// which would write into the sheet the accountant is typing in). It takes the
// SAME per-School lease as the automatic sync and the scheduled reconciliation,
// so a burst of edits, a cron pass and an edit can never run the read-back at
// the same time (which is what keeps "send the Full Payment email once" true
// under concurrency). Resolves { status }:
//   "unknown-sheet" — no finance config points at this spreadsheet;
//   "skipped"       — the School's sync is disabled;
//   "ignored"       — an edit on another tab of the spreadsheet;
//   "busy"          — the lease stayed held for the whole wait (caller retries);
//   "done"          — ran; `result` is the read-back's own result.
async function syncFullPaymentAfterSheetEdit({ spreadsheetId, sheetName }) {
  const config = await SchoolFinanceConfig.findOne({ googleSheetId: spreadsheetId });

  if (!config) return { status: "unknown-sheet" };
  if (!config.enabled) return { status: "skipped", reason: "Finance sync is disabled for this school." };
  if (String(sheetName).trim() !== String(config.tabName || "").trim()) return { status: "ignored" };

  const schoolId = config.schoolId;

  for (let attempt = 0; attempt < leaseAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const claimed = await claimLease(schoolId);

    if (claimed) {
      let result;
      try {
        result = await syncFullPaymentFromSchoolSheet(schoolId);
      } finally {
        await SchoolFinanceConfig.updateOne({ schoolId }, { $set: { "autoSync.lockedUntil": null } });
      }

      // A registration/approval that arrived while this held the lease only left
      // the dirty flag: give it its Mongo -> Sheet pass now (fire-and-forget,
      // exactly like every other trigger) instead of waiting for the reconciliation.
      const leftover = await SchoolFinanceConfig.findOne({ schoolId, "autoSync.dirty": true }).select("_id");
      if (leftover) requestSchoolFinanceSync(schoolId);

      return { status: "done", result };
    }

    // eslint-disable-next-line no-await-in-loop
    if (attempt < leaseAttempts - 1 && leaseWaitMs > 0) await sleep(leaseWaitMs);
  }

  return { status: "busy" };
}

module.exports = {
  requestSchoolFinanceSync,
  syncSchoolFinanceManually,
  reconcileAllSchoolFinance,
  syncFullPaymentAfterSheetEdit,
  __testing: {
    syncSchoolFinance,
    setLeaseWait(attempts, waitMs) {
      leaseAttempts = attempts;
      leaseWaitMs = waitMs;
    },
    setGap(ms) {
      gapMs = ms;
    },
    setConnectedCheck(fn) {
      connectedCheck = fn;
    },
    setKeepAlive(fn) {
      keepAlive = fn;
    },
    reset() {
      gapMs = DEFAULT_GAP_MS;
      leaseAttempts = DEFAULT_LEASE_ATTEMPTS;
      leaseWaitMs = DEFAULT_LEASE_WAIT_MS;
      connectedCheck = () => mongoose.connection.readyState === 1;
      keepAlive = (promise) => {
        try {
          // eslint-disable-next-line global-require
          require("@vercel/functions").waitUntil(promise);
        } catch (error) {
          // no-op off Vercel
        }
      };
    }
  }
};
