// Season 2 Admin Dashboard + Registered Customers.
//
// The aggregation tests run against a REAL throwaway mongod (see
// test/support/realMongo.js) because they must prove what the pipelines
// actually compute — an in-memory stub cannot run $lookup/$group/$facet. They
// are skipped (not failed) if no mongod binary is available.

process.env.JWT_SECRET = "test-jwt-secret-not-real";
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MODE = "off";

const { describe, before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../src/app");
const Attendee = require("../src/models/Attendee");
const Deposit = require("../src/models/Deposit");
const FullPaymentStatus = require("../src/models/FullPaymentStatus");
const School = require("../src/models/School");
const stats = require("../src/services/season2AdminStats");
const { MONGOD_SKIP_REASON, startRealMongo } = require("./support/realMongo");

const adminHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ email: "admin@example.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" })}`
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

const getJson = async (base, path, headers = adminHeaders()) => {
  const response = await fetch(`${base}${path}`, { headers });
  return { status: response.status, body: await response.json() };
};

// ---------------------------------------------------------------------------
// No database needed
// ---------------------------------------------------------------------------

describe("admin season2 endpoints require admin authentication", () => {
  test("dashboard, customer list and customer detail all reject a missing or bad token", async () => {
    await withServer(async (base) => {
      for (const path of [
        "/api/admin/season2/dashboard",
        "/api/admin/season2/customers",
        `/api/admin/season2/customers/${"a".repeat(24)}`
      ]) {
        assert.equal((await fetch(`${base}${path}`)).status, 401, `${path} without a token`);
        assert.equal(
          (await fetch(`${base}${path}`, { headers: { Authorization: "Bearer not-a-real-token" } })).status,
          401,
          `${path} with an invalid token`
        );
      }
    });
  });

  test("a customer token (not an admin JWT signed with the secret) cannot read them", async () => {
    const forged = jwt.sign({ email: "x@example.com", role: "admin" }, "some-other-secret");
    await withServer(async (base) => {
      const response = await fetch(`${base}/api/admin/season2/customers`, {
        headers: { Authorization: `Bearer ${forged}` }
      });
      assert.equal(response.status, 401);
    });
  });
});

describe("customer list query validation", () => {
  test("rejects bad paging, filters and dates with a 422", () => {
    const bad = [
      { page: "0" },
      { page: "abc" },
      { pageSize: "0" },
      { pageSize: String(stats.MAX_PAGE_SIZE + 1) },
      { pageSize: "2.5" },
      { schoolId: "not-an-id" },
      { payment: "maybe" },
      { fullPayment: "sometimes" },
      { from: "2026/09/01" },
      { to: "2026-02-31" }
    ];
    for (const query of bad) {
      assert.throws(() => stats.parseCustomerQuery(query), (error) => error.statusCode === 422, JSON.stringify(query));
    }
  });

  test("applies defaults", () => {
    const parsed = stats.parseCustomerQuery({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, stats.DEFAULT_PAGE_SIZE);
    assert.equal(parsed.q, "");
  });
});

describe("Egypt-local 'today'", () => {
  test("summer (UTC+3): a UTC evening is already tomorrow in Cairo", () => {
    // 2026-09-19T21:30Z is 00:30 on the 20th in Cairo (UTC+3, DST in force).
    assert.equal(stats.startOfToday(new Date("2026-09-19T21:30:00Z")).toISOString(), "2026-09-19T21:00:00.000Z");
    assert.equal(stats.startOfToday(new Date("2026-09-20T12:00:00Z")).toISOString(), "2026-09-19T21:00:00.000Z");
    // 20:30Z is 23:30 on the 19th in Cairo — still the 19th.
    assert.equal(stats.startOfToday(new Date("2026-09-19T20:30:00Z")).toISOString(), "2026-09-18T21:00:00.000Z");
  });

  test("winter (UTC+2)", () => {
    assert.equal(stats.startOfToday(new Date("2026-12-20T12:00:00Z")).toISOString(), "2026-12-19T22:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Real MongoDB
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-20T12:00:00Z"); // 15:00 on 20 Sep in Cairo

describe("dashboard + registered customers against a real MongoDB", { skip: MONGOD_SKIP_REASON }, () => {
  let mongo;
  const ids = {};

  async function makeIncomer(key, { school, createdAt, ticketPrice = 6000, fullName, email, phone, ...extra }) {
    const attendee = await Attendee.create({
      fullName: fullName || `Customer ${key}`,
      phone: phone || `0100000${String(Object.keys(ids).length).padStart(4, "0")}`,
      phoneNormalized: phone || `0100000${String(Object.keys(ids).length).padStart(4, "0")}`,
      email: email || `${key}@example.com`,
      attendeeType: "incomer",
      accessType: "INCOMER",
      schoolId: school,
      ticketPrice,
      incomerPhoto: { url: `https://res.cloudinary.com/demo/image/upload/v1/${key}.jpg`, publicId: `secret-public-id-${key}` },
      ...extra
    });
    // Deterministic registration time (Mongoose timestamps would use "now").
    await Attendee.collection.updateOne({ _id: attendee._id }, { $set: { createdAt } });
    ids[key] = attendee._id;
    return attendee;
  }

  async function makeDeposit(key, amount, status, createdAt) {
    const deposit = await Deposit.create({
      attendeeId: ids[key],
      amount,
      status,
      paymentOptionSnapshot: { amount, label: `Option ${amount}` },
      paymentProof: { url: `https://res.cloudinary.com/demo/image/upload/v1/proof-${amount}.jpg`, publicId: "proof-public-id" },
      ...(status !== "pending" ? { reviewedAt: createdAt } : {})
    });
    if (createdAt) await Deposit.collection.updateOne({ _id: deposit._id }, { $set: { createdAt } });
    return deposit;
  }

  before(async () => {
    mongo = await startRealMongo();
    await mongoose.connect(mongo.uri);

    const [schoolA, schoolB, schoolC] = await School.create([
      { name: "Mega Heliopolis", ticketPrice: 6000 },
      { name: "Cairo Prep", ticketPrice: 6000 },
      { name: "No Students Academy", ticketPrice: 6000 }
    ]);
    ids.schoolA = schoolA._id;
    ids.schoolB = schoolB._id;
    ids.schoolC = schoolC._id;

    // ---- School A ----
    // a1: registered TODAY, never touched payments at all (zero Deposits).
    await makeIncomer("a1", { school: schoolA._id, createdAt: new Date("2026-09-20T11:00:00Z"), fullName: "Alaa Zero Deposits", phone: "01011112222" });
    // a2: two approved (unique-attendee counting), one pending, one rejected.
    await makeIncomer("a2", { school: schoolA._id, createdAt: new Date("2026-09-17T09:00:00Z"), fullName: "Amira Approved", email: "amira@example.com", phone: "01033334444" });
    await makeDeposit("a2", 500, "approved", new Date("2026-09-18T10:00:00Z"));
    await makeDeposit("a2", 1500, "approved", new Date("2026-09-19T10:00:00Z"));
    await makeDeposit("a2", 700, "pending", new Date("2026-09-19T11:00:00Z"));
    await makeDeposit("a2", 300, "rejected", new Date("2026-09-18T12:00:00Z"));
    // a3: only pending + rejected — no approved payment.
    await makeIncomer("a3", { school: schoolA._id, createdAt: new Date("2026-09-16T09:00:00Z"), fullName: "Adam Pending" });
    await makeDeposit("a3", 400, "pending", new Date("2026-09-19T12:00:00Z"));
    await makeDeposit("a3", 250, "rejected", new Date("2026-09-18T13:00:00Z"));

    // ---- School B ----
    // b1: paid 2000 of 6000 but the ACCOUNTANT confirmed Full Payment.
    await makeIncomer("b1", { school: schoolB._id, createdAt: new Date("2026-09-15T09:00:00Z"), fullName: "Bassem Confirmed" });
    await makeDeposit("b1", 2000, "approved", new Date("2026-09-17T10:00:00Z"));
    await FullPaymentStatus.create({ attendeeId: ids.b1, confirmed: true, confirmedAt: new Date("2026-09-18T00:00:00Z") });
    // b2: approved total EQUALS the ticket price, but the accountant has NOT confirmed.
    await makeIncomer("b2", { school: schoolB._id, createdAt: new Date("2026-09-14T09:00:00Z"), ticketPrice: 1000, fullName: "Bola Paid In Full No DONE" });
    await makeDeposit("b2", 1000, "approved", new Date("2026-09-16T10:00:00Z"));
    await FullPaymentStatus.create({ attendeeId: ids.b2, confirmed: false });
    // a4: 00:30 on 20 Sep in Cairo (21:30Z on the 19th) — today in Egypt, yesterday in UTC.
    await makeIncomer("a4", { school: schoolB._id, createdAt: new Date("2026-09-19T21:30:00Z"), fullName: "Aya Midnight Cairo" });
    // a5: 23:30 on 19 Sep in Cairo — NOT today.
    await makeIncomer("a5", { school: schoolB._id, createdAt: new Date("2026-09-19T20:30:00Z"), fullName: "Ali Late Yesterday" });

    // ---- Not a Season 2 Incomer: must never appear anywhere ----
    const guest = await Attendee.create({
      fullName: "Legacy Guest",
      phone: "01099990000",
      phoneNormalized: "01099990000",
      attendeeType: "guest",
      schoolId: schoolA._id
    });
    ids.guest = guest._id;
    await makeDeposit("guest", 9999, "approved", new Date("2026-09-19T10:00:00Z"));
  });

  after(async () => {
    await mongoose.disconnect().catch(() => {});
    if (mongo) await mongo.stop();
  });

  // ---- Dashboard ----

  test("dashboard Total Registered includes zero-payment customers (and no non-Incomers)", async () => {
    const { kpis } = await stats.getDashboard({ now: NOW });
    // a1,a2,a3,a4,a5,b1,b2 — the guest is excluded.
    assert.equal(kpis.totalRegisteredIncomers, 7);
  });

  test("Registered Today uses the Egypt calendar day", async () => {
    const { kpis } = await stats.getDashboard({ now: NOW });
    // a1 (today) + a4 (00:30 Cairo, still 19th in UTC); a5 (23:30 Cairo on the 19th) is not.
    assert.equal(kpis.registeredToday, 2);
  });

  test("No Approved Payment Yet counts customers with zero APPROVED deposits", async () => {
    const { kpis } = await stats.getDashboard({ now: NOW });
    // a1 (no deposits), a3 (pending+rejected only), a4, a5.
    assert.equal(kpis.customersWithNoApprovedPayment, 4);
  });

  test("Customers With Approved Payment is unique per attendee (two approved deposits count once)", async () => {
    const { kpis } = await stats.getDashboard({ now: NOW });
    // a2 has TWO approved deposits, b1 and b2 one each → 3 customers, not 4 deposits.
    assert.equal(kpis.customersWithApprovedPayment, 3);
    assert.equal(kpis.approvedDeposits, 4);
  });

  test("Total Approved Amount is approved deposits only — pending/rejected never count", async () => {
    const { kpis } = await stats.getDashboard({ now: NOW });
    // 500 + 1500 + 2000 + 1000. Pending (700, 400), rejected (300, 250) and the guest's 9999 are excluded.
    assert.equal(kpis.totalApprovedAmount, 5000);
    assert.equal(kpis.pendingDeposits, 2);
    assert.equal(kpis.rejectedDeposits, 2);
  });

  test("Full Payment Complete comes from FullPaymentStatus, never from deposit totals", async () => {
    const { kpis } = await stats.getDashboard({ now: NOW });
    // b1 confirmed (paid only 2000 of 6000) counts; b2 paid its whole ticket price
    // (1000 of 1000) but the accountant has not confirmed, so it does not.
    assert.equal(kpis.fullPaymentComplete, 1);
  });

  test("Total Schools is every School", async () => {
    const { kpis } = await stats.getDashboard({ now: NOW });
    assert.equal(kpis.totalSchools, 3);
  });

  test("School breakdown is correct per school, including a school with no customers", async () => {
    const { schools } = await stats.getDashboard({ now: NOW });
    const byName = Object.fromEntries(schools.map((row) => [row.schoolName, row]));

    assert.deepEqual(
      { ...byName["Mega Heliopolis"], schoolId: undefined },
      {
        schoolId: undefined,
        schoolName: "Mega Heliopolis",
        totalRegistered: 3,
        noApprovedPayment: 2,
        withApprovedPayment: 1,
        fullPaymentComplete: 0,
        pendingDeposits: 2,
        approvedDeposits: 2,
        rejectedDeposits: 2,
        totalApprovedAmount: 2000
      }
    );
    assert.deepEqual(
      { ...byName["Cairo Prep"], schoolId: undefined },
      {
        schoolId: undefined,
        schoolName: "Cairo Prep",
        totalRegistered: 4,
        noApprovedPayment: 2,
        withApprovedPayment: 2,
        fullPaymentComplete: 1,
        pendingDeposits: 0,
        approvedDeposits: 2,
        rejectedDeposits: 0,
        totalApprovedAmount: 3000
      }
    );
    assert.equal(byName["No Students Academy"].totalRegistered, 0);
    assert.equal(byName["No Students Academy"].totalApprovedAmount, 0);
    assert.equal(schools.length, 3);
  });

  test("school breakdown totals add up to the KPI cards", async () => {
    const { kpis, schools } = await stats.getDashboard({ now: NOW });
    const sum = (key) => schools.reduce((total, row) => total + row[key], 0);
    assert.equal(sum("totalRegistered"), kpis.totalRegisteredIncomers);
    assert.equal(sum("totalApprovedAmount"), kpis.totalApprovedAmount);
    assert.equal(sum("fullPaymentComplete"), kpis.fullPaymentComplete);
  });

  test("recent activity uses existing timestamps, newest first, and is capped", async () => {
    const { recent } = await stats.getDashboard({ now: NOW });
    assert.equal(recent.registrations[0].fullName, "Alaa Zero Deposits"); // newest registration
    assert.ok(recent.registrations.length <= 8);
    assert.equal(recent.depositSubmissions[0].status, "pending"); // a3 pending 12:00 on the 19th is the latest submission
    assert.ok(recent.approvedPayments.every((row) => typeof row.amount === "number"));
    assert.equal(recent.approvedPayments[0].fullName, "Amira Approved");
  });

  test("GET /api/admin/season2/dashboard returns the same numbers over HTTP", async () => {
    await withServer(async (base) => {
      const { status, body } = await getJson(base, "/api/admin/season2/dashboard");
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.kpis.totalRegisteredIncomers, 7);
      assert.equal(body.kpis.totalApprovedAmount, 5000);
      assert.ok(Array.isArray(body.schools) && body.schools.length === 3);
    });
  });

  // ---- Registered Customers: list ----

  test("a registered Incomer with ZERO deposits appears in Registered Customers", async () => {
    const { customers, pagination } = await stats.listCustomers({});
    assert.equal(pagination.total, 7);
    const zero = customers.find((customer) => customer.fullName === "Alaa Zero Deposits");
    assert.ok(zero, "zero-deposit customer is listed");
    assert.equal(zero.approvedPaymentCount, 0);
    assert.equal(zero.approvedTotalPaid, 0);
    assert.equal(zero.fullPaymentComplete, false);
    // Not a Season 2 Incomer → not listed.
    assert.equal(customers.some((customer) => customer.fullName === "Legacy Guest"), false);
  });

  test("list rows carry the per-customer payment numbers and Full Payment truth", async () => {
    const { customers } = await stats.listCustomers({});
    const byName = Object.fromEntries(customers.map((customer) => [customer.fullName, customer]));
    assert.equal(byName["Amira Approved"].approvedPaymentCount, 2);
    assert.equal(byName["Amira Approved"].approvedTotalPaid, 2000); // pending 700 + rejected 300 excluded
    assert.equal(byName["Adam Pending"].approvedPaymentCount, 0);
    assert.equal(byName["Adam Pending"].approvedTotalPaid, 0);
    assert.equal(byName["Bassem Confirmed"].fullPaymentComplete, true);
    assert.equal(byName["Bola Paid In Full No DONE"].fullPaymentComplete, false);
    assert.equal(byName["Amira Approved"].schoolName, "Mega Heliopolis");
    assert.equal(byName["Amira Approved"].id, String(ids.a2));
  });

  test("list rows are lightweight: no publicId, no QR/internal fields, no proof, photo is a text URL only", async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/api/admin/season2/customers?pageSize=100`, { headers: adminHeaders() });
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.equal(/publicId|secret-public-id|qrToken|qrId|paymentProof|proof-public-id/.test(text), false);
      const { customers } = JSON.parse(text);
      assert.match(customers[0].photoUrl || "", /^https:\/\/res\.cloudinary\.com\//);
      // Season 2 registration never stores age or Instagram, so they are not part of the shape.
      assert.equal("age" in customers[0] || "instagram" in customers[0], false);
    });
  });

  test("newest registrations come first", async () => {
    const { customers } = await stats.listCustomers({});
    const times = customers.map((customer) => new Date(customer.registeredAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.equal(customers[0].fullName, "Alaa Zero Deposits");
  });

  test("pagination: pages partition the customers with correct totals and no overlap", async () => {
    const page1 = await stats.listCustomers({ page: "1", pageSize: "3" });
    const page2 = await stats.listCustomers({ page: "2", pageSize: "3" });
    const page3 = await stats.listCustomers({ page: "3", pageSize: "3" });
    const beyond = await stats.listCustomers({ page: "4", pageSize: "3" });

    assert.deepEqual(page1.pagination, { page: 1, pageSize: 3, total: 7, totalPages: 3 });
    assert.equal(page1.customers.length, 3);
    assert.equal(page2.customers.length, 3);
    assert.equal(page3.customers.length, 1);
    assert.equal(beyond.customers.length, 0);
    assert.equal(beyond.pagination.total, 7);

    const allIds = [...page1.customers, ...page2.customers, ...page3.customers].map((customer) => customer.id);
    assert.equal(new Set(allIds).size, 7, "no customer appears twice or is skipped");
  });

  test("search by name, email, phone (incl. +20 format) and Customer ID (full and prefix)", async () => {
    const names = async (q) => (await stats.listCustomers({ q })).customers.map((customer) => customer.fullName).sort();

    assert.deepEqual(await names("amira"), ["Amira Approved"]); // name, case-insensitive
    assert.deepEqual(await names("amira@example"), ["Amira Approved"]); // email
    assert.deepEqual(await names("01033334444"), ["Amira Approved"]); // phone
    assert.deepEqual(await names("+20 103 333 4444"), ["Amira Approved"]); // normalised phone
    assert.deepEqual(await names(String(ids.a2)), ["Amira Approved"]); // full Customer ID
    assert.ok((await names(String(ids.a2).slice(0, 18))).includes("Amira Approved"), "an id prefix finds the customer");
    assert.deepEqual(await names("zzz-no-such-customer"), []);
    // Regex characters in the search are literal, not a pattern.
    assert.deepEqual(await names(".*"), []);
  });

  test("filter by School", async () => {
    const result = await stats.listCustomers({ schoolId: String(ids.schoolB) });
    assert.equal(result.pagination.total, 4);
    assert.ok(result.customers.every((customer) => customer.schoolName === "Cairo Prep"));
    assert.equal((await stats.listCustomers({ schoolId: String(ids.schoolC) })).pagination.total, 0);
  });

  test("filter: has approved payment / no approved payment", async () => {
    const approved = await stats.listCustomers({ payment: "approved" });
    const none = await stats.listCustomers({ payment: "none" });
    assert.equal(approved.pagination.total, 3);
    assert.deepEqual(approved.customers.map((c) => c.fullName).sort(), ["Amira Approved", "Bassem Confirmed", "Bola Paid In Full No DONE"]);
    assert.equal(none.pagination.total, 4);
    // Zero-deposit customers are in the "no approved payment" view.
    assert.ok(none.customers.some((customer) => customer.fullName === "Alaa Zero Deposits"));
    assert.equal(approved.pagination.total + none.pagination.total, 7);
  });

  test("filter: full payment complete / not complete", async () => {
    const complete = await stats.listCustomers({ fullPayment: "complete" });
    const incomplete = await stats.listCustomers({ fullPayment: "incomplete" });
    assert.deepEqual(complete.customers.map((customer) => customer.fullName), ["Bassem Confirmed"]);
    assert.equal(incomplete.pagination.total, 6);
    assert.equal(incomplete.customers.some((customer) => customer.fullName === "Bassem Confirmed"), false);
  });

  test("filters combine and paginate together (derived-filter path)", async () => {
    const result = await stats.listCustomers({ schoolId: String(ids.schoolB), payment: "none", pageSize: "1", page: "2" });
    // School B, no approved payment: a4 and a5 → 2 total, this is the second page of size 1.
    assert.equal(result.pagination.total, 2);
    assert.equal(result.pagination.totalPages, 2);
    assert.equal(result.customers.length, 1);
    // Search + derived filter together.
    assert.equal((await stats.listCustomers({ q: "amira", payment: "approved" })).pagination.total, 1);
    assert.equal((await stats.listCustomers({ q: "amira", payment: "none" })).pagination.total, 0);
  });

  test("registration date range uses Egypt days", async () => {
    const today = await stats.listCustomers({ from: "2026-09-20", to: "2026-09-20" });
    assert.deepEqual(today.customers.map((customer) => customer.fullName).sort(), ["Alaa Zero Deposits", "Aya Midnight Cairo"]);

    const before = await stats.listCustomers({ to: "2026-09-19" });
    assert.equal(before.pagination.total, 5);
    assert.equal(before.customers.some((customer) => customer.fullName === "Aya Midnight Cairo"), false);
  });

  test("GET /api/admin/season2/customers supports pagination/search/filters over HTTP and validates input", async () => {
    await withServer(async (base) => {
      const ok = await getJson(base, `/api/admin/season2/customers?pageSize=2&page=2&schoolId=${ids.schoolA}&q=a`);
      assert.equal(ok.status, 200);
      assert.equal(ok.body.pagination.pageSize, 2);
      assert.equal(ok.body.pagination.page, 2);

      assert.equal((await getJson(base, "/api/admin/season2/customers?pageSize=9999")).status, 422);
      assert.equal((await getJson(base, "/api/admin/season2/customers?schoolId=nope")).status, 422);
    });
  });

  // ---- Registered Customers: detail ----

  test("customer detail with deposits: history, approved count/total, Full Payment status", async () => {
    await withServer(async (base) => {
      const { status, body } = await getJson(base, `/api/admin/season2/customers/${ids.a2}`);
      assert.equal(status, 200);
      const customer = body.customer;
      assert.equal(customer.fullName, "Amira Approved");
      assert.equal(customer.schoolName, "Mega Heliopolis");
      assert.equal(customer.ticketPrice, 6000);
      assert.equal(customer.approvedPaymentCount, 2);
      assert.equal(customer.approvedTotalPaid, 2000);
      assert.equal(customer.fullPayment.complete, false);
      assert.equal(customer.deposits.length, 4);
      assert.deepEqual(
        customer.deposits.map((deposit) => deposit.status).sort(),
        ["approved", "approved", "pending", "rejected"]
      );
      // Newest deposit first.
      const times = customer.deposits.map((deposit) => new Date(deposit.submittedAt).getTime());
      assert.deepEqual(times, [...times].sort((a, b) => b - a));
      assert.ok(customer.photoUrl);
      assert.equal("age" in customer || "instagram" in customer, false);
      assert.equal(/publicId|secret-public-id|proof-public-id/.test(JSON.stringify(body)), false);
    });
  });

  test("customer detail with NO deposits opens normally with an empty history", async () => {
    await withServer(async (base) => {
      const { status, body } = await getJson(base, `/api/admin/season2/customers/${ids.a1}`);
      assert.equal(status, 200);
      assert.equal(body.customer.fullName, "Alaa Zero Deposits");
      assert.deepEqual(body.customer.deposits, []);
      assert.equal(body.customer.approvedPaymentCount, 0);
      assert.equal(body.customer.approvedTotalPaid, 0);
      assert.equal(body.customer.fullPayment.complete, false);
    });
  });

  test("customer detail reports Full Payment from FullPaymentStatus", async () => {
    await withServer(async (base) => {
      const confirmed = await getJson(base, `/api/admin/season2/customers/${ids.b1}`);
      assert.equal(confirmed.body.customer.fullPayment.complete, true);
      assert.ok(confirmed.body.customer.fullPayment.confirmedAt);
      const notConfirmed = await getJson(base, `/api/admin/season2/customers/${ids.b2}`);
      assert.equal(notConfirmed.body.customer.approvedTotalPaid, 1000); // == ticket price
      assert.equal(notConfirmed.body.customer.fullPayment.complete, false);
    });
  });

  test("customer detail 404s for a non-Incomer or unknown id and 422s for a bad id", async () => {
    await withServer(async (base) => {
      assert.equal((await getJson(base, `/api/admin/season2/customers/${ids.guest}`)).status, 404);
      assert.equal((await getJson(base, `/api/admin/season2/customers/${"b".repeat(24)}`)).status, 404);
      assert.equal((await getJson(base, "/api/admin/season2/customers/not-an-id")).status, 422);
    });
  });

  test("the reporting endpoints are read-only: they change no attendee, deposit or full-payment data", async () => {
    const snapshot = async () =>
      JSON.stringify([
        await Attendee.countDocuments({}),
        await Deposit.find({}).sort({ _id: 1 }).lean(),
        await FullPaymentStatus.find({}).sort({ _id: 1 }).lean()
      ]);
    const before = await snapshot();
    await stats.getDashboard({ now: NOW });
    await stats.listCustomers({ payment: "approved", pageSize: "2" });
    await stats.getCustomerDetail(String(ids.a2));
    assert.equal(await snapshot(), before);
  });
});
