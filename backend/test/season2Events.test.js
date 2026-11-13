// Admin-only Season 2 Events Management.
//
// ISOLATED: no real MongoDB, Google Sheets or Cloudinary is touched. Models are
// stubbed with an in-memory store and the Cloudinary uploader is faked.
//
// Run with:  npm test

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MODE = "off";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { v2: cloudinary } = require("cloudinary");

const app = require("../src/app");
const Season2Event = require("../src/models/Season2Event");
const School = require("../src/models/School");
const SchoolFinanceConfig = require("../src/models/SchoolFinanceConfig");
const LegacyEvent = require("../src/models/Event");
const { cairoLocalToUtc } = require("../src/utils/season2EventValidation");
const { queryResult } = require("./support/memoryDb");

const SHEET_A = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AAAA";
const SHEET_B = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210-_BBBB";
const SHEET_FINANCE = "1FinanceSheetOnlyForTestsXXXXXXXXXXXXXXXX";
const SHEET_LEGACY = "1LegacySeasonOneSheetForTestsXXXXXXXXXXXX";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

const adminHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ email: "admin@example.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" })}`
});

let events; // in-memory "season2events" collection
let schools; // fictional Schools
let uploads;
let destroyed;
let restorers;
let touchedCustomerData;

function stub(obj, key, fn) {
  const original = obj[key];
  obj[key] = fn;
  restorers.push(() => {
    obj[key] = original;
  });
}

test.beforeEach(() => {
  restorers = [];
  events = [];
  uploads = [];
  destroyed = [];
  touchedCustomerData = [];
  schools = [
    { _id: new mongoose.Types.ObjectId(), name: "Fictional School One", accessCode: "SECRET1" },
    { _id: new mongoose.Types.ObjectId(), name: "Fictional School Two", accessCode: "SECRET2" },
    { _id: new mongoose.Types.ObjectId(), name: "Fictional School Three", accessCode: "SECRET3" }
  ];

  stub(Season2Event.prototype, "save", async function save() {
    await this.validate();
    const index = events.findIndex((doc) => String(doc._id) === String(this._id));
    if (index === -1) events.push(this);
    return this;
  });
  stub(Season2Event, "find", (filter = {}) =>
    queryResult(events.filter((doc) => !filter.status || doc.status === filter.status).sort((a, b) => a.startsAt - b.startsAt))
  );
  stub(Season2Event, "findById", (id) => queryResult(events.find((doc) => String(doc._id) === String(id)) || null));
  stub(Season2Event, "exists", async (filter) => {
    const hit = events.find(
      (doc) =>
        doc.sheet?.spreadsheetId === filter["sheet.spreadsheetId"] &&
        (!filter._id || String(doc._id) !== String(filter._id.$ne))
    );
    return hit ? { _id: hit._id } : null;
  });
  stub(School, "countDocuments", async (filter) => {
    const wanted = filter._id.$in.map(String);
    return schools.filter((school) => wanted.includes(String(school._id))).length;
  });
  stub(School, "find", (filter) => {
    const wanted = filter._id.$in.map(String);
    // Mirrors .select("name"): the route must never receive anything else.
    return queryResult(schools.filter((s) => wanted.includes(String(s._id))).map((s) => ({ _id: s._id, name: s.name })));
  });
  stub(SchoolFinanceConfig, "exists", async (filter) => (filter.googleSheetId === SHEET_FINANCE ? { _id: 1 } : null));
  stub(LegacyEvent, "exists", async (filter) =>
    filter.$or.some((clause) => Object.values(clause).includes(SHEET_LEGACY)) ? { _id: 1 } : null
  );

  stub(cloudinary.uploader, "upload_stream", (options, callback) => {
    uploads.push(options);
    return {
      end() {
        callback(null, {
          secure_url: `https://res.cloudinary.test/${options.folder}/img${uploads.length}.png`,
          public_id: `${options.folder}/img${uploads.length}`
        });
      }
    };
  });
  stub(cloudinary.uploader, "destroy", async (publicId) => {
    destroyed.push(publicId);
    return { result: "ok" };
  });

  // Any touch of customer / payment collections during event admin calls fails the test.
  const Attendee = require("../src/models/Attendee");
  const Deposit = require("../src/models/Deposit");
  for (const [model, name] of [[Attendee, "Attendee"], [Deposit, "Deposit"]]) {
    for (const method of ["create", "updateOne", "updateMany", "findByIdAndUpdate", "deleteOne", "deleteMany"]) {
      stub(model, method, async () => {
        touchedCustomerData.push(`${name}.${method}`);
        return null;
      });
    }
  }
  for (const method of ["create", "updateOne", "updateMany", "findByIdAndUpdate", "deleteOne", "deleteMany"]) {
    stub(School, method, async () => {
      touchedCustomerData.push(`School.${method}`);
      return null;
    });
  }
});

test.afterEach(() => {
  while (restorers.length) restorers.pop()();
});

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function call(base, method, path, { body, headers = adminHeaders(), form } = {}) {
  const res = await fetch(`${base}/api/admin/season2-events${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: form || (body ? JSON.stringify(body) : undefined)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text };
}

const validBody = (overrides = {}) => ({
  name: "Fictional Prom Night",
  eventDate: "2026-12-12",
  eventTime: "21:30",
  location: "Fictional Venue, Cairo",
  outcomerTicketPriceEGP: 1500,
  schoolIds: [String(schools[0]._id), String(schools[1]._id)],
  sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_A}/edit#gid=0`,
  ...overrides
});

// --------------------------------------------------------------------------
// Authorization
// --------------------------------------------------------------------------

test("every endpoint rejects a missing or invalid admin token (401)", async () => {
  await withServer(async (base) => {
    const id = new mongoose.Types.ObjectId().toString();
    const bad = { Authorization: "Bearer not-a-real-token" };
    for (const [method, path] of [
      ["GET", ""],
      ["GET", `/${id}`],
      ["POST", ""],
      ["PUT", `/${id}`],
      ["POST", `/${id}/thumbnail`]
    ]) {
      const none = await call(base, method, path, { body: method === "POST" || method === "PUT" ? {} : undefined, headers: {} });
      assert.equal(none.status, 401, `${method} ${path} without token`);
      const invalid = await call(base, method, path, { body: method === "POST" || method === "PUT" ? {} : undefined, headers: bad });
      assert.equal(invalid.status, 401, `${method} ${path} with bad token`);
    }
    assert.equal(events.length, 0);
  });
});

test("there is no DELETE route for events", async () => {
  await withServer(async (base) => {
    const created = (await call(base, "POST", "", { body: validBody() })).body.event;
    const res = await call(base, "DELETE", `/${created._id}`);
    assert.equal(res.status, 404);
    assert.equal(events.length, 1);
  });
});

// --------------------------------------------------------------------------
// Create / edit
// --------------------------------------------------------------------------

test("creates an event: defaults to COMING_SOON, stores multiple Schools, exposes names only", async () => {
  await withServer(async (base) => {
    const res = await call(base, "POST", "", { body: validBody() });
    assert.equal(res.status, 201);
    const event = res.body.event;
    assert.equal(event.status, "COMING_SOON");
    assert.equal(event.timezone, "Africa/Cairo");
    assert.equal(event.outcomerTicketPriceEGP, 1500);
    assert.equal(event.schoolIds.length, 2);
    assert.deepEqual(event.schools.map((s) => s.name).sort(), ["Fictional School One", "Fictional School Two"]);
    assert.equal(event.sheet.spreadsheetId, SHEET_A);
    assert.equal(event.sheet.tabName, "Sheet1");
    assert.equal(event.sheet.url, `https://docs.google.com/spreadsheets/d/${SHEET_A}/edit`);
    // Never leak School Access Codes.
    assert.ok(!res.text.includes("SECRET1") && !res.text.includes("accessCode"));
    assert.deepEqual(touchedCustomerData, []);
  });
});

test("edits event details; partial update keeps other fields; all statuses editable", async () => {
  await withServer(async (base) => {
    const created = (await call(base, "POST", "", { body: validBody() })).body.event;

    for (const status of ["AVAILABLE", "UNAVAILABLE", "COMING_SOON"]) {
      const res = await call(base, "PUT", `/${created._id}`, { body: { status, name: `Edited while ${status}` } });
      assert.equal(res.status, 200);
      assert.equal(res.body.event.status, status);
      assert.equal(res.body.event.name, `Edited while ${status}`);
      assert.equal(res.body.event.location, "Fictional Venue, Cairo");
      assert.equal(res.body.event.sheet.spreadsheetId, SHEET_A);
    }

    const moved = await call(base, "PUT", `/${created._id}`, {
      body: { eventTime: "20:00", location: "New Venue", outcomerTicketPriceEGP: "1750.5" }
    });
    assert.equal(moved.body.event.eventTime, "20:00");
    assert.equal(moved.body.event.eventDate, "2026-12-12");
    assert.equal(moved.body.event.outcomerTicketPriceEGP, 1750.5);
    assert.equal(new Date(moved.body.event.startsAt).toISOString(), "2026-12-12T18:00:00.000Z");
  });
});

test("the same School can be in several events, and School records are never written", async () => {
  await withServer(async (base) => {
    const schoolId = String(schools[0]._id);
    const a = await call(base, "POST", "", { body: validBody({ name: "Event A", schoolIds: [schoolId] }) });
    const b = await call(base, "POST", "", {
      body: validBody({ name: "Event B", schoolIds: [schoolId, String(schools[2]._id)], sheetUrl: SHEET_B })
    });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.body.event.schoolIds[0], schoolId);
    assert.ok(b.body.event.schoolIds.includes(schoolId));
    assert.deepEqual(touchedCustomerData, []);
  });
});

test("duplicate School ids are collapsed; unknown or malformed ids are rejected", async () => {
  await withServer(async (base) => {
    const id = String(schools[0]._id);
    const dup = await call(base, "POST", "", { body: validBody({ schoolIds: [id, id.toUpperCase(), id] }) });
    assert.equal(dup.status, 201);
    assert.equal(dup.body.event.schoolIds.length, 1);

    const unknown = await call(base, "POST", "", {
      body: validBody({ sheetUrl: SHEET_B, schoolIds: [new mongoose.Types.ObjectId().toString()] })
    });
    assert.equal(unknown.status, 422);

    const malformed = await call(base, "POST", "", { body: validBody({ sheetUrl: SHEET_B, schoolIds: ["nope"] }) });
    assert.equal(malformed.status, 422);

    const notArray = await call(base, "POST", "", { body: validBody({ sheetUrl: SHEET_B, schoolIds: "abc" }) });
    assert.equal(notArray.status, 422);
  });
});

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

test("validates required fields, date, time, status and ticket price (> 0)", async () => {
  await withServer(async (base) => {
    const bad = [
      { name: "" },
      { name: "x" },
      { location: "" },
      { eventDate: "2026-02-31" },
      { eventDate: "12/12/2026" },
      { eventDate: undefined },
      { eventTime: "25:00" },
      { eventTime: "9pm" },
      { eventTime: undefined },
      { status: "SOLD_OUT" },
      { status: "available" },
      { outcomerTicketPriceEGP: 0 },
      { outcomerTicketPriceEGP: "0" },
      { outcomerTicketPriceEGP: -5 },
      { outcomerTicketPriceEGP: "abc" },
      { outcomerTicketPriceEGP: 10.555 },
      { outcomerTicketPriceEGP: 99999999 },
      { outcomerTicketPriceEGP: undefined },
      { outcomerTicketPriceEGP: "" }
    ];
    for (const overrides of bad) {
      const res = await call(base, "POST", "", { body: validBody(overrides) });
      assert.equal(res.status, 422, `should reject ${JSON.stringify(overrides)}`);
    }
    assert.equal(events.length, 0);

    const ok = await call(base, "POST", "", { body: validBody({ outcomerTicketPriceEGP: 0.5 }) });
    assert.equal(ok.status, 201);

    const id = ok.body.event._id;
    for (const overrides of [{ outcomerTicketPriceEGP: 0 }, { status: "NOPE" }, { name: " " }, { eventTime: "99:99" }]) {
      const res = await call(base, "PUT", `/${id}`, { body: overrides });
      assert.equal(res.status, 422, `PUT should reject ${JSON.stringify(overrides)}`);
    }
    assert.equal((await call(base, "PUT", `/${new mongoose.Types.ObjectId()}`, { body: { name: "Valid name" } })).status, 404);
    assert.equal((await call(base, "PUT", "/not-an-id", { body: { name: "Valid name" } })).status, 422);
  });
});

test("converts Egypt time to UTC correctly in winter and summer", () => {
  assert.equal(cairoLocalToUtc("2026-01-15", "21:30").toISOString(), "2026-01-15T19:30:00.000Z"); // UTC+2
  assert.equal(cairoLocalToUtc("2026-07-15", "21:30").toISOString(), "2026-07-15T18:30:00.000Z"); // UTC+3 (DST)
  assert.equal(cairoLocalToUtc("2026-12-12", "00:00").toISOString(), "2026-12-11T22:00:00.000Z");
});

// --------------------------------------------------------------------------
// Google Sheet
// --------------------------------------------------------------------------

test("a dedicated Sheet is REQUIRED on create and cannot be removed on edit", async () => {
  await withServer(async (base) => {
    assert.equal((await call(base, "POST", "", { body: validBody({ sheetUrl: undefined }) })).status, 422);
    assert.equal((await call(base, "POST", "", { body: validBody({ sheetUrl: "  " }) })).status, 422);
    assert.equal((await call(base, "POST", "", { body: validBody({ sheetUrl: "https://example.com/spreadsheets/d/abc" }) })).status, 422);
    assert.equal((await call(base, "POST", "", { body: validBody({ sheetUrl: "https://docs.google.com/document/d/" + SHEET_A }) })).status, 422);

    const created = (await call(base, "POST", "", { body: validBody() })).body.event;
    assert.equal((await call(base, "PUT", `/${created._id}`, { body: { sheetUrl: "" } })).status, 422);

    // A bare id and a link both normalise to the same canonical id.
    const changed = await call(base, "PUT", `/${created._id}`, { body: { sheetUrl: SHEET_B, sheetTabName: "Outcomers" } });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.event.sheet.spreadsheetId, SHEET_B);
    assert.equal(changed.body.event.sheet.tabName, "Outcomers");
  });
});

test("every event needs its OWN Sheet: rejects School Finance, Season 1 and other-event Sheets (409)", async () => {
  await withServer(async (base) => {
    const finance = await call(base, "POST", "", { body: validBody({ sheetUrl: SHEET_FINANCE }) });
    assert.equal(finance.status, 409);
    assert.match(finance.body.message, /School Finance/);

    const legacy = await call(base, "POST", "", { body: validBody({ sheetUrl: SHEET_LEGACY }) });
    assert.equal(legacy.status, 409);
    assert.match(legacy.body.message, /Season 1/);

    const first = await call(base, "POST", "", { body: validBody() });
    assert.equal(first.status, 201);
    const reuse = await call(base, "POST", "", { body: validBody({ name: "Second event" }) });
    assert.equal(reuse.status, 409);

    // Re-saving an event with its own Sheet is fine; pointing at another event's Sheet is not.
    const second = await call(base, "POST", "", { body: validBody({ name: "Second event", sheetUrl: SHEET_B }) });
    assert.equal(second.status, 201);
    assert.equal((await call(base, "PUT", `/${first.body.event._id}`, { body: { sheetUrl: SHEET_A, name: "Renamed" } })).status, 200);
    assert.equal((await call(base, "PUT", `/${first.body.event._id}`, { body: { sheetUrl: SHEET_B } })).status, 409);
    assert.equal((await call(base, "PUT", `/${second.body.event._id}`, { body: { sheetUrl: SHEET_FINANCE } })).status, 409);
  });
});

test("saving an event never calls Google (no network, no Sheet write)", async () => {
  const { google } = require("googleapis");
  const original = google.sheets;
  let googleCalls = 0;
  google.sheets = () => {
    googleCalls += 1;
    throw new Error("Google must not be called");
  };
  try {
    await withServer(async (base) => {
      const created = await call(base, "POST", "", { body: validBody() });
      assert.equal(created.status, 201);
      await call(base, "PUT", `/${created.body.event._id}`, { body: { status: "AVAILABLE" } });
    });
    assert.equal(googleCalls, 0);
  } finally {
    google.sheets = original;
  }
});

// --------------------------------------------------------------------------
// Thumbnail
// --------------------------------------------------------------------------

function thumbnailForm(buffer, type = "image/png", name = "thumb.png") {
  const form = new FormData();
  form.append("thumbnail", new Blob([buffer], { type }), name);
  return form;
}

test("uploads a thumbnail to its own folder and replaces it safely", async () => {
  await withServer(async (base) => {
    const created = (await call(base, "POST", "", { body: validBody() })).body.event;
    assert.equal(created.thumbnailUrl, null);

    const first = await call(base, "POST", `/${created._id}/thumbnail`, { form: thumbnailForm(PNG) });
    assert.equal(first.status, 200);
    assert.match(first.body.event.thumbnailUrl, /alshayeb\/season2-event-thumbnails\/img1/);
    assert.equal(uploads[0].folder, "alshayeb/season2-event-thumbnails");
    assert.ok(!first.text.includes("publicId"));

    const second = await call(base, "POST", `/${created._id}/thumbnail`, { form: thumbnailForm(PNG) });
    assert.equal(second.status, 200);
    assert.match(second.body.event.thumbnailUrl, /img2/);
    assert.deepEqual(destroyed, ["alshayeb/season2-event-thumbnails/img1"]);
  });
});

test("a thumbnail upload never deletes assets outside the event-thumbnail folder", async () => {
  await withServer(async (base) => {
    const created = (await call(base, "POST", "", { body: validBody() })).body.event;
    events[0].thumbnail = { url: "https://x/y.png", publicId: "alshayeb/incomer-photos/customer-photo" };
    const res = await call(base, "POST", `/${created._id}/thumbnail`, { form: thumbnailForm(PNG) });
    assert.equal(res.status, 200);
    assert.deepEqual(destroyed, []);
  });
});

test("rejects bad thumbnails: wrong type, fake image bytes, over 4 MB, missing file, unknown event", async () => {
  await withServer(async (base) => {
    const created = (await call(base, "POST", "", { body: validBody() })).body.event;
    const url = `/${created._id}/thumbnail`;

    assert.equal((await call(base, "POST", url, { form: thumbnailForm(Buffer.from("%PDF-1.4 fake"), "application/pdf", "a.pdf") })).status, 422);
    assert.equal((await call(base, "POST", url, { form: thumbnailForm(Buffer.from("<script>alert(1)</script>"), "image/png") })).status, 422);
    assert.equal((await call(base, "POST", url, { form: thumbnailForm(Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)])) })).status, 422);
    assert.equal((await call(base, "POST", url, { form: new FormData() })).status, 422);
    const missingEvent = await call(base, "POST", `/${new mongoose.Types.ObjectId()}/thumbnail`, { form: thumbnailForm(PNG) });
    assert.equal(missingEvent.status, 404);
    assert.equal(uploads.length, 0);

    // 4 MB exactly is accepted; PNG, JPG and WebP all pass.
    const exactly4mb = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024 - PNG.length)]);
    assert.equal((await call(base, "POST", url, { form: thumbnailForm(exactly4mb) })).status, 200);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
    assert.equal((await call(base, "POST", url, { form: thumbnailForm(jpg, "image/jpeg", "a.jpg") })).status, 200);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(32)]);
    assert.equal((await call(base, "POST", url, { form: thumbnailForm(webp, "image/webp", "a.webp") })).status, 200);
  });
});

// --------------------------------------------------------------------------
// Admin list + isolation from the customer portal and Season 1
// --------------------------------------------------------------------------

test("lists all events regardless of status and can filter by status", async () => {
  await withServer(async (base) => {
    await call(base, "POST", "", { body: validBody({ name: "Soon", status: "COMING_SOON" }) });
    await call(base, "POST", "", { body: validBody({ name: "Open", status: "AVAILABLE", sheetUrl: SHEET_B }) });
    const all = await call(base, "GET", "");
    assert.equal(all.body.events.length, 2);
    const available = await call(base, "GET", "?status=AVAILABLE");
    assert.deepEqual(available.body.events.map((e) => e.name), ["Open"]);
    assert.equal((await call(base, "GET", "?status=BOGUS")).status, 422);
  });
});

test("AVAILABLE exposes nothing publicly: the legacy public /api/events and unauthenticated routes never return Season 2 events", async () => {
  await withServer(async (base) => {
    const created = (await call(base, "POST", "", { body: validBody({ status: "AVAILABLE" }) })).body.event;

    // The legacy public list reads the Season 1 `Event` model only.
    stub(LegacyEvent, "find", async () => []);
    const publicList = await fetch(`${base}/api/events`);
    assert.equal(publicList.status, 200);
    const publicText = await publicList.text();
    assert.ok(!publicText.includes("Fictional Prom Night") && !publicText.includes(created._id));

    for (const path of ["", `/${created._id}`]) {
      const res = await fetch(`${base}/api/admin/season2-events${path}`);
      assert.equal(res.status, 401);
    }
    // No public Season 2 events path exists.
    for (const path of ["/api/season2-events", "/api/season2/events", "/api/events/season2"]) {
      const res = await fetch(`${base}${path}`);
      assert.ok([404, 400].includes(res.status), `${path} -> ${res.status}`);
      assert.ok(!(await res.text()).includes(created._id));
    }
  });
});

test("event admin never touches customers, payments or School records", async () => {
  await withServer(async (base) => {
    const created = (await call(base, "POST", "", { body: validBody() })).body.event;
    await call(base, "PUT", `/${created._id}`, { body: { status: "AVAILABLE", schoolIds: [String(schools[2]._id)] } });
    await call(base, "POST", `/${created._id}/thumbnail`, { form: thumbnailForm(PNG) });
    assert.deepEqual(touchedCustomerData, []);
  });
});

// --------------------------------------------------------------------------
// Database-level Sheet uniqueness (simultaneous saves)
// --------------------------------------------------------------------------

test("the model declares a UNIQUE index on the Spreadsheet id", () => {
  const index = Season2Event.schema.indexes().find(([fields]) => fields["sheet.spreadsheetId"] === 1);
  assert.ok(index, "index on sheet.spreadsheetId exists");
  assert.equal(index[1].unique, true);
});

test("a simultaneous duplicate Sheet (database duplicate-key error) still returns the clear 409", async () => {
  await withServer(async (base) => {
    const first = (await call(base, "POST", "", { body: validBody() })).body.event;
    const second = (await call(base, "POST", "", { body: validBody({ name: "Second", sheetUrl: SHEET_B }) })).body.event;

    // Simulate the race: the pre-check saw no clash, but the database unique index rejects the save.
    const realSave = Season2Event.prototype.save;
    const raceError = () => {
      const error = new Error("E11000 duplicate key error collection: season2events index: sheet_spreadsheetId_unique");
      error.code = 11000;
      error.keyPattern = { "sheet.spreadsheetId": 1 };
      return error;
    };
    stub(Season2Event.prototype, "save", async function save() {
      throw raceError();
    });

    const created = await call(base, "POST", "", { body: validBody({ name: "Racer", sheetUrl: "1RaceSheetFictionalXXXXXXXXXXXXXXXXXXXX" }) });
    assert.equal(created.status, 409);
    assert.match(created.body.message, /already assigned to another event/);

    const edited = await call(base, "PUT", `/${second._id}`, { body: { sheetUrl: "1RaceSheetFictionalYYYYYYYYYYYYYYYYYYYY" } });
    assert.equal(edited.status, 409);
    assert.match(edited.body.message, /already assigned to another event/);

    // Unrelated database errors are not disguised as a Sheet clash.
    stub(Season2Event.prototype, "save", async function save() {
      const error = new Error("E11000 duplicate key error index: something_else");
      error.code = 11000;
      throw error;
    });
    const other = await call(base, "PUT", `/${first._id}`, { body: { name: "Another name" } });
    assert.equal(other.status, 500);
    Season2Event.prototype.save = realSave;
  });
});
