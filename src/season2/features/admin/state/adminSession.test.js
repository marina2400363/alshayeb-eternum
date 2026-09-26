import { setAdminSession, clearAdminSession, getSnapshot, subscribe } from "./adminSession";

const STORAGE_KEY = "alshayebAdminSession";

beforeEach(() => {
  clearAdminSession();
  window.localStorage.clear();
});

test("setAdminSession persists {authenticated, email, token, expiresAt, signedInAt} — the SAME shape the legacy admin dashboard writes", () => {
  setAdminSession({ email: "admin@alshayeb.com", token: "jwt-abc" });
  const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));

  expect(stored.authenticated).toBe(true);
  expect(stored.email).toBe("admin@alshayeb.com");
  expect(stored.token).toBe("jwt-abc");
  expect(typeof stored.expiresAt).toBe("number");
  expect(typeof stored.signedInAt).toBe("string");
  expect(getSnapshot().session).toEqual({ email: "admin@alshayeb.com", token: "jwt-abc", expiresAt: stored.expiresAt });
});

test("uses the SAME localStorage key as the legacy Season 1 admin dashboard — one shared session, not a second login system", () => {
  setAdminSession({ email: "a@b.com", token: "t" });
  expect(window.localStorage.getItem("alshayebAdminSession")).not.toBeNull();
});

test("clearAdminSession removes both memory and storage", () => {
  setAdminSession({ email: "a@b.com", token: "t" });
  clearAdminSession();
  expect(getSnapshot()).toEqual({ session: null });
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("an expired session is rejected client-side and cleared from storage", () => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ authenticated: true, email: "a@b.com", token: "t", expiresAt: Date.now() - 1000, signedInAt: "x" })
  );
  jest.resetModules();
  // eslint-disable-next-line global-require
  const fresh = require("./adminSession");
  expect(fresh.getSnapshot().session).toBeNull();
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("a session missing token/expiresAt/authenticated is treated as signed out", () => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ email: "a@b.com" }));
  jest.resetModules();
  // eslint-disable-next-line global-require
  const fresh = require("./adminSession");
  expect(fresh.getSnapshot().session).toBeNull();
});

test("ignores a session with no token", () => {
  setAdminSession({ email: "a@b.com", token: "" });
  expect(getSnapshot().session).toBeNull();
});

test("notifies subscribers and returns a stable snapshot between changes", () => {
  const listener = jest.fn();
  const unsubscribe = subscribe(listener);
  const before = getSnapshot();
  expect(getSnapshot()).toBe(before);

  setAdminSession({ email: "a@b.com", token: "t" });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getSnapshot()).not.toBe(before);

  unsubscribe();
  clearAdminSession();
  expect(listener).toHaveBeenCalledTimes(1);
});

test("still works in memory when localStorage throws", () => {
  const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => setAdminSession({ email: "a@b.com", token: "t" })).not.toThrow();
  expect(getSnapshot().session.token).toBe("t");
  spy.mockRestore();
});
