import React, { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { motion } from "framer-motion";
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import "./App.css";
import AnimatedBackground from "./AnimatedBackground";
import { dashboardStats, mockAttendees, mockEvents, mockOutcomers, mockPayments, recentActivity } from "./adminMockData";

const API_URL =
  "https://script.google.com/macros/s/AKfycbxg8nRm1dds5DDZRWqdIOmoo2fCD-XR__cgV13-m1m9GUacdpDRTG8MKrw6f3CKwxMJAA/exec";

const QR_REVEAL_TIME = "2026-12-31T18:00:00";
const ADMIN_SESSION_KEY = "alshayebAdminSession";
const ADMIN_EMAIL = "admin@alshayeb.com";
const ADMIN_PASSWORD = "admin123";

const events = [
  { id: "miu-prom-2026", name: "MIU PROM 2026", date: "31 MAY 2026", fee: "250 EGP" },
  { id: "bue-prom-2026", name: "BUE PROM 2026", date: "14 JUNE 2026", fee: "250 EGP" },
  { id: "aast-prom-2026", name: "AAST PROM 2026", date: "20 JUNE 2026", fee: "250 EGP" },
  { id: "future-prom-2026", name: "FUTURE ACADEMY PROM 2026", date: "28 JUNE 2026", fee: "250 EGP" }
];

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

const Shell = ({ children }) => (
  <div className="app-shell">
    <AnimatedBackground />
    <motion.div className="cosmic-card" {...pageMotion}>
      {children}
    </motion.div>
  </div>
);

function PublicWebsite() {
  const [phone, setPhone] = useState("");
  const [clients, setClients] = useState([]);
  const [foundClient, setFoundClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("home");
  const [errors, setErrors] = useState({});
  const [selectedEvent, setSelectedEvent] = useState(events[0]);
  const [now, setNow] = useState(Date.now());

  const [request, setRequest] = useState({
    name: "",
    phone: "",
    email: "",
    gender: "",
    school: "",
    age: "",
    instagram: "",
    referral: "",
    notes: "",
    screenshot: null
  });

  const cleanValue = (value) => String(value || "").replace(/\s/g, "").replace(/'/g, "").trim();
  const safeValue = (value, fallback = "Not available") => {
    const text = String(value ?? "").trim();
    return text || fallback;
  };

  const isEgyptianPhone = (value) => /^01[0-9]{9}$/.test(cleanValue(value));

  const loadGuests = useCallback(() => {
    setLoading(true);
    setErrors((prev) => ({ ...prev, home: "" }));

    fetch(API_URL + "?t=" + new Date().getTime())
      .then((res) => {
        if (!res.ok) {
          throw new Error("Guest list request failed");
        }
        return res.json();
      })
      .then((data) => {
        setClients(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((error) => {
        console.log("Error:", error);
        setClients([]);
        setLoading(false);
        setErrors((prev) => ({
          ...prev,
          home: "We could not load the guest list. Please check your connection and try again."
        }));
      });
  }, []);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const qrRevealDate = useMemo(() => new Date(QR_REVEAL_TIME).getTime(), []);
  const qrLocked = now < qrRevealDate;
  const countdown = useMemo(() => {
    const distance = Math.max(qrRevealDate - now, 0);
    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((distance / (1000 * 60)) % 60);
    const seconds = Math.floor((distance / 1000) % 60);
    return { days, hours, minutes, seconds };
  }, [now, qrRevealDate]);

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

  const handleSearch = () => {
    if (loading) return;
    if (!validatePhoneSearch()) return;

    const typedPhone = cleanValue(phone);
    const client = clients.find((c) => cleanValue(c?.phone || c?.Phone) === typedPhone);

    if (client) {
      setFoundClient(client);
      setErrors({});
      setPage("ticket");
    } else {
      setFoundClient(null);
      setErrors({});
      setPage("notfound");
    }
  };

  const validateRegistration = () => {
    const newErrors = {};
    const name = request.name.trim();
    const phoneNumber = cleanValue(request.phone);
    const email = request.email.trim();
    const school = request.school.trim();
    const age = request.age.trim();
    const instagram = request.instagram.trim();

    if (!name) {
      newErrors.name = "Full name is required.";
    } else if (name.length < 3) {
      newErrors.name = "Full name must be at least 3 characters.";
    } else if (!/^[a-zA-Z\s]+$/.test(name)) {
      newErrors.name = "Full name can contain letters and spaces only.";
    }

    if (!phoneNumber) {
      newErrors.phone = "Phone number is required.";
    } else if (!isEgyptianPhone(phoneNumber)) {
      newErrors.phone = "Enter an Egyptian phone number starting with 01 and 11 digits long.";
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Enter a valid email address.";
    }

    if (!school) {
      newErrors.school = "University / School is required.";
    }

    if (!age) {
      newErrors.age = "Age is required.";
    } else if (!/^\d+$/.test(age) || Number(age) < 15 || Number(age) > 40) {
      newErrors.age = "Age must be a number between 15 and 40.";
    }

    if (instagram && /\s/.test(instagram)) {
      newErrors.instagram = "Instagram cannot contain spaces.";
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
      setRequest((prev) => ({ ...prev, screenshot: null }));
      return;
    }

    const allowedTypes = ["image/png", "image/jpg", "image/jpeg"];
    const allowedExtensions = [".png", ".jpg", ".jpeg"];
    const fileName = file.name.toLowerCase();
    const hasAllowedExtension = allowedExtensions.some((extension) => fileName.endsWith(extension));

    if (!allowedTypes.includes(file.type) || !hasAllowedExtension) {
      setRequest((prev) => ({ ...prev, screenshot: null }));
      setErrors((prev) => ({ ...prev, screenshot: "Only PNG, JPG, or JPEG files are allowed." }));
      return;
    }

    setRequest((prev) => ({ ...prev, screenshot: file.name }));
    setErrors((prev) => ({ ...prev, screenshot: "" }));
  };

  const goToPayment = () => {
    if (!validateRegistration()) return;
    setPage("payment");
  };

  const submitRequest = () => {
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

    localStorage.setItem("alshayebRequest", JSON.stringify(newRequest));
    setRequest(newRequest);
    setErrors({});
    setPage("submitted");
  };

  const FieldError = ({ name }) => {
    if (!errors[name]) return null;
    return <p className="field-error">{errors[name]}</p>;
  };

  if (page === "notfound") {
    return (
      <Shell>
        <button className="back-icon" onClick={() => setPage("home")} aria-label="Back">
          &larr;
        </button>
        <div className="ring small-ring"></div>
        <h2 className="page-title">NOT FOUND</h2>
        <p className="muted">This phone number is not in our guest list yet.</p>
        <p className="muted">You can request access as an outcomer.</p>

        <button className="purple-btn" onClick={() => setPage("chooseEvent")}>
          REGISTER AS OUTCOMER
        </button>

        <button className="ghost-btn" onClick={() => setPage("home")}>
          BACK
        </button>
      </Shell>
    );
  }

  if (page === "chooseEvent") {
    return (
      <Shell>
        <button className="back-icon" onClick={() => setPage("notfound")} aria-label="Back">
          &larr;
        </button>
        <div className="ring small-ring"></div>
        <h1 className="brand-title">ETERNUM</h1>
        <p className="muted">SELECT YOUR DESTINATION</p>

        <div className="event-list">
          {events.map((event, index) => (
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
      <Shell>
        <button className="back-icon" onClick={() => setPage("chooseEvent")} aria-label="Back">
          &larr;
        </button>
        <h2 className="page-title">REQUEST ACCESS</h2>
        <p className="muted">{selectedEvent.name}</p>

        <div className="form-grid">
          <input className={errors.name ? "error-input" : ""} name="name" placeholder="Full name" value={request.name} onChange={handleRequestChange} />
          <FieldError name="name" />

          <input className={errors.phone ? "error-input" : ""} name="phone" placeholder="Phone number" value={request.phone} onChange={handleRequestChange} />
          <FieldError name="phone" />

          <input className={errors.email ? "error-input" : ""} name="email" placeholder="Email optional" value={request.email} onChange={handleRequestChange} />
          <FieldError name="email" />

          <input className={errors.school ? "error-input" : ""} name="school" placeholder="University / School" value={request.school} onChange={handleRequestChange} />
          <FieldError name="school" />

          <input className={errors.age ? "error-input" : ""} name="age" placeholder="Age" value={request.age} onChange={handleRequestChange} />
          <FieldError name="age" />

          <input className={errors.instagram ? "error-input" : ""} name="instagram" placeholder="Instagram username optional" value={request.instagram} onChange={handleRequestChange} />
          <FieldError name="instagram" />

          <input name="referral" placeholder="Referral code optional" value={request.referral} onChange={handleRequestChange} />

          <textarea name="notes" placeholder="Notes optional" value={request.notes} onChange={handleRequestChange}></textarea>
        </div>

        <button className="purple-btn" onClick={goToPayment}>
          CONTINUE TO PAYMENT
        </button>
      </Shell>
    );
  }

  if (page === "payment") {
    return (
      <Shell>
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
      <Shell>
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
      <Shell>
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
      <Shell>
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
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem("alshayebRequest") || "{}");
    } catch {
      saved = {};
    }

    return (
      <Shell>
        <div className="ring small-ring"></div>
        <h2 className="page-title">PENDING REVIEW</h2>
        <p className="muted">Your application is currently under review.</p>

        <div className="identity-card">
          <div><span>EVENT</span><p>{safeValue(saved.event, selectedEvent.name)}</p></div>
          <div><span>REQUEST ID</span><p>{safeValue(saved.requestId, "OUT-0000")}</p></div>
          <div><span>APPLICATION STATUS</span><p><span className="status-badge pending">PENDING REVIEW</span></p></div>
          <div><span>PAYMENT STATUS</span><p><span className="status-badge pending">UNDER VERIFICATION</span></p></div>
        </div>

        <p className="muted">This usually takes 24-48 hours.</p>
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

    return (
      <div className="ticket-page">
        <AnimatedBackground />
        <motion.div className="ticket-pass" {...pageMotion}>
          <div className="ticket-hero">
            <div className="ring"></div>
            <h3>ALSHAYEB</h3>
            <h1>ETERNUM</h1>
            <p>NO BEGINNING. NO END.</p>
          </div>

          {qrLocked ? (
            <motion.div className="locked-qr-card" {...softPop}>
              <span className="status-badge active">ACCESS CONFIRMED</span>
              <h2>QR UNLOCKS SOON</h2>
              <div className="countdown-grid">
                <div><strong>{countdown.days}</strong><span>DAYS</span></div>
                <div><strong>{countdown.hours}</strong><span>HRS</span></div>
                <div><strong>{countdown.minutes}</strong><span>MIN</span></div>
                <div><strong>{countdown.seconds}</strong><span>SEC</span></div>
              </div>
            </motion.div>
          ) : (
            <motion.div className="qr-card" {...softPop}>
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

  return (
    <motion.div className="container" {...pageMotion}>
      <AnimatedBackground />
      <div className="ring"></div>
      <h3>ALSHAYEB</h3>
      <h1>ETERNUM</h1>
      <p className="tagline">NO BEGINNING. NO END.</p>

      <div className="welcome-block">
        <p>WELCOME TO</p>
        <h2>THE ETERNITY</h2>
        <p>Enter your phone number to continue</p>
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

      <input
        className={errors.phoneSearch ? "error-input" : ""}
        type="text"
        placeholder="Enter your phone number"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setErrors((prev) => ({ ...prev, phoneSearch: "" }));
        }}
      />
      <FieldError name="phoneSearch" />

      <button className="purple-btn" onClick={handleSearch} disabled={loading}>
        {loading ? "LOADING" : "CONTINUE"}
      </button>

      <p className="secure">Your information is secure and encrypted</p>
    </motion.div>
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
    <div className="app-shell admin-page">
      <AnimatedBackground />
      <motion.form className="cosmic-card admin-login-card" {...pageMotion} onSubmit={handleSubmit}>
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
    <div className="admin-control-page">
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

function AdminHeader({ eyebrow, title, badge = "MOCK DATA" }) {
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

function AdminDashboard() {
  return (
    <AdminLayout>
      <AdminHeader eyebrow="CONTROL ROOM" title="Admin Dashboard" badge="FRONTEND PROTOTYPE" />

      <div className="admin-stat-grid">
        {dashboardStats.map((stat) => (
          <div className="admin-stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <h3>Recent Activity</h3>
          <div className="activity-list">
            {recentActivity.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        </section>

        <section className="admin-panel">
          <h3>Upcoming Events</h3>
          <div className="compact-list">
            {mockEvents.map((event) => (
              <div key={event.id}>
                <strong>{event.name}</strong>
                <span>{event.date} / {event.totalAttendees} attendees</span>
              </div>
            ))}
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
  return (
    <AdminLayout>
      <AdminHeader eyebrow="EVENT OPERATIONS" title="Events" />
      <section className="admin-panel">
        <div className="admin-panel-title">
          <div>
            <h3>Event Registry</h3>
            <p className="muted">Mock events only. Backend connection comes later.</p>
          </div>
          <button className="mini-admin-btn">CREATE EVENT</button>
        </div>

        <AdminTable
          columns={["Event Name", "Date", "Venue", "Registration Fee", "QR Reveal Time", "Registration Status", "Total Attendees", "Actions"]}
          rows={mockEvents}
          renderRow={(event) => (
            <tr key={event.id}>
              <td>{event.name}</td>
              <td>{event.date}</td>
              <td>{event.venue}</td>
              <td>{event.fee}</td>
              <td>{event.qrRevealTime}</td>
              <td><span className={`status-badge ${statusClass(event.registrationStatus)}`}>{event.registrationStatus}</span></td>
              <td>{event.totalAttendees}</td>
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
      </section>
    </AdminLayout>
  );
}

function AttendeesPage() {
  const [query, setQuery] = useState("");
  const [accessType, setAccessType] = useState("All");
  const [eventFilter, setEventFilter] = useState("All");
  const [qrStatus, setQrStatus] = useState("All");
  const eventNames = ["All", ...new Set(mockAttendees.map((attendee) => attendee.event))];

  const filteredAttendees = mockAttendees.filter((attendee) => {
    const matchesQuery = `${attendee.name} ${attendee.phone}`.toLowerCase().includes(query.toLowerCase());
    const matchesAccess = accessType === "All" || attendee.accessType === accessType;
    const matchesEvent = eventFilter === "All" || attendee.event === eventFilter;
    const matchesQr = qrStatus === "All" || attendee.qrStatus === qrStatus;
    return matchesQuery && matchesAccess && matchesEvent && matchesQr;
  });

  return (
    <AdminLayout>
      <AdminHeader eyebrow="ACCESS DATABASE" title="Attendees" />
      <section className="admin-panel">
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
          columns={["Name", "Phone", "Event", "Access Type", "QR ID", "Payment Status", "QR Status"]}
          rows={filteredAttendees}
          renderRow={(attendee) => (
            <tr key={attendee.id}>
              <td>{attendee.name}</td>
              <td>{attendee.phone}</td>
              <td>{attendee.event}</td>
              <td>{attendee.accessType}</td>
              <td>{attendee.qrId}</td>
              <td><span className={`status-badge ${statusClass(attendee.paymentStatus)}`}>{attendee.paymentStatus}</span></td>
              <td><span className={`status-badge ${statusClass(attendee.qrStatus)}`}>{attendee.qrStatus}</span></td>
            </tr>
          )}
        />
      </section>
    </AdminLayout>
  );
}

function OutcomersPage() {
  const [requests, setRequests] = useState(mockOutcomers);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Pending");

  const updateStatus = (id, nextStatus) => {
    setRequests((prev) =>
      prev.map((request) =>
        request.id === id
          ? {
              ...request,
              applicationStatus: nextStatus,
              paymentStatus: nextStatus === "Approved" ? "Verified" : nextStatus === "Rejected" ? "Rejected" : request.paymentStatus
            }
          : request
      )
    );
  };

  const filteredRequests = requests.filter((request) => {
    const matchesQuery = `${request.name} ${request.phone}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === "All" || request.applicationStatus === statusFilter;
    return matchesQuery && matchesStatus;
  });

  return (
    <AdminLayout>
      <AdminHeader eyebrow="OUTCOMER REVIEW" title="Outcomers" />
      <section className="admin-panel">
        <div className="admin-filter-bar outcomer-filters">
          <input placeholder="Search by name or phone" value={query} onChange={(event) => setQuery(event.target.value)} />
          {["All", "Pending", "Approved", "Rejected"].map((status) => (
            <button key={status} className={statusFilter === status ? "filter-pill active-filter" : "filter-pill"} onClick={() => setStatusFilter(status)} type="button">
              {status}
            </button>
          ))}
        </div>

        <div className="outcomer-card-grid">
          {filteredRequests.map((request) => (
            <article className="outcomer-review-card" key={request.id}>
              <div>
                <span>{request.requestId}</span>
                <h3>{request.name}</h3>
                <p>{request.phone}</p>
              </div>
              <div className="outcomer-meta">
                <div><span>EVENT</span><strong>{request.event}</strong></div>
                <div><span>SUBMITTED</span><strong>{request.submissionDate}</strong></div>
                <div><span>SCREENSHOT</span><strong>{request.paymentScreenshot}</strong></div>
                <div><span>PAYMENT</span><strong>{request.paymentStatus}</strong></div>
              </div>
              <div className="outcomer-status-row">
                <span className={`status-badge ${statusClass(request.applicationStatus)}`}>{request.applicationStatus}</span>
                <div className="table-actions">
                  <button type="button">View Screenshot</button>
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
  const [payments, setPayments] = useState(mockPayments);
  const updatePayment = (id, status) => {
    setPayments((prev) => prev.map((payment) => (payment.id === id ? { ...payment, status } : payment)));
  };

  return (
    <AdminLayout>
      <AdminHeader eyebrow="PAYMENT VERIFICATION" title="Payments" />
      <div className="payment-review-grid">
        {payments.map((payment) => (
          <section className="admin-panel payment-card" key={payment.id}>
            <div className="screenshot-preview">SCREENSHOT PREVIEW</div>
            <div className="payment-info">
              <h3>{payment.name}</h3>
              <p className="muted">{payment.phone}</p>
              <div><span>EVENT</span><strong>{payment.event}</strong></div>
              <div><span>AMOUNT</span><strong>{payment.amount}</strong></div>
              <div><span>SUBMITTED</span><strong>{payment.submittedAt}</strong></div>
              <div><span>STATUS</span><strong><span className={`status-badge ${statusClass(payment.status)}`}>{payment.status}</span></strong></div>
            </div>
            <div className="table-actions payment-actions">
              <button type="button" onClick={() => updatePayment(payment.id, "Verified")}>Approve Payment</button>
              <button type="button" onClick={() => updatePayment(payment.id, "Rejected")}>Reject Payment</button>
            </div>
          </section>
        ))}
      </div>
    </AdminLayout>
  );
}

function ScannerPage() {
  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const results = {
    granted: { title: "Access Granted", detail: "ALSHAYEB-A7K2 is valid for entry.", status: "active" },
    used: { title: "Already Used", detail: "This QR was scanned earlier today.", status: "used" },
    invalid: { title: "Invalid QR", detail: "No matching QR credentials were found.", status: "used" }
  };

  return (
    <AdminLayout>
      <AdminHeader eyebrow="ENTRY GATE" title="Scanner Page" badge="READY" />
      <section className="admin-panel scanner-panel">
        <div className="camera-placeholder">
          <div className="scan-frame"></div>
          <p>CAMERA SCANNER PLACEHOLDER</p>
        </div>
        <input placeholder="Paste QR token or ALSHAYEB ID" value={scanValue} onChange={(event) => setScanValue(event.target.value)} />
        <div className="scanner-actions">
          <button className="purple-btn" type="button" onClick={() => setScanResult(results.granted)}>Simulated Scan</button>
          <button className="ghost-btn" type="button" onClick={() => setScanResult(results.used)}>Already Used</button>
          <button className="ghost-btn" type="button" onClick={() => setScanResult(results.invalid)}>Invalid QR</button>
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
  const exportOptions = ["Export All Attendees", "Export Incomers", "Export Outcomers", "Export Committee", "Export Pending Payments", "Export Event Data"];

  return (
    <AdminLayout>
      <AdminHeader eyebrow="DATA EXPORT" title="Export Excel" />
      <section className="admin-panel">
        <p className="muted">Placeholder export controls. Excel API will be connected after backend testing.</p>
        <div className="export-grid">
          {exportOptions.map((option) => (
            <button className="export-option" type="button" key={option}>
              {option}
            </button>
          ))}
        </div>
      </section>
    </AdminLayout>
  );
}

function SettingsPage() {
  return (
    <AdminLayout>
      <AdminHeader eyebrow="SYSTEM DEFAULTS" title="Settings" />
      <section className="admin-panel">
        <div className="settings-grid">
          <label><span>InstaPay Link</span><input defaultValue="https://instapay.example/alshayeb" /></label>
          <label><span>Default Registration Fee</span><input defaultValue="250 EGP" /></label>
          <label><span>QR Reveal Time</span><input defaultValue="2026-12-31T18:00:00" /></label>
          <label><span>Venue Name</span><input defaultValue="ALSHAYEB ETERNUM" /></label>
          <label><span>Event Background Image</span><input defaultValue="venue-bg.png" /></label>
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
