const express = require("express");

const Attendee = require("../models/Attendee");
const SiteSettings = require("../models/SiteSettings");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { sendStatusEmail } = require("../utils/email");
const { generateQrToken, generateUniqueQrId } = require("../utils/qr");
const { serializeAttendee } = require("../utils/serializers");

const router = express.Router();

const DEFAULT_SITE_SETTINGS = {
  outcomerSelection: {
    approved: 129,
    pending: 73,
    declined: 46
  }
};

async function getSiteSettings() {
  return SiteSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default", ...DEFAULT_SITE_SETTINGS } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAttendeeQuery(query) {
  const filters = {};
  const type = String(query.type || query.attendeeType || "").trim().toLowerCase();
  const status = String(query.status || "").trim().toLowerCase();
  const paymentReview = String(query.paymentReview || "").trim().toLowerCase() === "true";
  const search = String(query.q || query.search || "").trim();

  if (type && type !== "all") {
    filters.attendeeType = type;
  }

  if (status && status !== "all") {
    filters.status = status;
  }

  if (paymentReview) {
    filters.paymentStatus = { $in: ["pending", "under_verification", "rejected", "verified"] };
  }

  if (search) {
    const safeSearch = escapeRegExp(search);
    filters.$or = [
      { fullName: new RegExp(safeSearch, "i") },
      { phone: new RegExp(safeSearch, "i") },
      { email: new RegExp(safeSearch, "i") },
      { university: new RegExp(safeSearch, "i") },
      { instagram: new RegExp(safeSearch, "i") },
      { eventName: new RegExp(safeSearch, "i") }
    ];
  }

  return filters;
}

async function dashboardStats() {
  const [totalApplications, pendingReview, approved, rejected, used] = await Promise.all([
    Attendee.countDocuments({}),
    Attendee.countDocuments({ status: "pending" }),
    Attendee.countDocuments({ status: "approved" }),
    Attendee.countDocuments({ status: "rejected" }),
    Attendee.countDocuments({ status: "used" })
  ]);

  return {
    stats: [
      { label: "Total Applications", value: totalApplications },
      { label: "Pending Review", value: pendingReview },
      { label: "Approved", value: approved },
      { label: "Rejected", value: rejected },
      { label: "Used Passes", value: used }
    ]
  };
}

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const [summary, recentAttendees] = await Promise.all([
      dashboardStats(),
      Attendee.find({}).sort({ updatedAt: -1 }).limit(8)
    ]);

    res.json({
      success: true,
      ...summary,
      recentActivity: recentAttendees.map((attendee) => `${attendee.fullName} / ${attendee.eventName || "No Prom"} / ${attendee.status}`),
      recentAttendees: recentAttendees.map(serializeAttendee)
    });
  })
);

router.get(
  "/site-settings",
  asyncHandler(async (req, res) => {
    const settings = await getSiteSettings();

    res.json({
      success: true,
      settings
    });
  })
);

router.patch(
  "/site-settings",
  asyncHandler(async (req, res) => {
    const toDisplayNumber = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
    };

    const currentSettings = await getSiteSettings();
    const incoming = req.body.outcomerSelection || req.body;
    const nextSelection = {
      approved: toDisplayNumber(incoming.approved, currentSettings.outcomerSelection.approved),
      pending: toDisplayNumber(incoming.pending, currentSettings.outcomerSelection.pending),
      declined: toDisplayNumber(incoming.declined, currentSettings.outcomerSelection.declined)
    };

    const settings = await SiteSettings.findOneAndUpdate(
      { key: "default" },
      { $set: { outcomerSelection: nextSelection } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      message: "Site display settings updated.",
      settings
    });
  })
);

router.get(
  "/attendees",
  asyncHandler(async (req, res) => {
    const attendees = await Attendee.find(buildAttendeeQuery(req.query)).sort({ createdAt: -1 });

    res.json({
      success: true,
      attendees: attendees.map(serializeAttendee)
    });
  })
);

router.patch(
  "/attendees/:id/approve",
  asyncHandler(async (req, res) => {
    const attendee = await Attendee.findById(req.params.id);

    if (!attendee) {
      throw apiError("Attendee was not found.", 404);
    }

    const previousStatus = attendee.status;
    attendee.status = "approved";
    attendee.paymentStatus = req.body.paymentStatus || "verified";
    attendee.rejectionReason = undefined;
    attendee.reviewedAt = new Date();

    if (!attendee.qrId) {
      attendee.qrId = await generateUniqueQrId(Attendee);
    }

    if (!attendee.qrToken) {
      attendee.qrToken = generateQrToken();
      attendee.qrIssuedAt = new Date();
    }

    await attendee.save();

    if (previousStatus !== "approved" && !attendee.emailNotifications?.approvedAt) {
      const emailSent = await sendStatusEmail(
        attendee,
        "ALSHAYEB ETERNUM application approved",
        "Application approved and QR pass available."
      );

      if (emailSent) {
        attendee.emailNotifications = {
          ...attendee.emailNotifications,
          approvedAt: new Date()
        };
        await attendee.save();
      }
    }

    res.json({
      success: true,
      message: "Attendee approved and QR credentials issued.",
      attendee: serializeAttendee(attendee)
    });
  })
);

router.patch(
  "/attendees/:id/reject",
  asyncHandler(async (req, res) => {
    const attendee = await Attendee.findById(req.params.id);

    if (!attendee) {
      throw apiError("Attendee was not found.", 404);
    }

    const previousStatus = attendee.status;
    attendee.status = "rejected";
    attendee.paymentStatus = req.body.paymentStatus || "rejected";
    attendee.rejectionReason = req.body.reason || "Rejected by admin.";
    attendee.reviewedAt = new Date();

    await attendee.save();

    if (previousStatus !== "rejected" && !attendee.emailNotifications?.rejectedAt) {
      const emailSent = await sendStatusEmail(
        attendee,
        "ALSHAYEB ETERNUM application declined",
        "Application declined."
      );

      if (emailSent) {
        attendee.emailNotifications = {
          ...attendee.emailNotifications,
          rejectedAt: new Date()
        };
        await attendee.save();
      }
    }

    res.json({
      success: true,
      message: "Attendee rejected.",
      attendee: serializeAttendee(attendee)
    });
  })
);

router.patch(
  "/attendees/:id/payment-status",
  asyncHandler(async (req, res) => {
    const attendee = await Attendee.findById(req.params.id);

    if (!attendee) {
      throw apiError("Attendee was not found.", 404);
    }

    const previousStatus = attendee.status;
    const paymentStatus = String(req.body.paymentStatus || req.body.status || attendee.paymentStatus).trim().toLowerCase();
    attendee.paymentStatus = paymentStatus;

    if (paymentStatus === "verified") {
      attendee.status = "approved";
      attendee.reviewedAt = new Date();

      if (!attendee.qrId) {
        attendee.qrId = await generateUniqueQrId(Attendee);
      }

      if (!attendee.qrToken) {
        attendee.qrToken = generateQrToken();
        attendee.qrIssuedAt = new Date();
      }
    }

    if (paymentStatus === "rejected") {
      attendee.status = "rejected";
      attendee.rejectionReason = req.body.reason || attendee.rejectionReason || "Payment proof rejected by admin.";
      attendee.reviewedAt = new Date();
    }

    await attendee.save();

    if (paymentStatus === "verified" && previousStatus !== "approved" && !attendee.emailNotifications?.approvedAt) {
      const emailSent = await sendStatusEmail(
        attendee,
        "ALSHAYEB ETERNUM application approved",
        "Application approved and QR pass available."
      );

      if (emailSent) {
        attendee.emailNotifications = {
          ...attendee.emailNotifications,
          approvedAt: new Date()
        };
        await attendee.save();
      }
    }

    if (paymentStatus === "rejected" && previousStatus !== "rejected" && !attendee.emailNotifications?.rejectedAt) {
      const emailSent = await sendStatusEmail(
        attendee,
        "ALSHAYEB ETERNUM application declined",
        "Application declined."
      );

      if (emailSent) {
        attendee.emailNotifications = {
          ...attendee.emailNotifications,
          rejectedAt: new Date()
        };
        await attendee.save();
      }
    }

    res.json({
      success: true,
      message: "Payment status updated.",
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
