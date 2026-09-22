// Season 2 (Marina) transactional email lifecycle. Entirely separate from the
// legacy Experience/Rooms sender in ./email.js — never imports it, never
// modifies it, and never reuses its templates. Legacy isolation is enforced
// upstream (see canReceiveLegacyStatusEmail in email.js); Season 2 Incomers
// only ever reach the functions in THIS file.
//
// Five events, each fired once per authoritative business transition:
//   A. Registration received  — Attendee.create() succeeds
//   B. Payment under review   — Deposit.create() succeeds
//   C. Payment confirmed      — Deposit pending -> approved
//   D. Payment needs attention— Deposit pending -> rejected
//   E. Full payment complete  — FullPaymentStatus false -> true
//
// No QR, no ticket, no OTP, no login/auth email exists here or ever will.
//
// Testability note: the Resend constructor is read off the required module
// object at send time (resendPkg.Resend), not destructured at module scope —
// mirrors how googleSheetsFullPaymentSync.js reads google.sheets/google.auth.JWT
// off the googleapis module object, so tests can swap in a fake without any
// dependency-injection plumbing in the route code.
const resendPkg = require("resend");

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

const SEASON2_FROM = "ALSHAYEB EXPERIENCE <selection@alshayebexperience.com>";

// Customer may open the email on a different device with no session — never
// link straight into /customer-area. This is the one URL every Season 2 CTA
// points at; the returning-flow screen re-establishes the session itself.
const SEASON2_RETURNING_URL = "https://alshayebexperience.com/season2/enter/incomer/returning";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// First token of the stored full name, HTML-safe callers still must escape
// (this only picks the token — escaping happens in the template functions).
function firstNameOf(fullName) {
  const trimmed = String(fullName || "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

// ---------------------------------------------------------------------------
// Template shell — dark, editorial, premium. Colors/type/radius are the
// email-safe (inline, hex/rgba, no custom properties) translation of the
// real site's design tokens in src/season2/styles/tokens.css and the
// primary button treatment in src/season2/components/Button.css — pure
// black background, near-black card surface, hairline white-alpha borders,
// white/grey text, solid white pill CTA with black uppercase text. No blue.
// New shell dedicated to this module: the legacy shell's "Selection
// Committee" copy and trackLookup CTA do not apply here, and this file must
// never modify ../utils/email.js's templates.
// ---------------------------------------------------------------------------

const COLOR_BG = "#000000";
const COLOR_SURFACE = "#0c0c0e";
const COLOR_BORDER = "rgba(255, 255, 255, 0.14)";
const COLOR_TEXT_PRIMARY = "#ffffff";
const COLOR_TEXT_SECONDARY = "#b7b7be";
const COLOR_TEXT_MUTED = "#7a7a82";
const FONT_STACK = "'Archivo', 'Helvetica Neue', Arial, sans-serif";

function generateSeason2EmailHTML({ heading, bodyLines, cta }) {
  const safeHeading = escapeHtml(heading);
  const bodyHtml = bodyLines
    .filter((line) => line !== null && line !== undefined && line !== "")
    .map(
      (line) =>
        `<p style="margin: 0 0 14px; color: ${COLOR_TEXT_SECONDARY}; font-size: 16px; line-height: 1.7;">${escapeHtml(line)}</p>`
    )
    .join("");

  const ctaHtml = cta
    ? `<div style="margin-top: 36px;">
        <a href="${escapeHtml(cta.url)}" style="display: inline-block; background: ${COLOR_TEXT_PRIMARY}; color: ${COLOR_BG}; padding: 15px 30px; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 13px; letter-spacing: 2px; text-transform: uppercase;">
          ${escapeHtml(cta.label)}
        </a>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background-color: ${COLOR_BG}; font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased;">
  <div style="background-color: ${COLOR_BG}; padding: 40px 20px;">
    <div style="max-width: 480px; margin: 0 auto; background: ${COLOR_SURFACE}; border: 1px solid ${COLOR_BORDER}; border-radius: 20px; padding: 44px 34px; text-align: center;">

      <div style="margin-bottom: 26px;">
        <h1 style="margin: 0; color: ${COLOR_TEXT_PRIMARY}; font-size: 19px; font-weight: 800; letter-spacing: 5px; text-transform: uppercase;">
          ALSHAYEB EXPERIENCE
        </h1>
      </div>

      <div style="height: 1px; background: ${COLOR_BORDER}; margin: 0 0 30px;"></div>

      <h2 style="margin: 0 0 24px; color: ${COLOR_TEXT_PRIMARY}; font-size: 17px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;">
        ${safeHeading}
      </h2>

      <div style="text-align: left;">
        ${bodyHtml}
      </div>

      ${ctaHtml}

      <div style="margin-top: 40px; font-size: 12px; color: ${COLOR_TEXT_MUTED};">
        <p style="margin: 0;">Please do not reply to this email.</p>
      </div>

    </div>
  </div>
</body>
</html>
  `;
}

// Plain-text fallback for clients that don't render HTML.
function generateSeason2EmailText({ heading, bodyLines, cta }) {
  const lines = [
    "ALSHAYEB EXPERIENCE",
    "",
    String(heading || "").toUpperCase(),
    "",
    ...bodyLines.filter((line) => line !== null && line !== undefined && line !== "")
  ];

  if (cta) {
    lines.push("", `${cta.label}: ${cta.url}`);
  }

  lines.push("", "Please do not reply to this email.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Low-level send. Never throws — always resolves to a structured result so a
// caller can decide whether to persist a *SentAt timestamp. Never logs the
// API key, the recipient's email body, or any credential; only the
// deterministic idempotency key (an internal id, not a secret) and Resend's
// own error shape are logged on failure.
// ---------------------------------------------------------------------------

async function sendSeason2Email({ to, subject, heading, bodyLines, cta, idempotencyKey }) {
  if (!to) {
    return { sent: false, reason: "no-recipient" };
  }

  if (!isResendConfigured()) {
    return { sent: false, reason: "resend-not-configured" };
  }

  const ResendCtor = resendPkg.Resend;
  const resend = new ResendCtor(process.env.RESEND_API_KEY);
  const html = generateSeason2EmailHTML({ heading, bodyLines, cta });
  const text = generateSeason2EmailText({ heading, bodyLines, cta });

  try {
    const { error } = await resend.emails.send(
      {
        from: SEASON2_FROM,
        to: [to],
        subject,
        text,
        html
      },
      idempotencyKey ? { idempotencyKey } : undefined
    );

    if (error) {
      console.error("Season 2 email rejected by Resend:", {
        idempotencyKey,
        statusCode: error.statusCode,
        name: error.name
      });
      return { sent: false, reason: "provider-error" };
    }

    return { sent: true };
  } catch (err) {
    console.error("Season 2 email send failed unexpectedly:", {
      idempotencyKey,
      message: err.message
    });
    return { sent: false, reason: "unexpected-error" };
  }
}

// ---------------------------------------------------------------------------
// Five event dispatchers. Each takes explicit primitive fields only — never a
// Mongoose document — so it is structurally impossible to leak an
// unconsidered field (qrToken, proof URL, publicId, Mongo _id, ...) into a
// template just by passing a document through.
// ---------------------------------------------------------------------------

const RETURN_CTA = { label: "RETURN TO ALSHAYEB EXPERIENCE", url: SEASON2_RETURNING_URL };
const STATUS_CTA = { label: "CHECK YOUR STATUS", url: SEASON2_RETURNING_URL };

async function sendSeason2RegistrationReceivedEmail({ attendeeId, email, fullName }) {
  const firstName = firstNameOf(fullName);
  return sendSeason2Email({
    to: email,
    subject: "REGISTRATION RECEIVED — ALSHAYEB EXPERIENCE",
    heading: "REGISTRATION RECEIVED",
    bodyLines: [
      `Hi ${firstName},`,
      "Your registration has been received.",
      "You can return anytime using your mobile number."
    ],
    cta: RETURN_CTA,
    idempotencyKey: `season2-registration-${attendeeId}`
  });
}

async function sendSeason2PaymentUnderReviewEmail({ depositId, email, fullName }) {
  const firstName = firstNameOf(fullName);
  return sendSeason2Email({
    to: email,
    subject: "PAYMENT UNDER REVIEW — ALSHAYEB EXPERIENCE",
    heading: "PAYMENT UNDER REVIEW",
    bodyLines: [
      `Hi ${firstName},`,
      "We've received your payment proof.",
      "It's now under review. We'll update you once it has been checked."
    ],
    cta: STATUS_CTA,
    idempotencyKey: `season2-proof-${depositId}`
  });
}

async function sendSeason2PaymentConfirmedEmail({ depositId, email, fullName }) {
  const firstName = firstNameOf(fullName);
  return sendSeason2Email({
    to: email,
    subject: "PAYMENT CONFIRMED — ALSHAYEB EXPERIENCE",
    heading: "PAYMENT CONFIRMED",
    bodyLines: [
      `Hi ${firstName},`,
      "Your payment has been approved.",
      "You can check your status and continue whenever you're ready."
    ],
    cta: STATUS_CTA,
    idempotencyKey: `season2-approved-${depositId}`
  });
}

async function sendSeason2PaymentRejectedEmail({ depositId, email, fullName, rejectionReason }) {
  const firstName = firstNameOf(fullName);
  return sendSeason2Email({
    to: email,
    subject: "PAYMENT NEEDS YOUR ATTENTION — ALSHAYEB EXPERIENCE",
    heading: "PAYMENT NEEDS YOUR ATTENTION",
    bodyLines: [
      `Hi ${firstName},`,
      "We couldn't confirm your latest payment.",
      "Reason:",
      String(rejectionReason || "Not specified."),
      "You can return and submit a new payment proof."
    ],
    cta: STATUS_CTA,
    idempotencyKey: `season2-rejected-${depositId}`
  });
}

async function sendSeason2FullPaymentCompleteEmail({ attendeeId, email, fullName }) {
  const firstName = firstNameOf(fullName);
  return sendSeason2Email({
    to: email,
    subject: "FULL PAYMENT COMPLETE — ALSHAYEB EXPERIENCE",
    heading: "FULL PAYMENT COMPLETE",
    bodyLines: [`Hi ${firstName},`, "Your full payment has been confirmed.", "You're all set for now."],
    cta: STATUS_CTA,
    idempotencyKey: `season2-full-payment-${attendeeId}`
  });
}

module.exports = {
  SEASON2_FROM,
  SEASON2_RETURNING_URL,
  escapeHtml,
  generateSeason2EmailHTML,
  generateSeason2EmailText,
  sendSeason2Email,
  sendSeason2RegistrationReceivedEmail,
  sendSeason2PaymentUnderReviewEmail,
  sendSeason2PaymentConfirmedEmail,
  sendSeason2PaymentRejectedEmail,
  sendSeason2FullPaymentCompleteEmail
};
