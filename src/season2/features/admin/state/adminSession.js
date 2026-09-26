// Sandra's Admin Portal session store — a tiny module-level store, same
// useSyncExternalStore pattern as onboarding/state/customerSession.js.
//
// Deliberately reuses the EXACT same localStorage key and shape the legacy
// Season 1 admin dashboard already writes ({authenticated, email, token,
// expiresAt, signedInAt} under "alshayebAdminSession") — see src/App.js's
// AdminLogin/isAdminAuthenticated(). This is the same physical admin
// account and the same backend JWT (adminAuthRoutes.js), so a login here
// authenticates the legacy admin too, and vice versa. This is intentional:
// "reuse existing admin authentication, do not create a second admin login
// system." localStorage (not sessionStorage) matches that existing
// convention — an admin session persists across tabs.

const STORAGE_KEY = "alshayebAdminSession";
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // matches backend's 8h JWT expiry

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.authenticated || !parsed?.token || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { email: parsed.email || "", token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  try {
    if (session) {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          authenticated: true,
          email: session.email,
          token: session.token,
          expiresAt: session.expiresAt,
          signedInAt: new Date().toISOString()
        })
      );
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private mode / blocked storage: in-memory session still works for this
    // page load, same graceful fallback as customerSession.js.
  }
}

const listeners = new Set();
let snapshot = { session: readStoredSession() };

function publish(next) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return snapshot;
}

// Called after a successful POST /api/admin/auth/login.
export function setAdminSession({ email, token }) {
  if (!token) return;
  const session = { email: email || "", token, expiresAt: Date.now() + TOKEN_TTL_MS };
  writeStoredSession(session);
  publish({ session });
}

export function clearAdminSession() {
  writeStoredSession(null);
  publish({ session: null });
}

// Test-only: rebuild the in-memory snapshot from storage.
export function resetAdminSessionStoreForTests() {
  publish({ session: readStoredSession() });
}
