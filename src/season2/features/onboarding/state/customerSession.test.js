import { setCustomer, clearCustomer, getSnapshot, subscribe } from "./customerSession";

const CUSTOMER = {
  id: "abc123",
  fullName: "Marina Adel",
  phone: "01012345678",
  attendeeType: "incomer"
};

beforeEach(() => {
  clearCustomer();
  window.sessionStorage.clear();
});

test("setCustomer persists ONLY { id, phone } to sessionStorage", () => {
  setCustomer({ ...CUSTOMER, qrToken: "leak", qrId: "leak" });
  const stored = JSON.parse(window.sessionStorage.getItem("alshayebS2Customer"));
  expect(stored).toEqual({ id: "abc123", phone: "01012345678" });
  expect(getSnapshot().session).toEqual(stored);
  expect(getSnapshot().customer.fullName).toBe("Marina Adel");
});

test("the session never stores an email — still only { id, phone }", () => {
  setCustomer({ ...CUSTOMER, email: "marina@example.com" });
  expect(JSON.parse(window.sessionStorage.getItem("alshayebS2Customer"))).toEqual({ id: "abc123", phone: "01012345678" });
  expect(getSnapshot().session).toEqual({ id: "abc123", phone: "01012345678" });
  expect(window.sessionStorage.getItem("alshayebS2Customer")).not.toMatch(/marina@example|email/);
});

test("clearCustomer removes both memory and storage", () => {
  setCustomer(CUSTOMER);
  clearCustomer();
  expect(getSnapshot()).toEqual({ session: null, customer: null });
  expect(window.sessionStorage.getItem("alshayebS2Customer")).toBeNull();
});

test("ignores customers without an id or phone", () => {
  setCustomer({ id: "", phone: "01012345678" });
  setCustomer({ id: "x", phone: "" });
  setCustomer(null);
  expect(getSnapshot().session).toBeNull();
});

test("notifies subscribers and returns a stable snapshot between changes", () => {
  const listener = jest.fn();
  const unsubscribe = subscribe(listener);
  const before = getSnapshot();
  expect(getSnapshot()).toBe(before);
  setCustomer(CUSTOMER);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getSnapshot()).not.toBe(before);
  unsubscribe();
  clearCustomer();
  expect(listener).toHaveBeenCalledTimes(1);
});

test("still works in memory when sessionStorage throws", () => {
  const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => setCustomer(CUSTOMER)).not.toThrow();
  expect(getSnapshot().session.id).toBe("abc123");
  spy.mockRestore();
});
