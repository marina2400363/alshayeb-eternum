const express = require("express");

const apiError = require("../utils/apiError");

const router = express.Router();

// RETIRED (Season 1). These two public write endpoints used to create outcomer
// registrations and overwrite an attendee's payment proof (the latter by bare
// attendeeId). Season 1 event/customer data was intentionally cleared before
// Season 2 and Season 2 has its own Incomer flow, so both now answer with a
// stable 410 Gone. Nothing is parsed, uploaded or written: multipart bodies are
// never read (no multer here), and no Cloudinary/email/Sheets code is reachable.
const retired = (req, res, next) => next(apiError("This registration is no longer available.", 410));

router.post("/register", retired);
router.post("/payment-proof", retired);

module.exports = router;
