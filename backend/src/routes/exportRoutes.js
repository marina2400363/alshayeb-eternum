const express = require("express");

const router = express.Router();

router.get("/attendees", (req, res) => {
  res.status(501).json({
    success: false,
    message: "Excel export API will be implemented later."
  });
});

module.exports = router;
