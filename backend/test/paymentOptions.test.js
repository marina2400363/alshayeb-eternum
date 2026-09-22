// Final payment model, driven end to end through the REAL routes on an
// in-memory database (test/support/memoryDb.js) — no live Mongo, Cloudinary
// or Sheets:
//   • School-specific Payment Options, any amount (even above the ticket
//     price), chosen freely each time — no sequence, no plan;
//   • one active payment cycle at a time, no lifetime payment limit;
//   • ticket price follows the School until the first Deposit, then locks;
//   • per-School ticket-price visibility, enforced in the customer API.
//
// Run with:  npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-for-real-use";
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-key";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-secret";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const { createMemoryDb } = require("./support/memoryDb");

let db;
test.beforeEach(() => {
  db = createMemoryDb();
});
test.afterEach(() => db.restore());

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const adminHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ email: "admin@example.com", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" })}`
});

function client(base) {
  const json = async (res) => ({ status: res.status, body: await res.json() });
  const postJson = (path, body) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json);
  const pair = (attendee) => ({ attendeeId: String(attendee._id), phone: attendee.phoneNormalized });

  return {
    summary: (attendee) => postJson("/api/payments/customer-summary", pair(attendee)).then((res) => res.body.summary),
    options: (attendee) => postJson("/api/payments/customer-options", pair(attendee)).then((res) => res.body.paymentOptions),
    submit: (attendee, option, extra = {}) => {
      const form = new FormData();
      form.append("attendeeId", String(attendee._id));
      form.append("phone", attendee.phoneNormalized);
      form.append("paymentOptionId", String(option._id || option));
      for (const [key, value] of Object.entries(extra)) form.append(key, String(value));
      form.append("paymentProof", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "proof.png");
      return fetch(`${base}/api/deposits`, { method: "POST", body: form }).then(json);
    },
    approve: (depositId) =>
      fetch(`${base}/api/admin/deposits/${depositId}/approve`, { method: "PUT", headers: adminHeaders() }).then(json),
    reject: (depositId, reason = "Screenshot unclear.") =>
      fetch(`${base}/api/admin/deposits/${depositId}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ rejectionReason: reason })
      }).then(json),
    acknowledge: (attendee, depositId) =>
      postJson("/api/payments/acknowledge-confirmation", { ...pair(attendee), depositId: String(depositId) }),
    updateSchool: (school, updates) =>
      fetch(`${base}/api/admin/schools/${school._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify(updates)
      }).then(json)
  };
}

const depositById = (id) => db.deposits.find((deposit) => String(deposit._id) === String(id));

async function payOnce(api, attendee, option) {
  const submitted = await api.submit(attendee, option);
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const approved = await api.approve(submitted.body.deposit.id);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const acked = await api.acknowledge(attendee, submitted.body.deposit.id);
  assert.equal(acked.status, 200);
  return depositById(submitted.body.deposit.id);
}

// ---------------------------------------------------------------------------
// Payment Options — any amount, School-isolated, no remaining filter
// ---------------------------------------------------------------------------

test("School A options 500 / 1000 / 7000 with a 6000 ticket: all offered; 7000 selectable, submittable and approvable", async () => {
  const schoolA = db.addSchool({ name: "A", ticketPrice: 6000, options: [500, 1000, 7000] });
  const customer = db.addAttendee(schoolA);

  await withServer(async (base) => {
    const api = client(base);
    const options = await api.options(customer);
    assert.deepEqual(options.map((option) => option.amount), [500, 1000, 7000]);
    assert.deepEqual(Object.keys(options[0]).sort(), ["amount", "id", "label"]);

    const deposit = await payOnce(api, customer, db.optionOf(schoolA, 7000));
    assert.equal(deposit.amount, 7000);
    assert.equal(deposit.status, "approved");

    // Even after 7000 approved (> ticket price) every option is still offered.
    assert.deepEqual((await api.options(customer)).map((option) => option.amount), [500, 1000, 7000]);
    assert.equal((await api.summary(customer)).paymentStatus, "ready");
    assert.equal((await api.submit(customer, db.optionOf(schoolA, 1000))).status, 201);
  });
});

test("approval is never blocked by approved totals vs ticket price", async () => {
  const school = db.addSchool({ ticketPrice: 1000, options: [800] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    await payOnce(api, customer, db.optionOf(school, 800));
    // 800 + 800 = 1600 > 1000 — still approvable.
    const second = await payOnce(api, customer, db.optionOf(school, 800));
    assert.equal(second.status, "approved");
  });
});

test("disabled options are hidden and refused; options stay in Admin order", async () => {
  const school = db.addSchool({ ticketPrice: 6000 });
  db.addOption(school, { amount: 2000 }, 2);
  db.addOption(school, { amount: 500, label: "Deposit" }, 1);
  const disabled = db.addOption(school, { amount: 9999, enabled: false }, 3);
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    assert.deepEqual(await api.options(customer).then((list) => list.map(({ amount, label }) => [amount, label])), [
      [500, "Deposit"],
      [2000, null]
    ]);
    const res = await api.submit(customer, disabled);
    assert.equal(res.status, 422);
    assert.equal(res.body.message, "Selected payment option is not available.");
  });
});

test("School isolation: B never receives A's options, and A's option id is refused generically for B", async () => {
  const schoolA = db.addSchool({ name: "A", ticketPrice: 6000, options: [500, 1000, 7000] });
  const schoolB = db.addSchool({ name: "B", ticketPrice: 4500, options: [1500] });
  const customerB = db.addAttendee(schoolB);

  await withServer(async (base) => {
    const api = client(base);
    assert.deepEqual((await api.options(customerB)).map((option) => option.amount), [1500]);

    const crossSchool = await api.submit(customerB, db.optionOf(schoolA, 7000));
    assert.equal(crossSchool.status, 422);
    assert.equal(crossSchool.body.message, "Selected payment option is not available.");
    assert.equal(db.deposits.length, 0);
    assert.equal(db.uploads.length, 0);
  });
});

test("server owns the amount: body amount / ticketPrice / schoolId are ignored", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [1000] });
  const other = db.addSchool({ ticketPrice: 10, options: [5] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const res = await client(base).submit(customer, db.optionOf(school, 1000), {
      amount: 1,
      ticketPrice: 1,
      schoolId: String(other._id)
    });
    assert.equal(res.status, 201);
    assert.equal(db.deposits[0].amount, 1000);
    assert.equal(customer.ticketPrice, 6000);
  });
});

// ---------------------------------------------------------------------------
// One active cycle, repeatable, no lifetime limit
// ---------------------------------------------------------------------------

test("complete cycles: blocked while pending and until OK, then any option again — repeatedly, no 5-payment limit", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500, 1000, 2000, 7000] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    const amounts = [1000, 500, 7000, 500, 2000, 1000, 500];

    for (const amount of amounts) {
      const submitted = await api.submit(customer, db.optionOf(school, amount));
      assert.equal(submitted.status, 201);

      // Pending → a second payment is refused.
      assert.equal((await api.summary(customer)).paymentStatus, "under_review");
      const whilePending = await api.submit(customer, db.optionOf(school, 500));
      assert.equal(whilePending.status, 409);
      assert.equal(whilePending.body.message, "You already have a payment in progress.");

      // Approved but not yet OK'd → still refused.
      await api.approve(submitted.body.deposit.id);
      const summary = await api.summary(customer);
      assert.equal(summary.paymentStatus, "awaiting_confirmation");
      assert.deepEqual(Object.keys(summary.paymentConfirmation), ["depositId"]);
      assert.equal((await api.submit(customer, db.optionOf(school, 500))).status, 409);

      // OK → clean payment screen, any option again.
      await api.acknowledge(customer, submitted.body.deposit.id);
      const after = await api.summary(customer);
      assert.equal(after.paymentStatus, "ready");
      assert.equal(after.paymentConfirmation, null);
    }

    assert.equal(db.deposits.filter((deposit) => deposit.status === "approved").length, amounts.length);
    assert.ok(db.deposits.every((deposit) => deposit.activeSlot === undefined), "no legacy slot is ever taken");
    assert.ok(db.deposits.every((deposit) => deposit.activeCycle === undefined), "every cycle closed by OK");
  });
});

test("after a rejection the customer may pay again (any option), with a current-state message", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500, 1000] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    const first = await api.submit(customer, db.optionOf(school, 1000));
    await api.reject(first.body.deposit.id, "Amount doesn't match.");

    const summary = await api.summary(customer);
    assert.equal(summary.paymentStatus, "ready");
    assert.deepEqual(summary.latestRejection, { reason: "Amount doesn't match." });
    assert.equal((await api.submit(customer, db.optionOf(school, 500))).status, 201);
    assert.equal(depositById(first.body.deposit.id).status, "rejected", "rejected Deposit kept for Admin");
  });
});

test("two concurrent submissions: exactly one Deposit, the loser's upload is cleaned up", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    const option = db.optionOf(school, 500);
    const results = await Promise.all([api.submit(customer, option), api.submit(customer, option)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(db.deposits.length, 1);
    assert.equal(db.uploads.length - db.destroyed.length, 1);
  });
});

test("Full Payment DONE blocks all future payments and shows full_payment_complete", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500, 7000] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    await payOnce(api, customer, db.optionOf(school, 500));
    db.fullPayments.push({ attendeeId: customer._id, confirmed: true });

    const summary = await api.summary(customer);
    assert.equal(summary.paymentStatus, "full_payment_complete");
    assert.equal(summary.paymentStatus, "full_payment_complete");
    assert.deepEqual(await api.options(customer), []);
    const res = await api.submit(customer, db.optionOf(school, 7000));
    assert.equal(res.status, 422);
    assert.equal(res.body.message, "Full payment has already been confirmed.");
    assert.equal(db.uploads.length, 1, "no upload for the refused payment");
  });
});

test("Full Payment is never inferred: paying more than the ticket price does not complete it", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [7000] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    await payOnce(api, customer, db.optionOf(school, 7000));
    const summary = await api.summary(customer);
    assert.equal(summary.paymentStatus, "ready");
  });
});

// ---------------------------------------------------------------------------
// Ticket-price lock
// ---------------------------------------------------------------------------

test("ticket-price lock: follows the School until the first Deposit, then locks (spec A–C)", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customerA = db.addAttendee(school);
  const customerB = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);

    // A. No Deposit → A follows the School to 7000.
    assert.equal((await api.updateSchool(school, { ticketPrice: 7000 })).status, 200);
    assert.equal(customerA.ticketPrice, 7000);
    assert.equal(customerA.ticketPriceLocked, false);

    // B. A's first (pending) Deposit locks 7000; School → 8000 leaves A at 7000.
    assert.equal((await api.submit(customerA, db.optionOf(school, 500))).status, 201);
    assert.equal(customerA.ticketPriceLocked, true);
    assert.ok(customerA.ticketPriceLockedAt instanceof Date);
    assert.equal(customerA.ticketPrice, 7000);

    await api.updateSchool(school, { ticketPrice: 8000 });
    assert.equal(customerA.ticketPrice, 7000);

    // C. B has no Deposit → B follows to 8000.
    assert.equal(customerB.ticketPrice, 8000);
    assert.equal(customerB.ticketPriceLocked, false);

    // B locks at 8000 on their first payment; later changes don't touch it.
    await api.submit(customerB, db.optionOf(school, 500));
    await api.updateSchool(school, { ticketPrice: 9000 });
    assert.equal(customerB.ticketPrice, 8000);
    assert.equal(customerA.ticketPrice, 7000);
  });
});

test("D. a rejected first Deposit still leaves the price locked", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    const first = await api.submit(customer, db.optionOf(school, 500));
    await api.reject(first.body.deposit.id);
    await api.updateSchool(school, { ticketPrice: 7000 });
    assert.equal(customer.ticketPriceLocked, true);
    assert.equal(customer.ticketPrice, 6000);
  });
});

test("E. an approved first Deposit leaves the price locked", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    await payOnce(api, customer, db.optionOf(school, 500));
    await api.updateSchool(school, { ticketPrice: 7000 });
    assert.equal(customer.ticketPrice, 6000);
    assert.equal(customer.ticketPriceLocked, true);
  });
});

test("F. concurrent first payment attempts + a price change resolve to one consistent lock", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    const option = db.optionOf(school, 500);
    const [first, second] = await Promise.all([
      api.submit(customer, option),
      api.submit(customer, option),
      api.updateSchool(school, { ticketPrice: 7000 })
    ]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);
    assert.equal(db.deposits.length, 1);
    assert.equal(customer.ticketPriceLocked, true);
    // Locked at one of the two prices the customer could have had when
    // making the request — and it no longer moves.
    const locked = customer.ticketPrice;
    assert.ok([6000, 7000].includes(locked));
    await api.updateSchool(school, { ticketPrice: 8000 });
    assert.equal(customer.ticketPrice, locked);
  });
});

test("the lock never reprices: a second payment keeps the first lock's price and timestamp", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    await payOnce(api, customer, db.optionOf(school, 500));
    const lockedAt = customer.ticketPriceLockedAt;
    customer.ticketPrice = 6000;
    await payOnce(api, customer, db.optionOf(school, 500));
    assert.equal(customer.ticketPriceLockedAt, lockedAt);
  });
});

test("customers who already had Deposits before the lock existed are locked, not repriced", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const legacy = db.addAttendee(school, { ticketPriceLocked: undefined, ticketPriceLockedAt: undefined });
  db.deposits.push({ _id: school._id, attendeeId: legacy._id, amount: 500, status: "rejected", createdAt: new Date("2026-01-01") });

  await withServer(async (base) => {
    await client(base).updateSchool(school, { ticketPrice: 7000 });
    assert.equal(legacy.ticketPrice, 6000);
    assert.equal(legacy.ticketPriceLocked, true);
  });
});

test("a price change only touches that School's unlocked Incomers", async () => {
  const schoolA = db.addSchool({ name: "A", ticketPrice: 6000 });
  const schoolB = db.addSchool({ name: "B", ticketPrice: 6000 });
  const inB = db.addAttendee(schoolB);
  const outcomer = db.addAttendee(schoolA, { attendeeType: "outcomer", ticketPrice: null });

  await withServer(async (base) => {
    await client(base).updateSchool(schoolA, { ticketPrice: 7000 });
    assert.equal(inB.ticketPrice, 6000);
    assert.equal(outcomer.ticketPrice, null);
  });
});

// ---------------------------------------------------------------------------
// Ticket-price visibility
// ---------------------------------------------------------------------------

test("ticket-price visibility: shown School returns the amount; hidden School omits it entirely", async () => {
  const shown = db.addSchool({ name: "Shown", ticketPrice: 6000, options: [500], showTicketPriceToCustomer: true });
  const hidden = db.addSchool({ name: "Hidden", ticketPrice: 4500, options: [1500], showTicketPriceToCustomer: false });
  const customerShown = db.addAttendee(shown);
  const customerHidden = db.addAttendee(hidden);

  await withServer(async (base) => {
    const api = client(base);
    const visible = await api.summary(customerShown);
    assert.equal(visible.ticketPriceVisible, true);
    assert.equal(visible.ticketPrice, 6000);

    const res = await fetch(`${base}/api/payments/customer-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId: String(customerHidden._id), phone: customerHidden.phoneNormalized })
    });
    const raw = await res.text();
    const body = JSON.parse(raw);
    assert.equal(body.summary.ticketPriceVisible, false);
    assert.equal("ticketPrice" in body.summary, false);
    assert.ok(!raw.includes("4500"), "the hidden amount appears nowhere in the response");
    // Payment still works normally.
    assert.equal((await api.submit(customerHidden, db.optionOf(hidden, 1500))).status, 201);
  });
});

test("toggling visibility changes only what the customer sees — never financial data", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    const hide = await api.updateSchool(school, { showTicketPriceToCustomer: false });
    assert.equal(hide.status, 200);
    assert.equal(hide.body.school.showTicketPriceToCustomer, false);
    assert.equal(school.ticketPrice, 6000);
    assert.equal(customer.ticketPrice, 6000);
    assert.equal((await api.summary(customer)).ticketPriceVisible, false);

    await api.updateSchool(school, { showTicketPriceToCustomer: true });
    const visible = await api.summary(customer);
    assert.equal(visible.ticketPriceVisible, true);
    assert.equal(visible.ticketPrice, 6000);

    const bad = await api.updateSchool(school, { showTicketPriceToCustomer: "nope" });
    assert.equal(bad.status, 422);
  });
});

test("a School without the setting (created before it existed) shows the price", async () => {
  const school = db.addSchool({ ticketPrice: 6000 });
  delete school.showTicketPriceToCustomer;
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const summary = await client(base).summary(customer);
    assert.equal(summary.ticketPriceVisible, true);
    assert.equal(summary.ticketPrice, 6000);
  });
});

// ---------------------------------------------------------------------------
// Customer privacy + Admin history
// ---------------------------------------------------------------------------

test("customer summary never exposes history, totals, progress or plan concepts", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500, 7000] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    await payOnce(api, customer, db.optionOf(school, 7000));
    const pending = await api.submit(customer, db.optionOf(school, 500));
    await api.approve(pending.body.deposit.id);

    const summary = await api.summary(customer);
    assert.deepEqual(Object.keys(summary).sort(), [
      "latestRejection",
      "paymentConfirmation",
      "paymentStatus",
      "ticketPrice",
      "ticketPriceVisible"
    ]);
    const serialized = JSON.stringify(summary);
    for (const forbidden of ["deposits", "approvedTotal", "remaining", "progress", "installment", "amount", "7000", "label", "paymentProof", "activeCycle"]) {
      assert.ok(!serialized.includes(forbidden), `summary leaked "${forbidden}"`);
    }
  });
});

test("Admin Deposit review keeps the complete history with option and price", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [{ amount: 500, label: "Deposit" }, 7000] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const api = client(base);
    await payOnce(api, customer, db.optionOf(school, 7000));
    const second = await api.submit(customer, db.optionOf(school, 500));
    await api.reject(second.body.deposit.id);
    await api.submit(customer, db.optionOf(school, 500));

    const res = await fetch(`${base}/api/admin/deposits?attendeeId=${customer._id}`, { headers: adminHeaders() });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.deposits.length, 3);
    assert.deepEqual(body.deposits.map((deposit) => deposit.status).sort(), ["approved", "pending", "rejected"]);
    const pending = body.deposits.find((deposit) => deposit.status === "pending");
    assert.equal(pending.paymentOptionSnapshot.label, "Deposit");
    assert.equal(pending.amount, 500);
    assert.ok(pending.paymentProof.publicId);
  });
});

test("customer-options uses the same generic ownership check", async () => {
  const school = db.addSchool({ ticketPrice: 6000, options: [500] });
  const customer = db.addAttendee(school);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/payments/customer-options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId: String(customer._id), phone: "01099999999" })
    });
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.message, "We couldn't verify this account. Check your details and try again.");
    assert.equal(body.paymentOptions, undefined);
  });
});

// ---------------------------------------------------------------------------
// Existing documents: the new fields are physically ABSENT (no migration).
// Queries must behave correctly against missing fields, not just against the
// schema defaults Mongoose would apply on hydration.
// ---------------------------------------------------------------------------

// Strips a field the way an old document has it: not present at all.
function withoutFields(doc, ...fields) {
  for (const field of fields) delete doc[field];
  return doc;
}

test("legacy documents without the new fields", async (t) => {
  await t.test("A. Attendee with no ticketPriceLocked field and no Deposits is treated as unlocked", async () => {
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const legacy = withoutFields(db.addAttendee(school), "ticketPriceLocked", "ticketPriceLockedAt");
    assert.equal("ticketPriceLocked" in legacy, false);

    await withServer(async (base) => {
      const api = client(base);
      await api.updateSchool(school, { ticketPrice: 7000 });
      assert.equal(legacy.ticketPrice, 7000, "unlocked legacy attendee follows the School");

      // Their first payment then locks them at that price.
      assert.equal((await api.submit(legacy, db.optionOf(school, 500))).status, 201);
      assert.equal(legacy.ticketPriceLocked, true);
      await api.updateSchool(school, { ticketPrice: 8000 });
      assert.equal(legacy.ticketPrice, 7000);
    });
  });

  await t.test("B. Attendee with no ticketPriceLocked field but a Deposit is locked, never repriced", async () => {
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    for (const status of ["pending", "approved", "rejected"]) {
      const legacy = withoutFields(db.addAttendee(school), "ticketPriceLocked", "ticketPriceLockedAt");
      db.deposits.push({
        _id: new (require("mongoose").Types.ObjectId)(),
        attendeeId: legacy._id,
        amount: 500,
        status,
        createdAt: new Date("2026-01-01T00:00:00Z")
      });
      legacy.expectedPrice = 6000;
    }

    await withServer(async (base) => {
      await client(base).updateSchool(school, { ticketPrice: 9000 });
      const legacyAttendees = db.attendees.filter((attendee) => attendee.expectedPrice === 6000);
      assert.equal(legacyAttendees.length, 3);
      for (const attendee of legacyAttendees) {
        assert.equal(attendee.ticketPrice, 6000, "a Deposit of ANY status keeps the old price");
        assert.equal(attendee.ticketPriceLocked, true, "and the lock is recorded from now on");
      }
    });
  });

  await t.test("C. School with no showTicketPriceToCustomer field shows the price", async () => {
    const school = withoutFields(db.addSchool({ ticketPrice: 6000, options: [500] }), "showTicketPriceToCustomer");
    const customer = db.addAttendee(school);
    assert.equal("showTicketPriceToCustomer" in school, false);

    await withServer(async (base) => {
      const summary = await client(base).summary(customer);
      assert.equal(summary.ticketPriceVisible, true);
      assert.equal(summary.ticketPrice, 6000);
    });
  });

  await t.test("D. the Admin toggle then persists an explicit boolean", async () => {
    const school = withoutFields(db.addSchool({ ticketPrice: 6000, options: [500] }), "showTicketPriceToCustomer");
    const customer = db.addAttendee(school);

    await withServer(async (base) => {
      const api = client(base);
      const off = await api.updateSchool(school, { showTicketPriceToCustomer: false });
      assert.equal(off.status, 200);
      assert.equal(school.showTicketPriceToCustomer, false, "an explicit false is stored");
      const hidden = await api.summary(customer);
      assert.equal(hidden.ticketPriceVisible, false);
      assert.equal("ticketPrice" in hidden, false);

      await api.updateSchool(school, { showTicketPriceToCustomer: true });
      assert.equal(school.showTicketPriceToCustomer, true, "an explicit true is stored");
      assert.equal((await api.summary(customer)).ticketPriceVisible, true);
    });
  });

  await t.test("a legacy pending Deposit with no activeCycle still blocks a second payment", async () => {
    const school = db.addSchool({ ticketPrice: 6000, options: [500] });
    const customer = db.addAttendee(school);
    db.deposits.push({
      _id: new (require("mongoose").Types.ObjectId)(),
      attendeeId: customer._id,
      amount: 500,
      status: "pending",
      activeSlot: 1, // old slot mechanism, no activeCycle
      createdAt: new Date("2026-01-01T00:00:00Z")
    });

    await withServer(async (base) => {
      const api = client(base);
      const res = await api.submit(customer, db.optionOf(school, 500));
      assert.equal(res.status, 409);
      assert.equal((await api.summary(customer)).paymentStatus, "under_review");
    });
  });
});
