const express = require("express");
const mongoose = require("mongoose");

const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { getCustomerDetail, getDashboard, listCustomers } = require("../services/season2AdminStats");

// Read-only Season 2 Admin reporting. Mounted (in app.js) behind requireAdmin
// at /api/admin/season2 — never public. All numbers come from
// services/season2AdminStats.js, which aggregates inside MongoDB.
const router = express.Router();

// KPIs, per-School breakdown and recent activity for the Admin Dashboard.
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const dashboard = await getDashboard();
    res.json({ success: true, ...dashboard });
  })
);

// Paginated, lightweight list of EVERY registered Incomer (with or without any
// Deposit). Query: page, pageSize, q, schoolId, payment=approved|none,
// fullPayment=complete|incomplete, from, to (YYYY-MM-DD).
router.get(
  "/customers",
  asyncHandler(async (req, res) => {
    const result = await listCustomers(req.query);
    res.json({ success: true, ...result });
  })
);

// Full details + deposit history for one customer, loaded only when opened.
router.get(
  "/customers/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw apiError("A valid customer id is required.", 422);
    }

    const customer = await getCustomerDetail(id);
    if (!customer) {
      throw apiError("Customer not found.", 404);
    }

    res.json({ success: true, customer });
  })
);

module.exports = router;
