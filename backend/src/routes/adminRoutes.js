const express = require("express");

const Attendee = require("../models/Attendee");
const SiteSettings = require("../models/SiteSettings");
const asyncHandler = require("../middleware/asyncHandler");
const apiError = require("../utils/apiError");
const { requireAdmin } = require("../middleware/requireAdmin");
const { sendStatusEmail } = require("../utils/email");
const { generateQrToken, generateUniqueQrId } = require("../utils/qr");
const { serializeAttendee } = require("../utils/serializers");
const Event = require("../models/Event");
const { syncEventExportSheet } = require("../services/googleSheetsExportSync");

const router = express.Router();

// Apply admin auth to every route in this file.
router.use(requireAdmin);

const DEFAULT_SITE_SETTINGS = {
  outcomerSelection: {
    approved: 129,
    pending: 73,
    declined: 46
  },
  guestListDisplayCount: 137
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

function toDisplayNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function buildSettingsUpdate(body, currentSettings) {
  const incomingSelection = body.outcomerSelection || body;
  const nextSelection = {
    approved: toDisplayNumber(incomingSelection.approved, currentSettings.outcomerSelection.approved),
    pending: toDisplayNumber(incomingSelection.pending, currentSettings.outcomerSelection.pending),
    declined: toDisplayNumber(incomingSelection.declined, currentSettings.outcomerSelection.declined)
  };

  const nextGuestCount = toDisplayNumber(
    body.guestListDisplayCount,
    currentSettings.guestListDisplayCount ?? DEFAULT_SITE_SETTINGS.guestListDisplayCount
  );

  const nextInstapayLink = typeof body.instapayLink === "string" 
    ? body.instapayLink.trim() 
    : currentSettings.instapayLink ?? "https://instapay.example/alshayeb";

  const nextRoomsInstapayLink = typeof body.roomsInstapayLink === "string"
    ? body.roomsInstapayLink.trim()
    : currentSettings.roomsInstapayLink ?? "instapay://pay?pa=alshayeb@instapay";

  return {
    outcomerSelection: nextSelection,
    guestListDisplayCount: nextGuestCount,
    instapayLink: nextInstapayLink,
    roomsInstapayLink: nextRoomsInstapayLink
  };
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
    // Only show records in the Payment Review queue if they have actually uploaded a payment proof.
    // This prevents incomplete drafts (users who abandoned the payment page) from cluttering the admin dashboard.
    filters.paymentStatus = { $in: ["pending", "under_verification", "rejected", "verified"] };
    filters["paymentProof.url"] = { $exists: true, $ne: null };
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
  const events = await Event.find({});
  const eventStats = [];

  for (const event of events) {
    const [incomers, outcomers, approved, pending, rejected, total] = await Promise.all([
      Attendee.countDocuments({ event: event._id, attendeeType: "incomer" }),
      Attendee.countDocuments({ event: event._id, attendeeType: "outcomer" }),
      Attendee.countDocuments({ event: event._id, status: "approved" }),
      Attendee.countDocuments({ event: event._id, status: "pending" }),
      Attendee.countDocuments({ event: event._id, status: "rejected" }),
      Attendee.countDocuments({ event: event._id })
    ]);

    eventStats.push({
      eventId: event._id,
      eventName: event.name,
      incomers,
      outcomers,
      approved,
      pending,
      declined: rejected,
      total
    });
  }

  // Calculate globals if needed, but return eventStats
  const totalApplications = await Attendee.countDocuments({});
  const pendingReview = await Attendee.countDocuments({ status: "pending" });
  const globalApproved = await Attendee.countDocuments({ status: "approved" });
  const globalRejected = await Attendee.countDocuments({ status: "rejected" });
  const used = await Attendee.countDocuments({ status: "used" });

  return {
    eventStats,
    stats: [
      { label: "Total Applications", value: totalApplications },
      { label: "Pending Review", value: pendingReview },
      { label: "Approved", value: globalApproved },
      { label: "Rejected", value: globalRejected },
      { label: "Used Passes", value: used }
    ]
  };
}

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const [summary, recentAttendees] = await Promise.all([
      dashboardStats(),
      Attendee.find({}).sort({ updatedAt: -1 }).limit(8).populate("event")
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
    const currentSettings = await getSiteSettings();
    const nextSettings = buildSettingsUpdate(req.body, currentSettings);

    const settings = await SiteSettings.findOneAndUpdate(
      { key: "default" },
      { $set: nextSettings },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      message: "Site display settings updated.",
      settings
    });
  })
);

router.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const currentSettings = await getSiteSettings();
    const nextSettings = buildSettingsUpdate(req.body, currentSettings);

    const settings = await SiteSettings.findOneAndUpdate(
      { key: "default" },
      { $set: nextSettings },
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
    const attendees = await Attendee.find(buildAttendeeQuery(req.query)).sort({ createdAt: -1 }).populate("event");

    res.json({
      success: true,
      attendees: attendees.map(serializeAttendee)
    });
  })
);

router.patch(
  "/attendees/:id/approve",
  asyncHandler(async (req, res) => {
    const attendee = await Attendee.findById(req.params.id).populate("event");

    if (!attendee) {
      throw apiError("Attendee was not found.", 404);
    }

    const previousStatus = attendee.status;
    attendee.status = "approved";
    attendee.paymentStatus = req.body.paymentStatus || "verified";
    attendee.rejectionReason = undefined;
    attendee.reviewedAt = new Date();

    if (!attendee.qrId) {
      let prefix = "ALSHAYEB-";
      if (attendee.event) {
        const ev = await Event.findById(attendee.event);
        if (ev && ev.prefix) prefix = ev.prefix;
      }
      attendee.qrId = await generateUniqueQrId(Attendee, prefix);
    }

    if (!attendee.qrToken) {
      attendee.qrToken = generateQrToken();
      attendee.qrIssuedAt = new Date();
    }

    await attendee.save();

    if (previousStatus !== "approved" && !attendee.emailNotifications?.approvedAt) {
      sendStatusEmail(
        attendee,
        "You Have Been Selected",
        "Your application has been approved.\nYour access has been granted.\nYou can now open the platform and view your ticket/access information."
      );

      attendee.emailNotifications = {
        ...attendee.emailNotifications,
        approvedAt: new Date()
      };
      await attendee.save();
    }

    if (attendee.attendeeType === "outcomer" && attendee.event) {
      await syncEventExportSheet(attendee.event).catch(err => console.error("Export sync hook failed:", err));
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
    const attendee = await Attendee.findById(req.params.id).populate("event");

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
      sendStatusEmail(
        attendee,
        "Application Status Updated",
        "Your application could not be approved at this stage.\nPlease contact your assigned committee member for more information."
      );

      attendee.emailNotifications = {
        ...attendee.emailNotifications,
        rejectedAt: new Date()
      };
      await attendee.save();
    }

    if (attendee.attendeeType === "outcomer" && attendee.event) {
      await syncEventExportSheet(attendee.event).catch(err => console.error("Export sync hook failed:", err));
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
    const attendee = await Attendee.findById(req.params.id).populate("event");

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
        let prefix = "ALSHAYEB-";
        if (attendee.event) {
          const ev = await Event.findById(attendee.event);
          if (ev && ev.prefix) prefix = ev.prefix;
        }
        attendee.qrId = await generateUniqueQrId(Attendee, prefix);
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
      sendStatusEmail(
        attendee,
        "You Have Been Selected",
        "Your application has been approved.\nYour access has been granted.\nYou can now open the platform and view your ticket/access information."
      );

      attendee.emailNotifications = {
        ...attendee.emailNotifications,
        approvedAt: new Date()
      };
      await attendee.save();
    }

    if (paymentStatus === "rejected" && previousStatus !== "rejected" && !attendee.emailNotifications?.rejectedAt) {
      sendStatusEmail(
        attendee,
        "Application Status Updated",
        "Your application could not be approved at this stage.\nPlease contact your assigned committee member for more information."
      );

      attendee.emailNotifications = {
        ...attendee.emailNotifications,
        rejectedAt: new Date()
      };
      await attendee.save();
    }

    if (attendee.attendeeType === "outcomer" && attendee.event) {
      await syncEventExportSheet(attendee.event).catch(err => console.error("Export sync hook failed:", err));
    }

    res.json({
      success: true,
      message: "Payment status updated.",
      attendee: serializeAttendee(attendee)
    });
  })
);

module.exports = router;
