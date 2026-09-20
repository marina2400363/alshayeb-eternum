// Season 2 customer session — a tiny module-level store (no provider, so
// src/season2/index.js stays untouched).
//
// What is persisted (sessionStorage): ONLY { id, phone } — enough to
// re-hydrate the profile through lookup after a refresh.
// What is kept in memory only: the sanitized customer profile.
//
// The identity model is phone-based (there is no password or token), so the
// session is deliberately scoped to the tab: it survives a refresh but not a
// closed tab, which is the safer default on shared devices.
//
// qrId / qrToken are NEVER stored here — customers are whitelisted by
// toCustomer() in onboarding.api.js before they can reach this store.

const STORAGE_KEY = "alshayebS2Customer";

function readStoredSession() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && typeof parsed.phone === "string" && parsed.id && parsed.phone) {
      return { id: parsed.id, phone: parsed.phone };
    }
  } catch {
    // Storage unavailable or corrupt — behave as signed out.
  }
  return null;
}

function writeStoredSession(session) {
  try {
    if (session) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: the in-memory session still works for
    // this page load.
  }
}

const listeners = new Set();
let snapshot = { session: readStoredSession(), customer: null };

function publish(next) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Stable reference between changes, as useSyncExternalStore requires.
export function getSnapshot() {
  return snapshot;
}

// Called after a successful registration, duplicate registration or lookup,
// and after Customer Area re-hydrates the profile.
export function setCustomer(customer) {
  if (!customer || !customer.id || !customer.phone) return;
  const session = { id: customer.id, phone: customer.phone };
  writeStoredSession(session);
  publish({ session, customer });
}

export function clearCustomer() {
  writeStoredSession(null);
  publish({ session: null, customer: null });
}

// Test-only: rebuild the in-memory snapshot from storage.
export function resetSessionStoreForTests() {
  publish({ session: readStoredSession(), customer: null });
}
