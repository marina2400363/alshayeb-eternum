// Sandra-owned API layer for the Season 2 Admin Portal. Deliberately private
// (not shared with payments.api.js or onboarding.api.js) — same "one client
// per feature" convention as the rest of Season 2.
//
// Every call here (except login) attaches the admin JWT from
// features/admin/state/adminSession.js as a Bearer token — the SAME token
// the legacy Season 1 admin dashboard also reads/writes (see that module's
// comment). No new admin auth system, no new storage.
//
// Endpoint contracts (all backend/src/routes/*, all requireAdmin-protected
// except login):
//   POST /api/admin/auth/login                                  → { success, token, expiresIn }
//   GET  /api/admin/schools                                     → { success, schools:[School] }
//   POST /api/admin/schools                                     → 201 { success, school }
//   PUT  /api/admin/schools/:id                                 → { success, school }
//   GET  /api/admin/payment-options?schoolId=                   → { success, paymentOptions:[PaymentOption] }
//   POST /api/admin/payment-options                             → 201 { success, paymentOption }
//   PUT  /api/admin/payment-options/:id                         → { success, paymentOption }
//   DELETE /api/admin/payment-options/:id                       → { success, message }
//   GET  /api/admin/deposits?status=                            → { success, deposits:[Deposit populated] }
//   GET  /api/admin/deposits/:id                                → { success, deposit }
//   PUT  /api/admin/deposits/:id/approve                        → { success, message, deposit }
//   PUT  /api/admin/deposits/:id/reject                         → { success, message, deposit }
//   GET  /api/admin/school-finance-config                       → { success, configs:[SchoolFinanceConfig] }
//   GET  /api/admin/school-finance-config/:schoolId              → { success, config }
//   PUT  /api/admin/school-finance-config/:schoolId              → { success, config }
//   POST /api/admin/school-finance-config/:schoolId/sync         → { success, syncedCount, updated, appended } | { success:false, skipped, reason } | { success:false, error }
//   POST /api/admin/school-finance-config/:schoolId/sync-full-payment → { success, syncedCount, confirmedCount, unconfirmedCount, skippedUnknown, skippedWrongSchool, duplicateCustomerIds } | { success:false, skipped, reason } | { success:false, error }
//   GET  /api/admin/site-settings                                → { success, settings }
//   PUT  /api/admin/settings                                     → { success, message, settings }

import { getSnapshot, clearAdminSession } from "../state/adminSession";

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

export const NETWORK_ERROR_MESSAGE = "We couldn't reach the server. Check your connection and try again.";
export const TIMEOUT_ERROR_MESSAGE = "That took too long. Please try again.";
const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again in a moment.";

// The backend's own placeholder fallback (backend/src/routes/settingsRoutes.js
// and adminRoutes.js's buildSettingsUpdate) when no admin has configured a
// real InstaPay link yet.
export const INSTAPAY_PLACEHOLDER_LINK = "https://instapay.example/alshayeb";

export class ApiError extends Error {
  // kind: "network" | "timeout" | "aborted" | "http" | "auth"
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

async function request(path, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, auth = true, ...options } = {}) {
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

  const token = auth ? getSnapshot().session?.token : null;
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
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
    // An expired/invalid token (or a token from a since-revoked env
    // credential) always comes back 401 from requireAdmin — sign out
    // immediately so the next render redirects to the login screen instead
    // of silently repeating failed calls.
    if (response.status === 401 && auth) {
      clearAdminSession();
      throw new ApiError(body?.message || "Your admin session has expired. Please log in again.", {
        kind: "auth",
        status: 401
      });
    }

    const message = response.status < 500 && body?.message ? body.message : GENERIC_ERROR_MESSAGE;
    throw new ApiError(message, { kind: "http", status: response.status });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function loginAdmin({ email, password }) {
  return request("/api/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    auth: false
  });
}

// ---------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------

export async function fetchSchools({ signal } = {}) {
  const body = await request("/api/admin/schools", { signal });
  return Array.isArray(body.schools) ? body.schools : [];
}

export async function createSchool({ name, ticketPrice }) {
  const body = await request("/api/admin/schools", {
    method: "POST",
    body: JSON.stringify({ name, ticketPrice })
  });
  return body.school;
}

export async function updateSchool(id, updates) {
  const body = await request(`/api/admin/schools/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates)
  });
  return body.school;
}

// ---------------------------------------------------------------------------
// Payment Options — always school-scoped, never a global list.
// ---------------------------------------------------------------------------

export async function fetchSchoolPaymentOptions(schoolId, { signal } = {}) {
  const body = await request(`/api/admin/payment-options?schoolId=${encodeURIComponent(schoolId)}`, { signal });
  return Array.isArray(body.paymentOptions) ? body.paymentOptions : [];
}

export async function createPaymentOption({ schoolId, amount, label, enabled, displayOrder }) {
  const body = await request("/api/admin/payment-options", {
    method: "POST",
    body: JSON.stringify({ schoolId, amount, label, enabled, displayOrder })
  });
  return body.paymentOption;
}

export async function updatePaymentOption(id, updates) {
  const body = await request(`/api/admin/payment-options/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates)
  });
  return body.paymentOption;
}

export async function deletePaymentOption(id) {
  return request(`/api/admin/payment-options/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export async function fetchDeposits({ status } = {}, { signal } = {}) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const body = await request(`/api/admin/deposits${query}`, { signal });
  return Array.isArray(body.deposits) ? body.deposits : [];
}

export async function approveDeposit(id) {
  const body = await request(`/api/admin/deposits/${id}/approve`, { method: "PUT" });
  return body.deposit;
}

export async function rejectDeposit(id, { rejectionReason }) {
  const body = await request(`/api/admin/deposits/${id}/reject`, {
    method: "PUT",
    body: JSON.stringify({ rejectionReason })
  });
  return body.deposit;
}

// ---------------------------------------------------------------------------
// School Finance Config
// ---------------------------------------------------------------------------

export async function fetchFinanceConfigs({ signal } = {}) {
  const body = await request("/api/admin/school-finance-config", { signal });
  return Array.isArray(body.configs) ? body.configs : [];
}

export async function saveFinanceConfig(schoolId, updates) {
  const body = await request(`/api/admin/school-finance-config/${schoolId}`, {
    method: "PUT",
    body: JSON.stringify(updates)
  });
  return body.config;
}

export async function syncFinanceSheet(schoolId) {
  return request(`/api/admin/school-finance-config/${schoolId}/sync`, { method: "POST", timeoutMs: 45000 });
}

export async function syncFullPayment(schoolId) {
  return request(`/api/admin/school-finance-config/${schoolId}/sync-full-payment`, {
    method: "POST",
    timeoutMs: 45000
  });
}

// ---------------------------------------------------------------------------
// Settings (InstaPay link) — shared SiteSettings document, not duplicated.
// ---------------------------------------------------------------------------

export async function fetchAdminSettings({ signal } = {}) {
  const body = await request("/api/admin/site-settings", { signal });
  return body.settings || {};
}

export async function saveInstaPayLink(instapayLink) {
  const body = await request("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify({ instapayLink })
  });
  return body.settings || {};
}
