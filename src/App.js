import React, { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "react-qr-code";
import { motion } from "framer-motion";
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import "./App.css";
import AnimatedBackground from "./AnimatedBackground";

const BACKEND_API_URL = String(process.env.REACT_APP_API_URL || "http://127.0.0.1:5000").replace(/\/$/, "");

const QR_REVEAL_TIME = "2026-12-31T18:00:00";
const ADMIN_SESSION_KEY = "alshayebAdminSession";
const ADMIN_EMAIL = "admin@alshayeb.com";
const ADMIN_PASSWORD = "admin123";

const events = [
  { id: "miu-prom-2026", name: "MIU PROM 2026", date: "31 MAY 2026", dateTime: "2026-05-31T21:30:00+03:00", fee: "250 EGP" },
  { id: "bue-prom-2026", name: "BUE PROM 2026", date: "14 JUNE 2026", dateTime: "2026-06-14T21:30:00+03:00", fee: "250 EGP" },
  { id: "aast-prom-2026", name: "AAST PROM 2026", date: "20 JUNE 2026", dateTime: "2026-06-20T21:30:00+03:00", fee: "250 EGP" },
  { id: "future-prom-2026", name: "FUTURE ACADEMY PROM 2026", date: "28 JUNE 2026", dateTime: "2026-06-28T21:30:00+03:00", fee: "250 EGP" }
];

const DEFAULT_OUTCOMER_SELECTION = {
  approved: 129,
  pending: 73,
  declined: 46
};

const EXPORT_COLUMNS = [
  "Full Name",
  "Phone Number",
  "Email",
  "School / Origin Prom",
  "Age",
  "Instagram Username",
  "Status",
  "Prom"
];

async function apiRequest(path, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  let response;

  try {
    response = await fetch(`${BACKEND_API_URL}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {})
      }
    });
  } catch (networkError) {
    const error = new Error("Could not reach the backend API. Please make sure the backend server is running and CORS allows this app URL.");
    error.cause = networkError;
    throw error;
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(result.message || result.reason || "Backend request failed.");
    error.details = result.details;
    throw error;
  }

  return result;
}

function normalizeStatusLabel(status, fallback = "Pending") {
  const normalized = String(status || fallback).replace(/_/g, " ").trim();
  if (!normalized) return fallback;
  return normalized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function attendeeName(attendee) {
  return attendee?.fullName || attendee?.name || attendee?.Name || "Unknown";
}

function attendeePhone(attendee) {
  return attendee?.phoneNumber || attendee?.phone || attendee?.Phone || "";
}

function attendeeProm(attendee) {
  return attendee?.eventName || attendee?.event || attendee?.Prom || attendee?.Venue || "ALSHAYEB ETERNUM";
}

function toAdminAttendee(attendee) {
  return {
    id: attendee.id || attendee._id,
    requestId: attendee.requestId || attendee.qrId || attendee.id,
    name: attendeeName(attendee),
    phone: attendeePhone(attendee),
    email: attendee.email || "",
    schoolOrOriginProm: attendee.schoolOrOriginProm || attendee.university || "",
    age: attendee.age || "",
    instagramUsername: attendee.instagramUsername || attendee.instagram || "",
    status: normalizeStatusLabel(attendee.status),
    rawStatus: attendee.status,
    applicationStatus: normalizeStatusLabel(attendee.applicationStatus || attendee.status),
    paymentStatus: normalizeStatusLabel(attendee.paymentStatus),
    rawPaymentStatus: attendee.paymentStatus,
    accessType: normalizeStatusLabel(attendee.accessType || attendee.attendeeType || "Guest"),
    attendeeType: attendee.attendeeType || "",
    qrStatus: attendee.status === "used" ? "Used" : attendee.qrToken || attendee.qrId ? "Active" : "Pending",
    qrToken: attendee.qrToken,
    qrId: attendee.qrId,
    event: attendeeProm(attendee),
    amount: attendee.amount || "250 EGP",
    submittedAt: attendee.createdAt ? new Date(attendee.createdAt).toLocaleString() : "",
    paymentProof: attendee.paymentProof
  };
}

const pageMotion = {
  initial: { opacity: 0, y: 25, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -20, scale: 0.98 },
  transition: { duration: 0.45, ease: "easeOut" }
};

const softPop = {
  initial: { opacity: 0, y: 18, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.45, ease: "easeOut" }
};

function sanitizeExcelSheetName(name, usedNames = new Set()) {
  const fallback = "Prom";
  const invalidSheetChars = new Set(["[", "]", ":", "*", "?", "/", "\\"]);
  const base = String(name || fallback)
    .split("")
    .map((character) => (invalidSheetChars.has(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || fallback;

  let sheetName = base;
  let counter = 2;

  while (usedNames.has(sheetName.toLowerCase())) {
    const suffix = ` ${counter}`;
    sheetName = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }

  usedNames.add(sheetName.toLowerCase());
  return sheetName;
}

function buildRegistrationExportRows(attendees = []) {
  return attendees.map((attendee) => {
    const row = toAdminAttendee(attendee);

    return {
      promName: row.event,
      "Full Name": row.name,
      "Phone Number": row.phone,
      Email: row.email || "",
      "School / Origin Prom": row.schoolOrOriginProm || "",
      Age: row.age || "",
      "Instagram Username": row.instagramUsername || "",
      Status: row.status || row.paymentStatus || "",
      Prom: row.event
    };
  });
}

function exportRegistrationsByProm(attendees = []) {
  const rows = buildRegistrationExportRows(attendees);
  const groupedRows = rows.reduce((groups, row) => {
    const promName = row.promName || row.Prom || "Unknown Prom";
    if (!groups.has(promName)) {
      groups.set(promName, []);
    }
    groups.get(promName).push(row);
    return groups;
  }, new Map());

  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  groupedRows.forEach((promRows, promName) => {
    if (!promRows.length) return;

    const orderedRows = promRows.map((row) =>
      EXPORT_COLUMNS.reduce((ordered, column) => {
        ordered[column] = row[column] ?? "";
        return ordered;
      }, {})
    );
    const worksheet = XLSX.utils.json_to_sheet(orderedRows, { header: EXPORT_COLUMNS });
    worksheet["!cols"] = EXPORT_COLUMNS.map((column) => ({
      wch: Math.max(column.length + 2, 16)
    }));

    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeExcelSheetName(promName, usedSheetNames));
  });

  if (!workbook.SheetNames.length) {
    const worksheet = XLSX.utils.aoa_to_sheet([["No registrations found"]]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "No Registrations");
  }

  XLSX.writeFile(workbook, "alshayeb-registrations-by-prom.xlsx");
}

function normalizeEventFee(fee) {
  if (!fee) return "250 EGP";
  if (typeof fee === "string") return fee;
  return `${fee.amount || 0} ${fee.currency || "EGP"}`;
}

function eventDateTimeValue(event) {
  return event?.dateTime || event?.date || QR_REVEAL_TIME;
}

function formatCountdownUnit(value) {
  return String(value).padStart(2, "0");
}

const Shell = ({ children, tone = "blue", className = "" }) => (
  <div className={`app-shell tone-${tone} ${className}`}>
    <AnimatedBackground />
    <motion.div className="cosmic-card tone-card" {...pageMotion}>
      {children}
    </motion.div>
  </div>
);

function PublicWebsite() {
  const [phone, setPhone] = useState("");
  const [foundClient, setFoundClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("home");
  const [errors, setErrors] = useState({});
  const [selectedEvent, setSelectedEvent] = useState(events[0]);
  const [liveEvents, setLiveEvents] = useState(events);
  const [outcomerSelection, setOutcomerSelection] = useState(DEFAULT_OUTCOMER_SELECTION);
  const [now, setNow] = useState(Date.now());
  const [trackedRegistration, setTrackedRegistration] = useState(null);

  const [request, setRequest] = useState({
    fullName: "",
    phoneNumber: "",
    email: "",
    schoolOrOriginProm: "",
    age: "",
    instagramUsername: "",
    screenshot: null,
    screenshotFile: null
  });

  const cleanValue = (value) => String(value || "").replace(/\s/g, "").replace(/'/g, "").trim();
  const safeValue = (value, fallback = "Not available") => {
    const text = String(value ?? "").trim();
    return text || fallback;
  };
  const displayEvents = liveEvents.length ? liveEvents : events;
  const findPromEvent = (promName) => {
    const normalizedProm = String(promName || "").trim().toLowerCase();
    return displayEvents.find((event) => String(event.name || "").trim().toLowerCase() === normalizedProm) || selectedEvent;
  };
  const toTicketClient = (attendee) => {
    const promEvent = findPromEvent(attendee.eventName || attendee.event || attendee.Venue);
    return {
      Name: attendee.fullName || attendee.name || attendee.Name,
      Phone: attendee.phoneNumber || attendee.phone || attendee.Phone,
      QR: attendee.qrToken || attendee.qrId || attendee.QR,
      ID: attendee.qrId || attendee.id || attendee.ID,
      type: attendee.accessType || attendee.type || attendee.attendeeType || "Guest",
      Status: attendee.status || attendee.Status || "Approved",
      Venue: attendee.eventName || attendee.Venue || promEvent.name || "ALSHAYEB ETERNUM",
      PromDateTime: eventDateTimeValue(promEvent)
    };
  };

  const isEgyptianPhone = (value) => /^01[0-9]{9}$/.test(cleanValue(value));

  const loadGuests = useCallback(() => {
    setLoading(true);
    setErrors((prev) => ({ ...prev, home: "" }));

    apiRequest("/api/attendees?status=approved")
      .then(() => {
        setLoading(false);
      })
      .catch((error) => {
        console.log("Error:", error);
        setLoading(false);
        setErrors((prev) => ({
          ...prev,
          home: "We could not connect to MongoDB records. Please check the backend API and try again."
        }));
      });
  }, []);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  useEffect(() => {
    apiRequest("/api/events")
      .then((result) => {
        const backendEvents = Array.isArray(result.events) && result.events.length
          ? result.events.map((event) => ({
              id: event._id || event.id || event.slug,
              name: event.name,
              date: event.date ? new Date(event.date).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" }).toUpperCase() : "DATE TBA",
              dateTime: event.date || QR_REVEAL_TIME,
              fee: normalizeEventFee(event.fee),
              venue: event.venue || "ALSHAYEB ETERNUM"
            }))
          : events;
        setLiveEvents(backendEvents);
        setSelectedEvent((current) => backendEvents.find((event) => event.name === current.name) || backendEvents[0] || current);
      })
      .catch((error) => {
        console.log("Event load failed:", error);
        setLiveEvents(events);
      });

    apiRequest("/api/admin/site-settings")
      .then((result) => {
        setOutcomerSelection({
          ...DEFAULT_OUTCOMER_SELECTION,
          ...(result.settings?.outcomerSelection || {})
        });
      })
      .catch((error) => {
        console.log("Site settings load failed:", error);
      });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const validatePhoneSearch = () => {
    const newErrors = {};

    if (!cleanValue(phone)) {
      newErrors.phoneSearch = "Phone number is required.";
    } else if (!isEgyptianPhone(phone)) {
      newErrors.phoneSearch = "Enter an Egyptian phone number starting with 01 and 11 digits long.";
    }

    setErrors((prev) => ({ ...prev, ...newErrors, home: prev.home || "" }));
    return Object.keys(newErrors).length === 0;
  };

  const handleSearch = async () => {
    if (loading) return;
    if (!validatePhoneSearch()) return;

    setLoading(true);
    const existing = await lookupBackendRegistration(phone);
    setLoading(false);

    if (existing && routeExistingRegistration(existing)) return;

    setFoundClient(null);
    setErrors({});
    setPage("notfound");
  };

  const handleTrackLookup = async () => {
    if (loading) return;
    if (!validatePhoneSearch()) return;

    setLoading(true);
    const existing = await lookupBackendRegistration(phone);
    setLoading(false);

    if (!existing) {
      setTrackedRegistration(null);
      setFoundClient(null);
      setErrors({});
      setPage("notfound");
      return;
    }

    const normalizedStatus = String(existing.status || "").toLowerCase();
    if (normalizedStatus.includes("approved") || normalizedStatus.includes("active") || normalizedStatus.includes("verified")) {
      setFoundClient(toTicketClient(existing.data));
      setErrors({});
      setPage("ticket");
      return;
    }

    setTrackedRegistration(existing.data);
    setRequest((prev) => ({ ...prev, ...existing.data }));
    setErrors({});
    setPage(normalizedStatus.includes("reject") || normalizedStatus.includes("declined") ? "rejected" : "track");
  };

  const validateRegistration = () => {
    const newErrors = {};
    const fullName = request.fullName.trim();
    const phoneNumber = cleanValue(request.phoneNumber);
    const email = request.email.trim();
    const schoolOrOriginProm = request.schoolOrOriginProm.trim();
    const age = request.age.trim();
    const instagramUsername = request.instagramUsername.trim();

    if (!fullName) {
      newErrors.fullName = "Full name is required.";
    } else if (fullName.length < 3) {
      newErrors.fullName = "Full name must be at least 3 characters.";
    } else if (!/^[a-zA-Z\s]+$/.test(fullName)) {
      newErrors.fullName = "Full name can contain letters and spaces only.";
    }

    if (!phoneNumber) {
      newErrors.phoneNumber = "Phone number is required.";
    } else if (!isEgyptianPhone(phoneNumber)) {
      newErrors.phoneNumber = "Enter an Egyptian phone number starting with 01 and 11 digits long.";
    }

    if (!email) {
      newErrors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Enter a valid email address.";
    }

    if (!schoolOrOriginProm) {
      newErrors.schoolOrOriginProm = "School / Origin Prom is required.";
    }

    if (!age) {
      newErrors.age = "Age is required.";
    } else if (!/^\d+$/.test(age) || Number(age) < 15 || Number(age) > 40) {
      newErrors.age = "Age must be a number between 15 and 40.";
    }

    if (!instagramUsername) {
      newErrors.instagramUsername = "Instagram username is required.";
    } else if (/\s/.test(instagramUsername)) {
      newErrors.instagramUsername = "Instagram username cannot contain spaces.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateScreenshot = () => {
    const newErrors = {};

    if (!request.screenshot) {
      newErrors.screenshot = "Upload a PNG, JPG, or JPEG screenshot before submitting for review.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRequestChange = (e) => {
    const { name, value } = e.target;
    setRequest((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handleScreenshotUpload = (e) => {
    const file = e.target.files?.[0];

    if (!file) {
      setRequest((prev) => ({ ...prev, screenshot: null, screenshotFile: null }));
      return;
    }

    const allowedTypes = ["image/png", "image/jpg", "image/jpeg"];
    const allowedExtensions = [".png", ".jpg", ".jpeg"];
    const fileName = file.name.toLowerCase();
    const hasAllowedExtension = allowedExtensions.some((extension) => fileName.endsWith(extension));

    if (!allowedTypes.includes(file.type) || !hasAllowedExtension) {
      setRequest((prev) => ({ ...prev, screenshot: null, screenshotFile: null }));
      setErrors((prev) => ({ ...prev, screenshot: "Only PNG, JPG, or JPEG files are allowed." }));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setRequest((prev) => ({ ...prev, screenshot: null, screenshotFile: null }));
      setErrors((prev) => ({ ...prev, screenshot: "Payment screenshot must be 5MB or smaller." }));
      return;
    }

    setRequest((prev) => ({ ...prev, screenshot: file.name, screenshotFile: file }));
    setErrors((prev) => ({ ...prev, screenshot: "" }));
  };

  const findExistingRegistration = (phoneNumber) => lookupBackendRegistration(phoneNumber);

  const routeExistingRegistration = (existing) => {
    const normalizedStatus = String(existing?.status || "").toLowerCase();

    if (normalizedStatus.includes("approved") || normalizedStatus.includes("active") || normalizedStatus.includes("verified")) {
      setFoundClient(toTicketClient(existing.data));
      setErrors({});
      setPage("ticket");
      return true;
    }

    if (normalizedStatus.includes("reject") || normalizedStatus.includes("declined")) {
      setTrackedRegistration(existing.data);
      setRequest((prev) => ({ ...prev, ...existing.data }));
      setErrors({});
      setPage("rejected");
      return true;
    }

    if (normalizedStatus.includes("pending") || normalizedStatus.includes("review") || normalizedStatus.includes("verification")) {
      setTrackedRegistration(existing.data);
      setRequest((prev) => ({ ...prev, ...existing.data }));
      setErrors({});
      setPage("track");
      return true;
    }

    return false;
  };

  const lookupBackendRegistration = async (phoneNumber) => {
    try {
      const result = await apiRequest(`/api/attendees/lookup?phone=${encodeURIComponent(cleanValue(phoneNumber))}`);
      if (!result?.found || !result.attendee) return null;
      return {
        source: "backend",
        status: result.attendee.status,
        data: result.attendee
      };
    } catch (error) {
      console.log("Backend lookup failed:", error);
      setErrors((prev) => ({ ...prev, home: "MongoDB lookup failed. Please check the backend API." }));
      return null;
    }
  };

  const submitBackendOutcomer = async (payload) => {
    try {
      return await apiRequest("/api/outcomers/register", {
        method: "POST",
        body: payload
      });
    } catch (error) {
      console.log("Backend registration failed:", error);
      if (error.details) {
        setErrors(error.details);
      } else {
        setErrors((prev) => ({
          ...prev,
          screenshot: error.message || "Could not save this registration. Please make sure the backend server is running."
        }));
      }
      return null;
    }
  };

  const goToPayment = async () => {
    if (!validateRegistration()) return;
    const existing = await findExistingRegistration(request.phoneNumber);
    if (existing && routeExistingRegistration(existing)) return;
    setPage("payment");
  };

  const submitRequest = async () => {
    if (!validateScreenshot()) return;

    const newRequest = {
      ...request,
      event: selectedEvent.name,
      eventId: selectedEvent.id,
      requestId: "OUT-" + Math.floor(1000 + Math.random() * 9000),
      applicationStatus: "PENDING REVIEW",
      paymentStatus: "UNDER VERIFICATION",
      submittedAt: new Date().toISOString()
    };

    const formData = new FormData();
    formData.append("fullName", request.fullName);
    formData.append("phoneNumber", request.phoneNumber);
    formData.append("email", request.email);
    formData.append("schoolOrOriginProm", request.schoolOrOriginProm);
    formData.append("age", request.age);
    formData.append("instagramUsername", request.instagramUsername);
    formData.append("eventName", selectedEvent.name);
    formData.append("paymentProof", request.screenshotFile);

    const backendResult = await submitBackendOutcomer(formData);

    if (!backendResult) return;

    if (backendResult?.duplicate) {
      const existing = {
        source: "backend",
        status: backendResult.attendee?.status,
        data: backendResult.attendee
      };
      if (routeExistingRegistration(existing)) return;
    }

    const persistedRequest = backendResult?.attendee
      ? {
          ...newRequest,
          ...backendResult.attendee,
          event: backendResult.attendee.eventName || selectedEvent.name,
          requestId: backendResult.attendee.id || newRequest.requestId,
          applicationStatus: backendResult.attendee.status || newRequest.applicationStatus,
          paymentStatus: backendResult.attendee.paymentStatus || newRequest.paymentStatus
        }
      : newRequest;

    setTrackedRegistration(persistedRequest);
    setRequest(persistedRequest);
    setErrors({});
    setPage("submitted");
  };

  const FieldError = ({ name }) => {
    if (!errors[name]) return null;
    return <p className="field-error">{errors[name]}</p>;
  };

  if (page === "notfound") {
    return (
      <Shell tone="blue">
        <button className="back-icon" onClick={() => setPage("home")} aria-label="Back">
          &larr;
        </button>
        <div className="ring small-ring"></div>
        <h2 className="page-title">NOT FOUND</h2>
        <p className="muted">This phone number is not in our guest list yet.</p>
        <p className="muted">You can request access as an outcomer.</p>

        <button className="purple-btn" onClick={() => setPage("outcomerLanding")}>
          REGISTER AS OUTCOMER
        </button>

        <button className="ghost-btn" onClick={() => setPage("home")}>
          BACK
        </button>
      </Shell>
    );
  }

  if (page === "outcomerLanding") {
    return (
      <Shell tone="purple" className="reference-flow outcomer-reference">
        <button className="back-icon" onClick={() => setPage("home")} aria-label="Back">
          &larr;
        </button>
        <div className="mini-brand-lockup">
          <div className="ring small-ring"></div>
          <span>ALSHAYEB</span>
          <strong>ETERNUM</strong>
          <em>NO BEGINNING. NO END.</em>
        </div>
        <div className="reference-gate" aria-hidden="true">
          <span className="gate-orb"></span>
          <span className="gate-door"></span>
          <span className="gate-floor"></span>
        </div>

        <section className="outcomer-selection-panel">
          <h2>THE SEEKERS</h2>
          <p>Not everyone is chosen.<br />Request access to join the experience.</p>
          <div className="selection-display">
            <div><strong>{outcomerSelection.approved}</strong><span>APPROVED</span></div>
            <div><strong>{outcomerSelection.pending}</strong><span>PENDING</span></div>
            <div><strong>{outcomerSelection.declined}</strong><span>DECLINED</span></div>
          </div>
        </section>

        <div className="outcomer-action-list">
          <button type="button" className="outcomer-action-card" onClick={() => setPage("chooseEvent")}>
            <span className="action-icon">01</span>
            <span><strong>REGISTER</strong><em>Begin your application to join Eternum.</em></span>
            <b>&rarr;</b>
          </button>
          <button type="button" className="outcomer-action-card" onClick={() => setPage("alreadyRegistered")}>
            <span className="action-icon">02</span>
            <span><strong>ALREADY REGISTERED</strong><em>Get your QR Code and access your pass.</em></span>
            <b>&rarr;</b>
          </button>
          <button type="button" className="outcomer-action-card" onClick={() => setPage("trackLookup")}>
            <span className="action-icon">03</span>
            <span><strong>TRACK YOUR REQUEST</strong><em>Check your application status and committee updates.</em></span>
            <b>&rarr;</b>
          </button>
        </div>

        <footer className="reference-footer">ALSHAYEB EXPERIENCE</footer>
      </Shell>
    );
  }

  if (page === "alreadyRegistered" || page === "trackLookup") {
    const isTrackLookup = page === "trackLookup";

    return (
      <Shell tone="purple" className="reference-flow lookup-reference">
        <button className="back-icon" onClick={() => setPage("outcomerLanding")} aria-label="Back">
          &larr;
        </button>
        <div className="ring small-ring"></div>
        <h2 className="page-title">{isTrackLookup ? "TRACK YOUR REQUEST" : "ALREADY REGISTERED"}</h2>
        <p className="tagline">{isTrackLookup ? "THE SEEKERS" : "ACCESS YOUR PASS"}</p>
        <div className="reference-gate compact-gate" aria-hidden="true">
          <span className="gate-door"></span>
          <span className="gate-floor"></span>
        </div>
        <div className="welcome-block">
          <p>{isTrackLookup ? "Enter your phone number" : "Your QR pass is waiting."}</p>
          <h2>{isTrackLookup ? "CURRENT PHASE" : "OPEN THE GATE"}</h2>
          <p>{isTrackLookup ? "Pending. Declined. Confirmed." : "Enter your phone number to access your universal ticket."}</p>
        </div>
        <div className="phone-field">
          <span>+20</span>
          <input
            className={errors.phoneSearch ? "error-input" : ""}
            type="text"
            placeholder="Phone Number"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setErrors((prev) => ({ ...prev, phoneSearch: "" }));
            }}
          />
        </div>
        <FieldError name="phoneSearch" />
        <button className="purple-btn" onClick={isTrackLookup ? handleTrackLookup : handleSearch} disabled={loading}>
          {loading ? "LOADING" : isTrackLookup ? "TRACK REQUEST" : "ACCESS THE GATE"}
        </button>
      </Shell>
    );
  }

  if (page === "chooseEvent") {
    return (
      <Shell tone="purple" className="reference-flow">
        <button className="back-icon" onClick={() => setPage("outcomerLanding")} aria-label="Back">
          &larr;
        </button>
        <div className="ring small-ring"></div>
        <h1 className="brand-title">ETERNUM</h1>
        <p className="muted">SELECT YOUR DESTINATION</p>

        <div className="event-list">
          {displayEvents.map((event, index) => (
            <motion.button
              type="button"
              key={event.id}
              className={`event-card ${selectedEvent.id === event.id ? "active-event" : ""}`}
              onClick={() => setSelectedEvent(event)}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06, duration: 0.35 }}
            >
              <div className="mini-venue"></div>
              <div>
                <h3>{event.name}</h3>
                <p>{event.date}</p>
              </div>
            </motion.button>
          ))}
        </div>

        <button className="purple-btn" onClick={() => setPage("register")}>
          CONTINUE
        </button>
      </Shell>
    );
  }

  if (page === "register") {
    return (
      <Shell tone="purple" className="reference-flow form-reference">
        <button className="back-icon" onClick={() => setPage("chooseEvent")} aria-label="Back">
          &larr;
        </button>
        <h2 className="page-title">REQUEST ACCESS</h2>
        <p className="muted">{selectedEvent.name}</p>

        <div className="form-grid">
          <label><span>Full Name</span><input className={errors.fullName ? "error-input" : ""} name="fullName" placeholder="Full Name" value={request.fullName} onChange={handleRequestChange} /></label>
          <FieldError name="fullName" />

          <label><span>Phone Number</span><input className={errors.phoneNumber ? "error-input" : ""} name="phoneNumber" placeholder="Phone Number" value={request.phoneNumber} onChange={handleRequestChange} /></label>
          <FieldError name="phoneNumber" />

          <label><span>Email</span><input className={errors.email ? "error-input" : ""} name="email" placeholder="Email" value={request.email} onChange={handleRequestChange} /></label>
          <FieldError name="email" />

          <label>
            <span>School / Origin Prom</span>
            <input
              className={errors.schoolOrOriginProm ? "error-input" : ""}
              name="schoolOrOriginProm"
              placeholder="Which school/prom are you coming from? Example: MIU, BUE, AAST, GUC, Helwan, etc."
              value={request.schoolOrOriginProm}
              onChange={handleRequestChange}
            />
          </label>
          <FieldError name="schoolOrOriginProm" />

          <label><span>Age</span><input className={errors.age ? "error-input" : ""} name="age" placeholder="Age" value={request.age} onChange={handleRequestChange} /></label>
          <FieldError name="age" />

          <label><span>Instagram Username</span><input className={errors.instagramUsername ? "error-input" : ""} name="instagramUsername" placeholder="Instagram Username" value={request.instagramUsername} onChange={handleRequestChange} /></label>
          <FieldError name="instagramUsername" />
        </div>

        <button className="purple-btn" onClick={goToPayment}>
          CONTINUE TO PAYMENT
        </button>
      </Shell>
    );
  }

  if (page === "payment") {
    return (
      <Shell tone="purple" className="reference-flow form-reference">
        <button className="back-icon" onClick={() => setPage("register")} aria-label="Back">
          &larr;
        </button>
        <h2 className="page-title">ACCESS REQUEST</h2>
        <motion.div className="success-icon" {...softPop}>
          OK
        </motion.div>
        <p className="muted">One final step remains before entry is granted.</p>

        <motion.div className="fee-box" {...softPop}>
          <span>REGISTRATION FEE</span>
          <h1>{selectedEvent.fee}</h1>
        </motion.div>

        <button className="purple-btn" onClick={() => setPage("instapay")}>
          PROCEED TO PAYMENT
        </button>
      </Shell>
    );
  }

  if (page === "instapay") {
    return (
      <Shell tone="purple" className="reference-flow form-reference">
        <h1 className="insta">instaPay</h1>
        <motion.div className="phone-pay" {...softPop}>
          <p>PAY</p>
          <h1>{selectedEvent.fee}</h1>
          <span>ALSHAYEB ETERNUM</span>
        </motion.div>

        <p className="muted">Payment link will be added later.</p>

        <button className="purple-btn" onClick={() => setPage("upload")}>
          I PAID - UPLOAD PROOF
        </button>
      </Shell>
    );
  }

  if (page === "upload") {
    return (
      <Shell tone="purple" className="reference-flow form-reference">
        <button className="back-icon" onClick={() => setPage("instapay")} aria-label="Back">
          &larr;
        </button>
        <h2 className="page-title">PAYMENT VERIFICATION</h2>
        <p className="muted">Please upload a screenshot of your completed payment.</p>

        <motion.label
          className={`upload-box ${errors.screenshot ? "upload-error" : ""} ${request.screenshot ? "upload-selected" : ""}`}
          whileHover={{ y: -3, scale: 1.01 }}
          transition={{ duration: 0.2 }}
        >
          <span>UPLOAD</span>
          <p>{request.screenshot ? "SCREENSHOT SELECTED" : "UPLOAD SCREENSHOT"}</p>
          <small>{request.screenshot || "PNG / JPG / JPEG"}</small>
          <input type="file" hidden accept="image/png,image/jpeg,image/jpg" onChange={handleScreenshotUpload} />
        </motion.label>

        <FieldError name="screenshot" />

        <button className="purple-btn" onClick={submitRequest}>
          SUBMIT FOR REVIEW
        </button>
      </Shell>
    );
  }

  if (page === "submitted") {
    return (
      <Shell tone="purple" className="reference-flow form-reference">
        <motion.div className="success-icon" {...softPop}>
          OK
        </motion.div>
        <h2 className="page-title">REQUEST SUBMITTED</h2>
        <p className="muted">Your application has been submitted successfully.</p>

        <div className="identity-card">
          <div><span>EVENT</span><p>{selectedEvent.name}</p></div>
          <div><span>REQUEST ID</span><p>{safeValue(request.requestId, "Unknown")}</p></div>
          <div><span>APPLICATION STATUS</span><p><span className="status-badge pending">PENDING REVIEW</span></p></div>
          <div><span>PAYMENT STATUS</span><p><span className="status-badge pending">UNDER VERIFICATION</span></p></div>
        </div>

        <button className="purple-btn" onClick={() => setPage("track")}>
          TRACK REQUEST
        </button>
      </Shell>
    );
  }

  if (page === "track") {
    const saved = trackedRegistration || request || {};
    const normalizedPhase = String(saved.status || saved.applicationStatus || "pending").toLowerCase();
    const phaseLabel = normalizedPhase.includes("approved") || normalizedPhase.includes("confirmed")
      ? "CONFIRMED"
      : normalizedPhase.includes("reject") || normalizedPhase.includes("declined")
        ? "DECLINED"
        : "PENDING";

    return (
      <Shell tone="purple" className="reference-flow form-reference">
        <div className="ring small-ring"></div>
        <h2 className="page-title">{phaseLabel}</h2>
        <p className="muted">Your application current phase is {phaseLabel.toLowerCase()}.</p>

        <div className="identity-card">
          <div><span>EVENT</span><p>{safeValue(saved.event, selectedEvent.name)}</p></div>
          <div><span>REQUEST ID</span><p>{safeValue(saved.requestId, "OUT-0000")}</p></div>
          <div><span>APPLICATION STATUS</span><p><span className={`status-badge ${statusClass(phaseLabel)}`}>{phaseLabel}</span></p></div>
          <div><span>PAYMENT STATUS</span><p><span className="status-badge pending">UNDER VERIFICATION</span></p></div>
        </div>

        <p className="muted">This usually takes 24-48 hours.</p>
        <button className="ghost-btn" onClick={() => setPage("home")}>BACK HOME</button>
      </Shell>
    );
  }

  if (page === "rejected") {
    const saved = trackedRegistration || request || {};

    return (
      <Shell tone="purple" className="reference-flow form-reference">
        <div className="ring small-ring"></div>
        <h2 className="page-title">APPLICATION DECLINED</h2>
        <p className="muted">Your application was declined.</p>

        <div className="identity-card">
          <div><span>EVENT</span><p>{safeValue(saved.event, selectedEvent.name)}</p></div>
          <div><span>REQUEST ID</span><p>{safeValue(saved.requestId, "OUT-0000")}</p></div>
          <div><span>APPLICATION STATUS</span><p><span className="status-badge used">REJECTED</span></p></div>
          <div><span>PHONE</span><p>{safeValue(saved.phoneNumber || saved.phone, "Not available")}</p></div>
        </div>

        <button className="ghost-btn" onClick={() => setPage("home")}>BACK HOME</button>
      </Shell>
    );
  }

  if (page === "ticket" && foundClient) {
    const guestName = safeValue(foundClient.name || foundClient.Name, "Guest");
    const guestPhone = safeValue(foundClient.phone || foundClient.Phone);
    const qrId = safeValue(foundClient.qr || foundClient.QR || foundClient.id || foundClient.ID, "Not available");
    const qrValue = String(foundClient.qr || foundClient.QR || "").trim();
    const accessType = safeValue(foundClient.accessType || foundClient["Access Type"] || foundClient.type, "Unknown");
    const rawStatus = safeValue(foundClient.status || foundClient.Status, "Active");
    const status = rawStatus.toLowerCase();
    const venue = safeValue(foundClient.venue || foundClient.Venue, "ALSHAYEB ETERNUM");
    const ticketPromEvent = findPromEvent(venue);
    const ticketRevealDate = new Date(foundClient.PromDateTime || eventDateTimeValue(ticketPromEvent)).getTime();
    const safeTicketRevealDate = Number.isFinite(ticketRevealDate) ? ticketRevealDate : new Date(QR_REVEAL_TIME).getTime();
    const ticketQrLocked = now < safeTicketRevealDate;
    const ticketDistance = Math.max(safeTicketRevealDate - now, 0);
    const ticketCountdown = {
      days: Math.floor(ticketDistance / (1000 * 60 * 60 * 24)),
      hours: Math.floor((ticketDistance / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((ticketDistance / (1000 * 60)) % 60),
      seconds: Math.floor((ticketDistance / 1000) % 60)
    };
    const normalizedAccessType = accessType.toLowerCase();
    const ticketTone = normalizedAccessType.includes("guest") || normalizedAccessType.includes("invited")
      ? "gold"
      : normalizedAccessType.includes("outcomer")
        ? "purple"
        : "blue";

    return (
      <div className={`ticket-page tone-${ticketTone}`}>
        <AnimatedBackground />
        <motion.div className="ticket-pass tone-card" {...pageMotion}>
          <div className="ticket-hero">
            <div className="ring"></div>
            <h3>ALSHAYEB</h3>
            <h1>ETERNUM</h1>
            <p>NO BEGINNING. NO END.</p>
          </div>

          {ticketQrLocked ? (
            <motion.div className="locked-qr-card" {...softPop}>
              <span className="qr-lock-icon" aria-hidden="true">&#128274;</span>
              <span className="status-badge active">ACCESS CONFIRMED</span>
              <h2>QR UNLOCKS SOON</h2>
              <div className="countdown-grid">
                <div><strong>{formatCountdownUnit(ticketCountdown.days)}</strong><span>DAYS</span></div>
                <div><strong>{formatCountdownUnit(ticketCountdown.hours)}</strong><span>HRS</span></div>
                <div><strong>{formatCountdownUnit(ticketCountdown.minutes)}</strong><span>MIN</span></div>
                <div><strong>{formatCountdownUnit(ticketCountdown.seconds)}</strong><span>SEC</span></div>
              </div>
              <p className="muted">Unlocks at {new Date(safeTicketRevealDate).toLocaleString()}</p>
            </motion.div>
          ) : (
            <motion.div className="qr-card" {...softPop}>
              <span className="qr-lock-icon unlocked" aria-hidden="true">&#128275;</span>
              <h2>{qrValue ? "SCAN TO ENTER" : "QR NOT AVAILABLE YET"}</h2>
              {qrValue ? (
                <>
                  <motion.div className="qr-white" initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45 }}>
                    <QRCode value={qrValue} size={230} />
                  </motion.div>
                  <p>{qrValue}</p>
                </>
              ) : (
                <p className="muted">QR not available yet.</p>
              )}
            </motion.div>
          )}

          <motion.div className="identity-card" {...softPop}>
            <h2>ACCESS IDENTITY</h2>
            <div><span>NAME</span><p>{guestName}</p></div>
            <div><span>PHONE</span><p>{guestPhone}</p></div>
            <div><span>ID / QR ID</span><p>{qrId}</p></div>
            <div><span>ACCESS TYPE</span><p>{accessType}</p></div>
            <div><span>STATUS</span><p><span className={`status-badge ${status === "used" ? "used" : "active"}`}>{status === "used" ? "USED BEFORE" : rawStatus.toUpperCase()}</span></p></div>
            <div><span>VENUE</span><p>{venue}</p></div>
          </motion.div>

          <div className="venue-about">
            <h2>ABOUT THE VENUE</h2>
            <p>
              ALSHAYEB ETERNUM is our iconic destination for music, art and connection.
              Designed as a circular island where energy flows endlessly.
            </p>
          </div>

          <div className="feature-grid">
            <div>360 DEGREE EXPERIENCE</div>
            <div>WORLD CLASS SOUND</div>
            <div>SAFETY FIRST</div>
            <div>PREMIUM EXPERIENCE</div>
          </div>

          <button className="purple-btn" onClick={() => setPage("home")}>
            BACK
          </button>
        </motion.div>
      </div>
    );
  }

  if (page === "incomer" || page === "guestList") {
    const isIncomer = page === "incomer";

    return (
      <Shell tone={isIncomer ? "blue" : "gold"} className="reference-flow incomer-reference">
        <button className="back-icon" onClick={() => setPage("home")} aria-label="Back">
          &larr;
        </button>
        <div className="ring small-ring"></div>
        <h1 className="brand-title">{isIncomer ? "THE ETERNAL LIST" : "THE INVITED"}</h1>
        <p className="tagline">{isIncomer ? "INCOMER" : "GUEST LIST"}</p>
        <div className="reference-gate" aria-hidden="true">
          <span className="gate-orb"></span>
          <span className="gate-door"></span>
          <span className="gate-floor"></span>
        </div>

        <div className="welcome-block">
          <p>{isIncomer ? "Your place has already been secured." : "Feeling lucky?"}</p>
          {isIncomer && <div className="incomer-divider" aria-hidden="true"><span></span></div>}
          <h2>{isIncomer ? "Enter your phone number to access your pass." : "Check if your name made it onto the Eternal List."}</h2>
        </div>

        {loading && <p className="loading-message">Loading guest list...</p>}
        {errors.home && (
          <div className="home-error">
            <p className="field-error center-error">{errors.home}</p>
            <button className="retry-btn" onClick={loadGuests} disabled={loading}>
              RETRY
            </button>
          </div>
        )}

        <div className="phone-field">
          <span>+20</span>
          <input
            className={errors.phoneSearch ? "error-input" : ""}
            type="text"
            placeholder="Phone Number"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setErrors((prev) => ({ ...prev, phoneSearch: "" }));
            }}
          />
        </div>
        <FieldError name="phoneSearch" />

        <button className="purple-btn" onClick={handleSearch} disabled={loading}>
          {loading ? "LOADING" : isIncomer ? "ACCESS THE GATE" : "CHECK NOW"}
        </button>

        <p className="secure">{isIncomer && <span aria-hidden="true">◇</span>}Your information is secure and encrypted.</p>
      </Shell>
    );
  }

  return (
    <motion.main className="eternum-home" {...pageMotion}>
      <AnimatedBackground />
      <div className="eternum-frame" aria-hidden="true"></div>
      <div className="eternum-axis" aria-hidden="true"></div>

      <section className="eternum-hero" aria-label="ALSHAYEB ETERNUM">
        <div className="sigil-mark" aria-hidden="true">
          <span></span>
        </div>

        <div className="brand-lockup">
          <p>ALSHAYEB</p>
          <h1>ETERNUM</h1>
          <span>NO BEGINNING. NO END.</span>
        </div>

        <div className="portal-scene" aria-hidden="true">
          <div className="portal-rings"></div>
          <div className="portal-gate"></div>
          <div className="portal-floor"></div>
          <span className="obelisk obelisk-left one"></span>
          <span className="obelisk obelisk-left two"></span>
          <span className="obelisk obelisk-right one"></span>
          <span className="obelisk obelisk-right two"></span>
        </div>
      </section>

      <section className="path-section" aria-label="Choose your path">
        <div className="path-title">
          <span></span>
          <h2>CHOOSE YOUR PATH</h2>
          <span></span>
        </div>

        <div className="path-card-list">
          <button className="path-card path-blue" type="button" onClick={() => setPage("incomer")}>
            <span className="path-number">01</span>
            <span className="path-copy">
              <span className="path-kicker">THE ETERNAL LIST</span>
              <strong>INCOMER</strong>
              <span className="path-description">Already registered?<br />Access your digital pass and event details.</span>
            </span>
            <span className="path-divider"></span>
            <span className="path-arrow" aria-hidden="true">&rarr;</span>
          </button>

          <button className="path-card path-purple" type="button" onClick={() => setPage("outcomerLanding")}>
            <span className="path-number">02</span>
            <span className="path-copy">
              <span className="path-kicker">THE SEEKERS</span>
              <strong>OUTCOMER</strong>
              <span className="path-description">Request access to join the experience. Applications are reviewed by the committee.</span>
            </span>
            <span className="path-divider"></span>
            <span className="path-arrow" aria-hidden="true">&rarr;</span>
          </button>

          <button className="path-card path-gold" type="button" onClick={() => setPage("guestList")}>
            <span className="path-number">03</span>
            <span className="path-copy">
              <span className="path-kicker">THE INVITED</span>
              <strong>GUEST LIST</strong>
              <span className="path-description">Feeling lucky?<br />Check if your name made it onto the Eternal List.</span>
            </span>
            <span className="path-divider"></span>
            <span className="path-arrow" aria-hidden="true">&rarr;</span>
          </button>
        </div>

        <footer className="home-footer">
          <p>YOUR JOURNEY. SECURE. PRIVATE. ETERNAL.</p>
          <span>ALSHAYEB ETERNUM</span>
        </footer>
      </section>
    </motion.main>
  );
}

function isAdminAuthenticated() {
  try {
    const session = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || "null");
    return Boolean(session?.authenticated);
  } catch {
    return false;
  }
}

function ProtectedAdminRoute({ children }) {
  if (!isAdminAuthenticated()) {
    return <Navigate to="/control" replace />;
  }

  return children;
}

function AdminLogin() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");

  if (isAdminAuthenticated()) {
    return <Navigate to="/control/dashboard" replace />;
  }

  const handleSubmit = (event) => {
    event.preventDefault();

    if (credentials.email.trim().toLowerCase() !== ADMIN_EMAIL || credentials.password !== ADMIN_PASSWORD) {
      setLoginError("Invalid admin email or password.");
      return;
    }

    localStorage.setItem(
      ADMIN_SESSION_KEY,
      JSON.stringify({
        authenticated: true,
        email: ADMIN_EMAIL,
        signedInAt: new Date().toISOString()
      })
    );

    navigate("/control/dashboard", { replace: true });
  };

  return (
    <div className="app-shell admin-page tone-gold">
      <AnimatedBackground />
      <motion.form className="cosmic-card tone-card admin-login-card" {...pageMotion} onSubmit={handleSubmit}>
        <div className="ring small-ring"></div>
        <h3>ALSHAYEB</h3>
        <h1 className="brand-title">CONTROL</h1>
        <p className="muted">ADMIN ACCESS</p>

        <input
          className={loginError ? "error-input" : ""}
          type="email"
          placeholder="Admin email"
          value={credentials.email}
          onChange={(event) => {
            setCredentials((prev) => ({ ...prev, email: event.target.value }));
            setLoginError("");
          }}
        />

        <input
          className={loginError ? "error-input" : ""}
          type="password"
          placeholder="Password"
          value={credentials.password}
          onChange={(event) => {
            setCredentials((prev) => ({ ...prev, password: event.target.value }));
            setLoginError("");
          }}
        />

        {loginError && <p className="field-error center-error">{loginError}</p>}

        <button className="purple-btn" type="submit">
          ENTER CONTROL
        </button>

        <Link className="admin-link" to="/">
          BACK TO PUBLIC SITE
        </Link>
      </motion.form>
    </div>
  );
}

function AdminLayout({ children }) {
  const navigate = useNavigate();
  const navItems = [
    { label: "Dashboard", path: "/control/dashboard" },
    { label: "Events", path: "/control/events" },
    { label: "Attendees", path: "/control/attendees" },
    { label: "Outcomers", path: "/control/outcomers" },
    { label: "Payments", path: "/control/payments" },
    { label: "Scanner", path: "/control/scanner" },
    { label: "Export Excel", path: "/control/export" },
    { label: "Settings", path: "/control/settings" }
  ];

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    navigate("/control", { replace: true });
  };

  return (
    <div className="admin-control-page tone-gold">
      <AnimatedBackground />
      <motion.div className="admin-control-shell" {...pageMotion}>
        <aside className="admin-sidebar">
          <div>
            <span>ALSHAYEB</span>
            <h1>CONTROL</h1>
          </div>

          <nav>
            {navItems.map((item) => (
              <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? "active-admin-link" : "")}>
                {item.label}
              </NavLink>
            ))}
            <Link to="/">Public Site</Link>
          </nav>

          <button className="ghost-btn admin-logout" onClick={handleLogout}>
            LOG OUT
          </button>
        </aside>

        <main className="admin-main">{children}</main>
      </motion.div>
    </div>
  );
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized.includes("approved") || normalized.includes("verified") || normalized.includes("active") || normalized.includes("open") || normalized.includes("granted")) {
    return "active";
  }

  if (normalized.includes("reject") || normalized.includes("invalid") || normalized.includes("closed") || normalized.includes("used")) {
    return "used";
  }

  return "pending";
}

function AdminHeader({ eyebrow, title, badge = "LIVE MONGODB" }) {
  return (
    <div className="admin-header">
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <span className="status-badge pending">{badge}</span>
    </div>
  );
}

function AdminTable({ columns, rows, renderRow }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
    </div>
  );
}

function QuickAction({ children, to }) {
  return (
    <Link className="quick-action" to={to}>
      {children}
    </Link>
  );
}

function useBackendData(path, fallback) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fallbackRef = useRef(fallback);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");

    return apiRequest(path)
      .then((result) => {
        setData(result);
        setLoading(false);
        return result;
      })
      .catch((requestError) => {
        console.log("Admin API request failed:", requestError);
        setData(fallbackRef.current);
        setError(requestError.message || "Could not load MongoDB records.");
        setLoading(false);
        return null;
      });
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}

function AdminDashboard() {
  const { data, loading, error } = useBackendData("/api/admin/dashboard", {
    stats: [],
    recentActivity: [],
    recentAttendees: []
  });
  const stats = data.stats || [];
  const activity = data.recentActivity || [];
  const recentEvents = [...new Set((data.recentAttendees || []).map((attendee) => attendeeProm(attendee)).filter(Boolean))];

  return (
    <AdminLayout>
      <AdminHeader eyebrow="CONTROL ROOM" title="Admin Dashboard" badge={loading ? "LOADING MONGODB" : "LIVE MONGODB"} />
      {error && <div className="admin-empty-state">{error}</div>}

      <div className="admin-stat-grid">
        {stats.map((stat) => (
          <div className="admin-stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
        {!loading && stats.length === 0 && <div className="admin-empty-state">NO MONGODB STATS YET</div>}
      </div>

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <h3>Recent Activity</h3>
          <div className="activity-list">
            {activity.map((item) => (
              <div key={item}>{item}</div>
            ))}
            {!loading && activity.length === 0 && <div>NO RECENT MONGODB ACTIVITY</div>}
          </div>
        </section>

        <section className="admin-panel">
          <h3>Proms In MongoDB</h3>
          <div className="compact-list">
            {recentEvents.map((eventName) => (
              <div key={eventName}>
                <strong>{eventName}</strong>
                <span>Live registration records</span>
              </div>
            ))}
            {!loading && recentEvents.length === 0 && <div><strong>NO PROMS FOUND</strong><span>Submit registrations to populate MongoDB.</span></div>}
          </div>
        </section>

        <section className="admin-panel quick-actions-panel">
          <h3>Quick Actions</h3>
          <div className="quick-action-grid">
            <QuickAction to="/control/events">Create Event</QuickAction>
            <QuickAction to="/control/payments">Review Payments</QuickAction>
            <QuickAction to="/control/scanner">Open Scanner</QuickAction>
            <QuickAction to="/control/export">Export Excel</QuickAction>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

function EventsPage() {
  const { data, loading, error } = useBackendData("/api/events", { events: [] });
  const liveEvents = data.events || [];

  return (
    <AdminLayout>
      <AdminHeader eyebrow="EVENT OPERATIONS" title="Events" badge={loading ? "LOADING MONGODB" : "LIVE MONGODB"} />
      <section className="admin-panel">
        <div className="admin-panel-title">
          <div>
            <h3>Event Registry</h3>
            <p className="muted">Events are loaded from MongoDB.</p>
          </div>
          <button className="mini-admin-btn">CREATE EVENT</button>
        </div>
        {error && <div className="admin-empty-state">{error}</div>}

        <AdminTable
          columns={["Event Name", "Date", "Venue", "Registration Fee", "QR Reveal Time", "Registration Status", "Total Attendees", "Actions"]}
          rows={liveEvents}
          renderRow={(event) => (
            <tr key={event.id || event._id}>
              <td>{event.name}</td>
              <td>{event.date ? new Date(event.date).toLocaleDateString() : "Not set"}</td>
              <td>{event.venue}</td>
              <td>{event.fee}</td>
              <td>{event.qrRevealTime || "Global default"}</td>
              <td><span className={`status-badge ${statusClass(event.isActive ? "Open" : "Closed")}`}>{event.isActive ? "Open" : "Closed"}</span></td>
              <td>{event.totalAttendees || 0}</td>
              <td>
                <div className="table-actions">
                  <button>Edit</button>
                  <button>Close Registration</button>
                  <button>View Attendees</button>
                </div>
              </td>
            </tr>
          )}
        />
        {!loading && liveEvents.length === 0 && <div className="admin-empty-state">NO EVENTS IN MONGODB YET</div>}
      </section>
    </AdminLayout>
  );
}

function AttendeesPage() {
  const [query, setQuery] = useState("");
  const [accessType, setAccessType] = useState("All");
  const [eventFilter, setEventFilter] = useState("All");
  const [qrStatus, setQrStatus] = useState("All");
  const { data, loading, error } = useBackendData("/api/admin/attendees", { attendees: [] });
  const attendees = (data.attendees || []).map(toAdminAttendee);
  const eventNames = ["All", ...new Set(attendees.map((attendee) => attendee.event).filter(Boolean))];

  const filteredAttendees = attendees.filter((attendee) => {
    const matchesQuery = `${attendee.name} ${attendee.phone} ${attendee.email || ""} ${attendee.schoolOrOriginProm || ""} ${attendee.instagramUsername || ""}`.toLowerCase().includes(query.toLowerCase());
    const matchesAccess = accessType === "All" || attendee.accessType === accessType;
    const matchesEvent = eventFilter === "All" || attendee.event === eventFilter;
    const matchesQr = qrStatus === "All" || attendee.qrStatus === qrStatus;
    return matchesQuery && matchesAccess && matchesEvent && matchesQr;
  });

  return (
    <AdminLayout>
      <AdminHeader eyebrow="ACCESS DATABASE" title="Attendees" badge={loading ? "LOADING MONGODB" : "LIVE MONGODB"} />
      <section className="admin-panel">
        {error && <div className="admin-empty-state">{error}</div>}
        <div className="admin-filter-bar">
          <input placeholder="Search by name or phone" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select value={accessType} onChange={(event) => setAccessType(event.target.value)}>
            {["All", "Incomer", "Outcomer", "Committee"].map((option) => <option key={option}>{option}</option>)}
          </select>
          <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
            {eventNames.map((option) => <option key={option}>{option}</option>)}
          </select>
          <select value={qrStatus} onChange={(event) => setQrStatus(event.target.value)}>
            {["All", "Active", "Locked", "Used", "Pending"].map((option) => <option key={option}>{option}</option>)}
          </select>
        </div>

        <AdminTable
          columns={["Full Name", "Phone Number", "Email", "School / Origin Prom", "Age", "Instagram Username", "Status / Current Phase", "Prom"]}
          rows={filteredAttendees}
          renderRow={(attendee) => (
            <tr key={attendee.id}>
              <td>{attendee.name}</td>
              <td>{attendee.phone}</td>
              <td>{attendee.email}</td>
              <td>{attendee.schoolOrOriginProm}</td>
              <td>{attendee.age}</td>
              <td>{attendee.instagramUsername}</td>
              <td><span className={`status-badge ${statusClass(attendee.status || attendee.paymentStatus)}`}>{attendee.status || attendee.paymentStatus}</span></td>
              <td>{attendee.event}</td>
            </tr>
          )}
        />
        {!loading && filteredAttendees.length === 0 && <div className="admin-empty-state">NO MONGODB ATTENDEES MATCH THIS VIEW</div>}
      </section>
    </AdminLayout>
  );
}

function OutcomersPage() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [actionMessage, setActionMessage] = useState("");
  const { data, loading, error, setData } = useBackendData("/api/admin/attendees?type=outcomer", { attendees: [] });
  const requests = (data.attendees || []).map(toAdminAttendee);

  const updateStatus = async (id, nextStatus) => {
    const endpoint = nextStatus === "Approved" ? "approve" : "reject";

    try {
      const result = await apiRequest(`/api/admin/attendees/${id}/${endpoint}`, {
        method: "PATCH",
        body: JSON.stringify({})
      });

      setData((prev) => ({
        ...prev,
        attendees: (prev.attendees || []).map((attendee) => (attendee.id === id ? result.attendee : attendee))
      }));
      setActionMessage(
        nextStatus === "Approved"
          ? "Application approved in MongoDB. Approval email queued if email is configured."
          : "Application rejected in MongoDB. Rejection email queued if email is configured."
      );
    } catch (requestError) {
      console.log("Admin status update failed:", requestError);
      setActionMessage(requestError.message || "Could not update MongoDB status.");
    }
  };

  const filteredRequests = requests.filter((request) => {
    const matchesQuery = `${request.name} ${request.phone} ${request.email} ${request.schoolOrOriginProm} ${request.instagramUsername} ${request.event}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === "All" || request.applicationStatus === statusFilter;
    return matchesQuery && matchesStatus;
  });

  return (
    <AdminLayout>
      <AdminHeader eyebrow="OUTCOMER REVIEW" title="Outcomers" badge={loading ? "LOADING MONGODB" : "LIVE MONGODB"} />
      <section className="admin-panel">
        {error && <div className="admin-empty-state">{error}</div>}
        <div className="admin-filter-bar outcomer-filters">
          <input placeholder="Search name, phone, email, origin prom, Instagram, or Prom" value={query} onChange={(event) => setQuery(event.target.value)} />
          {["All", "Pending", "Approved", "Rejected"].map((status) => (
            <button key={status} className={statusFilter === status ? "filter-pill active-filter" : "filter-pill"} onClick={() => setStatusFilter(status)} type="button">
              {status}
            </button>
          ))}
        </div>

        {actionMessage && <div className="admin-success-state">{actionMessage}</div>}

        <div className="outcomer-card-grid">
          {filteredRequests.map((request) => (
            <article className="outcomer-review-card" key={request.id}>
              <div>
                <span>{request.requestId}</span>
                <h3>{request.name}</h3>
                <p>{request.phone}</p>
              </div>
              <div className="outcomer-meta">
                <div><span>FULL NAME</span><strong>{request.name}</strong></div>
                <div><span>PHONE NUMBER</span><strong>{request.phone}</strong></div>
                <div><span>EMAIL</span><strong>{request.email}</strong></div>
                <div><span>SCHOOL / ORIGIN PROM</span><strong>{request.schoolOrOriginProm}</strong></div>
                <div><span>AGE</span><strong>{request.age}</strong></div>
                <div><span>INSTAGRAM USERNAME</span><strong>{request.instagramUsername}</strong></div>
                <div><span>STATUS / CURRENT PHASE</span><strong>{request.applicationStatus}</strong></div>
                <div><span>PROM</span><strong>{request.event}</strong></div>
              </div>
              <div className="outcomer-status-row">
                <span className={`status-badge ${statusClass(request.applicationStatus)}`}>{request.applicationStatus}</span>
                <div className="table-actions">
                  <button type="button" onClick={() => updateStatus(request.id, "Approved")}>Approve</button>
                  <button type="button" onClick={() => updateStatus(request.id, "Rejected")}>Reject</button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {filteredRequests.length === 0 && <div className="admin-empty-state">NO REQUESTS MATCH THIS VIEW</div>}
      </section>
    </AdminLayout>
  );
}

function PaymentsPage() {
  const { data, loading, error, setData } = useBackendData("/api/admin/attendees?paymentReview=true", { attendees: [] });
  const payments = (data.attendees || []).map(toAdminAttendee);

  const updatePayment = async (id, status) => {
    const paymentStatus = status === "Verified" ? "verified" : "rejected";

    try {
      const result = await apiRequest(`/api/admin/attendees/${id}/payment-status`, {
        method: "PATCH",
        body: JSON.stringify({ paymentStatus })
      });

      setData((prev) => ({
        ...prev,
        attendees: (prev.attendees || []).map((attendee) => (attendee.id === id ? result.attendee : attendee))
      }));
    } catch (requestError) {
      console.log("Payment status update failed:", requestError);
    }
  };

  return (
    <AdminLayout>
      <AdminHeader eyebrow="PAYMENT VERIFICATION" title="Payments" badge={loading ? "LOADING MONGODB" : "LIVE MONGODB"} />
      {error && <div className="admin-empty-state">{error}</div>}
      <div className="payment-review-grid">
        {payments.map((payment) => (
          <section className="admin-panel payment-card" key={payment.id}>
            <div className="screenshot-preview">
              {payment.paymentProof?.url ? (
                <img src={payment.paymentProof.url} alt={`${payment.name} payment proof`} />
              ) : (
                <span>No screenshot uploaded.</span>
              )}
            </div>
            <div className="payment-info">
              <h3>{payment.name}</h3>
              <p className="muted">{payment.phone}</p>
              <div><span>EVENT</span><strong>{payment.event}</strong></div>
              <div><span>AMOUNT</span><strong>{payment.amount}</strong></div>
              <div><span>SUBMITTED</span><strong>{payment.submittedAt}</strong></div>
              <div><span>STATUS</span><strong><span className={`status-badge ${statusClass(payment.paymentStatus)}`}>{payment.paymentStatus}</span></strong></div>
            </div>
            <div className="table-actions payment-actions">
              {payment.paymentProof?.url && (
                <a className="mini-admin-btn" href={payment.paymentProof.url} target="_blank" rel="noreferrer">
                  View Full Screenshot
                </a>
              )}
              <button type="button" onClick={() => updatePayment(payment.id, "Verified")}>Approve Payment</button>
              <button type="button" onClick={() => updatePayment(payment.id, "Rejected")}>Reject Payment</button>
            </div>
          </section>
        ))}
      </div>
      {!loading && payments.length === 0 && <div className="admin-empty-state">NO MONGODB PAYMENT RECORDS YET</div>}
    </AdminLayout>
  );
}

function ScannerPage() {
  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [cameraMessage, setCameraMessage] = useState("Start the camera to scan an Eternum QR pass.");
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const scanningRef = useRef(false);
  const lastDetectedRef = useRef("");

  const stopCamera = useCallback((updateStatus = true) => {
    scanningRef.current = false;
    if (scanLoopRef.current) {
      window.cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (updateStatus) {
      setCameraStatus((currentStatus) => currentStatus === "active" || currentStatus === "starting" ? "idle" : currentStatus);
    }
  }, []);

  const formatScannerError = useCallback((requestError) => {
    const detail = requestError.message || "No matching QR credentials were found.";
    const normalized = detail.toLowerCase();

    if (normalized.includes("used") || normalized.includes("already")) {
      return { title: "Already Used", detail, status: "used" };
    }

    if (
      normalized.includes("status") ||
      normalized.includes("pending") ||
      normalized.includes("review") ||
      normalized.includes("rejected") ||
      normalized.includes("declined") ||
      normalized.includes("not approved")
    ) {
      return { title: "Access Denied", detail, status: "denied" };
    }

    return { title: "Invalid QR", detail, status: "invalid" };
  }, []);

  const validateScan = useCallback(async (value = scanValue) => {
    const qrCredential = String(value || "").trim();
    if (!qrCredential) {
      setScanResult({
        title: "Invalid QR",
        detail: "Paste a QR token or start the camera scanner first.",
        status: "invalid"
      });
      return;
    }

    try {
      const result = await apiRequest("/api/scanner/validate", {
        method: "POST",
        body: JSON.stringify({
          qrToken: qrCredential,
          qrId: qrCredential,
          markUsed: true
        })
      });

      const attendeeDetail = result.attendee ? `${attendeeName(result.attendee)} / ${attendeeProm(result.attendee)}` : "Entry token validated.";
      setScanValue(qrCredential);
      setScanResult({
        title: result.valid ? "Access Granted" : "Access Denied",
        detail: result.message || result.reason || attendeeDetail,
        status: result.valid ? "active" : "denied"
      });
    } catch (requestError) {
      setScanValue(qrCredential);
      setScanResult(formatScannerError(requestError));
    }
  }, [formatScannerError, scanValue]);

  const readCameraFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });

    if (!scanningRef.current || !video || !canvas || !context) {
      return;
    }

    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth && video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });

      if (code?.data && code.data !== lastDetectedRef.current) {
        lastDetectedRef.current = code.data;
        setCameraMessage("QR detected. Validating access...");
        stopCamera();
        validateScan(code.data);
        return;
      }
    }

    scanLoopRef.current = window.requestAnimationFrame(readCameraFrame);
  }, [stopCamera, validateScan]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("unavailable");
      setCameraMessage("This device or browser does not support camera scanning. Use manual input below.");
      return;
    }

    stopCamera();
    lastDetectedRef.current = "";
    setScanResult(null);
    setCameraStatus("starting");
    setCameraMessage("Requesting camera permission...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      scanningRef.current = true;
      setCameraStatus("active");
      setCameraMessage("Camera live. Point the frame at an Eternum QR code.");
      scanLoopRef.current = window.requestAnimationFrame(readCameraFrame);
    } catch (cameraError) {
      const errorName = cameraError?.name || "";
      stopCamera();

      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        setCameraStatus("denied");
        setCameraMessage("Camera permission was denied. Enable camera access or use manual input below.");
      } else if (errorName === "NotFoundError" || errorName === "OverconstrainedError") {
        setCameraStatus("unavailable");
        setCameraMessage("No usable camera was found on this device. Use manual input below.");
      } else {
        setCameraStatus("error");
        setCameraMessage("Camera could not be started. Use manual input below.");
      }
    }
  }, [readCameraFrame, stopCamera]);

  useEffect(() => () => stopCamera(false), [stopCamera]);

  return (
    <AdminLayout>
      <AdminHeader eyebrow="ENTRY GATE" title="Scanner Page" badge={cameraStatus === "active" ? "CAMERA LIVE" : "READY"} />
      <section className="admin-panel scanner-panel">
        <div className={`camera-preview ${cameraStatus}`}>
          <video ref={videoRef} muted playsInline aria-label="Live QR scanner camera preview" />
          <canvas ref={canvasRef} aria-hidden="true" />
          <div className="camera-overlay">
            <div className="scan-frame"></div>
            <p>{cameraStatus === "active" ? "SCAN TO ENTER" : "ETERNUM CAMERA GATE"}</p>
          </div>
        </div>
        <p className={`camera-status ${cameraStatus}`}>{cameraMessage}</p>
        <div className="camera-actions">
          <button className="purple-btn" type="button" onClick={startCamera} disabled={cameraStatus === "starting" || cameraStatus === "active"}>
            {cameraStatus === "starting" ? "Opening Camera..." : "Start Camera"}
          </button>
          <button className="ghost-btn" type="button" onClick={stopCamera} disabled={cameraStatus !== "active" && cameraStatus !== "starting"}>Stop Camera</button>
        </div>
        <input className="scanner-manual-input" placeholder="Paste QR token or ALSHAYEB ID" value={scanValue} onChange={(event) => setScanValue(event.target.value)} />
        <div className="scanner-actions">
          <button className="purple-btn" type="button" onClick={() => validateScan()}>Validate Manual QR</button>
          <button className="ghost-btn" type="button" onClick={() => {
            setScanResult(null);
            setScanValue("");
          }}>Clear Result</button>
        </div>
        {scanResult && (
          <div className={`scan-result-card ${scanResult.status}`}>
            <h3>{scanResult.title}</h3>
            <p>{scanResult.detail}</p>
          </div>
        )}
      </section>
    </AdminLayout>
  );
}

function ExportPage() {
  const { data, loading, error } = useBackendData("/api/export/attendees", { attendees: [] });
  const exportAttendees = data.attendees || [];
  const exportRows = buildRegistrationExportRows(exportAttendees);
  const promCount = new Set(exportRows.map((row) => row.Prom)).size;

  return (
    <AdminLayout>
      <AdminHeader eyebrow="DATA EXPORT" title="Export Excel" badge={loading ? "LOADING MONGODB" : "LIVE MONGODB"} />
      <section className="admin-panel">
        {error && <div className="admin-empty-state">{error}</div>}
        <div className="admin-panel-title">
          <div>
            <h3>Registrations By Prom</h3>
            <p className="muted">Creates one workbook with one sheet per prom. Status stays inside each sheet.</p>
          </div>
          <span className="status-badge active">{promCount} PROM SHEETS</span>
        </div>

        <div className="export-summary-grid">
          <div>
            <span>WORKBOOK</span>
            <strong>alshayeb-registrations-by-prom.xlsx</strong>
          </div>
          <div>
            <span>REGISTRATIONS</span>
            <strong>{exportRows.length}</strong>
          </div>
          <div>
            <span>GROUPING</span>
            <strong>PROM NAME</strong>
          </div>
        </div>

        <button className="export-primary-btn" type="button" onClick={() => exportRegistrationsByProm(exportAttendees)} disabled={loading}>
          DOWNLOAD PROM WORKBOOK
        </button>
      </section>
    </AdminLayout>
  );
}

function SettingsPage() {
  const { data, loading, error, setData } = useBackendData("/api/admin/site-settings", {
    settings: { outcomerSelection: DEFAULT_OUTCOMER_SELECTION }
  });
  const [message, setMessage] = useState("");
  const selection = {
    ...DEFAULT_OUTCOMER_SELECTION,
    ...(data.settings?.outcomerSelection || {})
  };

  const updateSelectionField = (field, value) => {
    setMessage("");
    setData((prev) => ({
      ...prev,
      settings: {
        ...(prev.settings || {}),
        outcomerSelection: {
          ...selection,
          [field]: value
        }
      }
    }));
  };

  const saveSelectionNumbers = async () => {
    setMessage("");

    try {
      const result = await apiRequest("/api/admin/site-settings", {
        method: "PATCH",
        body: JSON.stringify({ outcomerSelection: selection })
      });
      setData(result);
      setMessage("Outcomer display numbers updated.");
    } catch (requestError) {
      setMessage(requestError.message || "Could not update display numbers.");
    }
  };

  return (
    <AdminLayout>
      <AdminHeader eyebrow="SYSTEM DEFAULTS" title="Settings" badge={loading ? "LOADING MONGODB" : "DISPLAY CONTROLS"} />
      <section className="admin-panel">
        {error && <div className="admin-empty-state">{error}</div>}
        <div className="admin-panel-title">
          <div>
            <h3>Outcomer Selection Display</h3>
            <p className="muted">Manual public display numbers. They are not calculated from MongoDB registrations.</p>
          </div>
        </div>
        <div className="settings-grid">
          <label><span>Approved Display Number</span><input type="number" min="0" value={selection.approved} onChange={(event) => updateSelectionField("approved", event.target.value)} /></label>
          <label><span>Pending Display Number</span><input type="number" min="0" value={selection.pending} onChange={(event) => updateSelectionField("pending", event.target.value)} /></label>
          <label><span>Declined Display Number</span><input type="number" min="0" value={selection.declined} onChange={(event) => updateSelectionField("declined", event.target.value)} /></label>
        </div>
        <button className="purple-btn settings-save" type="button" onClick={saveSelectionNumbers} disabled={loading}>SAVE DISPLAY NUMBERS</button>
        {message && <div className="admin-empty-state">{message}</div>}
      </section>
      <section className="admin-panel">
        <div className="settings-grid">
          <label><span>InstaPay Link</span><input defaultValue="https://instapay.example/alshayeb" /></label>
          <label><span>Default Registration Fee</span><input defaultValue="250 EGP" /></label>
          <label><span>QR Reveal Time</span><input defaultValue="2026-12-31T18:00:00" /></label>
          <label><span>Venue Name</span><input defaultValue="ALSHAYEB ETERNUM" /></label>
          <label><span>Event Background Image</span><input defaultValue="eternum-reference" /></label>
          <label><span>Registration Open / Closed</span><select defaultValue="Open"><option>Open</option><option>Closed</option></select></label>
        </div>
        <button className="purple-btn settings-save" type="button">SAVE SETTINGS LATER</button>
      </section>
    </AdminLayout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicWebsite />} />
        <Route path="/control" element={<AdminLogin />} />
        <Route
          path="/control/dashboard"
          element={
            <ProtectedAdminRoute>
              <AdminDashboard />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/control/events"
          element={
            <ProtectedAdminRoute>
              <EventsPage />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/control/attendees"
          element={
            <ProtectedAdminRoute>
              <AttendeesPage />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/control/outcomers"
          element={
            <ProtectedAdminRoute>
              <OutcomersPage />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/control/payments"
          element={
            <ProtectedAdminRoute>
              <PaymentsPage />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/control/scanner"
          element={
            <ProtectedAdminRoute>
              <ScannerPage />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/control/export"
          element={
            <ProtectedAdminRoute>
              <ExportPage />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/control/settings"
          element={
            <ProtectedAdminRoute>
              <SettingsPage />
            </ProtectedAdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
