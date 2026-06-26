const express = require("express");

const SiteSettings = require("../models/SiteSettings");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

const DEFAULT_GUEST_LIST_DISPLAY_COUNT = 137;

async function getPublicSettings() {
  return SiteSettings.findOneAndUpdate(
    { key: "default" },
    {
      $setOnInsert: {
        key: "default",
        guestListDisplayCount: DEFAULT_GUEST_LIST_DISPLAY_COUNT,
        outcomerSelection: {
          approved: 129,
          pending: 73,
          declined: 46
        }
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const settings = await getPublicSettings();

    res.json({
      success: true,
      guestListDisplayCount: settings.guestListDisplayCount ?? DEFAULT_GUEST_LIST_DISPLAY_COUNT,
      instapayLink: settings.instapayLink || "https://instapay.example/alshayeb",
      outcomerSelection: settings.outcomerSelection || {}
    });
  })
);

module.exports = router;
