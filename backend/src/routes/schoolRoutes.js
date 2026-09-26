const express = require("express");

const School = require("../models/School");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// Public School shape for the Incomer registration dropdown: an explicit
// allowlist, never the raw document. ticketPrice is included ONLY when the
// School shows it to customers (showTicketPriceToCustomer !== false — a missing
// flag means visible, matching the payment endpoints); when hidden the amount is
// absent from the response altogether. Admin-only fields (flags, timestamps,
// internal ids beyond _id, __v) are never exposed here. The Admin School API
// (schoolAdminRoutes) is separate and unchanged.
function serializePublicSchool(school) {
  const publicSchool = {
    _id: String(school._id),
    name: school.name
  };

  if (school.showTicketPriceToCustomer !== false && typeof school.ticketPrice === "number") {
    publicSchool.ticketPrice = school.ticketPrice;
  }

  return publicSchool;
}

// Public: list schools for the Incomer registration dropdown.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const schools = await School.find({}).select("name ticketPrice showTicketPriceToCustomer").sort({ name: 1 });
    res.json({ success: true, schools: schools.map(serializePublicSchool) });
  })
);

module.exports = router;
