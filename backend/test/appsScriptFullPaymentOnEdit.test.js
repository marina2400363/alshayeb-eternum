// backend/apps-script/FullPaymentOnEdit.gs — the code pasted into each School
// finance sheet. Google's services (Properties, Cache, Lock, UrlFetch, Script)
// are replaced by in-memory fakes and the script runs in a Node VM, so what it
// would SEND (and log) is checked without any Google account.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "apps-script", "FullPaymentOnEdit.gs"), "utf8");

const URL_PROPERTY = "https://www.alshayebexperience.com/api/sheets/full-payment-edit";
const SECRET = "apps-script-test-secret-0123456789abcdef";
const SHEET_ID = "1AbCdEf123456789_ABCDEFGHIJKLMNOPQRSTUVWX";

// Builds a sandbox with fake Apps Script services and loads the script into it.
function loadScript({ properties = { BACKEND_URL: URL_PROPERTY, CRON_SECRET: SECRET }, respond = () => ({ code: 200 }), lockAvailable = true } = {}) {
  const logs = [];
  const fetches = [];
  const sleeps = [];
  const cache = new Map();
  const triggers = [];
  const lockState = { held: false, tryLockCalls: 0, releases: 0 };

  const capture = (level) => (...args) => logs.push(`${level}: ${args.join(" ")}`);

  const sandbox = {
    console: { log: capture("log"), warn: capture("warn"), error: capture("error"), info: capture("info") },
    JSON,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => (key in properties ? properties[key] : null) }) },
    CacheService: {
      getScriptCache: () => ({
        put: (key, value) => cache.set(key, value),
        get: (key) => (cache.has(key) ? cache.get(key) : null),
        remove: (key) => cache.delete(key)
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          lockState.tryLockCalls += 1;
          if (!lockAvailable || lockState.held) return false;
          lockState.held = true;
          return true;
        },
        releaseLock: () => {
          lockState.held = false;
          lockState.releases += 1;
        }
      })
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        fetches.push({ url, options });
        const outcome = respond(fetches.length, { url, options });
        if (outcome instanceof Error) throw outcome;
        return { getResponseCode: () => outcome.code };
      }
    },
    Utilities: { sleep: (ms) => sleeps.push(ms) },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((trigger) => ({ getHandlerFunction: () => trigger.handler })),
      newTrigger: (handler) => {
        const trigger = { handler };
        return {
          forSpreadsheet: (spreadsheet) => {
            trigger.spreadsheet = spreadsheet;
            return {
              onEdit: () => ({
                create: () => {
                  trigger.kind = "onEdit";
                  triggers.push(trigger);
                }
              })
            };
          }
        };
      }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getId: () => SHEET_ID,
        getActiveSheet: () => ({ getName: () => "Sheet1" })
      })
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { sandbox, logs, fetches, sleeps, cache, triggers, lockState };
}

// An `e` event like Google passes to an on-edit handler.
function edit({ column = 9, lastColumn = column, row = 2, lastRow = row, sheetName = "Sheet1", spreadsheetId = SHEET_ID } = {}) {
  return {
    source: { getId: () => spreadsheetId },
    range: {
      getColumn: () => column,
      getLastColumn: () => lastColumn,
      getRow: () => row,
      getLastRow: () => lastRow,
      getSheet: () => ({ getName: () => sheetName })
    }
  };
}

describe("which edits it reacts to", () => {
  test("an edit of column I below the header calls the backend once", () => {
    const env = loadScript();
    env.sandbox.handleFullPaymentEdit(edit({ column: 9, row: 2 }));
    assert.equal(env.fetches.length, 1);
  });

  test("a column that is not I is ignored (A..H and J..L)", () => {
    const env = loadScript();
    for (const column of [1, 2, 5, 8, 10, 11, 12]) env.sandbox.handleFullPaymentEdit(edit({ column, row: 5 }));
    assert.equal(env.fetches.length, 0);
  });

  test("the header row is ignored — even in column I", () => {
    const env = loadScript();
    env.sandbox.handleFullPaymentEdit(edit({ column: 9, row: 1 }));
    assert.equal(env.fetches.length, 0);
  });

  test("a paste or fill whose range includes column I reacts; one that stops short of / starts after it does not", () => {
    const env = loadScript();
    env.sandbox.handleFullPaymentEdit(edit({ column: 9, row: 2, lastRow: 40 })); // I2:I40
    assert.equal(env.fetches.length, 1);
    env.sandbox.handleFullPaymentEdit(edit({ column: 1, lastColumn: 12, row: 2, lastRow: 40 })); // A2:L40
    assert.equal(env.fetches.length, 2);
    env.sandbox.handleFullPaymentEdit(edit({ column: 8, lastColumn: 9, row: 3 })); // H3:I3
    assert.equal(env.fetches.length, 3);

    env.sandbox.handleFullPaymentEdit(edit({ column: 1, lastColumn: 8, row: 2, lastRow: 40 })); // A2:H40 — stops before I
    env.sandbox.handleFullPaymentEdit(edit({ column: 10, lastColumn: 12, row: 2, lastRow: 40 })); // J2:L40 — starts after I
    assert.equal(env.fetches.length, 3);
  });

  test("a range covering only the header row (e.g. I1) never calls; one spanning header + data does", () => {
    const env = loadScript();
    env.sandbox.handleFullPaymentEdit(edit({ column: 9, row: 1, lastRow: 1 }));
    assert.equal(env.fetches.length, 0);
    env.sandbox.handleFullPaymentEdit(edit({ column: 9, row: 1, lastRow: 6 }));
    assert.equal(env.fetches.length, 1);
  });

  test("a malformed event does nothing and never throws", () => {
    const env = loadScript();
    for (const bad of [undefined, null, {}, { range: null }, { source: {} }]) env.sandbox.handleFullPaymentEdit(bad);
    assert.equal(env.fetches.length, 0);
  });
});

describe("what it sends", () => {
  test("POSTs the spreadsheet id and tab name to BACKEND_URL with the Bearer secret in the header only", () => {
    const env = loadScript();
    env.sandbox.handleFullPaymentEdit(edit({ sheetName: "Sheet1" }));

    const { url, options } = env.fetches[0];
    assert.equal(url, URL_PROPERTY);
    assert.equal(options.method, "post");
    assert.equal(options.contentType, "application/json");
    assert.equal(options.headers.Authorization, `Bearer ${SECRET}`);
    assert.deepEqual(JSON.parse(options.payload), { spreadsheetId: SHEET_ID, sheetName: "Sheet1" });
    // The secret is nowhere else: not the URL, not the body.
    assert.equal(url.includes(SECRET), false);
    assert.equal(options.payload.includes(SECRET), false);
  });

  test("it never follows redirects (the secret must not be forwarded to another host) and never throws on HTTP errors", () => {
    const env = loadScript();
    env.sandbox.handleFullPaymentEdit(edit());
    assert.equal(env.fetches[0].options.followRedirects, false);
    assert.equal(env.fetches[0].options.muteHttpExceptions, true);
  });

  test("the tab name comes from the edited sheet", () => {
    const env = loadScript();
    env.sandbox.handleFullPaymentEdit(edit({ sheetName: "Finance 2026" }));
    assert.equal(JSON.parse(env.fetches[0].options.payload).sheetName, "Finance 2026");
  });

  test("the secret and URL come from Script Properties — the source contains neither", () => {
    assert.equal(SOURCE.includes(SECRET), false);
    assert.equal(/alshayebexperience\.com/.test(SOURCE.replace(/^\s*\*.*$/gm, "")), false, "no URL in executable code");
    assert.match(SOURCE, /getScriptProperties\(\)/);
    assert.match(SOURCE, /getProperty\('CRON_SECRET'\)/);
    assert.match(SOURCE, /getProperty\('BACKEND_URL'\)/);
  });

  test("missing script properties: nothing is sent and the message names the setting, not any value", () => {
    for (const properties of [{}, { BACKEND_URL: URL_PROPERTY }, { CRON_SECRET: SECRET }]) {
      const env = loadScript({ properties });
      env.sandbox.handleFullPaymentEdit(edit());
      assert.equal(env.fetches.length, 0);
      assert.match(env.logs.join("\n"), /BACKEND_URL and CRON_SECRET/);
      assert.equal(env.logs.join("\n").includes(SECRET), false);
    }
  });
});

describe("it is an INSTALLABLE trigger, not a simple one", () => {
  test("no function is named onEdit (a simple trigger cannot make authenticated calls and would double-fire)", () => {
    const env = loadScript();
    assert.equal(typeof env.sandbox.onEdit, "undefined");
    assert.equal(typeof env.sandbox.handleFullPaymentEdit, "function");
  });

  test("installFullPaymentTrigger creates one on-edit trigger for this spreadsheet, and never a second", () => {
    const env = loadScript();
    env.sandbox.installFullPaymentTrigger();
    assert.equal(env.triggers.length, 1);
    assert.equal(env.triggers[0].handler, "handleFullPaymentEdit");
    assert.equal(env.triggers[0].kind, "onEdit");
    assert.equal(env.triggers[0].spreadsheet.getId(), SHEET_ID);

    env.sandbox.installFullPaymentTrigger();
    assert.equal(env.triggers.length, 1);
  });

  test("testFullPaymentBackend sends the active spreadsheet + tab through the same path", () => {
    const env = loadScript();
    env.sandbox.testFullPaymentBackend();
    assert.equal(env.fetches.length, 1);
    assert.deepEqual(JSON.parse(env.fetches[0].options.payload), { spreadsheetId: SHEET_ID, sheetName: "Sheet1" });
    assert.match(env.logs.join("\n"), /Backend check passed/);
  });
});

describe("delivery: retries, locking and coalescing", () => {
  test("a 503 (busy) or network error is retried; success stops the retries", () => {
    const env = loadScript({ respond: (n) => (n === 1 ? { code: 503 } : n === 2 ? new Error("network down") : { code: 200 }) });
    env.sandbox.handleFullPaymentEdit(edit());
    assert.equal(env.fetches.length, 3);
    assert.deepEqual(env.sleeps, [3000, 6000]);
    assert.match(env.logs.join("\n"), /sync OK \(HTTP 200\)/);
  });

  test("gives up after three attempts on persistent 5xx", () => {
    const env = loadScript({ respond: () => ({ code: 502 }) });
    env.sandbox.handleFullPaymentEdit(edit());
    assert.equal(env.fetches.length, 3);
  });

  test("a 4xx (wrong secret, unknown sheet) is NOT retried — retrying cannot fix it — and the secret is not logged", () => {
    for (const code of [401, 403, 404, 422]) {
      const env = loadScript({ respond: () => ({ code }) });
      env.sandbox.handleFullPaymentEdit(edit());
      assert.equal(env.fetches.length, 1, `HTTP ${code}`);
      assert.match(env.logs.join("\n"), new RegExp(`HTTP ${code}`));
      assert.equal(env.logs.join("\n").includes(SECRET), false);
    }
  });

  test("the lock is always released, even if the request throws", () => {
    const env = loadScript({ respond: () => new Error("boom") });
    env.sandbox.handleFullPaymentEdit(edit());
    assert.equal(env.lockState.held, false);
    assert.equal(env.lockState.releases, 1);
  });

  test("edits that arrive while a delivery is in flight are coalesced into ONE follow-up call, not one each", () => {
    let nested = false;
    const env = loadScript({
      respond: (n) => {
        // While the first call is "in flight", four more edits land (the lock is held, so they only mark it dirty).
        if (n === 1 && !nested) {
          nested = true;
          for (let i = 0; i < 4; i += 1) env.sandbox.handleFullPaymentEdit(edit({ row: 3 + i }));
        }
        return { code: 200 };
      }
    });
    env.sandbox.handleFullPaymentEdit(edit());
    assert.equal(env.fetches.length, 2, "one for the first edit + one covering all four that arrived meanwhile");
    assert.equal(env.lockState.held, false);
  });

  test("an execution that cannot get the lock leaves its edit marked for the one that holds it, and sends nothing itself", () => {
    const env = loadScript({ lockAvailable: false });
    env.sandbox.handleFullPaymentEdit(edit());
    assert.equal(env.fetches.length, 0);
    assert.equal(env.cache.get("fullPaymentDirty"), "1");
  });

  test("the delivery loop is bounded (a flood of edits cannot loop forever)", () => {
    const env = loadScript({
      respond: () => {
        env.cache.set("fullPaymentDirty", "1"); // an edit lands during every single call
        return { code: 200 };
      }
    });
    env.sandbox.handleFullPaymentEdit(edit());
    assert.equal(env.fetches.length, 3);
  });
});

describe("logging never contains the secret", () => {
  test("across success, failure, retry and misconfiguration", () => {
    const scenarios = [
      loadScript(),
      loadScript({ respond: () => ({ code: 401 }) }),
      loadScript({ respond: () => new Error(`network error while calling with ${"x"}`) }),
      loadScript({ properties: {} })
    ];
    for (const env of scenarios) {
      env.sandbox.handleFullPaymentEdit(edit());
      assert.equal(env.logs.join("\n").includes(SECRET), false);
      assert.equal(env.logs.join("\n").includes(SHEET_ID), false, "the spreadsheet id is not logged either");
    }
  });
});
