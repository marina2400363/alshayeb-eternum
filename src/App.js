import React, { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "react-qr-code";
import { motion } from "framer-motion";
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import "./App.css";
import "./RoomsApp.css";
import RoomsApp from "./RoomsApp";
import AnimatedBackground from "./AnimatedBackground";

const LOCAL_API_URL = `http://${["127", "0", "0", "1"].join(".")}:5000`;
const CONFIGURED_API_URL = String(process.env.REACT_APP_API_URL || "").trim().replace(/\/$/, "");
const CONFIGURED_API_URL_IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(CONFIGURED_API_URL);
const BACKEND_API_URL = process.env.NODE_ENV === "production"
  ? (CONFIGURED_API_URL_IS_LOCAL ? "" : CONFIGURED_API_URL)
  : CONFIGURED_API_URL || LOCAL_API_URL;

const QR_REVEAL_TIME = "2026-12-31T18:00:00";
const ADMIN_SESSION_KEY = "alshayebAdminSession";

const DEFAULT_OUTCOMER_SELECTION = {
  approved: 2847,
  pending: 1024,
  declined: 376
};

const EXPORT_COLUMNS = [
  "Full Name",
  "Phone Number",
  "Email",
  "Gender",
  "School / Origin Prom",
  "Age",
  "Instagram Username",
  "Status",
  "Prom",
  "Amount",
  "Entry Time"
];

async function apiRequest(path, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const hasBody = options.body !== undefined && options.body !== null;
  const isJsonRequest = hasBody && !isFormData;

  // Attach JWT token for all /api/admin requests automatically
  // Also attach for /api/events if it's a mutating request (POST, PUT, DELETE)
  const isMutatingEvent = path.startsWith("/api/events") && options.method && options.method !== "GET";
  const isAdminPath = path.startsWith("/api/admin") || path.startsWith("/api/scanner") || path.startsWith("/api/export") || path.startsWith("/api/schools/admin") || path.startsWith("/api/sync") || isMutatingEvent;
  let adminToken = "";
  if (isAdminPath) {
    try {
      const session = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || "null");
      adminToken = session?.token || "";
    } catch { /* ignore */ }
  }

  let response;

  try {
    response = await fetch(`${BACKEND_API_URL}${path}`, {
      ...options,
      headers: {
        ...(isJsonRequest ? { "Content-Type": "application/json" } : {}),
        ...(adminToken ? { "Authorization": `Bearer ${adminToken}` } : {}),
        ...(options.headers || {})
      }
    });
  } catch (networkError) {
    const error = new Error("Could not reach the backend API. Please try again in a moment.");
    error.cause = networkError;
    throw error;
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(result.message || result.reason || "Backend request failed.");
    error.details = result.details;
    error.attendee = result.attendee;
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
  const entryUsed = !!(attendee.isUsed);
  return {
    id: attendee.id || attendee._id,
    requestId: attendee.requestId || attendee.qrId || attendee.id,
    name: attendeeName(attendee),
    phone: attendeePhone(attendee),
    email: attendee.email || "",
    gender: attendee.gender || "",
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
    // qrStatus uses isUsed (venue entry) — status never becomes "used" in the lifecycle
    qrStatus: entryUsed ? "Used" : attendee.qrToken || attendee.qrId ? "Active" : "Pending",
    qrToken: attendee.qrToken,
    qrId: attendee.qrId,
    event: attendeeProm(attendee),
    amount: attendee.event?.price ? `${attendee.event.price} EGP` : (attendee.amount || "TBA"),
    submittedAt: attendee.createdAt ? new Date(attendee.createdAt).toLocaleString() : "",
    paymentProof: attendee.paymentProof,
    outcomerPhoto: attendee.outcomerPhoto,
    // Venue entry fields — separate from lifecycle status
    isUsed: entryUsed,
    scannedAt: attendee.scannedAt ? new Date(attendee.scannedAt).toLocaleString() : null,
    scanCount: attendee.scanCount || 0
  };
}

const pageMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: "easeOut" }
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
      Gender: row.gender || "",
      "School / Origin Prom": row.schoolOrOriginProm || "",
      Age: row.age || "",
      "Instagram Username": row.instagramUsername || "",
      Status: row.status || row.paymentStatus || "",
      Prom: row.event,
      Amount: row.amount || "",
      "Entry Time": attendee.event?.entryTime || "TBA"
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
  if (!fee) return "TBA";
  if (typeof fee === "string") return fee;
  return `${fee.amount || 0} ${fee.currency || "EGP"}`;
}

function eventDateTimeValue(event) {
  const rawDateStr = event?.dateTime || event?.date;
  if (rawDateStr && event?.entryTime) {
    try {
      const d = new Date(rawDateStr);
      if (!isNaN(d.getTime())) {
        const [hours, minutes] = event.entryTime.split(':');
        d.setHours(parseInt(hours, 10) || 21, parseInt(minutes, 10) || 30, 0, 0);
        return d.toISOString();
      }
    } catch (e) {}
  }
  return rawDateStr || QR_REVEAL_TIME;
}

function formatCountdownUnit(value) {
  return String(value).padStart(2, "0");
}

const Shell = ({ children, tone = "blue", className = "" }) => {
  const shouldRenderAnimatedBackground = !className.includes("eternum-public-flow");

  return (
    <div className={`app-shell tone-${tone} ${className}`}>
      {shouldRenderAnimatedBackground && <AnimatedBackground />}
      <div className="cosmic-card tone-card">
        {children}
      </div>
    </div>
  );
};

const BackButton = ({ to = "home", onNavigate }) => (
  <button className="back-icon" onClick={() => onNavigate(to)} aria-label="Back">
    &larr;
  </button>
);


const EternumWordmark = ({ title = "ETERNUM", subtitle = "NO BEGINNING. NO END." }) => (
  <div className="eternum-wordmark-container">
    <div className="eternum-wordmark-alshayeb">ALSHAYEB</div>
    <div className="eternum-wordmark-eternum">{title}</div>
    {subtitle && <div className="eternum-wordmark-tagline">{subtitle}</div>}
  </div>
);

const BrandHeader = ({ title = "ETERNUM", subtitle = "NO BEGINNING. NO END." }) => (
  <div className="brand-header-wrapper">
    <div className="brand-header-logo-container">
      <img
        src={process.env.PUBLIC_URL + "/spade-reference.png"}
        alt="Eternum Spade"
        className="brand-header-spade-img"
        draggable="false"
      />
    </div>
    <div className="brand-header-typography">
      <EternumWordmark title={title} subtitle={subtitle} />
    </div>
  </div>
);

const HouseRulesGuard = ({ onAccept, onBack, buttonText = "VIEW MY TICKET" }) => {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="incomer-page-container rules-page-container">
      <div className="incomer-back-wrapper">
        <button onClick={onBack} aria-label="Go back" className="incomer-back-btn">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
      </div>
      <div className="rules-header">
        <div className="rules-brand-logo">ALSHAYEB</div>
        <h1 className="rules-title">HOUSE RULES</h1>
        <p className="rules-subtitle">
          <span className="rules-cyan">READ BEFORE YOU ENTER.</span><br/>
          Every destination has rules.<br/>
          These aren't restrictions. They're what protect the experience.
        </p>
      </div>
      <HouseRulesContent />
      <div className="rules-confirmation-action">
        <label className="eternum-checkbox-wrapper">
          <input 
            type="checkbox" 
            className="eternum-checkbox" 
            checked={agreed} 
            onChange={(e) => setAgreed(e.target.checked)} 
          />
          <span className="eternum-checkbox-custom">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
          <span className="eternum-checkbox-label">I UNDERSTAND THE RULES. LET ME IN.</span>
        </label>
        <button 
          className="eternum-button rules-confirm-btn" 
          disabled={!agreed}
          onClick={onAccept}
        >
          <span>{buttonText}</span>
          <b aria-hidden="true">&rarr;</b>
        </button>
      </div>
      <div className="rules-footer">
        <div className="rules-footer-title">FINAL NOTICE</div>
        <div className="rules-footer-text">
          <span>PROTECT THE EXPERIENCE.</span>
          <span className="rules-divider">|</span>
          <span>RESPECT EVERYONE.</span>
          <span className="rules-divider">|</span>
          <span className="rules-cyan">ALSHAYEB EXPERIENCE.</span>
        </div>
      </div>
    </div>
  );
};

const HouseRulesContent = () => (
  <div className="rules-list">
    <div className="rule-card">
      <div className="rule-num">01</div>
      <div className="rule-content">
        <h3>ENTRY</h3>
        <p>&#8226; Your QR code is personal. Sharing or transferring it ends your access.</p>
        <p>&#8226; ALSHAYEB team may request a valid ID for verification</p>
      </div>
    </div>
    <div className="rule-card">
      <div className="rule-num">02</div>
      <div className="rule-content">
        <h3>DOORS</h3>
        <p>&#8226; Doors open at 9:00 PM and close at 10:00 PM.</p>
        <p>&#8226; Arrive early. Great experiences don't wait for late arrivals.</p>
      </div>
    </div>
    <div className="rule-card">
      <div className="rule-num">03</div>
      <div className="rule-content">
        <h3>RE-ENTRY</h3>
        <p>&#8226; Re-entry is permitted only for guests wearing their official ALSHAYEB wristband.</p>
        <p>&#8226; Lost, removed, or damaged wristbands will void re-entry access.</p>
      </div>
    </div>
    <div className="rule-card">
      <div className="rule-num">04</div>
      <div className="rule-content">
        <h3>QR VALIDATION</h3>
        <p>Only QR codes accessed through the official ALSHAYEB website are accepted. Screenshots, copies, or duplicated QR codes are invalid.<br/>
        For security, your QR code will remain locked and automatically unlock only when you are near the venue entrance.</p>
      </div>
    </div>
    <div className="rule-card">
      <div className="rule-num">05</div>
      <div className="rule-content">
        <h3>SECURITY</h3>
        <p>&#8226; All guests are subject to security screening before entry.</p>
        <p>&#8226; Weapons, illegal items, laser devices, drones, professional cameras, and unauthorized recording equipment never make it inside.</p>
      </div>
    </div>
    <div className="rule-card">
      <div className="rule-num">06</div>
      <div className="rule-content">
        <h3>ALCOHOL &amp; DRUGS</h3>
        <p>&#8226; Illegal drugs and prohibited substances have no place here.</p>
        <p>&#8226; Alcohol is available only at events where ALSHAYEB officially permits it.</p>
      </div>
    </div>
    <div className="rule-card">
      <div className="rule-num">07</div>
      <div className="rule-content">
        <h3>RESPECT</h3>
        <p>&#8226; Respect isn't optional. It's the minimum requirement to stay.</p>
        <p>&#8226; Harassment, unwanted physical contact, violence, discrimination, or disruptive behavior ends your experience immediately.</p>
      </div>
    </div>
    <div className="rule-card">
      <div className="rule-num">08</div>
      <div className="rule-content">
        <h3>MEDIA</h3>
        <p>&#8226; Some moments deserve to be remembered.</p>
        <p>&#8226; By attending, you agree that photos and videos featuring you may be used by ALSHAYEB's media team</p>
      </div>
    </div>
    <div className="rule-card">
      <div className="rule-num">09</div>
      <div className="rule-content">
        <h3>RIGHT OF ADMISSION</h3>
        <p>&#8226; ALSHAYEB reserves the right to refuse entry or remove any guest to protect the experience and the safety of others.</p>
      </div>
    </div>
  </div>
);

const PublicShell = ({ children, backTo = "home", className = "", onNavigate }) => (
  <Shell tone="blue" className={`eternum-public-flow ${className}`}>
    <BackButton to={backTo} onNavigate={onNavigate} />
    {children}
  </Shell>
);

const PrimaryButton = ({ children, onClick, disabled, type = "button", className = "" }) => (
  <button type={type} className={`eternum-button ${className}`} onClick={onClick} disabled={disabled}>
    <span>{children}</span>
    <b aria-hidden="true">&rarr;</b>
  </button>
);

const PhoneInput = ({ value, onChange, error }) => (
  <div className={`eternum-phone ${error ? "error-input" : ""}`}>
    <span>+20</span>
    <input className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} type="text" placeholder="Enter your phone number" value={value} onChange={onChange} />
  </div>
);

const SelectionStats = ({ selection, className = "" }) => (
  <section className={`eternum-card selection-card ${className}`}>
    <h3>THE SELECTION</h3>
    <div className="selection-grid">
      <div><strong>{selection.approved}</strong><span>APPROVED</span></div>
      <div><strong>{selection.pending}</strong><span>PENDING</span></div>
      <div><strong>{selection.declined}</strong><span>DECLINED</span></div>
    </div>
  </section>
);

const StatusRow = ({ icon = "◇", label, value, note }) => (
  <div className="eternum-status-card">
    <span className="status-icon" aria-hidden="true">{icon}</span>
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
      {note && <p>{note}</p>}
    </div>
  </div>
);

const TextInputCard = ({ icon, label, error, children }) => (
  <div className={`eternum-input-card ${error ? "has-error" : ""}`}>
    <span className="input-icon" aria-hidden="true">{icon}</span>
    <span className="input-copy">
      <small>{label}</small>
      {children}
    </span>
  </div>
);

/* ---- Starfield data: fixed so it doesn't re-randomize on every render ---- */
const ELS_STARS = Array.from({ length: 55 }, (_, i) => ({
  id: i,
  top:  `${(i * 37 + 11) % 100}%`,
  left: `${(i * 61 + 7)  % 100}%`,
  size: (i % 3 === 0) ? 2 : (i % 3 === 1) ? 1.5 : 1,
  dur:  `${2.5 + (i % 7) * 0.6}s`,
  delay: `${(i % 5) * 0.4}s`,
}));

function EternumLoadingScreen({ visible }) {
  const [pct, setPct] = useState(5);
  const [exiting, setExiting] = useState(false);
  const pctRef = useRef(5);
  const timerRef = useRef(null);

  /* Fake progress ticker */
  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setPct(prev => {
        const ceiling = visible ? 92 : 100;
        if (prev >= ceiling) {
          window.clearInterval(timerRef.current);
          return ceiling;
        }
        /* Slow down as it approaches the ceiling */
        const step = Math.max(0.4, (ceiling - prev) * 0.035);
        const next = Math.min(prev + step, ceiling);
        pctRef.current = next;
        return next;
      });
    }, 80);

    return () => window.clearInterval(timerRef.current);
  }, [visible]);

  /* When real load finishes, sprint to 100 then trigger exit fade */
  useEffect(() => {
    if (!visible) {
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setPct(prev => {
          if (prev >= 100) {
            window.clearInterval(timerRef.current);
            setExiting(true);
            return 100;
          }
          return Math.min(prev + 3.5, 100);
        });
      }, 40);
    }
  }, [visible]);

  const cx = 160, cy = 160;
  const rings = [
    { r: 118, stroke: 'rgba(0,178,255,0.18)', dash: '0', dots: [0, 180],         dotR: 4.5, dotColor: '#00b2ff', dotGlow: '0 0 10px #00b2ff' },
    { r: 146, stroke: 'rgba(0,178,255,0.10)', dash: '5 8', dots: [60, 220, 310], dotR: 3,   dotColor: 'rgba(0,178,255,0.7)', dotGlow: '0 0 6px rgba(0,178,255,0.8)' },
    { r: 90,  stroke: 'rgba(0,178,255,0.12)', dash: '3 6', dots: [100, 270],     dotR: 2.5, dotColor: 'rgba(160,220,255,0.6)', dotGlow: '0 0 4px rgba(160,220,255,0.6)' },
  ];

  return (
    <div className={`els-overlay${exiting ? ' els-exiting' : ''}`} aria-live="polite" aria-label="Loading Eternum">
      {/* Starfield */}
      <div className="els-stars" aria-hidden="true">
        {ELS_STARS.map(s => (
          <span
            key={s.id}
            className="els-star"
            style={{ top: s.top, left: s.left, width: s.size, height: s.size, animationDuration: s.dur, animationDelay: s.delay }}
          />
        ))}
      </div>

      {/* Brand header */}
      <div className="els-brand">
        <BrandHeader />

        <div className="els-brand-divider" aria-hidden="true">
          <div className="els-brand-divider-line"/>
          <svg width="7" height="7" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 0.5L8.5 4.5L4.5 8.5L0.5 4.5Z" stroke="rgba(0,178,255,0.55)" strokeWidth="1" fill="none"/>
          </svg>
          <div className="els-brand-divider-line"/>
        </div>
      </div>

      {/* Orbit + Planet system */}
      <div className="els-orbit-system" aria-hidden="true">
        <svg className="els-orbit-svg" width="320" height="320" viewBox="0 0 320 320">
          <defs>
            <radialGradient id="els-planet-grad" cx="42%" cy="38%" r="60%">
              <stop offset="0%"   stopColor="#1a3a6a"/>
              <stop offset="40%"  stopColor="#0a1e42"/>
              <stop offset="100%" stopColor="#030c22"/>
            </radialGradient>
            <radialGradient id="els-planet-glow-outer-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="rgba(0,100,200,0.18)"/>
              <stop offset="100%" stopColor="rgba(0,100,200,0)"/>
            </radialGradient>
            <radialGradient id="els-planet-glow-inner-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="rgba(0,178,255,0.12)"/>
              <stop offset="100%" stopColor="rgba(0,178,255,0)"/>
            </radialGradient>
            <filter id="els-planet-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="6" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {/* Outer ambient glow */}
          <circle className="els-planet-glow-outer" cx={cx} cy={cy} r="130" fill="url(#els-planet-glow-outer-grad)"/>

          {/* Ring 1 — slow, solid */}
          <g className="els-ring-1">
            <ellipse cx={cx} cy={cy} rx={rings[0].r} ry={rings[0].r * 0.28}
              stroke={rings[0].stroke} strokeWidth="1" fill="none" strokeDasharray={rings[0].dash}/>
            {rings[0].dots.map(deg => {
              const rad = (deg * Math.PI) / 180;
              const dx = Math.cos(rad) * rings[0].r;
              const dy = Math.sin(rad) * rings[0].r * 0.28;
              return <circle key={deg} cx={cx + dx} cy={cy + dy} r={rings[0].dotR}
                fill={rings[0].dotColor} style={{filter:`drop-shadow(${rings[0].dotGlow})`}}/>;
            })}
          </g>

          {/* Ring 2 — mid speed, dashed */}
          <g className="els-ring-2">
            <ellipse cx={cx} cy={cy} rx={rings[1].r} ry={rings[1].r * 0.24}
              stroke={rings[1].stroke} strokeWidth="0.8" fill="none" strokeDasharray={rings[1].dash}/>
            {rings[1].dots.map(deg => {
              const rad = (deg * Math.PI) / 180;
              const dx = Math.cos(rad) * rings[1].r;
              const dy = Math.sin(rad) * rings[1].r * 0.24;
              return <circle key={deg} cx={cx + dx} cy={cy + dy} r={rings[1].dotR}
                fill={rings[1].dotColor} style={{filter:`drop-shadow(${rings[1].dotGlow})`}}/>;
            })}
          </g>

          {/* Ring 3 — reverse, inner */}
          <g className="els-ring-3">
            <ellipse cx={cx} cy={cy} rx={rings[2].r} ry={rings[2].r * 0.22}
              stroke={rings[2].stroke} strokeWidth="0.7" fill="none" strokeDasharray={rings[2].dash}/>
            {rings[2].dots.map(deg => {
              const rad = (deg * Math.PI) / 180;
              const dx = Math.cos(rad) * rings[2].r;
              const dy = Math.sin(rad) * rings[2].r * 0.22;
              return <circle key={deg} cx={cx + dx} cy={cy + dy} r={rings[2].dotR}
                fill={rings[2].dotColor} style={{filter:`drop-shadow(${rings[2].dotGlow})`}}/>;
            })}
          </g>

          {/* Planet body */}
          <circle cx={cx} cy={cy} r="72" fill="url(#els-planet-grad)" filter="url(#els-planet-shadow)"/>
          {/* Planet highlight */}
          <ellipse cx={cx - 14} cy={cy - 18} rx="22" ry="14" fill="rgba(255,255,255,0.04)"/>
          {/* Inner glow */}
          <circle className="els-planet-glow-inner" cx={cx} cy={cy} r="80" fill="url(#els-planet-glow-inner-grad)"/>
        </svg>

        {/* LOADING label centered in planet */}
        <p className="els-loading-label">LOADING</p>
      </div>

      {/* Progress section */}
      <div className="els-progress-section">
        <p className="els-preparing-label">PREPARING YOUR EXPERIENCE</p>
        <div className="els-progress-bar-track">
          <div className="els-progress-bar-fill" style={{ width: `${pct}%` }}/>
        </div>
        <p className="els-progress-pct">{Math.round(pct)}%</p>
      </div>

      {/* Feature cards */}
      <div className="els-features">
        {[
          {
            title: 'SECURE',
            desc: 'Your data is protected',
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path><line x1="11" y1="11" x2="11" y2="21"></line><line x1="8" y1="16" x2="14" y2="16"></line><line x1="13.8" y1="5.8" x2="20" y2="2"></line><polyline points="15 2 20 2 20 7"></polyline></svg>
            )
          },
          {
            title: 'PRIVATE',
            desc: 'Your journey stays private',
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.75)" strokeWidth="1.3" strokeLinecap="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M2 12C4 7,9 4,12 4s8 3,10 8c-2 5-7 8-10 8S4 17,2 12z"/>
                <line x1="3" y1="3" x2="21" y2="21" strokeOpacity="0.35"/>
              </svg>
            )
          },
          {
            title: 'SEAMLESS',
            desc: 'Built for a smooth experience',
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.75)" strokeWidth="1.3" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="3"/>
                <line x1="12" y1="2" x2="12" y2="9"/>
                <line x1="12" y1="15" x2="12" y2="22"/>
              </svg>
            )
          },
          {
            title: 'ETERNAL',
            desc: 'Designed to inspire',
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.75)" strokeWidth="1.3" strokeLinecap="round">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
              </svg>
            )
          },
        ].map(f => (
          <div key={f.title} className="els-feature">
            <div className="els-feature-icon">{f.icon}</div>
            <p className="els-feature-title">{f.title}</p>
            <p className="els-feature-desc">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="els-footer">
        <div className="els-footer-line">
          <svg width="5" height="5" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5L8.5 4.5L4.5 8.5L0.5 4.5Z" stroke="rgba(0,178,255,0.4)" strokeWidth="1" fill="none"/></svg>
          <p className="els-footer-text">YOUR JOURNEY. SECURE. PRIVATE. ETERNAL.</p>
          <svg width="5" height="5" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5L8.5 4.5L4.5 8.5L0.5 4.5Z" stroke="rgba(0,178,255,0.4)" strokeWidth="1" fill="none"/></svg>
        </div>
        <p className="els-footer-brand">ALSHAYEB EXPERIENCE</p>
      </footer>
    </div>
  );
}

function PublicWebsite() {
  const [phone, setPhone] = useState("");
  const [foundClient, setFoundClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /* showLoader stays true for at least MIN_LOAD_MS after loading starts,
     preventing the screen from flashing away too quickly */
  const MIN_LOAD_MS = 1800;
  const loadStartRef = useRef(Date.now());
  const [showLoader, setShowLoader] = useState(true);

  /* When loading flips false, enforce the minimum display duration */
  useEffect(() => {
    if (!loading) {
      const elapsed = Date.now() - loadStartRef.current;
      const remaining = Math.max(0, MIN_LOAD_MS - elapsed);
      const t = window.setTimeout(() => setShowLoader(false), remaining);
      return () => window.clearTimeout(t);
    }
  }, [loading]);

  const [page, setPageState] = useState(() => {
    if (typeof window === "undefined") return "home";
    const params = new URLSearchParams(window.location.search);
    const urlPage = params.get("page");
    if (urlPage) return urlPage;
    return window.history.state?.eternumPage || "home";
  });
  const pageRef = useRef(page);

  const isBrowserHistoryNavigation = useRef(false);
  const [errors, setErrors] = useState({});
  const [liveEvents, setLiveEvents] = useState([]);

  const [selectedEvent, setSelectedEvent] = useState({});
  const [outcomerSelection, setOutcomerSelection] = useState(DEFAULT_OUTCOMER_SELECTION);
  const [guestListCount, setGuestListCount] = useState(137);
  const [globalInstapayLink, setGlobalInstapayLink] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [guests, setGuests] = useState([]);
  const [eventsError, setEventsError] = useState("");
  const [trackedRegistration, setTrackedRegistration] = useState(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  const [request, setRequest] = useState({
    fullName: "",
    phoneNumber: "",
    email: "",
    gender: "",
    schoolOrOriginProm: "",
    age: "",
    instagramUsername: "",
    screenshot: null,
    screenshotFile: null
  });

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const setPage = useCallback((nextPage, options = {}) => {
    if (!nextPage) return;

    setPageState((currentPage) => {
      if (currentPage === nextPage) return currentPage;

      if (!isBrowserHistoryNavigation.current && typeof window !== "undefined") {
        const currentState = window.history.state || {};
        const nextState = {
          ...currentState,
          eternumPage: nextPage
        };

        if (options.replace) {
          window.history.replaceState(nextState, "", window.location.href);
        } else {
          window.history.pushState(nextState, "", window.location.href);
        }
      }

      return nextPage;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const currentState = window.history.state || {};
    if (!currentState.eternumPage) {
      window.history.replaceState(
        {
          ...currentState,
          eternumPage: pageRef.current
        },
        "",
        window.location.href
      );
    }

    const handlePopState = (event) => {
      isBrowserHistoryNavigation.current = true;
      setPageState(event.state?.eternumPage || "home");
      window.setTimeout(() => {
        isBrowserHistoryNavigation.current = false;
      }, 0);
    };

    const handleForceGoHome = () => {
      setPage("home");
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("forceGoHome", handleForceGoHome);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("forceGoHome", handleForceGoHome);
    };
  }, []);

  const cleanValue = (value) => String(value || "").replace(/\s/g, "").replace(/'/g, "").trim();
  const safeValue = (value, fallback = "Not available") => {
    const text = String(value ?? "").trim();
    return text || fallback;
  };
  const displayEvents = liveEvents;
  const findPromEvent = (promName) => {
    const normalizedProm = String(promName || "").trim().toLowerCase();
    return displayEvents.find((event) => String(event.name || "").trim().toLowerCase() === normalizedProm) || selectedEvent;
  };
  const toTicketClient = (attendee) => {
    const promEvent = findPromEvent(attendee.eventName || attendee.event || attendee.Venue);
    return {
      ...attendee,
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

    apiRequest("/api/attendees/public-list")
      .then((result) => {
        setGuests(result.attendees || []);
        setLoading(false);
      })
      .catch((error) => {
        console.log("Attendee connectivity check failed:", error);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  useEffect(() => {
    apiRequest("/api/events")
      .then((result) => {
        setEventsError("");
        const backendEvents = Array.isArray(result.events) && result.events.length
          ? result.events.map((event) => ({
              id: event._id || event.id || event.slug,
              name: event.name,
              date: event.date ? new Date(event.date).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" }).toUpperCase() : "DATE TBA",
              dateTime: event.date || QR_REVEAL_TIME,
              entryTime: event.entryTime || "21:30",
              price: event.price || 1800,
              fee: event.price ? `${event.price} EGP` : "1800 EGP",
              venue: event.venue || "ALSHAYEB ETERNUM",
              status: event.status || "available",
              schools: event.schools || [],
              displayOrder: event.displayOrder,
              instapayLink: event.instapayLink,
              bannerImageUrl: event.bannerImageUrl,
              eventTypeLabel: event.eventTypeLabel,
              tagline: event.tagline,
              description: event.description
            }))
          : [];
        setLiveEvents(backendEvents);
        setSelectedEvent((current) => backendEvents.find((event) => event.name === current.name) || backendEvents[0] || current);
      })
      .catch((error) => {
        console.log("Event load failed:", error);
        setLiveEvents([]);
        if (error.status === 401) {
          setEventsError("Authentication required to fetch events. Please contact support.");
        } else {
          setEventsError("Failed to fetch events from the server.");
        }
      });

    // outcomerSelection is now fetched from /api/settings/public below

    apiRequest("/api/settings/public")
      .then((result) => {
        const displayCount = Number(result.guestListDisplayCount);
        if (Number.isFinite(displayCount) && displayCount >= 0) {
          setGuestListCount(Math.floor(displayCount));
        }
        if (result.instapayLink) {
          setGlobalInstapayLink(result.instapayLink);
        }
        if (result.outcomerSelection) {
          setOutcomerSelection({
            ...DEFAULT_OUTCOMER_SELECTION,
            ...result.outcomerSelection
          });
        }
      })
      .catch((error) => {
        console.log("Public settings load failed:", error);
        setGuestListCount(137);
      });


  }, []);

  useEffect(() => {
    if (page !== "ticket") return undefined;

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [page]);

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
    setErrors((prev) => ({ ...prev, phoneSearch: "" }));

    let expectedType = undefined;
    if (page === "guestList") expectedType = "guest";
    else if (page === "incomer") expectedType = "incomer";

    const existing = await lookupBackendRegistration(phone, { errorField: "phoneSearch", expectedType });
    setLoading(false);

    if (existing?.failed) return;

    // Guest list: NEVER route to ticket — handle entirely within this page
    if (page === "guestList") {
      if (existing) {
        setFoundClient(existing.data ? existing.data : existing);
      } else {
        setFoundClient(null);
        setErrors((prev) => ({ ...prev, phoneSearch: "Your number is not registered on this Guest List." }));
      }
      return;
    }

    if (existing && routeExistingRegistration(existing)) return;

    setFoundClient(null);
    setErrors((prev) => ({ ...prev, phoneSearch: "" }));
    setPage("notfound");
  };

  const handleTrackLookup = async () => {
    if (loading) return;
    if (!validatePhoneSearch()) return;

    setLoading(true);
    setErrors((prev) => ({ ...prev, phoneSearch: "" }));
    const existing = await lookupBackendRegistration(phone, { errorField: "phoneSearch", expectedType: "outcomer" });
    setLoading(false);

    if (existing?.failed) return;

    if (!existing) {
      setTrackedRegistration(null);
      setFoundClient(null);
      setErrors({});
      setPage("notfound");
      return;
    }

    const normalizedStatus = String(existing.status || "").toLowerCase();
    if (normalizedStatus.includes("approved") || normalizedStatus.includes("confirmed") || normalizedStatus.includes("active") || normalizedStatus.includes("verified")) {
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
    const fullName = String(request.fullName ?? "").trim();
    const phoneNumber = cleanValue(String(request.phoneNumber ?? ""));
    const email = String(request.email ?? "").trim();
    const gender = String(request.gender ?? "").trim();
    const schoolOrOriginProm = String(request.schoolOrOriginProm ?? "").trim();
    const ageValue = String(request.age ?? "").trim();
    const instagramUsername = String(request.instagramUsername ?? "").trim();

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

    if (!gender) {
      newErrors.gender = "Gender is required.";
    }

    if (!schoolOrOriginProm) {
      newErrors.schoolOrOriginProm = "School / Origin Prom is required.";
    }

    if (!ageValue) {
      newErrors.age = "Age is required.";
    } else if (!/^\d+$/.test(ageValue) || Number(ageValue) < 16 || Number(ageValue) > 30) {
      newErrors.age = "Age must be a number between 16 and 30.";
    }

    if (!instagramUsername) {
      newErrors.instagramUsername = "Instagram username is required.";
    } else if (/\s/.test(instagramUsername)) {
      newErrors.instagramUsername = "Instagram username cannot contain spaces.";
    }

    if (!request.outcomerPhotoFile) {
      newErrors.outcomerPhoto = "Personal photo is required.";
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

  const handleOutcomerPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.type)) {
      setErrors((prev) => ({ ...prev, outcomerPhoto: "Only PNG, JPG, or JPEG images are allowed." }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, outcomerPhoto: "Personal photo must be 5MB or smaller." }));
      return;
    }

    const url = URL.createObjectURL(file);
    setRequest((prev) => ({ ...prev, outcomerPhoto: url, outcomerPhotoFile: file }));
    setErrors((prev) => ({ ...prev, outcomerPhoto: "" }));
  };

  const handleScreenshotUpload = async (e) => {
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

    if (file.size > 10 * 1024 * 1024) {
      setRequest((prev) => ({ ...prev, screenshot: null, screenshotFile: null }));
      setErrors((prev) => ({ ...prev, screenshot: "Payment screenshot must be 10MB or smaller." }));
      return;
    }

    // --- Client-side compression ---
    try {
      const compressedBlob = await new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const MAX_W = 1000;
          let { width, height } = img;
          if (width > MAX_W) {
            height = Math.round((height * MAX_W) / width);
            width = MAX_W;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
            "image/jpeg",
            0.6
          );
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
        img.src = objectUrl;
      });

      const compressedFile = new File([compressedBlob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      setRequest((prev) => ({ ...prev, screenshot: file.name, screenshotFile: compressedFile }));
      setErrors((prev) => ({ ...prev, screenshot: "" }));
    } catch {
      // Fallback: use original file if compression fails
      setRequest((prev) => ({ ...prev, screenshot: file.name, screenshotFile: file }));
      setErrors((prev) => ({ ...prev, screenshot: "" }));
    }
  };

  const findExistingRegistration = (phoneNumber) => lookupBackendRegistration(phoneNumber);

  const routeExistingRegistration = (existing) => {
    const normalizedStatus = String(existing?.status || "").toLowerCase();

    if (normalizedStatus.includes("approved") || normalizedStatus.includes("confirmed") || normalizedStatus.includes("active") || normalizedStatus.includes("verified")) {
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

      if (existing.data.paymentStatus === "pending" && !existing.data.paymentProof) {
        const foundEvent = liveEvents.find(e => e.name === existing.data.eventName || e._id === existing.data.event || e.id === existing.data.event);
        if (foundEvent) setSelectedEvent(foundEvent);
        setPage("payment");
        return true;
      }

      setPage("track");
      return true;
    }

    return false;
  };

  const lookupBackendRegistration = async (phoneNumber, options = {}) => {
    const { errorField = "home", quiet = false, expectedType } = options;

    try {
      let url = `/api/attendees/lookup?phone=${encodeURIComponent(cleanValue(phoneNumber))}`;
      if (expectedType) {
        url += `&type=${encodeURIComponent(expectedType)}`;
      }
      const result = await apiRequest(url);
      if (!result?.found || !result.attendee) return null;
      return {
        source: "backend",
        status: result.attendee.status || result.attendee.applicationStatus,
        data: result.attendee
      };
    } catch (error) {
      console.log("Backend lookup failed:", error);
      if (!quiet) {
        setErrors((prev) => ({
          ...prev,
          [errorField]: "Could not reach the server. Please try again."
        }));
        return { failed: true };
      }
      return null;
    }
  };

  useEffect(() => {
    if (page !== "track") return undefined;

    const phoneForLookup = cleanValue(
      trackedRegistration?.phoneNumber ||
      trackedRegistration?.phone ||
      request.phoneNumber ||
      phone
    );

    if (!phoneForLookup) return undefined;

    let cancelled = false;

    const refreshTrackingStatus = async () => {
      const existing = await lookupBackendRegistration(phoneForLookup, { quiet: true, expectedType: "outcomer" });
      if (cancelled || !existing?.data) return;

      const normalizedStatus = String(existing.status || existing.data.status || existing.data.applicationStatus || "").toLowerCase();

      if (normalizedStatus.includes("approved") || normalizedStatus.includes("confirmed") || normalizedStatus.includes("active") || normalizedStatus.includes("verified")) {
        setFoundClient(toTicketClient(existing.data));
        setTrackedRegistration(existing.data);
        setRequest((prev) => ({ ...prev, ...existing.data }));
        setErrors({});
        setPage("ticket");
        return;
      }

      setTrackedRegistration(existing.data);
      setRequest((prev) => ({ ...prev, ...existing.data }));
      setErrors({});

      if (normalizedStatus.includes("reject") || normalizedStatus.includes("declined")) {
        setPage("rejected");
      }
    };

    refreshTrackingStatus();
    const timer = window.setInterval(refreshTrackingStatus, 5000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshTrackingStatus();
      }
    };

    window.addEventListener("focus", refreshTrackingStatus);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshTrackingStatus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  // The lookup helpers are intentionally omitted so this polling effect does not
  // restart on every render while the user is waiting on the tracking page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, trackedRegistration, request.phoneNumber, phone]);

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
          submit: error.message || "Could not save this registration. Please make sure the backend server is running."
        }));
      }
      return null;
    }
  };

  const handlePrePaymentRules = () => {
    if (isSubmitting) return;
    if (!validateRegistration()) return;
    setPage("prePaymentRules");
  };

  const goToPayment = async () => {
    if (isSubmitting) return;
    if (!validateRegistration()) return;

    setIsSubmitting(true);
    setErrors({});

    const formData = new FormData();
    formData.append("fullName", request.fullName);
    formData.append("phoneNumber", request.phoneNumber);
    formData.append("email", request.email);
    formData.append("gender", request.gender);
    formData.append("schoolOrOriginProm", request.schoolOrOriginProm);
    formData.append("age", request.age);
    formData.append("instagramUsername", request.instagramUsername);
    formData.append("eventName", selectedEvent.name);
    if (selectedEvent.id) formData.append("eventId", selectedEvent.id);
    if (request.outcomerPhotoFile) formData.append("outcomerPhoto", request.outcomerPhotoFile);

    const backendResult = await submitBackendOutcomer(formData);
    setIsSubmitting(false);

    if (backendResult?.duplicate && backendResult?.attendee) {
      routeExistingRegistration({
        source: "backend",
        status: backendResult.attendee.status || backendResult.attendee.applicationStatus,
        data: backendResult.attendee
      });
      return;
    }

    setTrackedRegistration(backendResult.attendee);
    setRequest((prev) => ({
      ...prev,
      ...backendResult.attendee,
      requestId: backendResult.attendee?.id || prev.requestId
    }));
    setPage("payment");
  };

  const submitRequest = async () => {
    if (isSubmitting) return;
    if (!validateScreenshot()) return;

    setIsSubmitting(true);
    setErrors({});

    const formData = new FormData();
    const actualId = trackedRegistration?._id || trackedRegistration?.id || request?._id || request?.id || request?.requestId;
    
    if (!actualId) {
      setIsSubmitting(false);
      setErrors({ screenshot: "Session expired. Please search your phone number in the Home page to continue." });
      return;
    }

    formData.append("attendeeId", actualId);
    formData.append("paymentProof", request.screenshotFile);

    try {
      const backendResult = await apiRequest("/api/outcomers/payment-proof", {
        method: "POST",
        body: formData
      });
      setIsSubmitting(false);

      if (backendResult?.attendee) {
        setTrackedRegistration(backendResult.attendee);
        setRequest((prev) => ({ ...prev, ...backendResult.attendee }));
      }
      setPage("submitted");
    } catch (err) {
      setIsSubmitting(false);
      setErrors({ screenshot: err.message || "Failed to upload payment proof. Please try again." });
    }
  };

  const FieldError = ({ name }) => {
    if (!errors[name]) return null;
    return <p className="field-error">{errors[name]}</p>;
  };

  /* ---- Global public loading screen — blocks all public content ---- */
  if (showLoader) {
    return <EternumLoadingScreen visible={loading} />;
  }

  if (page === "notfound") {
    return (
      <div className="incomer-page-container">
        <BrandHeader />

        <div className="incomer-welcome-box">
          <h2>ACCESS NOT FOUND</h2>
          <p>No incoming access was found for this phone number.</p>
          <p style={{ marginTop: '16px', color: 'rgba(255, 255, 255, 0.45)' }}>
            Please contact your assigned committee member for assistance.
          </p>
        </div>
        
        <div style={{ width: '100%', maxWidth: '320px', margin: '24px auto 0', display: 'flex' }}>
          <button type="button" className="incomer-continue-btn" onClick={() => setPage('incomer')} style={{ width: '100%' }}>
            <div style={{ width: '18px', flexShrink: 0 }} />
            <span>GO BACK</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(180deg)' }}>
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  if (page === "outcomerLanding") {
    return (
      <div className="outcomer-landing-container">
        {/* BACK ARROW */}
        <div className="outcomer-back-wrapper">
          <button
            onClick={() => setPage('home')}
            aria-label="Go back"
            className="outcomer-back-btn"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>

        <BrandHeader />

        {/* DIAMOND DIVIDER UPPER */}
        <div className="outcomer-diamond-divider">
          <div className="outcomer-diamond-line-left" />
          <svg width="7" height="7" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.65)" strokeWidth="1" fill="none" />
          </svg>
          <div className="outcomer-diamond-line-right" />
        </div>

        {/* THE SEEKERS HEADING */}
        <div className="outcomer-welcome-box">
          <h2>THE SEEKERS</h2>
          <p>Not everyone is chosen.<br />Request access to earn the experience.</p>
        </div>

        {/* THE SELECTION CARD */}
        <div className="outcomer-selection-card">
          <div className="outcomer-selection-title">THE SELECTION</div>
          <div className="outcomer-selection-grid">
            <div className="outcomer-stat-col">
              <span className="outcomer-stat-number">{outcomerSelection.approved}</span>
              <svg width="5" height="5" viewBox="0 0 9 9" fill="none" className="outcomer-tiny-diamond"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.8)" strokeWidth="1" fill="none" /></svg>
              <span className="outcomer-stat-label">APPROVED</span>
            </div>
            <div className="outcomer-stat-divider" />
            <div className="outcomer-stat-col">
              <span className="outcomer-stat-number">{outcomerSelection.pending}</span>
              <svg width="5" height="5" viewBox="0 0 9 9" fill="none" className="outcomer-tiny-diamond"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.8)" strokeWidth="1" fill="none" /></svg>
              <span className="outcomer-stat-label">PENDING</span>
            </div>
            <div className="outcomer-stat-divider" />
            <div className="outcomer-stat-col">
              <span className="outcomer-stat-number">{outcomerSelection.declined}</span>
              <svg width="5" height="5" viewBox="0 0 9 9" fill="none" className="outcomer-tiny-diamond"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.8)" strokeWidth="1" fill="none" /></svg>
              <span className="outcomer-stat-label">DECLINED</span>
            </div>
          </div>
        </div>

        {/* ACTION CARDS */}
        <div className="outcomer-action-list">
          <button type="button" className="outcomer-action-card" onClick={() => setPage("chooseEvent")}>
            <div className="outcomer-action-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <div className="outcomer-action-text">
              <h3>REGISTER</h3>
              <p>Begin your application to join Eternum.</p>
            </div>
            <div className="outcomer-action-arrow">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </button>

          <button type="button" className="outcomer-action-card" onClick={() => setPage("alreadyRegistered")}>
            <div className="outcomer-action-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <polyline points="16 11 18 13 22 9"></polyline>
              </svg>
            </div>
            <div className="outcomer-action-text">
              <h3>ALREADY REGISTERED</h3>
              <p>Get your QR Code and access your pass.</p>
            </div>
            <div className="outcomer-action-arrow">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </button>

          <button type="button" className="outcomer-action-card" onClick={() => setPage("trackLookup")}>
            <div className="outcomer-action-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <div className="outcomer-action-text">
              <h3>TRACK YOUR REQUEST</h3>
              <p>Check your application status and committee updates.</p>
            </div>
            <div className="outcomer-action-arrow">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </button>
        </div>

        {/* FOOTER */}
        <footer className="outcomer-footer">
          <div className="outcomer-footer-line">
            <svg width="5" height="5" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.6)" strokeWidth="1" fill="none" /></svg>
            <span>YOUR JOURNEY. SECURE. PRIVATE. ETERNAL.</span>
            <svg width="5" height="5" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.6)" strokeWidth="1" fill="none" /></svg>
          </div>
          <div className="outcomer-footer-brand">ALSHAYEB EXPERIENCE</div>
        </footer>
      </div>
    );
  }

  if (page === "alreadyRegistered" || page === "trackLookup") {
    const isTrackLookup = page === "trackLookup";

    const handleLookupSubmit = async () => {
      if (loading) return;
      if (!validatePhoneSearch()) return;

      setLoading(true);
      setErrors((prev) => ({ ...prev, phoneSearch: "" }));
      const existing = await lookupBackendRegistration(phone, { errorField: "phoneSearch", expectedType: "outcomer" });
      setLoading(false);

      if (existing?.failed) return;

      if (isTrackLookup) {
        if (!existing) {
          setLookupFailed(true);
          return;
        }
        const normalizedStatus = String(existing.status || "").toLowerCase();
        if (normalizedStatus.includes("approved") || normalizedStatus.includes("confirmed") || normalizedStatus.includes("active") || normalizedStatus.includes("verified")) {
          setFoundClient(toTicketClient(existing.data));
          setErrors({});
          setPage("ticket");
          return;
        }
        setTrackedRegistration(existing.data);
        setRequest((prev) => ({ ...prev, ...existing.data }));
        setErrors({});
        setPage(normalizedStatus.includes("reject") || normalizedStatus.includes("declined") ? "rejected" : "track");
      } else {
        if (existing && routeExistingRegistration(existing)) return;
        setLookupFailed(true);
      }
    };

    return (
      <div className="outcomer-landing-container arp-page">
        {/* Back arrow */}
        <div className="outcomer-back-wrapper">
          <button className="outcomer-back-btn" onClick={() => { setLookupFailed(false); setPage("outcomerLanding"); }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
        </div>

        <BrandHeader />

        {/* Title + subtitle */}
        <div className="outcomer-destination-header">
          <div className="outcomer-diamond-divider small">
            <svg width="7" height="7" viewBox="0 0 9 9" fill="none">
              <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.65)" strokeWidth="1" fill="none" />
            </svg>
          </div>
          <h2>{isTrackLookup ? "ACCESS YOUR APPLICATION" : "ACCESS YOUR PASS"}</h2>
          <p>
            {isTrackLookup
              ? <>Enter your phone number<br/>to access your application and track its status.</>
              : <>Enter your phone number<br/>to open your universal ticket.</>
            }
          </p>
        </div>

        {/* Phone input */}
        <div className="arp-field">
          <label className="arp-label">PHONE NUMBER</label>
          <div className={`arp-input-card ${errors.phoneSearch ? 'arp-input-error' : ''}`}>
            <div className="arp-country">
              <span className="arp-country-code">+20</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div className="arp-input-div"/>
            <input
                className="arp-phone-input eternum-input"
                type="tel"
              placeholder="Enter your phone number"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setErrors((prev) => ({ ...prev, phoneSearch: "" }));
                setLookupFailed(false);
              }}
            />
          </div>
          {errors.phoneSearch && <p className="arp-error">{errors.phoneSearch}</p>}
        </div>

        {/* Continue button */}
        <button className="arp-continue-btn" onClick={handleLookupSubmit} disabled={loading}>
          <span>{loading ? "LOADING" : "CONTINUE"}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>

        {/* APPLICATION NOT FOUND — only after failed lookup */}
        {lookupFailed && (
          <>
            <div className="pay-divider-row" style={{maxWidth:'320px', margin:'22px auto 14px'}}>
              <div className="pay-divider-line"/>
              <svg width="7" height="7" viewBox="0 0 9 9" fill="none">
                <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.5)" strokeWidth="1" fill="none"/>
              </svg>
              <div className="pay-divider-line"/>
            </div>
            <div className="arp-notfound-card">
              <div className="arp-notfound-icon">
                <svg width="34" height="34" viewBox="0 0 40 40" fill="none">
                  <rect x="8" y="4" width="24" height="36" rx="3" stroke="rgba(0,178,255,0.5)" strokeWidth="1.2" fill="none"/>
                  <line x1="8" y1="8" x2="14" y2="8" stroke="rgba(0,178,255,0.3)" strokeWidth="1"/>
                  <line x1="8" y1="34" x2="14" y2="34" stroke="rgba(0,178,255,0.3)" strokeWidth="1"/>
                  <circle cx="20" cy="22" r="5" stroke="rgba(0,178,255,0.6)" strokeWidth="1.2" fill="none"/>
                  <line x1="20" y1="19.5" x2="20" y2="23" stroke="rgba(0,178,255,0.6)" strokeWidth="1.2" strokeLinecap="round"/>
                  <circle cx="20" cy="25" r="0.6" fill="rgba(0,178,255,0.6)"/>
                </svg>
              </div>
              <div className="arp-notfound-body">
                <p className="arp-notfound-title">APPLICATION NOT FOUND</p>
                <p className="arp-notfound-desc">No application was found<br/>with this phone number.</p>
                <button className="arp-register-link" onClick={() => { setLookupFailed(false); setPage("chooseEvent"); }}>
                  REGISTER NOW <span>→</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (page === "chooseEvent") {
    return (
      <div className="outcomer-landing-container outcomer-destinations-container">
        {/* BACK ARROW */}
        <div className="outcomer-back-wrapper">
          <button
            onClick={() => setPage('outcomerLanding')}
            aria-label="Go back"
            className="outcomer-back-btn"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>

        <BrandHeader />

        <div className="outcomer-destination-header">
          <div className="outcomer-diamond-divider small">
            <svg width="7" height="7" viewBox="0 0 9 9" fill="none">
              <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.65)" strokeWidth="1" fill="none" />
            </svg>
          </div>
          <h2>SELECT YOUR DESTINATION</h2>
          <p>Choose the experience<br/>you wish to request access to.</p>
        </div>

        <div className="premium-event-list">
          {displayEvents.map((event, index) => {
            const rawStatus = (event.status || "AVAILABLE").toUpperCase();
            const isSoldOut = rawStatus === "SOLD_OUT" || rawStatus === "SOLD OUT";
            const isUnavailable = rawStatus === "CLOSED" || rawStatus === "UNAVAILABLE" || rawStatus === "NOT AVAILABLE";
            const isAvailable = !isSoldOut && !isUnavailable;
            const displayStatus = isSoldOut ? "Sold Out" : isUnavailable ? "Not Available" : "Available";

            return (
              <div key={event.id} className={`premium-event-card ${!isAvailable ? 'disabled' : ''}`}>
                <div className="premium-event-image-container">
                  <div className={`premium-event-status-badge ${!isAvailable ? 'unavailable' : ''}`}>
                    {displayStatus}
                  </div>
                  <img 
                    src={event.bannerImageUrl || "/homepage-background-spade.png"} 
                    alt={event.name} 
                    className="premium-event-banner" 
                  />
                </div>
                <div className="premium-event-details">
                  <div className="premium-event-header">
                    <span className="premium-event-number">{String(event.displayOrder && event.displayOrder !== 999 ? event.displayOrder : index + 1).padStart(2, "0")}</span>
                    <span className="premium-event-prom-badge">{event.eventTypeLabel || "PROM"}</span>
                  </div>
                  <h3 className="premium-event-title">{event.name}</h3>
                  {event.tagline && <p className="premium-event-tagline">{event.tagline}</p>}
                  {event.description && <p className="premium-event-desc">{event.description}</p>}
                  
                  <div className="premium-event-divider"></div>
                  
                  <div className="premium-event-meta">
                    <div className="premium-event-meta-row">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                      <span>{event.date || "TBD"}</span>
                    </div>
                    <div className="premium-event-meta-row">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle>
                      </svg>
                      <span>{event.venue || "ALSHAYEB ETERNUM"}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="premium-event-action-btn"
                    disabled={!isAvailable}
                    onClick={() => {
                      if (isAvailable) {
                        setSelectedEvent(event);
                        setPage("register");
                      }
                    }}
                  >
                    {isSoldOut ? "SOLD OUT" : isUnavailable ? "NOT AVAILABLE" : "REQUEST ACCESS"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (page === "register") {
    return (
      <div className="outcomer-landing-container outcomer-register-container">
        {/* BACK ARROW */}
        <div className="outcomer-back-wrapper">
          <button
            onClick={() => setPage('chooseEvent')}
            aria-label="Go back"
            className="outcomer-back-btn"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>

        <BrandHeader />

        {/* FORM CARDS */}
        <div className="outcomer-reg-form">
          {/* FULL NAME */}
          <div className={`outcomer-reg-card ${errors.fullName ? "error" : ""}`}>
            <div className="outcomer-reg-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </div>
            <div className="outcomer-reg-divider" />
            <div className="outcomer-reg-input-group">
              <label>FULL NAME</label>
              <input className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} name="fullName" placeholder="Enter your full name" value={request.fullName} onChange={handleRequestChange} />
            </div>
          </div>
          {errors.fullName && <div className="outcomer-reg-error">{errors.fullName}</div>}

          {/* PHONE NUMBER */}
          <div className={`outcomer-reg-card ${errors.phoneNumber ? "error" : ""}`}>
            <div className="outcomer-reg-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            </div>
            <div className="outcomer-reg-divider" />
            <div className="outcomer-reg-input-group outcomer-reg-phone-group">
              <label>PHONE NUMBER</label>
              <div className="outcomer-reg-phone-wrapper">
                <span className="outcomer-reg-phone-prefix">+20 <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
                <div className="outcomer-reg-phone-div" />
                <input className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} name="phoneNumber" placeholder="Enter your phone number" value={request.phoneNumber} onChange={handleRequestChange} />
              </div>
            </div>
          </div>
          {errors.phoneNumber && <div className="outcomer-reg-error">{errors.phoneNumber}</div>}

          {/* EMAIL ADDRESS */}
          <div className={`outcomer-reg-card ${errors.email ? "error" : ""}`}>
            <div className="outcomer-reg-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            </div>
            <div className="outcomer-reg-divider" />
            <div className="outcomer-reg-input-group">
              <label>EMAIL ADDRESS</label>
              <input className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} name="email" placeholder="Enter your email address" value={request.email} onChange={handleRequestChange} />
            </div>
          </div>
          {errors.email && <div className="outcomer-reg-error">{errors.email}</div>}

          {/* GENDER */}
          <div className={`outcomer-reg-card ${errors.gender ? "error" : ""}`}>
            <div className="outcomer-reg-icon">
              {/* gender/mars+venus icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="4"/>
                <line x1="11" y1="7" x2="11" y2="2"/>
                <polyline points="14 2 11 2 11 5"/>
                <line x1="15" y1="15" x2="19" y2="19"/>
                <line x1="17" y1="17" x2="20" y2="17"/>
                <line x1="20" y1="15" x2="20" y2="19"/>
              </svg>
            </div>
            <div className="outcomer-reg-divider" />
            <div className="outcomer-reg-input-group outcomer-reg-gender-group">
                <label>GENDER</label>
                <div className="outcomer-gender-toggles">
                <button
                  type="button"
                  className={`outcomer-gender-btn ${request.gender === 'male' ? 'active' : ''}`}
                  onClick={() => {
                    setRequest(prev => ({ ...prev, gender: 'male' }));
                    setErrors(prev => ({ ...prev, gender: "" }));
                  }}
                >
                  <span className="outcomer-gender-radio">{request.gender === 'male' ? '●' : '○'}</span>
                  MALE
                </button>
                <button
                  type="button"
                  className={`outcomer-gender-btn ${request.gender === 'female' ? 'active' : ''}`}
                  onClick={() => {
                    setRequest(prev => ({ ...prev, gender: 'female' }));
                    setErrors(prev => ({ ...prev, gender: "" }));
                  }}
                >
                  <span className="outcomer-gender-radio">{request.gender === 'female' ? '●' : '○'}</span>
                  FEMALE
                </button>
              </div>
            </div>
          </div>
          {errors.gender && <div className="outcomer-reg-error">{errors.gender}</div>}

          {/* SCHOOL / ORIGIN PROM */}
          <div className={`outcomer-reg-card ${errors.schoolOrOriginProm ? "error" : ""}`}>
            <div className="outcomer-reg-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            </div>
            <div className="outcomer-reg-divider" />
            <div className="outcomer-reg-input-group">
              <label>SCHOOL YOU'RE COMING WITH</label>
              {selectedEvent?.schools && selectedEvent.schools.length > 0 ? (
                <select
                  className="eternum-input"
                  name="schoolOrOriginProm"
                  value={request.schoolOrOriginProm}
                  onChange={handleRequestChange}
                >
                  <option value="" disabled>Select</option>
                  {selectedEvent.schools.map(school => (
                    <option key={school} value={school}>{school}</option>
                  ))}
                </select>
              ) : (
                <select className="eternum-input" disabled>
                  <option value="">UNAVAILABLE</option>
                </select>
              )}
            </div>
          </div>
          {errors.schoolOrOriginProm && <div className="outcomer-reg-error">{errors.schoolOrOriginProm}</div>}

          {/* AGE */}
          <div className={`outcomer-reg-card ${errors.age ? "error" : ""}`}>
            <div className="outcomer-reg-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            </div>
            <div className="outcomer-reg-divider" />
            <div className="outcomer-reg-input-group">
              <label>AGE</label>
              <input className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} name="age" placeholder="Enter your age" value={request.age} onChange={handleRequestChange} />
            </div>
          </div>
          {errors.age && <div className="outcomer-reg-error">{errors.age}</div>}

          {/* INSTAGRAM USERNAME */}
          <div className={`outcomer-reg-card ${errors.instagramUsername ? "error" : ""}`}>
            <div className="outcomer-reg-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
            </div>
            <div className="outcomer-reg-divider" />
            <div className="outcomer-reg-input-group outcomer-reg-insta-group">
              <label>INSTAGRAM USERNAME</label>
              <div className="outcomer-reg-insta-wrapper">
                <span className="outcomer-reg-insta-prefix">@</span>
                <input className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} name="instagramUsername" placeholder="Enter your Instagram username" value={request.instagramUsername} onChange={handleRequestChange} />
              </div>
            </div>
          </div>
          {errors.instagramUsername && <div className="outcomer-reg-error">{errors.instagramUsername}</div>}

          {/* UPLOAD IMAGE */}
          <label className="outcomer-reg-card outcomer-reg-upload-card" htmlFor="reg-image-upload">
            <div className="outcomer-reg-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <div className="outcomer-reg-divider" />
            <div className="outcomer-reg-input-group">
              <span className="outcomer-reg-upload-label">UPLOAD PERSONAL PHOTO</span>
              <span className={`outcomer-reg-upload-hint ${request.outcomerPhoto ? 'uploaded' : ''}`}>
                {request.outcomerPhotoFile ? request.outcomerPhotoFile.name : 'Tap to upload'}
              </span>
            </div>
            <svg className="outcomer-reg-upload-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <input id="reg-image-upload" type="file" hidden accept="image/png,image/jpeg,image/jpg" onChange={handleOutcomerPhotoUpload} />
          </label>
          {errors.outcomerPhoto && <div className="outcomer-reg-error">{errors.outcomerPhoto}</div>}
        </div>

        {/* BOTTOM SECTION */}
        <div className="outcomer-reg-footer">
          <div className="outcomer-diamond-divider small">
            <svg width="7" height="7" viewBox="0 0 9 9" fill="none">
              <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.65)" strokeWidth="1" fill="none" />
            </svg>
          </div>
          <p className="outcomer-reg-footer-copy">ALL APPLICATIONS ARE REVIEWED<br/>BY ALSHAYEB'S TEAM</p>
          {errors.submit && <div className="outcomer-reg-error" style={{ marginBottom: "16px", color: "#ff4d4f" }}>{errors.submit}</div>}
          <button className="outcomer-reg-submit" onClick={handlePrePaymentRules} disabled={isSubmitting}>
            {isSubmitting ? "SUBMITTING..." : "SUBMIT APPLICATION"} <span className="outcomer-reg-submit-arrow">→</span>
          </button>
        </div>
      </div>
    );
  }
  if (page === "prePaymentRules") {
    return (
      <HouseRulesGuard 
        buttonText="GO TO PAYMENT"
        onBack={() => setPage("register")}
        onAccept={() => {
          goToPayment();
        }}
      />
    );
  }

  if (page === "payment") {
    const rawFee = String(selectedEvent?.fee || "1800").replace(/EGP/i, "").trim() || "1800";
    const instapayLink = selectedEvent?.instapayLink || globalInstapayLink || null;
    const hasProof = Boolean(request.screenshot && request.screenshotFile);

    return (
      <div className="pay-page">
        {/* Back arrow */}
        <button className="pay-back-btn" onClick={() => setPage("chooseEvent")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>

        <BrandHeader />
        
        <div style={{ textAlign: 'center' }}>
          <p className="pay-eyebrow" style={{ marginTop: '0' }}>APPLICATION RECEIVED</p>
        </div>

        {/* Glowing check circle */}
        <div className="pay-check-circle">
          <svg width="110" height="110" viewBox="0 0 110 110" fill="none">
            <defs>
              <filter id="circle-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <circle cx="55" cy="55" r="48" stroke="#00b2ff" strokeWidth="1.5" fill="none" filter="url(#circle-glow)" strokeOpacity="0.9"/>
            <circle cx="55" cy="55" r="50" stroke="rgba(0,178,255,0.15)" strokeWidth="2" fill="none"/>
            <polyline points="36,55 50,69 74,41" stroke="#00b2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#circle-glow)"/>
          </svg>
        </div>

        {/* Main message */}
        <div className="pay-message">
          <p className="pay-main-text">Your application has been<br/>created successfully.</p>
          <p className="pay-sub-text">
            To enter the review process,<br/>
            please complete the <span className="pay-blue">entry fees</span>.
          </p>
        </div>

        {/* Diamond divider */}
        <div className="pay-divider-row">
          <div className="pay-divider-line"/>
          <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.7)" strokeWidth="1" fill="none"/>
          </svg>
          <div className="pay-divider-line"/>
        </div>

        {/* Entry fees card */}
        <div className="pay-card pay-fee-card">
          <p className="pay-card-label">ENTRY FEES</p>
          <p className="pay-fee-amount">{rawFee}</p>
          <p className="pay-fee-currency">EGP</p>
        </div>

        {/* Payment method card */}
        <div className="pay-card pay-method-card">
          <p className="pay-card-label">PAYMENT METHOD</p>
          <div className="pay-instapay-logo">
            <span className="pay-insta-white">INSTA</span><span className="pay-insta-arrows">»</span><span className="pay-insta-pay">PAY</span>
          </div>
          <p className="pay-method-sub">The secure and instant way to pay</p>
          <button
            className="pay-goto-btn"
            onClick={() => { if (instapayLink) window.open(instapayLink, "_blank"); else setPage("instapay"); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            <span>GO TO INSTAPAY</span>
            <svg className="pay-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </div>

        {/* Diamond divider before upload */}
        <div className="pay-divider-row" style={{ marginTop: '28px' }}>
          <div className="pay-divider-line"/>
          <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.7)" strokeWidth="1" fill="none"/>
          </svg>
          <div className="pay-divider-line"/>
        </div>

        {/* Upload proof section — merged from upload page */}
        <p className="upv-instruction" style={{ marginTop: '20px' }}>
          After payment, upload a clear screenshot<br/>of your payment transaction.
        </p>

        <label className={`upv-card upv-upload-card ${errors.screenshot ? "upv-card-error" : ""}`} htmlFor="pay-upv-file-input">
          <p className="upv-card-heading">UPLOAD PAYMENT SCREENSHOT</p>
          <div className="upv-dropzone">
            <svg width="52" height="52" viewBox="0 0 56 56" fill="none">
              <rect x="2" y="2" width="52" height="52" rx="10" stroke="rgba(0,178,255,0.6)" strokeWidth="1.5" fill="rgba(0,178,255,0.06)"/>
              <path d="M28 36V20M28 20L21 27M28 20L35 27" stroke="#00b2ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="upv-tap-label">
              {request.screenshot ? (
                <span className="upv-tap-selected">{request.screenshot}</span>
              ) : (
                <span className="upv-tap-blue">Tap to upload</span>
              )}
            </p>
            <p className="upv-format-hint">PNG, JPG or JPEG (max. 10MB)</p>
          </div>
          <input id="pay-upv-file-input" type="file" hidden accept="image/png,image/jpeg,image/jpg" onChange={handleScreenshotUpload} />
        </label>
        {errors.screenshot && <p className="upv-error">{errors.screenshot}</p>}

        {/* Lock notice */}
        <div className="pay-notice">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p className="pay-notice-text">APPLICATIONS ARE REVIEWED<br/>ONLY AFTER PAYMENT CONFIRMATION.</p>
        </div>

        {/* Submit proof button — disabled until proof is selected */}
        <button className="upv-submit-btn" onClick={submitRequest} disabled={isSubmitting || !hasProof}>
          <span>{isSubmitting ? "SUBMITTING..." : "SUBMIT FOR REVIEW"}</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
        {!hasProof && !isSubmitting && (
          <p className="pay-receipt-sub">UPLOAD PAYMENT PROOF TO CONTINUE</p>
        )}
      </div>
    );
  }

  if (page === "instapay") {
    return (
      <PublicShell backTo="payment" className="payment-public-page" onNavigate={setPage}>
        <BrandHeader title="ETERNITY" subtitle="PAYMENT METHOD" />
        <section className="eternum-card payment-method-card">
          <h3>PAY</h3>
          <strong className="fee-mini">{selectedEvent.fee}</strong>
          <p>ALSHAYEB ETERNUM</p>
          <strong className="instapay-wordmark">INSTAPAY</strong>
        </section>
        <p className="secure-note">Open InstaPay, complete your payment, then upload your receipt.</p>
        <PrimaryButton onClick={() => setPage("upload")}>I PAID - UPLOAD PROOF</PrimaryButton>
      </PublicShell>
    );
  }

  if (page === "upload") {
    return (
      <div className="upv-page">
        {/* Back arrow */}
        <button className="pay-back-btn" onClick={() => setPage("payment")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>

        <BrandHeader subtitle="UPLOAD PROOF OF PAYMENT" />

        {/* Instruction */}
        <p className="upv-instruction">
          Please upload a clear screenshot<br/>of your payment transaction.
        </p>

        {/* Upload card */}
        <label className={`upv-card upv-upload-card ${errors.screenshot ? "upv-card-error" : ""}`} htmlFor="upv-file-input">
          <p className="upv-card-heading">UPLOAD PAYMENT SCREENSHOT</p>
          <div className="upv-dropzone">
            <svg width="52" height="52" viewBox="0 0 56 56" fill="none">
              <rect x="2" y="2" width="52" height="52" rx="10" stroke="rgba(0,178,255,0.6)" strokeWidth="1.5" fill="rgba(0,178,255,0.06)"/>
              <path d="M28 36V20M28 20L21 27M28 20L35 27" stroke="#00b2ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="upv-tap-label">
              {request.screenshot ? (
                <span className="upv-tap-selected">{request.screenshot}</span>
              ) : (
                <span className="upv-tap-blue">Tap to upload</span>
              )}
            </p>
            <p className="upv-format-hint">PNG, JPG or JPEG (max. 10MB)</p>
          </div>
          <input id="upv-file-input" type="file" hidden accept="image/png,image/jpeg,image/jpg" onChange={handleScreenshotUpload} />
        </label>
        {errors.screenshot && <p className="upv-error">{errors.screenshot}</p>}

        {/* Notice card */}
        <div className="upv-card upv-notice-card">
          <div className="upv-notice-left"/>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <polyline points="9 12 11 14 15 10"/>
          </svg>
          <p className="upv-notice-text">Applications are reviewed<br/>only after payment confirmation.</p>
        </div>

        {/* Submit button */}
        <button className="upv-submit-btn" onClick={submitRequest} disabled={isSubmitting}>
          <span>{isSubmitting ? "SUBMITTING..." : "SUBMIT RECEIPT"}</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>

        {/* Bottom diamond */}
        <svg width="8" height="8" viewBox="0 0 9 9" fill="none" style={{marginTop: '28px'}}>
          <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.5)" strokeWidth="1" fill="none"/>
        </svg>
      </div>
    );
  }


  if (page === "submitted") {
    const sel = outcomerSelection || DEFAULT_OUTCOMER_SELECTION;
    const fmtNum = (n) => Number(n).toLocaleString();

    return (
      <div className="sub-page">
        {/* Back arrow */}
        <button className="pay-back-btn" onClick={() => setPage("trackLookup")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>

        <BrandHeader />

        {/* Glowing check */}
        <div className="pay-check-circle" style={{margin:'16px 0 14px'}}>
          <svg width="100" height="100" viewBox="0 0 110 110" fill="none">
            <defs>
              <filter id="sub-ck" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <circle cx="55" cy="55" r="48" stroke="#00b2ff" strokeWidth="1.5" fill="none" filter="url(#sub-ck)" strokeOpacity="0.9"/>
            <circle cx="55" cy="55" r="50" stroke="rgba(0,178,255,0.15)" strokeWidth="2" fill="none"/>
            <polyline points="36,55 50,69 74,41" stroke="#00b2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#sub-ck)"/>
          </svg>
        </div>

        {/* Title */}
        <p className="sub-main-title">APPLICATION SUBMITTED</p>
        <p className="sub-main-desc">Your application has been submitted successfully.</p>

        {/* Status cards */}
        <div className="sub-status-card">
          <div className="sub-status-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.55)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
          </div>
          <div className="sub-status-text">
            <span className="sub-status-label">PAYMENT STATUS</span>
            <span className="sub-status-value">UNDER VERIFICATION</span>
          </div>
          <div className="sub-status-clock">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.35)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              <circle cx="4" cy="4" r="1" fill="rgba(0,178,255,0.2)" stroke="none"/>
              <circle cx="20" cy="4" r="1" fill="rgba(0,178,255,0.2)" stroke="none"/>
              <circle cx="4" cy="20" r="1" fill="rgba(0,178,255,0.2)" stroke="none"/>
              <circle cx="20" cy="20" r="1" fill="rgba(0,178,255,0.2)" stroke="none"/>
            </svg>
          </div>
        </div>

        <div className="sub-status-card">
          <div className="sub-status-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.55)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>
            </svg>
          </div>
          <div className="sub-status-text">
            <span className="sub-status-label">APPLICATION STATUS</span>
            <span className="sub-status-value">UNDER REVIEW</span>
          </div>
          <div className="sub-status-clock">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.35)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              <circle cx="4" cy="4" r="1" fill="rgba(0,178,255,0.2)" stroke="none"/>
              <circle cx="20" cy="4" r="1" fill="rgba(0,178,255,0.2)" stroke="none"/>
              <circle cx="4" cy="20" r="1" fill="rgba(0,178,255,0.2)" stroke="none"/>
              <circle cx="20" cy="20" r="1" fill="rgba(0,178,255,0.2)" stroke="none"/>
            </svg>
          </div>
        </div>

        {/* Team review card */}
        <div className="sub-team-card">
          <p className="sub-team-title">ALSHAYEB'S TEAM</p>
          <div className="sub-team-divider-row">
            <div className="pay-divider-line" style={{maxWidth:'60px'}}/>
            <svg width="6" height="6" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.5)" strokeWidth="1" fill="none"/></svg>
            <div className="pay-divider-line" style={{maxWidth:'60px'}}/>
          </div>
          <div className="sub-team-body">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="rgba(0,178,255,0.55)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="16" cy="10" r="4"/><path d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8"/><circle cx="8" cy="14" r="2.5"/><circle cx="24" cy="14" r="2.5"/><path d="M4 26c0-2.2 1.8-4 4-4"/><path d="M28 26c0-2.2-1.8-4-4-4"/>
            </svg>
            <p className="sub-team-desc">is currently reviewing<br/>your application.</p>
          </div>
        </div>

        {/* OUTCOMERS COMMUNITY divider */}
        <div className="sub-community-divider">
          <div className="pay-divider-line"/>
          <span className="sub-community-text">OUTCOMERS COMMUNITY</span>
          <div className="pay-divider-line"/>
        </div>

        {/* THE SELECTION counter card */}
        <div className="sub-selection-card">
          <p className="sub-selection-title">THE SELECTION</p>
          <svg width="6" height="6" viewBox="0 0 9 9" fill="none" style={{margin:'4px auto 10px', display:'block'}}>
            <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.5)" strokeWidth="1" fill="none"/>
          </svg>
          <div className="sub-selection-row">
            <div className="sub-selection-col">
              <span className="sub-selection-num">{fmtNum(sel.approved)}</span>
              <svg width="5" height="5" viewBox="0 0 9 9" fill="none" style={{margin:'3px auto', display:'block'}}><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.3)" strokeWidth="1" fill="none"/></svg>
              <span className="sub-selection-lab">APPROVED</span>
            </div>
            <div className="sub-selection-div"/>
            <div className="sub-selection-col">
              <span className="sub-selection-num">{fmtNum(sel.pending)}</span>
              <svg width="5" height="5" viewBox="0 0 9 9" fill="none" style={{margin:'3px auto', display:'block'}}><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.3)" strokeWidth="1" fill="none"/></svg>
              <span className="sub-selection-lab">PENDING</span>
            </div>
            <div className="sub-selection-div"/>
            <div className="sub-selection-col">
              <span className="sub-selection-num">{fmtNum(sel.declined)}</span>
              <svg width="5" height="5" viewBox="0 0 9 9" fill="none" style={{margin:'3px auto', display:'block'}}><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.3)" strokeWidth="1" fill="none"/></svg>
              <span className="sub-selection-lab">DECLINED</span>
            </div>
          </div>
        </div>

        {/* TRACK APPLICATION button */}
        <button className="sub-track-btn" onClick={() => setPage("trackLookup")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>TRACK APPLICATION</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>
    );
  }

  if (page === "track" || page === "rejected") {
    const saved = trackedRegistration || request || {};
    const rawStatus = String(saved.status || saved.applicationStatus || "pending").toLowerCase();

    // Determine state
    const isConfirmed = rawStatus.includes("approved") || rawStatus.includes("confirmed") || rawStatus.includes("payment_confirmed");
    const isDeclined  = rawStatus.includes("reject") || rawStatus.includes("declined");
    const isPending   = !isConfirmed && !isDeclined;

    // Dynamic event data
    const eventName     = saved.eventName || saved.event || selectedEvent?.name || "ALSHAYEB ETERNUM";
    const trackedEvent  = findPromEvent(eventName);
    const rawDate       = trackedEvent?.date || trackedEvent?.dateTime || saved.eventDate || null;
    const eventDateStr  = rawDate
      ? new Date(rawDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()
      : "TBA";
    const locationStr   = trackedEvent?.location || trackedEvent?.venue || saved.location || "TBA";
    const accessTypeStr = (saved.accessType || saved.type || saved.attendeeType || "OUTCOMER").toUpperCase();

    // State-specific content
    const badgeLabel    = isConfirmed ? "PAYMENT CONFIRMED" : isDeclined ? "DECLINED" : "PENDING";
    const badgeColor    = isConfirmed ? "#00d97e" : isDeclined ? "#ff3366" : "#00b2ff";
    const statusDesc    = isConfirmed
      ? <>Your payment has been successfully verified.<br/>We're excited to see you at the event!</>
      : isDeclined
      ? <>Your application could not be approved at this stage.<br/>Please reach out to your assigned committee member for more information.</>
      : <>Your application is under review.<br/>You will be notified once a decision is made.</>;

    const infoCardTitle = isConfirmed ? "GET READY!" : isDeclined ? "STATUS CLOSED" : "STAY UPDATED";
    const infoCardDesc  = isConfirmed
      ? "Your ticket is ready.\nWe can't wait to welcome you."
      : isDeclined
      ? "The review process has been completed."
      : "We'll notify you as soon as there's an update on your application.";

    const btnLabel      = isConfirmed ? "VIEW YOUR TICKET" : isDeclined ? "RETURN TO HOME" : "TRACK ANOTHER APPLICATION";
    const handleBtn     = () => {
      if (isConfirmed) {
        // Attempt to route to ticket if foundClient available
        if (foundClient) { setPage("ticket"); }
        else { setPage("trackLookup"); }
      } else if (isDeclined) {
        setPage("home");
      } else {
        setPage("trackLookup");
      }
    };

    // SVG icons for status badge
    const BadgeIcon = () => {
      if (isConfirmed) return (
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <circle cx="13" cy="13" r="11" stroke={badgeColor} strokeWidth="1.4" fill="none"/>
          <polyline points="8,13 11.5,17 18,9" stroke={badgeColor} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="3" cy="3" r="1.5" fill={badgeColor} fillOpacity="0.3"/>
          <circle cx="23" cy="3" r="1.5" fill={badgeColor} fillOpacity="0.3"/>
          <circle cx="3" cy="23" r="1.5" fill={badgeColor} fillOpacity="0.3"/>
          <circle cx="23" cy="23" r="1.5" fill={badgeColor} fillOpacity="0.3"/>
        </svg>
      );
      if (isDeclined) return (
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <circle cx="13" cy="13" r="11" stroke={badgeColor} strokeWidth="1.4" fill="none"/>
          <line x1="9" y1="9" x2="17" y2="17" stroke={badgeColor} strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="17" y1="9" x2="9" y2="17" stroke={badgeColor} strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="3" cy="3" r="1.5" fill={badgeColor} fillOpacity="0.3"/>
          <circle cx="23" cy="3" r="1.5" fill={badgeColor} fillOpacity="0.3"/>
          <circle cx="3" cy="23" r="1.5" fill={badgeColor} fillOpacity="0.3"/>
          <circle cx="23" cy="23" r="1.5" fill={badgeColor} fillOpacity="0.3"/>
        </svg>
      );
      return (
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <circle cx="13" cy="13" r="11" stroke={badgeColor} strokeWidth="1.4" fill="none" strokeDasharray="3 2"/>
          <polyline points="13 7 13 13 17 15" stroke={badgeColor} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    };

    // Info card icon
    const InfoIcon = () => {
      if (isConfirmed) return (
        <svg width="26" height="26" viewBox="0 0 30 30" fill="none" stroke={badgeColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="24" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="9"/><line x1="21" y1="3" x2="21" y2="9"/>
          <polyline points="10,16 13,19 20,12"/>
        </svg>
      );
      if (isDeclined) return (
        <svg width="26" height="26" viewBox="0 0 30 30" fill="none" stroke="rgba(0,178,255,0.6)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12z"/><polyline points="14 2 14 12 24 12"/>
          <polyline points="12,19 15,22 20,16"/>
        </svg>
      );
      return (
        <svg width="26" height="26" viewBox="0 0 30 30" fill="none" stroke="rgba(0,178,255,0.6)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
          <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
        </svg>
      );
    };

    return (
      <div className="trk-page">
        {/* Back */}
        <button className="pay-back-btn" onClick={() => setPage("trackLookup")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>

        <BrandHeader />

        {/* Diamond divider */}
        <div className="trk-divider-row">
          <div className="pay-divider-line"/>
          <svg width="7" height="7" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.55)" strokeWidth="1" fill="none"/></svg>
          <div className="pay-divider-line"/>
        </div>

        {/* Your Application Details */}
        <div className="trk-copy">
          <p className="trk-copy-top">YOUR APPLICATION</p>
          <p className="trk-copy-sub">DETAILS</p>
        </div>

        {/* Main application card */}
        <div className="trk-main-card">
          {/* Event label + name */}
          <p className="trk-event-label">EVENT</p>
          <h2 className="trk-event-name">{eventName.toUpperCase()}</h2>

          {/* Diamond */}
          <svg width="6" height="6" viewBox="0 0 9 9" fill="none" style={{margin:'10px auto', display:'block'}}>
            <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.45)" strokeWidth="1" fill="none"/>
          </svg>

          {/* APPLICATION STATUS */}
          <p className="trk-status-label">APPLICATION STATUS</p>

          {/* Status badge */}
          <div className="trk-badge" style={{borderColor: badgeColor, boxShadow: `0 0 14px ${badgeColor}22`}}>
            <BadgeIcon/>
            <span className="trk-badge-text" style={{color: badgeColor}}>{badgeLabel}</span>
          </div>

          {/* Description */}
          <p className="trk-status-desc">{statusDesc}</p>

          {/* Event details row */}
          <div className="trk-details-row">
            <div className="trk-detail-col">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.4)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span className="trk-detail-label">EVENT DATE</span>
              <span className="trk-detail-val">{eventDateStr}</span>
            </div>
            <div className="trk-detail-sep"/>
            <div className="trk-detail-col">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.4)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <span className="trk-detail-label">LOCATION</span>
              <span className="trk-detail-val">{locationStr}</span>
            </div>
            <div className="trk-detail-sep"/>
            <div className="trk-detail-col">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.4)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <span className="trk-detail-label">ACCESS TYPE</span>
              <span className="trk-detail-val">{accessTypeStr}</span>
            </div>
          </div>
        </div>

        {/* Info card */}
        <div className="trk-info-card">
          <div className="trk-info-icon-wrap">
            <InfoIcon/>
          </div>
          <div className="trk-info-body">
            <p className="trk-info-title" style={{color: isConfirmed ? badgeColor : '#00b2ff'}}>{infoCardTitle}</p>
            {infoCardDesc.split("\n").map((line, i) => (
              <p key={i} className="trk-info-desc">{line}</p>
            ))}
            
          </div>
        </div>

        {/* Action button */}
        <button className="trk-action-btn" onClick={handleBtn} style={{borderColor: isConfirmed ? badgeColor+'88' : undefined}}>
          {isConfirmed && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
            </svg>
          )}
          {!isConfirmed && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          )}
          <span>{btnLabel}</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>

        {/* Footer */}
        <div className="trk-footer">
          <svg width="5" height="5" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.4)" strokeWidth="1" fill="none"/></svg>
          <span className="trk-footer-text">YOUR JOURNEY. SECURE. PRIVATE. ETERNAL.</span>
          <svg width="5" height="5" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.4)" strokeWidth="1" fill="none"/></svg>
        </div>
        <p className="trk-footer-brand">ALSHAYEB EXPERIENCE</p>
      </div>
    );
  }

  if (page === "ticket" && foundClient) {
    const ticketQrId = safeValue(foundClient.ID || foundClient.qrId || foundClient.id || foundClient._id, "N/A");
    const rulesAcceptedKey = `houseRulesAccepted:${ticketQrId}`;
    const isRulesAccepted = sessionStorage.getItem(rulesAcceptedKey) === "true";

    if (!isRulesAccepted) {
      return (
        <HouseRulesGuard 
          onBack={() => {
            const isOutcomer = foundClient?.type === "OUTCOMER" || foundClient?.accessType === "OUTCOMER";
            setPage(isOutcomer ? "track" : "incomer");
          }}
          onAccept={() => {
            sessionStorage.setItem(rulesAcceptedKey, "true");
            setNow(Date.now());
          }}
        />
      );
    }

    const guestName      = safeValue(foundClient.name || foundClient.Name || foundClient.fullName, "Guest");
    const guestPhone     = safeValue(foundClient.phone || foundClient.Phone || foundClient.phoneNumber, "—");
    const qrId           = safeValue(foundClient.ID || foundClient.qrId || foundClient.id, "N/A");
    const qrValue        = String(foundClient.qrToken || foundClient.qr || foundClient.QR || "").trim();
    const accessType     = safeValue(foundClient.accessType || foundClient["Access Type"] || foundClient.type || foundClient.attendeeType, "OUTCOMER");
    const isUsed         = foundClient.isUsed || foundClient.scanned || foundClient.scannedAt || foundClient.usedAt || (String(foundClient.status || "").toLowerCase() === "used");
    const venue          = "ALSHAYEB ETERNUM";
    const school         = safeValue(foundClient.schoolOrOriginProm || foundClient.university || foundClient.school || foundClient.School, "—");
    const preferredName  = safeValue(foundClient.instagramUsername || foundClient.preferredName || foundClient.nickname || guestName.split(" ")[0], "—");
    const eventNameDisp  = safeValue(foundClient.eventName || (foundClient.event && typeof foundClient.event === 'object' ? foundClient.event.name : foundClient.event), "N/A");

    const ticketPromEvent   = findPromEvent(foundClient.eventName || foundClient.event || foundClient.Venue || venue);
    const rawDateTime       = eventDateTimeValue(ticketPromEvent) || foundClient.PromDateTime || foundClient.eventDate || null;
    const ticketRevealDate  = rawDateTime ? new Date(rawDateTime).getTime() : new Date(QR_REVEAL_TIME).getTime();
    const safeRevealDate    = Number.isFinite(ticketRevealDate) ? ticketRevealDate : new Date(QR_REVEAL_TIME).getTime();
    const ticketQrLocked    = now < safeRevealDate;
    const ticketDistance    = Math.max(safeRevealDate - now, 0);
    const tDays    = Math.floor(ticketDistance / (1000 * 60 * 60 * 24));
    const tHours   = Math.floor((ticketDistance / (1000 * 60 * 60)) % 24);
    const tMins    = Math.floor((ticketDistance / (1000 * 60)) % 60);
    const tSecs    = Math.floor((ticketDistance / 1000) % 60);

    // Format event date and entry time from event data
    const eventDateDisp = rawDateTime 
      ? new Date(rawDateTime).toLocaleDateString("en-GB", {day:"2-digit", month:"short", year:"numeric"}).toUpperCase() 
      : "TBA";
    const entryTimeDisp = ticketPromEvent?.entryTime || foundClient.entryTime || "TBA";

    return (
      <div className="tkt-page">
        {/* Back */}
        <button className="pay-back-btn" onClick={() => {
          const isOutcomer = foundClient?.type === "OUTCOMER" || foundClient?.accessType === "OUTCOMER";
          setPage(isOutcomer ? "track" : "incomer");
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>

        <BrandHeader />

        {/* QR Card */}
        <div className="tkt-qr-card">
          <p className="tkt-scan-label">SCAN TO ENTER</p>
          <h2 className="tkt-eternal-list">THE ETERNAL LIST</h2>

          <div className="tkt-qr-wrap">
            {qrValue && <div className="tkt-qr-inner"><QRCode value={qrValue} size={200} /></div>}
            {ticketQrLocked && (
              <div className="tkt-qr-lock-overlay">
                <div className="tkt-lock-icon-wrap">
                  <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
                    <rect x="10" y="22" width="28" height="20" rx="4" stroke="#00b2ff" strokeWidth="1.5" fill="rgba(4,12,35,0.9)"/>
                    <path d="M16 22V16a8 8 0 0 1 16 0v6" stroke="#00b2ff" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                    <circle cx="24" cy="33" r="3" fill="#00b2ff" fillOpacity="0.8"/>
                    <line x1="24" y1="33" x2="24" y2="38" stroke="#00b2ff" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
            )}
            {!qrValue && !ticketQrLocked && (
              <div className="tkt-qr-lock-overlay"><p className="tkt-qr-na">QR not available yet.</p></div>
            )}
          </div>

          {ticketQrLocked && (
            <>
              <div className="tkt-countdown-row">
                <p className="tkt-unlocking-label">UNLOCKING IN</p>
                <div className="tkt-countdown">
                  <span className="tkt-cd-num">{String(tDays).padStart(2,"0")}</span>
                  <span className="tkt-cd-sep">:</span>
                  <span className="tkt-cd-num">{String(tHours).padStart(2,"0")}</span>
                  <span className="tkt-cd-sep">:</span>
                  <span className="tkt-cd-num">{String(tMins).padStart(2,"0")}</span>
                  <span className="tkt-cd-sep">:</span>
                  <span className="tkt-cd-num">{String(tSecs).padStart(2,"0")}</span>
                </div>
                <div className="tkt-cd-labels">
                  <span>DAYS</span><span>HOURS</span><span>MINUTES</span><span>SECONDS</span>
                </div>
              </div>
              <div className="tkt-security-warning">
                <div className="tkt-security-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                </div>
                <p className="tkt-security-text">
                  FOR SECURITY, YOUR QR CODE WILL REMAIN LOCKED AND AUTOMATICALLY UNLOCK ONLY WHEN YOU ARE NEAR THE VENUE ENTRANCE.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Access Identity Card */}
        <div className="tkt-identity-card">
          <p className="tkt-identity-title">ACCESS IDENTITY</p>
          {[
            { icon: "user-solid", label: "NAME",          val: guestName.toUpperCase() },
            { icon: "school",     label: "SCHOOL",         val: school.toUpperCase() },
            { icon: "phone",      label: "PHONE NUMBER",   val: guestPhone },
            { icon: "id",         label: "ID",             val: qrId.toUpperCase() },
            { icon: "star",       label: "EVENT NAME",     val: eventNameDisp.toUpperCase() },
            { icon: "crown",      label: "ACCESS TYPE",    val: accessType.toUpperCase(), color: "#00b2ff" },
            { icon: "shield",     label: "STATUS",         val: isUsed ? "USED" : "UNUSED", color: isUsed ? "#ff3366" : "#00b2ff", dot: true },
            { icon: "cal",        label: "DATE",           val: eventDateDisp },
            { icon: "clock",      label: "ENTRY TIME",     val: entryTimeDisp },
            { icon: "venue",      label: "VENUE",          val: venue },
          ].map(({ icon, label, val, color, dot }) => (
            <div key={label} className="tkt-id-row">
              <div className="tkt-id-icon">
                {icon === "user-solid" && <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(0,178,255,0.4)" stroke="none"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>}
                {icon === "user"       && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                {icon === "school"     && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>}
                {icon === "phone"      && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 11a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.06 6.06l.94-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>}
                {icon === "id"         && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-12c0 1.1.9 2 2 2s2-.9 2-2-.9-2-2-2-2 .9-2 2zm-4 7c0-2.21 1.79-4 4-4s4 1.79 4 4"/></svg>}
                {icon === "star"       && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
                {icon === "crown"      && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><path d="M2 4l4 8 6-4 6 4 4-8"/><path d="M4 17h16"/><path d="M4 20h16"/></svg>}
                {icon === "shield"     && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>}
                {icon === "cal"        && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
                {icon === "clock"      && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
                {icon === "venue"      && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              </div>
              <span className="tkt-id-label">{label}</span>
              <span className="tkt-id-val" style={color ? {color} : {}}>
                {dot && <span className="tkt-status-dot" style={{background: color}}/>}
                {val}
              </span>
            </div>
          ))}
        </div>

        {/* About The Venue Card */}
        <div className="tkt-venue-card">
          <p className="tkt-venue-title">ABOUT THE VENUE</p>
          <div className="tkt-venue-body">
            <div className="tkt-venue-text">
              <p>ALSHAYEB ETERNUM is a secret dimension for music, art and connection.</p>
              <p>Designed as a circular island, it creates unforgettable experiences in a space where energy flows endlessly.</p>
            </div>
            <div className="tkt-venue-ring-art" aria-hidden="true">
              <svg width="200" height="200" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="ringGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(40,100,255,0.9)" />
                    <stop offset="50%" stopColor="rgba(80,160,255,1)" />
                    <stop offset="100%" stopColor="rgba(20,60,200,0.6)" />
                  </linearGradient>
                  <filter id="arcBlur">
                    <feGaussianBlur stdDeviation="3" />
                  </filter>
                  <filter id="arcBlurWide">
                    <feGaussianBlur stdDeviation="8" />
                  </filter>
                </defs>
                {/* Wide outer glow */}
                <circle cx="100" cy="100" r="88" stroke="rgba(40,100,255,0.15)" strokeWidth="12" fill="none" filter="url(#arcBlurWide)" />
                {/* Outer ring - bright */}
                <circle cx="100" cy="100" r="88" stroke="url(#ringGlow)" strokeWidth="2" fill="none" />
                {/* Outer ring glow */}
                <circle cx="100" cy="100" r="88" stroke="rgba(60,140,255,0.5)" strokeWidth="4" fill="none" filter="url(#arcBlur)" />
                {/* Inner ring */}
                <circle cx="100" cy="100" r="72" stroke="rgba(80,160,255,0.6)" strokeWidth="1.5" fill="none" />
                {/* Inner ring glow */}
                <circle cx="100" cy="100" r="72" stroke="rgba(40,100,255,0.3)" strokeWidth="4" fill="none" filter="url(#arcBlur)" />
                {/* Particle dots */}
                <circle cx="170" cy="45" r="1" fill="rgba(150,200,255,0.7)" />
                <circle cx="180" cy="70" r="0.8" fill="rgba(150,200,255,0.5)" />
                <circle cx="160" cy="30" r="0.6" fill="rgba(150,200,255,0.4)" />
                <circle cx="185" cy="100" r="1" fill="rgba(150,200,255,0.6)" />
                <circle cx="175" cy="130" r="0.7" fill="rgba(150,200,255,0.5)" />
                <circle cx="165" cy="155" r="0.9" fill="rgba(150,200,255,0.6)" />
                <circle cx="155" cy="170" r="0.6" fill="rgba(150,200,255,0.3)" />
                <circle cx="140" cy="180" r="0.8" fill="rgba(150,200,255,0.4)" />
                <circle cx="188" cy="88" r="0.5" fill="rgba(200,220,255,0.8)" />
                <circle cx="150" cy="20" r="0.5" fill="rgba(200,220,255,0.5)" />
                <circle cx="120" cy="188" r="0.7" fill="rgba(150,200,255,0.4)" />
                <circle cx="190" cy="115" r="0.6" fill="rgba(150,200,255,0.5)" />
              </svg>
            </div>
          </div>
        </div>

        {/* Feature icons row */}
        <div className="tkt-features-row">
          {[
            { icon: "capacity", label: "CAPACITY", desc: "Limited capacity experience" },
            { icon: "360", label: "360° EXPERIENCE", desc: "Immersive around & beyond from every angle" },
            { icon: "sound", label: "WORLD CLASS SOUND", desc: "Next level audio curation by top industry leaders" },
            { icon: "safety", label: "SAFETY FIRST", desc: "Advanced security & seamless movement" },
            { icon: "premium", label: "PREMIUM EXPERIENCE", desc: "VIP areas, bars exclusive service" },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="tkt-feat-col">
              <div className="tkt-feat-icon">
                {icon === "capacity" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.6)" strokeWidth="1.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                {icon === "360" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.6)" strokeWidth="1.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><text x="6" y="16" fill="rgba(0,178,255,0.6)" fontSize="7" fontFamily="sans-serif">360°</text></svg>}
                {icon === "sound" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.6)" strokeWidth="1.2" strokeLinecap="round"><line x1="9" y1="18" x2="9" y2="6"/><line x1="5" y1="15" x2="5" y2="9"/><line x1="13" y1="21" x2="13" y2="3"/><line x1="17" y1="16" x2="17" y2="8"/><line x1="21" y1="14" x2="21" y2="10"/></svg>}
                {icon === "safety" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.6)" strokeWidth="1.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
                {icon === "premium" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.6)" strokeWidth="1.2" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
              </div>
              <span className="tkt-feat-label">{label}</span>
              <span className="tkt-feat-desc">{desc}</span>
            </div>
          ))}
        </div>

        {/* Stay Connected card */}
        <div className="tkt-connected-card">
          <div className="tkt-connected-left">
            <img src="/instagram-qr.jpeg" alt="Instagram QR @ALSHAYEB.EG" className="tkt-ig-qr"/>
          </div>
          <div className="tkt-connected-mid">
            <p className="tkt-connected-title">STAY CONNECTED</p>
            <p className="tkt-connected-desc">Scan to follow our Instagram for updates, stories and more</p>
          </div>
          <div className="tkt-connected-right">
            <div className="tkt-info-link">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span className="tkt-link-label">LOCATION</span>
              <span className="tkt-link-val">Find & locate area</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
            <div className="tkt-info-sep"/>
            <a className="tkt-info-link" href="https://www.instagram.com/alshayebexperience?igsh=bGY0dmxvZXAwd3dr" target="_blank" rel="noopener noreferrer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              <span className="tkt-link-label">INSTAGRAM</span>
              <span className="tkt-link-val">Follow us on instagram</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </a>
            <div className="tkt-info-sep"/>
            <div className="tkt-info-link" onClick={() => setPage('houseRules')} role="button" tabIndex={0}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(0,178,255,0.5)" strokeWidth="1.3" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span className="tkt-link-label">VENUE INFO</span>
              <span className="tkt-link-val">House rules</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="tkt-footer">
          <svg width="6" height="6" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.5)" strokeWidth="1" fill="none"/></svg>
          <span className="tkt-footer-text">ALSHAYEB EXPERIENCE</span>
          <svg width="6" height="6" viewBox="0 0 9 9" fill="none"><path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.5)" strokeWidth="1" fill="none"/></svg>
        </div>
      </div>
    );
  }

  if (page === "houseRules") {
    return (
      <div className="incomer-page-container rules-page-container">
        {/* BACK ARROW */}
        <div className="incomer-back-wrapper">
          <button
            onClick={() => setPage("home")}
            aria-label="Go back"
            className="incomer-back-btn"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>

        <div className="rules-header">
          <div className="rules-brand-logo">ALSHAYEB</div>
          <h1 className="rules-title">HOUSE RULES</h1>
          <p className="rules-subtitle">
            <span className="rules-cyan">READ BEFORE YOU ENTER.</span><br/>
            Every destination has rules.<br/>
            These aren't restrictions. They're what protect the experience.
          </p>
        </div>

        <HouseRulesContent />

        <div className="rules-footer">
          <div className="rules-footer-title">FINAL NOTICE</div>
          <div className="rules-footer-text">
            <span>PROTECT THE EXPERIENCE.</span>
            <span className="rules-divider">|</span>
            <span>RESPECT EVERYONE.</span>
            <span className="rules-divider">|</span>
            <span className="rules-cyan">ALSHAYEB EXPERIENCE.</span>
          </div>
        </div>
      </div>
    );
  }

  if (page === "guestList") {
    return (
      <div className="incomer-page-container guest-list-reference">
        {/* BACK ARROW */}
        <div className="incomer-back-wrapper">
          <button
            onClick={() => setPage('home')}
            aria-label="Go back"
            className="incomer-back-btn"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>

        <BrandHeader />

        {/* DIAMOND DIVIDER UPPER */}
        <div className="incomer-diamond-divider">
          <div className="incomer-diamond-line-left" />
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.65)" strokeWidth="1" fill="none" />
          </svg>
          <div className="incomer-diamond-line-right" />
        </div>

        {/* WELCOME HEADING */}
        <div className="incomer-welcome-box">
          <h2>GUEST LIST</h2>
          <p>Check if your name<br />made it onto the Eternal List.</p>
        </div>

        {/* ERROR MESSAGES */}
        {loading && <p className="incomer-loading">Checking guest list...</p>}

        {/* FOUND ON GUEST LIST */}
        {foundClient && !loading && (
          <div style={{
            margin: '18px auto',
            maxWidth: '340px',
            background: 'linear-gradient(135deg, rgba(0,178,255,0.12), rgba(0,217,126,0.08))',
            border: '1px solid rgba(0,178,255,0.4)',
            borderRadius: '14px',
            padding: '20px 22px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>✅</div>
            <p style={{ color: '#00d97e', fontWeight: 700, fontSize: '1rem', letterSpacing: '0.08em', margin: '0 0 6px' }}>YOU'RE ON THE LIST</p>
            <p style={{ color: '#e2e8f0', fontSize: '0.9rem', margin: '0 0 4px' }}>{foundClient.fullName || foundClient.name}</p>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: 0 }}>{foundClient.eventName || 'THE ARRIVAL'}</p>
            <button
              type="button"
              onClick={() => { setFoundClient(null); setPhone(''); setErrors({}); }}
              style={{ marginTop: '14px', background: 'transparent', border: '1px solid rgba(0,178,255,0.3)', color: '#00b2ff', borderRadius: '8px', padding: '7px 18px', cursor: 'pointer', fontSize: '0.8rem', letterSpacing: '0.05em' }}
            >CHECK ANOTHER NUMBER</button>
          </div>
        )}

        {/* PHONE FORM */}
        <form autoComplete="off" className="incomer-phone-form" onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
          <label>PHONE NUMBER</label>
          <div className="incomer-phone-row">
            <div className="incomer-country-code">
              +20
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <input className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                type="tel"
                placeholder="Enter your phone number"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setErrors((prev) => ({ ...prev, phoneSearch: "" }));
              }}
              disabled={loading}
              required
              autoComplete="tel"
            />
          </div>
          
          {errors.phoneSearch && (
            <p className="incomer-error-text">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px', verticalAlign: 'middle'}}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              {errors.phoneSearch}
            </p>
          )}

          <button type="submit" className="incomer-continue-btn" disabled={loading}>
            <div style={{ width: '18px', flexShrink: 0 }} />
            <span>{loading ? 'CHECKING...' : 'CHECK STATUS'}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </form>

          <section className="guest-count-card" aria-label="Current guest list count">
            <h3>CURRENT GUEST LIST</h3>
            <strong>{guestListCount}</strong>
            <span>INVITED</span>
          </section>

          <section className="guest-notice-card">
            <div className="guest-shield" aria-hidden="true">!</div>
            <h3>SELECTION NOTICE</h3>
            <p>
              A name appearing on the Guest List<br />
              does not guarantee admission.
            </p>
            <i aria-hidden="true"></i>
            <p>
              Final entry decisions remain at the<br />
              discretion of the <span className="guest-notice-highlight">ALSHAYEB&rsquo;s</span> team.
            </p>
          </section>
        <footer className="guest-list-footer">
          <span>&bull; ALSHAYEB EXPERIENCE &bull;</span>
        </footer>
      </div>
    );
  }

  if (page === "incomer") {
    return (
      <div className="incomer-page-container">
        {/* BACK ARROW */}
        <div className="incomer-back-wrapper">
          <button
            onClick={() => setPage('home')}
            aria-label="Go back"
            className="incomer-back-btn"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>

        {/* SPADE LOGO */}
        <BrandHeader />

        {/* DIAMOND DIVIDER UPPER */}
        <div className="incomer-diamond-divider">
          <div className="incomer-diamond-line-left" />
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.65)" strokeWidth="1" fill="none" />
          </svg>
          <div className="incomer-diamond-line-right" />
        </div>

        {/* WELCOME HEADING */}
        <div className="incomer-welcome-box">
          <h2>WELCOME INCOMER</h2>
          <p>Enter your phone number to access<br />all incoming guest information.</p>
        </div>

        {/* ERROR MESSAGES */}
        {loading && <p className="incomer-loading">Verifying access...</p>}
        {errors.home && (
          <div className="incomer-error-box">
            <p>{errors.home}</p>
            <button type="button" onClick={loadGuests} disabled={loading}>RETRY</button>
          </div>
        )}

        {/* PHONE FORM */}
        <form autoComplete="off" className="incomer-phone-form" onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
          <label>PHONE NUMBER</label>
          <div className="incomer-phone-row">
            <div className="incomer-country-code">
              +20
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <input className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                type="tel"
                placeholder="Enter your phone number"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setErrors((prev) => ({ ...prev, phoneSearch: "" }));
              }}
              disabled={loading}
              required
              autoComplete="tel"
            />
          </div>
          
          {errors.phoneSearch && (
            <p className="incomer-error-text">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px', verticalAlign: 'middle'}}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              {errors.phoneSearch}
            </p>
          )}

          <button type="submit" className="incomer-continue-btn" disabled={loading}>
            <div style={{ width: '18px', flexShrink: 0 }} />
            <span>{loading ? 'VERIFYING...' : 'CONTINUE'}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </form>

        {/* DIAMOND DIVIDER LOWER */}
        <div className="incomer-diamond-divider incomer-diamond-lower">
          <div className="incomer-diamond-line-left-subtle" />
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 0.5 L8.5 4.5 L4.5 8.5 L0.5 4.5 Z" stroke="rgba(0,178,255,0.58)" strokeWidth="1" fill="none" />
          </svg>
          <div className="incomer-diamond-line-right-subtle" />
        </div>

        {/* ACCESS RESTRICTED CARD */}
        <div className="incomer-restricted-card">
          <div className="incomer-restricted-icon">
            <svg width="50" height="68" viewBox="0 0 50 68" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="7" y="2" width="36" height="56" rx="5" stroke="rgba(0,178,255,0.65)" strokeWidth="1.8" fill="none" />
              <line x1="19" y1="7.5" x2="31" y2="7.5" stroke="rgba(0,178,255,0.45)" strokeWidth="2" strokeLinecap="round" />
              <circle cx="25" cy="35" r="9" stroke="rgba(0,178,255,0.65)" strokeWidth="1.6" fill="none" />
              <line x1="25" y1="30.5" x2="25" y2="36.5" stroke="rgba(0,178,255,0.9)" strokeWidth="2" strokeLinecap="round" />
              <circle cx="25" cy="39.5" r="1.3" fill="rgba(0,178,255,0.9)" />
              <line x1="21" y1="52" x2="29" y2="52" stroke="rgba(0,178,255,0.45)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h3>ACCESS RESTRICTED</h3>
            <p>This access is for incoming<br />guests only.</p>
            <button onClick={() => setPage('home')}>
              GO BACK
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="hp-portal">
      {/* Hero Section (Spade + Header) */}
      <div className="hp-hero-section">
        <img
          src={process.env.PUBLIC_URL + "/homepage-background-spade.png"}
          alt=""
          aria-hidden="true"
          className="hp-hero-bg"
          draggable="false"
        />
        <div className="hp-hero-overlay" />
        
        <header className="hp-header">
          <EternumWordmark />
        </header>
      </div>

      {/* Content Section (Cards + Footer) sitting below the spade */}
      <div className="hp-content-section">
        {/* Section Label */}
        <div className="hp-section-label">
          <div className="hp-label-line" />
          <span className="hp-label-text">CHOOSE YOUR PATH</span>
          <div className="hp-label-line" />
        </div>

        {/* Path Cards */}
        <div className="hp-cards">
          <button className="hp-card" type="button" onClick={() => setPage("incomer")}>
            <span className="hp-card-num">01</span>
            <span className="hp-card-divider" />
            <span className="hp-card-body">
              <span className="hp-card-kicker">THE INVITED</span>
              <span className="hp-card-name">INCOMER</span>
              <span className="hp-card-desc">Already invited? Access your digital pass and event details.</span>
            </span>
            <span className="hp-card-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="11"/><line x1="8" y1="12" x2="16" y2="12"/><polyline points="13 9 17 12 13 15"/></svg>
            </span>
          </button>

          <button className="hp-card" type="button" onClick={() => setPage("outcomerLanding")}>
            <span className="hp-card-num">02</span>
            <span className="hp-card-divider" />
            <span className="hp-card-body">
              <span className="hp-card-kicker">THE SEEKERS</span>
              <span className="hp-card-name">OUTCOMER</span>
              <span className="hp-card-desc">Request access to join the experience. Applications are reviewed by alshayeb's team</span>
            </span>
            <span className="hp-card-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="11"/><line x1="8" y1="12" x2="16" y2="12"/><polyline points="13 9 17 12 13 15"/></svg>
            </span>
          </button>

          <button className="hp-card hp-card--gold" type="button" onClick={() => setPage("guestList")}>
            <span className="hp-card-num">03</span>
            <span className="hp-card-divider" />
            <span className="hp-card-body">
              <span className="hp-card-kicker">THE ETERNAL LIST</span>
              <span className="hp-card-name">GUEST LIST</span>
              <span className="hp-card-desc">Feeling lucky? Check if your name made it onto the Eternal List.</span>
            </span>
            <span className="hp-card-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="11"/><line x1="8" y1="12" x2="16" y2="12"/><polyline points="13 9 17 12 13 15"/></svg>
            </span>
          </button>
        </div>

        {/* Footer */}
        <footer className="hp-footer">
          <p className="hp-footer-tagline">YOUR JOURNEY. SECURE. PRIVATE. ETERNAL.</p>
          <p className="hp-footer-brand">&bull; ALSHAYEB EXPERIENCE &bull;</p>
        </footer>
      </div>
    </main>
  );
}

function isAdminAuthenticated() {
  try {
    const session = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || "null");
    if (!session?.authenticated || !session?.token || !session?.expiresAt) return false;
    // Reject expired sessions client-side so the UI redirects to login proactively
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function ProtectedRoomsAdminRoute({ children }) {
  if (!isAdminAuthenticated()) {
    return <Navigate to="/rooms-control" replace />;
  }
  return children;
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

  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isAdminAuthenticated()) {
    return <Navigate to="/control/dashboard" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoginError("");
    setIsSubmitting(true);

    try {
      const result = await apiRequest("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(credentials.email ?? "").trim(),
          password: credentials.password
        })
      });

      // Token is valid — store it with expiry for client-side session check
      // Backend enforces auth on every request regardless of this value
      const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
      localStorage.setItem(
        ADMIN_SESSION_KEY,
        JSON.stringify({
          authenticated: true,
          email: String(credentials.email ?? "").trim().toLowerCase(),
          token: result.token,
          expiresAt: Date.now() + EIGHT_HOURS_MS,
          signedInAt: new Date().toISOString()
        })
      );

      navigate("/control/dashboard", { replace: true });
    } catch (err) {
      setLoginError(err.message || "Invalid admin email or password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell admin-page admin-bg tone-gold">
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

        <button className="purple-btn" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "AUTHENTICATING..." : "ENTER CONTROL"}
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
    <div className="admin-control-page admin-bg tone-gold">
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

  if (normalized.includes("approved") || normalized.includes("verified") || normalized.includes("active") || normalized.includes("open") || normalized.includes("granted") || normalized.includes("confirmed")) {
    return "active";
  }

  if (normalized.includes("reject") || normalized.includes("invalid") || normalized.includes("closed") || normalized.includes("used") || normalized.includes("declined")) {
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
    eventStats: [],
    recentActivity: [],
    recentAttendees: []
  });
  const stats = data.stats || [];
  const eventStats = data.eventStats || [];
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

      {eventStats.map(event => (
        <div key={event.eventId} style={{ marginTop: '2rem' }}>
          <div className="admin-panel-title">
            <h3>{event.eventName} Stats</h3>
          </div>
          <div className="admin-stat-grid">
            <div className="admin-stat-card"><span>Total</span><strong>{event.total}</strong></div>
            <div className="admin-stat-card"><span>Incomers</span><strong>{event.incomers}</strong></div>
            <div className="admin-stat-card"><span>Outcomers</span><strong>{event.outcomers}</strong></div>
            <div className="admin-stat-card"><span>Approved</span><strong>{event.approved}</strong></div>
            <div className="admin-stat-card"><span>Pending</span><strong>{event.pending}</strong></div>
            <div className="admin-stat-card"><span>Declined</span><strong>{event.declined}</strong></div>
          </div>
        </div>
      ))}

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
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useBackendData("/api/events", { events: [] }, [refreshKey]);
  const liveEvents = data.events || [];
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    date: "",
    entryTime: "21:30",
    venue: "ALSHAYEB ETERNUM",
    status: "available",
    prefix: "",
    price: 1800,
    googleSheetId: "",
    exportGoogleSheetId: "",
    guestListSheetId: "",
    guestListTabName: "Sheet1",
    schools: "",
    displayOrder: "",
    bannerImageUrl: "",
    tagline: "",
    description: "",
    eventTypeLabel: "PROM"
  });
  const [bannerFile, setBannerFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(null);

  const handleOpenModal = (event = null) => {
    if (event) {
      setEditingEvent(event);
      setFormData({
        name: event.name || "",
        slug: event.slug || "",
        date: event.date ? event.date.split('T')[0] : "",
        entryTime: event.entryTime || "21:30",
        venue: event.venue || "ALSHAYEB ETERNUM",
        status: event.status || "available",
        prefix: event.prefix || "",
        price: event.price || 1800,
        googleSheetId: event.googleSheetId || "",
        exportGoogleSheetId: event.exportGoogleSheetId || "",
        guestListSheetId: event.guestListSheetId || "",
        guestListTabName: event.guestListTabName || "Sheet1",
        schools: (event.schools || []).join(", "),
        displayOrder: event.displayOrder !== undefined && event.displayOrder !== null && event.displayOrder !== 999 ? event.displayOrder : "",
        bannerImageUrl: event.bannerImageUrl || "",
        tagline: event.tagline || "",
        description: event.description || "",
        eventTypeLabel: event.eventTypeLabel || "PROM"
      });
      setBannerFile(null);
    } else {
      setEditingEvent(null);
      setFormData({
        name: "",
        slug: "",
        date: "",
        entryTime: "21:30",
        venue: "ALSHAYEB ETERNUM",
        status: "available",
        prefix: "",
        price: 1800,
        googleSheetId: "",
        exportGoogleSheetId: "",
        guestListSheetId: "",
        guestListTabName: "Sheet1",
        schools: "",
        displayOrder: "",
        bannerImageUrl: "",
        tagline: "",
        description: "",
        eventTypeLabel: "PROM"
      });
      setBannerFile(null);
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const payload = {
        ...formData,
        schools: formData.schools.split(",").map(s => s.trim()).filter(Boolean)
      };
      
      const method = editingEvent ? "PUT" : "POST";
      const url = editingEvent ? `/api/events/${editingEvent._id}` : "/api/events";
      
      const json = await apiRequest(url, {
        method,
        body: JSON.stringify(payload)
      });
      
      if (json.success && bannerFile) {
        const uploadData = new FormData();
        uploadData.append("bannerImage", bannerFile);
        
        await apiRequest(`/api/events/${json.event._id}/banner`, {
          method: "POST",
          body: uploadData
        });
      }
      
      setIsModalOpen(false);
      setRefreshKey(k => k + 1);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (eventId) => {
    if (!window.confirm("Manually trigger Google Sheets sync? (Note: Automated sync runs every 5 mins)")) return;
    setSyncing(eventId);
    try {
      const json = await apiRequest(`/api/admin/events/${eventId}/sync`, { method: "POST" });
      alert(`Sync Success! Imported: ${json.stats?.imported || 0}, Skipped: ${json.stats?.skipped || 0}, Errors: ${json.stats?.errors || 0}\n\nDebug: ${JSON.stringify(json.stats?.debug?.colIdx)}`);
      setRefreshKey(k => k + 1);
    } catch (err) {
      alert(err.message);
    } finally {
      setSyncing(null);
    }
  };

  const [previewingGuestList, setPreviewingGuestList] = useState(null);
  const [importingGuestList, setImportingGuestList] = useState(null);
  const [syncingGuestList, setSyncingGuestList] = useState(null);
  const [guestListPreviewModal, setGuestListPreviewModal] = useState({ open: false, event: null, stats: null });
  const [connectSheetModal, setConnectSheetModal] = useState({ open: false, event: null, sheetId: "", tabName: "Sheet1" });
  const [connectSheetSaving, setConnectSheetSaving] = useState(false);

  const handleOpenConnectSheet = (event) => {
    setConnectSheetModal({
      open: true,
      event,
      sheetId: event.guestListSheetId || "",
      tabName: event.guestListTabName || "Sheet1"
    });
  };

  const handleSaveConnectSheet = async (e) => {
    e.preventDefault();
    if (!connectSheetModal.sheetId.trim()) {
      alert("Please enter a Google Sheet ID.");
      return;
    }
    setConnectSheetSaving(true);
    try {
      const ev = connectSheetModal.event;
      const payload = {
        name: ev.name,
        slug: ev.slug,
        date: ev.date,
        entryTime: ev.entryTime,
        venue: ev.venue,
        status: ev.status,
        prefix: ev.prefix,
        price: ev.price,
        googleSheetId: ev.googleSheetId || "",
        exportGoogleSheetId: ev.exportGoogleSheetId || "",
        guestListSheetId: connectSheetModal.sheetId.trim(),
        guestListTabName: connectSheetModal.tabName.trim() || "Sheet1",
        schools: ev.schools || [],
        displayOrder: ev.displayOrder,
        bannerImageUrl: ev.bannerImageUrl || "",
        tagline: ev.tagline || "",
        description: ev.description || "",
        eventTypeLabel: ev.eventTypeLabel || "PROM"
      };
      await apiRequest(`/api/events/${ev._id}`, { method: "PUT", body: JSON.stringify(payload) });
      setConnectSheetModal({ open: false, event: null, sheetId: "", tabName: "Sheet1" });
      setRefreshKey(k => k + 1);
    } catch (err) {
      alert(err.message);
    } finally {
      setConnectSheetSaving(false);
    }
  };

  const handleGuestListPreview = async (event) => {
    setPreviewingGuestList(event._id);
    try {
      const json = await apiRequest(`/api/admin/events/${event._id}/guest-list-preview`, { method: "POST" });
      setGuestListPreviewModal({ open: true, event, stats: json.stats });
    } catch (err) {
      alert(err.message);
    } finally {
      setPreviewingGuestList(null);
    }
  };

  const handleGuestListImport = async (event) => {
    setImportingGuestList(event._id);
    try {
      const json = await apiRequest(`/api/admin/events/${event._id}/guest-list-import`, { method: "POST" });
      alert(`Import Successful for ${event.name}!\n\nImported: ${json.stats?.importedCount || 0}\nCreated New: ${json.stats?.createdCount || 0}\nUpdated Existing: ${json.stats?.updatedCount || 0}\nInvalid Rows: ${json.stats?.invalidCount || 0}\nIn-sheet Duplicates: ${json.stats?.duplicateCount || 0}`);
      setGuestListPreviewModal({ open: false, event: null, stats: null });
      setRefreshKey(k => k + 1);
    } catch (err) {
      alert(err.message);
    } finally {
      setImportingGuestList(null);
    }
  };

  const handleGuestListSyncNow = async (event) => {
    setSyncingGuestList(event._id);
    try {
      const json = await apiRequest(`/api/admin/events/${event._id}/guest-list-sync`, { method: "POST" });
      alert(`Auto-Sync Successful for ${event.name}!\n\nNew Attendees: ${json.stats?.createdCount || 0}\nUpdated Profiles: ${json.stats?.updatedCount || 0}`);
      setRefreshKey(k => k + 1);
    } catch (err) {
      alert(err.message);
    } finally {
      setSyncingGuestList(null);
    }
  };

  return (
    <AdminLayout>
      <AdminHeader eyebrow="EVENT OPERATIONS" title="Events" badge={loading ? "LOADING MONGODB" : "LIVE MONGODB"} />
      <section className="admin-panel">
        <div className="admin-panel-title">
          <div>
            <h3>Event Registry</h3>
            <p className="muted">Manage available events, pricing, and sync operations.</p>
          </div>
          <button className="mini-admin-btn" onClick={() => handleOpenModal()}>CREATE EVENT</button>
        </div>
        {error && <div className="admin-empty-state">{error}</div>}

        <AdminTable
          columns={["Name", "Order", "Prefix", "Status", "Date/Time", "Price", "Sheet Sync", "Actions"]}
          rows={liveEvents}
          renderRow={(event) => (
            <tr key={event._id}>
              <td>
                <strong>{event.name}</strong><br/>
                <small className="muted">{event.venue}</small>
              </td>
              <td><strong>{event.displayOrder !== undefined && event.displayOrder !== null && event.displayOrder !== 999 ? event.displayOrder : "-"}</strong></td>
              <td><strong>{event.prefix}</strong></td>
              <td><span className={`status-badge ${statusClass(event.status)}`}>{event.status}</span></td>
              <td>
                {event.date ? new Date(event.date).toLocaleDateString() : "TBA"}<br/>
                <small className="muted">{event.entryTime}</small>
              </td>
              <td>{event.price} EGP</td>
              <td>
                {event.googleSheetId ? (
                  <div>
                    <span className={`status-badge ${statusClass(event.sync?.lastSyncStatus === "success" ? "Approved" : "Rejected")}`}>
                      {event.sync?.lastSyncStatus || "Pending"}
                    </span><br/>
                    <small className="muted">
                      {event.sync?.lastSyncAt ? new Date(event.sync.lastSyncAt).toLocaleString() : "Never synced"}
                    </small>
                  </div>
                ) : <span className="muted">No Sheet</span>}
              </td>
              <td>
                <div className="table-actions">
                  <button onClick={() => handleOpenModal(event)}>Edit</button>
                  {event.googleSheetId && (
                    <button onClick={() => handleSync(event._id)} disabled={syncing === event._id}>
                      {syncing === event._id ? "Syncing..." : "Sync Now"}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          )}
        />
        {!loading && liveEvents.length === 0 && <div className="admin-empty-state">NO EVENTS YET</div>}

        {/* GUEST LIST IMPORT SECTION */}
        <div style={{ marginTop: "2.5rem" }}>
          <div className="admin-panel-title">
            <div>
              <h3>GUEST LIST IMPORT</h3>
              <p className="muted">Event-specific Guest List Google Sheet import & pre-approval.</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem", marginTop: "1rem" }}>
            {liveEvents.map((event) => {
              const hasSheet = Boolean(event.guestListSheetId);
              const syncInfo = event.guestListSync || {};
              return (
                <div key={`gl-${event._id}`} className="admin-panel" style={{ background: "rgba(10,20,40,0.6)", border: "1px solid rgba(0,178,255,0.2)", borderRadius: "8px", padding: "1.25rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <div>
                      <strong style={{ fontSize: "1.1rem", color: "#fff" }}>{event.name}</strong>
                      <span className="status-badge active" style={{ marginLeft: "8px" }}>{event.prefix}</span>
                    </div>
                    <button className="mini-admin-btn" style={{ padding: "3px 8px", fontSize: "0.75rem" }} onClick={() => handleOpenConnectSheet(event)}>
                      {hasSheet ? "✏️ Change Sheet" : "+ Connect Sheet"}
                    </button>
                  </div>

                  <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "1rem" }}>
                    {hasSheet ? (
                      <>
                        <div style={{ marginBottom: "2px" }}><strong>Sheet ID:</strong> <code style={{ color: "#00b2ff" }}>{event.guestListSheetId}</code></div>
                        <div><strong>Tab Name:</strong> <code style={{ color: "#00b2ff" }}>{event.guestListTabName || "Sheet1"}</code></div>
                      </>
                    ) : (
                      <div style={{ color: "#ffb3c6" }}>No Guest List Sheet connected yet. Click &quot;Connect Sheet&quot; to save Sheet ID.</div>
                    )}
                  </div>

                  {syncInfo.lastImportAt && (
                    <div style={{ background: "rgba(255,255,255,0.03)", padding: "0.75rem", borderRadius: "6px", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                      <div style={{ color: "#94a3b8", marginBottom: "4px" }}>
                        <strong>LAST MANUAL IMPORT:</strong> {new Date(syncInfo.lastImportAt).toLocaleString()}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                        <span>Imported: <strong>{syncInfo.importedCount || 0}</strong></span>
                        <span>Created: <strong>{syncInfo.createdCount || 0}</strong></span>
                        <span>Updated: <strong>{syncInfo.updatedCount || 0}</strong></span>
                        <span>Invalid: <strong style={{ color: syncInfo.invalidCount > 0 ? "#ffb3c6" : "inherit" }}>{syncInfo.invalidCount || 0}</strong></span>
                      </div>
                    </div>
                  )}

                  {syncInfo.lastAutoSyncAt && (
                    <div style={{ background: "rgba(0,178,255,0.05)", border: "1px solid rgba(0,178,255,0.2)", padding: "0.75rem", borderRadius: "6px", fontSize: "0.8rem", marginBottom: "1rem" }}>
                      <div style={{ color: "#00b2ff", marginBottom: "4px" }}>
                        <strong>LAST AUTO-SYNC:</strong> {new Date(syncInfo.lastAutoSyncAt).toLocaleString()}
                        {syncInfo.lastAutoSyncStatus === "error" && <span style={{ color: "#ffb3c6", marginLeft: "8px" }}>(FAILED)</span>}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                        <span>Created: <strong>{syncInfo.lastAutoSyncCreated || 0}</strong></span>
                        <span>Updated: <strong>{syncInfo.lastAutoSyncUpdated || 0}</strong></span>
                        <span>Invalid: <strong style={{ color: syncInfo.lastAutoSyncInvalid > 0 ? "#ffb3c6" : "inherit" }}>{syncInfo.lastAutoSyncInvalid || 0}</strong></span>
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      className="purple-btn"
                      style={{ flex: "1 1 45%", padding: "8px", fontSize: "0.85rem" }}
                      onClick={() => handleGuestListPreview(event)}
                      disabled={!hasSheet || previewingGuestList === event._id}
                    >
                      {previewingGuestList === event._id ? "Previewing..." : "Preview Import"}
                    </button>
                    <button
                      className="ghost-btn"
                      style={{ flex: "1 1 45%", padding: "8px", fontSize: "0.85rem" }}
                      onClick={() => handleGuestListImport(event)}
                      disabled={!hasSheet || importingGuestList === event._id}
                    >
                      {importingGuestList === event._id ? "Importing..." : syncInfo.lastImportAt ? "Re-import" : "Import Valid"}
                    </button>
                    <button
                      className="admin-btn"
                      style={{ flex: "1 1 100%", padding: "8px", fontSize: "0.85rem", marginTop: "4px" }}
                      onClick={() => handleGuestListSyncNow(event)}
                      disabled={!hasSheet || syncingGuestList === event._id}
                    >
                      {syncingGuestList === event._id ? "Syncing..." : "Sync Now"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* PREVIEW MODAL */}
      {guestListPreviewModal.open && guestListPreviewModal.stats && (
        <div className="admin-modal-overlay">
          <div className="admin-modal" style={{ maxWidth: "600px" }}>
            <h3>Guest List Import Preview — {guestListPreviewModal.event.name}</h3>
            <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
              Review the breakdown below before writing records to MongoDB.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.25rem" }}>
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "6px" }}>
                <span className="muted" style={{ fontSize: "0.75rem" }}>TOTAL SHEET ROWS</span>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold" }}>{guestListPreviewModal.stats.totalRows}</div>
              </div>
              <div style={{ background: "rgba(0,178,255,0.1)", padding: "10px", borderRadius: "6px", border: "1px solid rgba(0,178,255,0.3)" }}>
                <span className="muted" style={{ fontSize: "0.75rem" }}>VALID ROWS</span>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#00b2ff" }}>{guestListPreviewModal.stats.validRowsCount}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "6px" }}>
                <span className="muted" style={{ fontSize: "0.75rem" }}>NEW GUESTS TO CREATE</span>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4ade80" }}>+{guestListPreviewModal.stats.willCreate}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "6px" }}>
                <span className="muted" style={{ fontSize: "0.75rem" }}>EXISTING GUESTS TO UPDATE</span>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#facc15" }}>{guestListPreviewModal.stats.willUpdate}</div>
              </div>
              <div style={{ background: "rgba(255,51,102,0.1)", padding: "10px", borderRadius: "6px" }}>
                <span className="muted" style={{ fontSize: "0.75rem" }}>INVALID PHONE NUMBERS</span>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#ff3366" }}>{guestListPreviewModal.stats.invalidPhones}</div>
              </div>
              <div style={{ background: "rgba(255,51,102,0.1)", padding: "10px", borderRadius: "6px" }}>
                <span className="muted" style={{ fontSize: "0.75rem" }}>MISSING FULL NAMES</span>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#ff3366" }}>{guestListPreviewModal.stats.missingNames}</div>
              </div>
            </div>

            {guestListPreviewModal.stats.sampleRows && guestListPreviewModal.stats.sampleRows.length > 0 && (
              <div style={{ marginBottom: "1.25rem" }}>
                <strong style={{ fontSize: "0.85rem", color: "#94a3b8" }}>SAMPLE VALID ROWS (FIRST 5):</strong>
                <div style={{ overflowX: "auto", marginTop: "6px" }}>
                  <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.05)", textAlign: "left" }}>
                        <th style={{ padding: "6px" }}>Row</th>
                        <th style={{ padding: "6px" }}>Full Name</th>
                        <th style={{ padding: "6px" }}>Phone Number</th>
                        <th style={{ padding: "6px" }}>School</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guestListPreviewModal.stats.sampleRows.map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px" }}>{row.rowIndex}</td>
                          <td style={{ padding: "6px" }}>{row.fullName}</td>
                          <td style={{ padding: "6px" }}>{row.phone}</td>
                          <td style={{ padding: "6px" }}>{row.school || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="admin-modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setGuestListPreviewModal({ open: false, event: null, stats: null })}>
                Cancel
              </button>
              <button
                type="button"
                className="purple-btn"
                disabled={importingGuestList === guestListPreviewModal.event._id || guestListPreviewModal.stats.validRowsCount === 0}
                onClick={() => handleGuestListImport(guestListPreviewModal.event)}
              >
                {importingGuestList === guestListPreviewModal.event._id ? "Importing..." : "CONFIRM & IMPORT VALID GUESTS"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <h3>{editingEvent ? "Edit Event" : "Create Event"}</h3>
            <form autoComplete="off" onSubmit={handleSave}>
              <div className="form-group">
                <label>Event Name</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Slug</label>
                  <input required value={formData.slug} onChange={e => setFormData({...formData, slug: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Prefix (e.g. ORB)</label>
                  <input required value={formData.prefix} onChange={e => setFormData({...formData, prefix: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Type Label (e.g. PROM, AFTERPARTY)</label>
                  <input value={formData.eventTypeLabel} onChange={e => setFormData({...formData, eventTypeLabel: e.target.value})} placeholder="PROM" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Date</label>
                  <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Entry Time</label>
                  <input required value={formData.entryTime} onChange={e => setFormData({...formData, entryTime: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Price (EGP)</label>
                  <input type="number" required value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Display Order</label>
                  <input type="number" value={formData.displayOrder} min="1" onChange={e => setFormData({...formData, displayOrder: e.target.value})} placeholder="e.g. 1" />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                    <option value="available">Available</option>
                    <option value="sold out">Sold Out</option>
                    <option value="not available">Not Available</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Schools (Comma separated)</label>
                <input value={formData.schools} onChange={e => setFormData({...formData, schools: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Google Sheet ID (For Sync)</label>
                <input value={formData.googleSheetId} onChange={e => setFormData({...formData, googleSheetId: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Export Google Sheet ID (For Confirmed Outcomers)</label>
                <input value={formData.exportGoogleSheetId} onChange={e => setFormData({...formData, exportGoogleSheetId: e.target.value})} placeholder="Live sync target sheet ID" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Guest List Google Sheet ID</label>
                  <input value={formData.guestListSheetId} onChange={e => setFormData({...formData, guestListSheetId: e.target.value})} placeholder="e.g. 1LOqW8mFVRUvB8vM4qC5oWbcqRlhDOkPJkwALoV9N2vI" />
                </div>
                <div className="form-group">
                  <label>Guest List Sheet Tab Name</label>
                  <input value={formData.guestListTabName} onChange={e => setFormData({...formData, guestListTabName: e.target.value})} placeholder="Sheet1" />
                </div>
              </div>
              <div className="form-group">
                <label>Tagline (e.g. NO BEGINNING. NO END.)</label>
                <input value={formData.tagline} onChange={e => setFormData({...formData, tagline: e.target.value})} placeholder="Blue subtitle on event card" />
              </div>
              <div className="form-group">
                <label>Description (Short)</label>
                <textarea rows="3" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Gray descriptive text" style={{width: '100%', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.2)'}}></textarea>
              </div>
              <div className="form-group">
                <label>Banner Image URL (Existing or Cloudinary URL)</label>
                <input value={formData.bannerImageUrl} onChange={e => setFormData({...formData, bannerImageUrl: e.target.value})} placeholder="https://res.cloudinary.com/..." />
              </div>
              <div className="form-group">
                <label>Or Upload New Banner Image (Saved on Submit)</label>
                <input type="file" accept="image/*" onChange={e => setBannerFile(e.target.files[0])} />
                {bannerFile && <div style={{marginTop: 5, fontSize: 12, color: '#00b2ff'}}>Image selected for upload on save.</div>}
              </div>
              
              <div className="admin-modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Event"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* CONNECT SHEET MODAL */}
      {connectSheetModal.open && (
        <div className="admin-modal-overlay" onClick={() => setConnectSheetModal({ open: false, event: null, sheetId: "", tabName: "Sheet1" })}>
          <div className="admin-modal" style={{ maxWidth: "480px" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: "0.25rem" }}>Connect Guest List Sheet</h3>
            <p className="muted" style={{ marginBottom: "1.5rem", fontSize: "0.85rem" }}>
              Event: <strong style={{ color: "#fff" }}>{connectSheetModal.event?.name}</strong>
            </p>
            <form autoComplete="off" onSubmit={handleSaveConnectSheet}>
              <div className="form-group">
                <label>Google Sheet ID</label>
                <input
                  required
                  placeholder="e.g. 1LOqW8mFVRUvB8vM4qC5oWbcqRlhDOkPJkwALoV9N2vI"
                  value={connectSheetModal.sheetId}
                  onChange={e => setConnectSheetModal(m => ({ ...m, sheetId: e.target.value }))}
                  style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                />
                <small className="muted">Paste the ID from the Google Sheets URL — the long string after /d/</small>
              </div>
              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Sheet Tab Name</label>
                <input
                  required
                  placeholder="Sheet1"
                  value={connectSheetModal.tabName}
                  onChange={e => setConnectSheetModal(m => ({ ...m, tabName: e.target.value }))}
                />
                <small className="muted">The exact name of the tab (bottom of the sheet) containing your guest list</small>
              </div>
              <div className="admin-modal-actions" style={{ marginTop: "1.5rem" }}>
                <button type="button" className="btn-secondary" onClick={() => setConnectSheetModal({ open: false, event: null, sheetId: "", tabName: "Sheet1" })}>Cancel</button>
                <button type="submit" disabled={connectSheetSaving}>{connectSheetSaving ? "Saving..." : "Save Sheet Settings"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
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
          columns={["Full Name", "Phone Number", "Email", "School / Origin Prom", "Age", "Instagram Username", "Status / Current Phase", "Prom", "Venue Entry"]}
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
              <td>
                <span className={`status-badge ${attendee.isUsed ? "active" : ""}`} style={attendee.isUsed ? {background:"rgba(0,200,100,0.15)",color:"#00c864"} : {opacity:0.45}}>
                  {attendee.isUsed ? "YES" : "NO"}
                </span>
                {attendee.scannedAt && <div style={{fontSize:"0.7rem",opacity:0.6,marginTop:"2px"}}>{attendee.scannedAt}</div>}
              </td>
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
                {request.paymentProof?.url ? (
                  <div><span>PAYMENT PROOF</span><strong><a href={request.paymentProof.url} target="_blank" rel="noreferrer" style={{color: "var(--accent)"}}>View Proof</a></strong></div>
                ) : (
                  <div><span>PAYMENT PROOF</span><strong style={{opacity: 0.45}}>Not Uploaded</strong></div>
                )}
                {request.outcomerPhoto?.url ? (
                  <div><span>CLIENT PHOTO</span><strong><a href={request.outcomerPhoto.url} target="_blank" rel="noreferrer" style={{color: "var(--accent)"}}>View Photo</a></strong></div>
                ) : (
                  <div><span>CLIENT PHOTO</span><strong style={{opacity: 0.45}}>Not Uploaded</strong></div>
                )}
                <div>
                  <span>VENUE ENTRY</span>
                  <strong>
                    <span className={`status-badge ${request.isUsed ? "active" : ""}`} style={request.isUsed ? {background:"rgba(0,200,100,0.15)",color:"#00c864"} : {opacity:0.45}}>
                      {request.isUsed ? "YES" : "NO"}
                    </span>
                  </strong>
                </div>
                {request.scannedAt && (
                  <div><span>SCANNED AT</span><strong>{request.scannedAt}</strong></div>
                )}
                <div><span>SCAN COUNT</span><strong>{request.scanCount || 0}</strong></div>
              </div>
              <div className="outcomer-status-row">
                <span className={`status-badge ${statusClass(request.applicationStatus)}`}>{request.applicationStatus}</span>
                <div className="table-actions">
                  {request.applicationStatus !== "Approved" && request.applicationStatus !== "Rejected" && (
                    <>
                      <button type="button" onClick={() => updateStatus(request.id, "Approved")}>Approve</button>
                      <button type="button" onClick={() => updateStatus(request.id, "Rejected")}>Reject</button>
                    </>
                  )}
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
              {payment.paymentStatus !== "Verified" && payment.paymentStatus !== "Rejected" && (
                <>
                  <button type="button" onClick={() => updatePayment(payment.id, "Verified")}>Approve Payment</button>
                  <button type="button" onClick={() => updatePayment(payment.id, "Rejected")}>Reject Payment</button>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
      {!loading && payments.length === 0 && <div className="admin-empty-state">NO MONGODB PAYMENT RECORDS YET</div>}
    </AdminLayout>
  );
}

// Session-level camera permission cache: avoids re-prompting every time the
// scanner page is mounted during the same browser session.
const _sessionCameraGranted = { current: false };

function ScannerAttendeeCard({ attendee, isAlreadyScanned }) {
  if (!attendee) return null;

  const photoUrl = attendee.outcomerPhoto?.url || attendee.outcomerPhoto;

  return (
    <div className="scanner-attendee-card">
      <div className="scanner-attendee-photo-container">
        {photoUrl ? (
          <img src={photoUrl} alt="Attendee" className="scanner-attendee-photo" />
        ) : (
          <div className="scanner-attendee-no-photo">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            <span>No Photo</span>
          </div>
        )}
      </div>
      <div className="scanner-attendee-details">
        <p><strong>Name:</strong> {attendee.fullName || attendee.name || "N/A"}</p>
        <p><strong>Access Type:</strong> {normalizeStatusLabel(attendee.accessType || attendee.attendeeType || "N/A")}</p>
        <p><strong>Phone:</strong> {attendee.phone || attendee.phoneNumber || "N/A"}</p>
        {attendee.university && attendee.university !== "—" && <p><strong>School:</strong> {attendee.university}</p>}
        {attendee.eventName && attendee.eventName !== "N/A" && <p><strong>Event:</strong> {attendee.eventName}</p>}
        
        {isAlreadyScanned && attendee.scannedAt && (
          <div className="scanner-already-scanned-warning">
            <p><strong>Original Scan:</strong> {new Date(attendee.scannedAt).toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
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
  // In-flight lock: prevents two concurrent validateScan calls (double-tap, rapid reads)
  const isValidatingRef = useRef(false);

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
    const attendee = requestError.attendee;

    if (normalized.includes("used") || normalized.includes("already") || normalized.includes("scanned")) {
      return { title: "Already Scanned", detail, status: "used", attendee };
    }

    if (
      normalized.includes("status") ||
      normalized.includes("pending") ||
      normalized.includes("review") ||
      normalized.includes("rejected") ||
      normalized.includes("declined") ||
      normalized.includes("not approved")
    ) {
      return { title: "Access Denied", detail, status: "denied", attendee };
    }

    return { title: "Invalid QR", detail, status: "invalid", attendee };
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

    // In-flight lock: ignore rapid duplicate reads / double-taps
    if (isValidatingRef.current) return;
    isValidatingRef.current = true;

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

      // Correctly distinguish "Already Scanned" (valid=false, reason contains 'already')
      // from a generic access-denied so the UI shows the right colour/title.
      const reasonText = (result.reason || "").toLowerCase();
      const isAlreadyScanned = !result.valid && (reasonText.includes("already") || reasonText.includes("scanned"));

      setScanResult(
        isAlreadyScanned
          ? { title: "Already Scanned", detail: result.reason, status: "used", attendee: result.attendee }
          : {
              title: result.valid ? "Access Granted" : "Access Denied",
              detail: result.message || result.reason || attendeeDetail,
              status: result.valid ? "active" : "denied",
              attendee: result.attendee
            }
      );
    } catch (requestError) {
      setScanValue(qrCredential);
      setScanResult(formatScannerError(requestError));
    } finally {
      // Release the lock after a 1.5 s cooldown so the camera won't re-read
      // the same QR label while it's still in frame.
      setTimeout(() => { isValidatingRef.current = false; }, 1500);
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
    isValidatingRef.current = false;
    setScanResult(null);
    setCameraStatus("starting");

    // Only show the "requesting permission" message the very first time this session.
    // After permission is already granted, the browser opens the camera immediately
    // without any prompt, so there is no need to tell the user to wait.
    setCameraMessage(_sessionCameraGranted.current ? "Starting camera..." : "Requesting camera permission...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      // Mark permission as granted for the rest of this browser session
      _sessionCameraGranted.current = true;

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
        _sessionCameraGranted.current = false;
        setCameraStatus("denied");
        setCameraMessage("Camera permission was denied. Please enable camera access in your browser settings, then tap Start Camera again.");
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
            {scanResult.attendee && (
              <ScannerAttendeeCard 
                attendee={scanResult.attendee} 
                isAlreadyScanned={scanResult.status === "used"} 
              />
            )}
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
    settings: { outcomerSelection: DEFAULT_OUTCOMER_SELECTION, guestListDisplayCount: 137, instapayLink: "https://instapay.example/alshayeb" }
  });
  const [message, setMessage] = useState("");
  const selection = {
    ...DEFAULT_OUTCOMER_SELECTION,
    ...(data.settings?.outcomerSelection || {})
  };
  const guestListDisplayCount = data.settings?.guestListDisplayCount ?? 137;
  const instapayLinkValue = data.settings?.instapayLink ?? "https://instapay.example/alshayeb";
  const roomsInstapayLinkValue = data.settings?.roomsInstapayLink ?? "instapay://pay?pa=alshayeb@instapay";

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

  const updateGuestListDisplayCount = (value) => {
    setMessage("");
    setData((prev) => ({
      ...prev,
      settings: {
        ...(prev.settings || {}),
        guestListDisplayCount: value
      }
    }));
  };

  const updateInstapayLink = (value) => {
    setMessage("");
    setData((prev) => ({
      ...prev,
      settings: {
        ...(prev.settings || {}),
        instapayLink: value
      }
    }));
  };

  const updateRoomsInstapayLink = (value) => {
    setMessage("");
    setData((prev) => ({
      ...prev,
      settings: {
        ...(prev.settings || {}),
        roomsInstapayLink: value
      }
    }));
  };

  const saveSettings = async () => {
    setMessage("");
    const guestCountNumber = Number(guestListDisplayCount);

    if (!Number.isFinite(guestCountNumber) || guestCountNumber < 0) {
      setMessage("Guest List Display Count must be 0 or higher.");
      return;
    }

    try {
      const result = await apiRequest("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          outcomerSelection: selection,
          guestListDisplayCount: Math.floor(guestCountNumber),
          instapayLink: instapayLinkValue,
          roomsInstapayLink: roomsInstapayLinkValue
        })
      });
      setData(result);
      setMessage("Settings updated successfully.");
    } catch (requestError) {
      setMessage(requestError.message || "Could not update settings.");
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
          <label><span>Guest List Display Count</span><input type="number" min="0" value={guestListDisplayCount} onChange={(event) => updateGuestListDisplayCount(event.target.value)} /></label>
        </div>
        <button className="purple-btn settings-save" type="button" onClick={saveSettings} disabled={loading}>SAVE SETTINGS</button>
        {message && <div className="admin-empty-state">{message}</div>}
      </section>
      <section className="admin-panel">
        <div className="settings-grid">
          <label><span>InstaPay Link (QR Events)</span><input value={instapayLinkValue} onChange={(e) => updateInstapayLink(e.target.value)} /></label>
          <label><span>InstaPay Link (Rooms)</span><input value={roomsInstapayLinkValue} onChange={(e) => updateRoomsInstapayLink(e.target.value)} /></label>
          <label><span>Default Registration Fee</span><input defaultValue="Dynamic based on event" disabled /></label>
          <label><span>QR Reveal Time</span><input defaultValue="2026-12-31T18:00:00" /></label>
          <label><span>Venue Name</span><input defaultValue="ALSHAYEB ETERNUM" /></label>
          <label><span>Event Background Image</span><input defaultValue="eternum-reference" /></label>
          <label><span>Registration Open / Closed</span><select defaultValue="Open"><option>Open</option><option>Closed</option></select></label>
        </div>
        <button className="purple-btn settings-save" type="button" onClick={saveSettings} disabled={loading}>SAVE SETTINGS</button>
      </section>
    </AdminLayout>
  );
}

const PublicHamburgerMenu = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    const handleClickOutside = (e) => {
      if (!e.target.closest(".floating-menu-container")) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.addEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="floating-menu-container">
      <button 
        className={`floating-hamburger-btn ${isOpen ? "open" : ""}`} 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        aria-label="Menu"
        type="button"
      >
        <span className="ham-line"></span>
        <span className="ham-line"></span>
        <span className="ham-line"></span>
      </button>
      
      {isOpen && (
        <div className="floating-menu-dropdown">
          <button 
            className="floating-menu-item"
            onClick={() => {
              setIsOpen(false);
              window.dispatchEvent(new CustomEvent("forceGoHome"));
            }}
            type="button"
          >
            HOME
          </button>
          <a
            className="floating-menu-item"
            href="/rooms"
            onClick={(e) => {
              // Standard link behavior unless they are already in React router
              setIsOpen(false);
            }}
          >
            ROOMS
          </a>
          <a 
            className="floating-menu-item"
            href="https://www.instagram.com/alshayebexperience?igsh=bGY0dmxvZXAwd3dr" 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={() => setIsOpen(false)}
          >
            INSTAGRAM
          </a>
          <a 
            className="floating-menu-item"
            href="https://www.tiktok.com/@alshayebexperience?_r=1&_t=ZS-97UW4Hhql9t" 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={() => setIsOpen(false)}
          >
            TIKTOK
          </a>
        </div>
      )}
    </div>
  );
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div className="eternum-global-bg"><PublicWebsite /><PublicHamburgerMenu /></div>} />
        <Route path="/rooms" element={<div className="eternum-global-bg"><RoomsApp /></div>} />
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
        <Route path="/rooms-control" element={<RoomsAdminLogin />} />
        <Route
          path="/rooms-control/dashboard"
          element={
            <ProtectedRoomsAdminRoute>
              <AdminRooms />
            </ProtectedRoomsAdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}



function RoomsAdminLogin() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isAdminAuthenticated()) {
    return <Navigate to="/rooms-control/dashboard" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoginError("");
    setIsSubmitting(true);
    try {
      const result = await apiRequest("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(credentials.email ?? "").trim(),
          password: credentials.password
        })
      });
      const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
      localStorage.setItem(
        ADMIN_SESSION_KEY,
        JSON.stringify({
          authenticated: true,
          email: String(credentials.email ?? "").trim().toLowerCase(),
          token: result.token,
          expiresAt: Date.now() + EIGHT_HOURS_MS,
          signedInAt: new Date().toISOString()
        })
      );
      navigate("/rooms-control/dashboard", { replace: true });
    } catch (err) {
      setLoginError(err.message || "Invalid admin email or password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell admin-page admin-bg tone-gold">
      <AnimatedBackground />
      <motion.form className="cosmic-card tone-card admin-login-card" {...pageMotion} onSubmit={handleSubmit}>
        <div className="ring small-ring"></div>
        <h3>ALSHAYEB</h3>
        <h1 className="brand-title">ROOMS CONTROL</h1>
        <p className="muted">ROOMS ADMIN ACCESS</p>
        <input className={loginError ? "error-input" : ""} type="email" placeholder="Admin email" value={credentials.email} onChange={(e) => { setCredentials(p => ({...p, email: e.target.value})); setLoginError(""); }} />
        <input className={loginError ? "error-input" : ""} type="password" placeholder="Password" value={credentials.password} onChange={(e) => { setCredentials(p => ({...p, password: e.target.value})); setLoginError(""); }} />
        {loginError && <p className="field-error center-error">{loginError}</p>}
        <button className="purple-btn" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "AUTHENTICATING..." : "ENTER ROOMS CONTROL"}
        </button>
        <Link className="admin-link" to="/">
          BACK TO PUBLIC SITE
        </Link>
      </motion.form>
    </div>
  );
}

function RoomsAdminLayout({ children, view, setView }) {
  const navigate = useNavigate();
  const navItems = [
    { label: "Hotels", id: "hotels" },
    { label: "Room Types", id: "roomTypes" },
    { label: "Reservations", id: "reservations" }
  ];

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    navigate("/rooms-control", { replace: true });
  };

  return (
    <div className="admin-control-page admin-bg tone-gold">
      <AnimatedBackground />
      <motion.div className="admin-control-shell" {...pageMotion}>
        <aside className="admin-sidebar">
          <div>
            <span>ALSHAYEB</span>
            <h1>ROOMS</h1>
          </div>
          <nav>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView && setView(item.id)}
                className={view === item.id ? "active-admin-link" : "admin-sidebar-btn"}
              >
                {item.label}
              </button>
            ))}
            <Link to="/">Public Site</Link>
            <button className="ghost-btn admin-logout" onClick={handleLogout}>
              LOG OUT
            </button>
          </nav>
        </aside>
        <main className="admin-main">{children}</main>
      </motion.div>
    </div>
  );
}

// --- ROOMS ADMIN ---
function AdminRooms() {
  const [hotels, setHotels] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('hotels');

  // Modals
  const [hotelModalOpen, setHotelModalOpen] = useState(false);
  const [editingHotel, setEditingHotel] = useState(null);
  const [hotelForm, setHotelForm] = useState({ name: '', description: '', status: 'available', startingPrice: 0, displayOrder: 999 });

  const [roomTypeModalOpen, setRoomTypeModalOpen] = useState(false);
  const [editingRoomType, setEditingRoomType] = useState(null);
  const [roomTypeForm, setRoomTypeForm] = useState({ hotelId: '', name: '', capacity: 2, breakfastIncluded: false, pricePerNight: 0, status: 'available', displayOrder: 999 });

  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [viewingProof, setViewingProof] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, rtRes, rRes] = await Promise.all([
        apiRequest('/api/admin/rooms/hotels'),
        apiRequest('/api/admin/rooms/room-types'),
        apiRequest('/api/admin/rooms/reservations')
      ]);
      setHotels(hRes.hotels || []);
      setRoomTypes(rtRes.roomTypes || []);
      setReservations(rRes.reservations || []);
    } catch (e) {
      console.error(e);
      alert("Failed to load rooms data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const saveHotel = async (e) => {
    e.preventDefault();
    try {
      const url = editingHotel ? `/api/admin/rooms/hotels/${editingHotel._id}` : '/api/admin/rooms/hotels';
      await apiRequest(url, { method: editingHotel ? 'PUT' : 'POST', body: JSON.stringify(hotelForm) });
      setHotelModalOpen(false);
      loadData();
    } catch(err) { alert(err.message); }
  };

  const deleteHotel = async (id) => {
    if (!window.confirm("Are you sure? This deletes the hotel and all its room types.")) return;
    try {
      await apiRequest(`/api/admin/rooms/hotels/${id}`, { method: 'DELETE' });
      loadData();
    } catch(err) { alert(err.message); }
  };

  const saveRoomType = async (e) => {
    e.preventDefault();
    try {
      const url = editingRoomType ? `/api/admin/rooms/room-types/${editingRoomType._id}` : '/api/admin/rooms/room-types';
      await apiRequest(url, { method: editingRoomType ? 'PUT' : 'POST', body: JSON.stringify(roomTypeForm) });
      setRoomTypeModalOpen(false);
      loadData();
    } catch(err) { alert(err.message); }
  };

  const deleteRoomType = async (id) => {
    if (!window.confirm("Delete this room type?")) return;
    try {
      await apiRequest(`/api/admin/rooms/room-types/${id}`, { method: 'DELETE' });
      loadData();
    } catch(err) { alert(err.message); }
  };

  const updateReservationStatus = async (id, status, paymentStatus) => {
    if (!window.confirm(`Are you sure you want to change this reservation to ${status}?`)) return;
    try {
      await apiRequest(`/api/admin/rooms/reservations/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ reservationStatus: status, paymentStatus })
      });
      loadData();
    } catch(err) { alert(err.message); }
  };

  return (
    <RoomsAdminLayout view={view} setView={setView}>
      <AdminHeader eyebrow="ROOMS CONTROL" title="Rooms Administration" />
      <div className="admin-tabs" style={{ display: 'none', gap: '1rem', marginBottom: '2rem' }}>
        <button className={view === 'hotels' ? 'admin-tab active' : 'admin-tab'} onClick={() => setView('hotels')}>Hotels</button>
        <button className={view === 'roomTypes' ? 'admin-tab active' : 'admin-tab'} onClick={() => setView('roomTypes')}>Room Types</button>
        <button className={view === 'reservations' ? 'admin-tab active' : 'admin-tab'} onClick={() => setView('reservations')}>Reservations</button>
      </div>

      <div className="admin-panel">
        {loading ? <p>Loading...</p> : (
          <>
            {view === 'hotels' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 className="admin-panel-title">Manage Hotels</h3>
                  <button className="eternum-button primary small" onClick={() => { setEditingHotel(null); setHotelForm({ name: '', description: '', status: 'available', startingPrice: 0, displayOrder: 999 }); setHotelModalOpen(true); }}>+ Add Hotel</button>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Starting Price</th><th>Actions</th></tr></thead>
                    <tbody>
                      {hotels.map(h => (
                        <tr key={h._id}>
                          <td>{h.name}</td>
                          <td>{h.status}</td>
                          <td>{h.startingPrice} EGP</td>
                          <td>
                            <button className="action-button edit" onClick={() => { setEditingHotel(h); setHotelForm(h); setHotelModalOpen(true); }}>Edit</button>
                            <button className="action-button danger" onClick={() => deleteHotel(h._id)}>Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {view === 'roomTypes' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 className="admin-panel-title">Manage Room Types</h3>
                  <button className="eternum-button primary small" onClick={() => { setEditingRoomType(null); setRoomTypeForm({ hotelId: hotels[0]?._id || '', name: '', capacity: 2, breakfastIncluded: false, pricePerNight: 0, status: 'available', displayOrder: 999 }); setRoomTypeModalOpen(true); }}>+ Add Room Type</button>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th>Hotel</th><th>Name</th><th>Capacity</th><th>Price</th><th>Actions</th></tr></thead>
                    <tbody>
                      {roomTypes.map(rt => {
                        const h = hotels.find(ht => ht._id === rt.hotelId);
                        return (
                        <tr key={rt._id}>
                          <td>{h ? h.name : 'Unknown'}</td>
                          <td>{rt.name}</td>
                          <td>{rt.capacity}</td>
                          <td>{rt.pricePerNight} EGP</td>
                          <td>
                            <button className="action-button edit" onClick={() => { setEditingRoomType(rt); setRoomTypeForm(rt); setRoomTypeModalOpen(true); }}>Edit</button>
                            <button className="action-button danger" onClick={() => deleteRoomType(rt._id)}>Delete</button>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {view === 'reservations' && (
              <div>
                <h3 className="admin-panel-title">Manage Reservations</h3>
                <div className="payment-review-grid">
                  {reservations.map(r => (
                    <section className="admin-panel payment-card" key={r._id}>
                      <div className="screenshot-preview">
                        {r.paymentProofUrl ? (
                          <img src={r.paymentProofUrl} alt={`${r.fullName} payment proof`} onClick={() => { setViewingProof(r.paymentProofUrl); setProofModalOpen(true); }} style={{ cursor: 'pointer' }} />
                        ) : (
                          <span>No screenshot uploaded.</span>
                        )}
                      </div>
                      <div className="payment-info">
                        <h3>{r.fullName}</h3>
                        <p className="muted">{r.phoneNumber}</p>
                        <div><span>ID</span><strong>{r.reservationId}</strong></div>
                        <div><span>NATIONAL ID</span><strong>{r.nationalId}</strong></div>
                        <div><span>EMAIL</span><strong>{r.emailAddress}</strong></div>
                        <div><span>HOTEL</span><strong>{r.hotelId?.name || "N/A"}</strong></div>
                        <div><span>ROOM</span><strong>{r.roomTypeId?.name || "N/A"}</strong></div>
                        <div><span>CHECK-IN</span><strong>{new Date(r.checkInDate).toLocaleDateString()}</strong></div>
                        <div><span>CHECK-OUT</span><strong>{new Date(r.checkOutDate).toLocaleDateString()}</strong></div>
                        <div><span>DURATION</span><strong>{r.stayDuration} NIGHT(S)</strong></div>
                        <div><span>TOTAL AMOUNT</span><strong>{r.totalAmount} EGP</strong></div>
                        <div><span>PAYMENT STATUS</span><strong><span className={`status-badge ${statusClass(r.paymentStatus)}`}>{r.paymentStatus.replace(/_/g, ' ')}</span></strong></div>
                        <div><span>RESERVATION STATUS</span><strong><span className={`status-badge ${statusClass(r.reservationStatus)}`}>{r.reservationStatus.replace(/_/g, ' ')}</span></strong></div>
                      </div>
                      <div className="table-actions payment-actions">
                        {r.reservationStatus === 'pending_review' && (
                          <>
                            <button type="button" onClick={() => updateReservationStatus(r._id, 'confirmed', 'verified')}>Confirm</button>
                            <button type="button" onClick={() => updateReservationStatus(r._id, 'declined', 'rejected')}>Decline</button>
                          </>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {hotelModalOpen && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <h3 className="modal-title">{editingHotel ? "Edit Hotel" : "Create Hotel"}</h3>
            <form onSubmit={saveHotel}>
              <div className="form-group"><label>Name</label><input type="text" value={hotelForm.name} onChange={e => setHotelForm({...hotelForm, name: e.target.value})} required className="eternum-input" /></div>
              <div className="form-group"><label>Description</label><textarea value={hotelForm.description} onChange={e => setHotelForm({...hotelForm, description: e.target.value})} className="eternum-input" /></div>
              <div className="form-group"><label>Starting Price</label><input type="number" value={hotelForm.startingPrice} onChange={e => setHotelForm({...hotelForm, startingPrice: e.target.value})} className="eternum-input" /></div>
              <div className="form-group"><label>Status</label><select value={hotelForm.status} onChange={e => setHotelForm({...hotelForm, status: e.target.value})} className="eternum-input"><option value="available">Available</option><option value="fully_booked">Fully Booked</option><option value="hidden">Hidden</option><option value="not_available">Not Available</option></select></div>
              <div className="modal-actions"><button type="button" className="eternum-button secondary" onClick={() => setHotelModalOpen(false)}>Cancel</button><button type="submit" className="eternum-button primary">Save Hotel</button></div>
            </form>
          </div>
        </div>
      )}

      {roomTypeModalOpen && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <h3 className="modal-title">{editingRoomType ? "Edit Room Type" : "Create Room Type"}</h3>
            <form onSubmit={saveRoomType}>
              <div className="form-group"><label>Hotel</label><select value={roomTypeForm.hotelId} onChange={e => setRoomTypeForm({...roomTypeForm, hotelId: e.target.value})} required className="eternum-input"><option value="">Select Hotel</option>{hotels.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}</select></div>
              <div className="form-group"><label>Name</label><input type="text" value={roomTypeForm.name || ''} onChange={e => setRoomTypeForm({...roomTypeForm, name: e.target.value})} required className="eternum-input" /></div>
              <div className="form-group"><label>Description</label><textarea value={roomTypeForm.description || ''} onChange={e => setRoomTypeForm({...roomTypeForm, description: e.target.value})} className="eternum-input" rows="3" placeholder="A private room for one person"></textarea></div>
              <div className="form-group"><label>Capacity</label><input type="number" value={roomTypeForm.capacity || ''} onChange={e => setRoomTypeForm({...roomTypeForm, capacity: e.target.value})} required className="eternum-input" /></div>
              <div className="form-group"><label>Price Per Night</label><input type="number" value={roomTypeForm.pricePerNight} onChange={e => setRoomTypeForm({...roomTypeForm, pricePerNight: e.target.value})} required className="eternum-input" /></div>
              <div className="form-group"><label style={{display:'flex', gap:'0.5rem', alignItems:'center'}}><input type="checkbox" checked={roomTypeForm.breakfastIncluded} onChange={e => setRoomTypeForm({...roomTypeForm, breakfastIncluded: e.target.checked})} /> Breakfast Included</label></div>
              <div className="form-group"><label>Status</label><select value={roomTypeForm.status} onChange={e => setRoomTypeForm({...roomTypeForm, status: e.target.value})} className="eternum-input"><option value="available">Available</option><option value="fully_booked">Fully Booked</option><option value="hidden">Hidden</option><option value="not_available">Not Available</option></select></div>
              <div className="modal-actions"><button type="button" className="eternum-button secondary" onClick={() => setRoomTypeModalOpen(false)}>Cancel</button><button type="submit" className="eternum-button primary">Save Room Type</button></div>
            </form>
          </div>
        </div>
      )}

      {proofModalOpen && (
        <div className="admin-modal-overlay" onClick={() => setProofModalOpen(false)}>
          <div className="admin-modal" style={{maxWidth: '800px', background: 'var(--eternum-bg)'}} onClick={e => e.stopPropagation()}>
            <h3 className="modal-title" style={{marginBottom:'1rem'}}>Payment Proof</h3>
            <div style={{textAlign:'center'}}>
              <img src={viewingProof} alt="Payment Proof" style={{maxWidth:'100%', maxHeight:'60vh', borderRadius:'8px', objectFit:'contain'}} />
            </div>
            <div className="modal-actions" style={{marginTop:'2rem'}}>
              <button type="button" className="eternum-button secondary" onClick={() => setProofModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </RoomsAdminLayout>
  );
}

export default App;

