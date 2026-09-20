// Marina-owned API layer for the Season 2 public onboarding flow.
// Deliberately private (not a shared client): only schools, Incomer
// registration and the Already Registered lookup live here.
//
// Contracts (backend/src/routes/schoolRoutes.js + attendeeRoutes.js):
//   GET  /api/schools                        → { success, schools:[{ _id, name, ticketPrice }] }
//   GET  /api/attendees/season2/lookup?phone → { success, found, attendee:{ id, fullName, phone, attendeeType } | null }
//   POST /api/attendees/register (multipart) → 201 { success, attendee:{ id, fullName, phone, attendeeType } }
//                                            | 200 { success, duplicate:true, attendee:{ …same shape… } }
//     fields: attendeeType, fullName, phoneNumber, email, schoolId, incomerPhoto
//     (email is required customer data — never identity; phone stays the key)
//
// Season 2 never calls the legacy GET /api/attendees/lookup: Season 1's ticket
// and QR flows depend on that response's shape (qrToken included), so it is
// left exactly as it is — Season 2 has its own minimal endpoint instead.
import { normalizePhone } from "../features/onboarding/utils/phone";
import { normalizeEmail } from "../features/onboarding/utils/email";

// Same base-URL resolution as src/App.js so Season 2 hits the same backend.
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

export class ApiError extends Error {
  // kind: "network" | "timeout" | "aborted" | "http"
  constructor(message, { kind = "http", status = 0 } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }

  // Connectivity-type failures, where "Retry" makes sense as-is.
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
    // No Content-Type is set: for FormData the browser must add the
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
    // Server messages for 4xx are written for the customer; a 5xx (or a
    // missing message) gets our own generic copy.
    const message = response.status < 500 && body?.message ? body.message : GENERIC_ERROR_MESSAGE;
    throw new ApiError(message, { kind: "http", status: response.status });
  }

  return body;
}

// The Season 2 endpoints already return only { id, fullName, phone,
// attendeeType }. This whitelist stays as a second line of defence at the
// boundary: even if a response ever carried more (QR fields, email, photo
// metadata, prices, status…), none of it can reach the UI or the Season 2
// session. Anything else the Customer Area needs (payments, deposits) comes
// from its own endpoints, never from this profile.
export function toCustomer(attendee) {
  if (!attendee) return null;

  return {
    id: String(attendee.id || attendee._id || ""),
    fullName: attendee.fullName || attendee.name || "",
    phone: attendee.phone || attendee.phoneNumber || "",
    attendeeType: attendee.attendeeType || ""
  };
}

// Schools are the Admin-managed list. ticketPrice is intentionally dropped:
// onboarding never shows payment amounts.
export async function fetchSchools({ signal } = {}) {
  const body = await request("/api/schools", { signal });
  const schools = Array.isArray(body.schools) ? body.schools : [];

  return schools
    .filter((school) => school && school._id && school.name)
    .map((school) => ({ id: String(school._id), name: String(school.name) }));
}

// Resolves { found, customer }. Phone only: the dedicated Season 2 endpoint
// always searches Incomers server-side (no attendee type is sent or accepted)
// and returns the minimal customer shape. Used by Already Registered, the
// Details phone pre-check and Customer Area hydration.
export async function lookupIncomer(phone, { signal } = {}) {
  const normalized = normalizePhone(phone);
  const query = new URLSearchParams({ phone: normalized });
  const body = await request(`/api/attendees/season2/lookup?${query.toString()}`, { signal });

  const customer = body.found ? toCustomer(body.attendee) : null;

  // Defensive: never treat a non-Incomer record as an Incomer profile.
  if (!customer || !customer.id || customer.attendeeType !== "incomer") {
    return { found: false, customer: null };
  }

  return { found: true, customer };
}

// Resolves { duplicate, customer }. A duplicate (HTTP 200) means the phone was
// already registered; the backend ignores the submitted details in that case.
export async function registerIncomer({ fullName, phone, email, schoolId, photo }, { signal } = {}) {
  const form = new FormData();
  form.append("attendeeType", "incomer");
  form.append("fullName", fullName);
  form.append("phoneNumber", normalizePhone(phone));
  form.append("email", normalizeEmail(email));
  form.append("schoolId", schoolId);
  form.append("incomerPhoto", photo);

  const body = await request("/api/attendees/register", {
    method: "POST",
    body: form,
    signal,
    timeoutMs: UPLOAD_TIMEOUT_MS
  });

  return { duplicate: Boolean(body.duplicate), customer: toCustomer(body.attendee) };
}
