const express = require("express");

const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { applySchoolTicketPrice } = require("../utils/ticketPriceLock");
const { requestSchoolFinanceSync } = require("../services/financeAutoSync");
const { generateAccessCode, normalizeAccessCode, ACCESS_CODE_PATTERN } = require("../utils/schoolAccessCode");

const router = express.Router();

const MAX_ACCESS_CODE_ATTEMPTS = 5;

function parseVisibility(value) {
  if (typeof value !== "boolean") {
    throw apiError("showTicketPriceToCustomer must be true or false.", 422);
  }
  return value;
}

// Every School must have its own private Access Code — one is generated at
// creation time (retried on the rare random collision; the schema's unique
// index is the final backstop). Admin can replace it later via the dedicated
// /access-code endpoint below.
async function createSchoolWithAccessCode(fields) {
  for (let attempt = 0; attempt < MAX_ACCESS_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await School.create({ ...fields, accessCode: generateAccessCode() });
    } catch (error) {
      if (error.code !== 11000 || attempt === MAX_ACCESS_CODE_ATTEMPTS - 1) throw error;
    }
  }
  throw apiError("Could not generate a unique access code. Please try again.", 500);
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const schools = await School.find({}).sort({ name: 1 });
    res.json({ success: true, schools });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const ticketPrice = Number(req.body.ticketPrice);

    if (!name) {
      throw apiError("School name is required.");
    }

    if (!Number.isFinite(ticketPrice) || ticketPrice < 0) {
      throw apiError("A valid ticket price is required.");
    }

    const fields = { name, ticketPrice };
    if (req.body.showTicketPriceToCustomer !== undefined) {
      fields.showTicketPriceToCustomer = parseVisibility(req.body.showTicketPriceToCustomer);
    }

    const school = await createSchoolWithAccessCode(fields);
    res.status(201).json({ success: true, school });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const update = {};

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        throw apiError("School name is required.");
      }
      update.name = name;
    }

    if (req.body.ticketPrice !== undefined) {
      const ticketPrice = Number(req.body.ticketPrice);
      if (!Number.isFinite(ticketPrice) || ticketPrice < 0) {
        throw apiError("A valid ticket price is required.");
      }
      update.ticketPrice = ticketPrice;
    }

    // Visibility only — never touches any price or financial data.
    if (req.body.showTicketPriceToCustomer !== undefined) {
      update.showTicketPriceToCustomer = parseVisibility(req.body.showTicketPriceToCustomer);
    }

    const school = await School.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    });

    if (!school) {
      throw apiError("School not found.", 404);
    }

    // New price reaches this School's customers who have not made a payment
    // request yet; customers with a locked price keep theirs (see
    // utils/ticketPriceLock.js).
    if (update.ticketPrice !== undefined) {
      await applySchoolTicketPrice(school._id, school.ticketPrice);
    }

    // The sheet shows the School name (D) and each customer's ticket price (E):
    // refresh it after a price or name change. Fire-and-forget (never awaited).
    if (update.ticketPrice !== undefined || update.name !== undefined) {
      requestSchoolFinanceSync(school._id);
    }

    res.json({ success: true, school });
  })
);

// Set, replace or regenerate a School's Access Code. Body: { code? } — an
// explicit custom code (validated + uniqueness-checked, 409 on clash with
// another School), or omitted/blank to auto-generate a fresh random one
// (retried on the rare random collision). This is the ONLY place an Access
// Code is ever created or changed — never through the public registration
// flow, and never returned by any public School endpoint.
router.post(
  "/:id/access-code",
  asyncHandler(async (req, res) => {
    const rawCode = req.body.code !== undefined ? String(req.body.code) : "";
    const customCode = rawCode.trim() ? normalizeAccessCode(rawCode) : "";

    if (customCode && !ACCESS_CODE_PATTERN.test(customCode)) {
      throw apiError("Access code must be 4-32 letters and numbers.", 422);
    }

    const attempts = customCode ? 1 : MAX_ACCESS_CODE_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidate = customCode || generateAccessCode();
      const clash = await School.findOne({ _id: { $ne: req.params.id }, accessCode: candidate });

      if (clash) {
        if (customCode) {
          throw apiError("This access code is already used by another School.", 409);
        }
        continue; // a random collision: try another candidate
      }

      const school = await School.findByIdAndUpdate(
        req.params.id,
        { accessCode: candidate },
        { new: true, runValidators: true }
      );

      if (!school) {
        throw apiError("School not found.", 404);
      }

      res.json({ success: true, school });
      return;
    }

    throw apiError("Could not generate a unique access code. Please try again.", 500);
  })
);

module.exports = router;
