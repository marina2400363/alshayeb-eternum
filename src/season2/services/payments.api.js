// Sandra-owned API layer for the Season 2 Customer Area payment experience.
// Deliberately private (not shared with onboarding.api.js — Marina's client
// stays untouched): only the payment endpoints below live here.
//
// Contracts (backend/src/routes/paymentRoutes.js + depositRoutes.js + settingsRoutes.js):
//   POST /api/payments/customer-summary         → { success, summary:{ ticketPriceVisible, ticketPrice?,
//                                                    paymentStatus,
//                                                    paymentConfirmation:{ depositId } | null,
//                                                    latestRejection:{ reason } | null } }
//     body: { attendeeId, phone }
//     Product rule: NO payment-progress fields (approvedTotal/remaining) and
//     NO payment history are ever in this response. ticketPrice is present
//     only when the customer's School shows it (ticketPriceVisible).
//   POST /api/payments/acknowledge-confirmation → { success }
//     body: { attendeeId, phone, depositId }
//     The customer's OK on the one-time PAYMENT CONFIRMED screen.
//   POST /api/payments/customer-options          → { success, paymentOptions:[{ id, amount, label }] }
//     body: { attendeeId, phone }
//     School-specific: the backend reads the customer's own schoolId
//     server-side (never sent by the client) and returns every enabled
//     option of that School.
//   POST /api/deposits (multipart)                → 201 { success, message, deposit:{ id, amount, label, status, createdAt } }
//     fields: attendeeId, phone, paymentOptionId, paymentProof
//   GET  /api/settings/public                     → { success, instapayLink, ... }
//     Shared, non-Sandra-owned platform settings endpoint (also read by the
//     legacy Season 1 frontend) — reused here rather than duplicating
//     settings storage, per the product's admin-editable InstaPay rule.
//
// attendeeId + phone are the ONLY access control the backend has for the
// payment endpoints (no OTP/password/JWT for customers) — every call here
// requires both, sourced from the Season 2 customer session ({id, phone})
// and never from anywhere else. This file is the single place that pairing
// happens; components never assemble the pair themselves.

const LOCAL_API_URL = "http://127.0.0.1:5000";
const CONFIGURED_API_URL = String(process.env.REACT_APP_API_URL || "").trim().replace(/\/$/, "");
const CONFIGURED_API_URL_IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(CONFIGURED_API_URL);
const API_BASE_URL =
  process.env.NODE_ENV === "production"
    ? CONFIGURED_API_URL_IS_LOCAL
      ? ""
      : CONFIGURED_API_URL
    : CONFIGURED_API_URL || LOCAL_API_URL;

const DEFAULT_TIMEOUT_MS = 20000;
const UPLOAD_TIMEOUT_MS = 60000;

export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach the server. Check your connection and try again.";
export const TIMEOUT_ERROR_MESSAGE = "That took too long. Please try again.";
const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again in a moment.";

// The backend's own placeholder fallback (backend/src/routes/settingsRoutes.js)
// when no admin has configured a real InstaPay link yet. Treated as "not
// configured" here so the customer is never shown a fake destination.
const INSTAPAY_PLACEHOLDER_LINK = "https://instapay.example/alshayeb";

export class ApiError extends Error {
  // kind: "network" | "timeout" | "aborted" | "http"
  constructor(message, { kind = "http", status = 0 } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }

  get isRetryable() {
    return this.kind === "network" || this.kind === "timeout" || this.status >= 500;
  }
}

async function request(path, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let response;
  try {
    // No Content-Type is set for FormData bodies: the browser must add the
    // multipart boundary itself.
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, signal: controller.signal });
  } catch (cause) {
    if (timedOut) throw new ApiError(TIMEOUT_ERROR_MESSAGE, { kind: "timeout" });
    if (signal?.aborted) throw new ApiError("Request cancelled.", { kind: "aborted" });
    throw new ApiError(NETWORK_ERROR_MESSAGE, { kind: "network" });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = response.status < 500 && body?.message ? body.message : GENERIC_ERROR_MESSAGE;
    throw new ApiError(message, { kind: "http", status: response.status });
  }

  return body;
}

// Whitelist mappers — a second line of defence at the boundary, same pattern
// as onboarding.api.js's toCustomer(): even if a response ever carried more
// than the documented shape, nothing beyond these fields reaches the UI.

// Just the id — the screen only needs to acknowledge it. No amount and no
// date: the customer never sees a previous payment.
function toPaymentConfirmation(raw) {
  if (!raw || !raw.depositId) return null;
  return { depositId: String(raw.depositId) };
}

function toLatestRejection(raw) {
  if (!raw) return null;
  return { reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null };
}

function toCreatedDeposit(raw) {
  return {
    id: String(raw?.id ?? ""),
    amount: Number(raw?.amount) || 0,
    label: raw?.label ?? null,
    status: raw?.status === "approved" || raw?.status === "rejected" ? raw.status : "pending",
    createdAt: raw?.createdAt ?? null
  };
}

const PAYMENT_STATUSES = ["ready", "under_review", "awaiting_confirmation", "full_payment_complete"];

// Current state only — no history, no approvedTotal, no remaining, no
// payment-progress figure of any kind. Even if the backend response ever
// carried one (it shouldn't — see paymentRoutes.js), it is dropped here
// rather than passed through.
//
// ticketPrice is carried ONLY when the backend says it is visible; a hidden
// price is never read from the response, even if one were present.
function toPaymentSummary(raw) {
  const summary = raw || {};
  const ticketPriceVisible = summary.ticketPriceVisible === true;
  return {
    ticketPriceVisible,
    ticketPrice: ticketPriceVisible ? Number(summary.ticketPrice) || 0 : null,
    // An unknown status is treated as "under_review" — nothing payable —
    // never as a state that would let the customer submit.
    paymentStatus: PAYMENT_STATUSES.includes(summary.paymentStatus) ? summary.paymentStatus : "under_review",
    paymentConfirmation: toPaymentConfirmation(summary.paymentConfirmation),
    latestRejection: toLatestRejection(summary.latestRejection)
  };
}

function toPaymentOption(raw) {
  return {
    id: String(raw?.id ?? ""),
    amount: Number(raw?.amount) || 0,
    label: raw?.label ?? null
  };
}

// Current payment state only — see toPaymentSummary. attendeeId and phone
// are sent, never returned or re-exposed.
export async function fetchCustomerPaymentSummary({ attendeeId, phone }, { signal } = {}) {
  const body = await request("/api/payments/customer-summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attendeeId, phone }),
    signal
  });

  return toPaymentSummary(body.summary);
}

// The customer's OK on the one-time PAYMENT CONFIRMED screen. Persisted
// server-side (never a browser flag) so the confirmation shows exactly once
// across devices/sessions. Resolves only once the backend has recorded it.
export async function acknowledgePaymentConfirmation({ attendeeId, phone, depositId }, { signal } = {}) {
  await request("/api/payments/acknowledge-confirmation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attendeeId, phone, depositId }),
    signal
  });
}

// The calling customer's own School's enabled options — every one of them,
// whatever the amount (they are not filtered by any balance). This never
// accepts or sends a schoolId: the backend resolves it from the attendee.
export async function fetchCustomerPaymentOptions({ attendeeId, phone }, { signal } = {}) {
  const body = await request("/api/payments/customer-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attendeeId, phone }),
    signal
  });

  const options = Array.isArray(body.paymentOptions) ? body.paymentOptions : [];
  return options.map(toPaymentOption);
}

// Creates one Deposit. The amount is never sent — the backend derives it
// from paymentOptionId server-side — and phone is required alongside
// attendeeId for the same ownership cross-check every payment call uses.
export async function createDeposit({ attendeeId, phone, paymentOptionId, paymentProof }, { signal } = {}) {
  const form = new FormData();
  form.append("attendeeId", attendeeId);
  form.append("phone", phone);
  form.append("paymentOptionId", paymentOptionId);
  form.append("paymentProof", paymentProof);

  const body = await request("/api/deposits", {
    method: "POST",
    body: form,
    signal,
    timeoutMs: UPLOAD_TIMEOUT_MS
  });

  return { deposit: toCreatedDeposit(body.deposit) };
}

// Reads the shared, platform-level public settings endpoint (not owned by
// either Season — Season 1's legacy frontend reads the same one) purely for
// its instapayLink field. Returns null — never the backend's own example
// placeholder — when no real destination has been configured yet, so the UI
// can show an honest "not available" state instead of a fake link.
export async function fetchInstaPayLink({ signal } = {}) {
  const body = await request("/api/settings/public", { signal });
  const link = typeof body.instapayLink === "string" ? body.instapayLink.trim() : "";
  if (!link || link === INSTAPAY_PLACEHOLDER_LINK) return null;
  return link;
}
