// Public, read-only client for the Customer Area's Accepted/Rejected/Pending
// counter. Deliberately its own tiny file (not payments.api.js/onboarding.api.js
// — each Season 2 feature owns its client): this counter is unrelated to
// payments or registration, and its numbers are manually admin-set, never
// derived from Deposit/Attendee/FullPaymentStatus data.
//
// Contract (backend/src/routes/season2SettingsRoutes.js):
//   GET /api/season2/settings/status-counter → { success, accepted, rejected, pending }

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

export class ApiError extends Error {
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

function toCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export async function fetchStatusCounter({ signal } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEFAULT_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/season2/settings/status-counter`, { signal: controller.signal });
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
    throw new ApiError(GENERIC_ERROR_MESSAGE, { kind: "http", status: response.status });
  }

  return {
    accepted: toCount(body.accepted),
    rejected: toCount(body.rejected),
    pending: toCount(body.pending)
  };
}
