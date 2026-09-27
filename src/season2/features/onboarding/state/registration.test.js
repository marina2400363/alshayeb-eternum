import { createInitialState, registrationReducer } from "./registrationReducer";
import { readDraft, writeDraft, clearDraft, hasDraftContent } from "./registrationDraftStorage";
import { mapRegistrationError } from "../utils/registrationErrors";
import { firstIncompleteStep, detailsIncomplete } from "../utils/registrationSteps";
import { PATHS } from "../paths";

const file = new File(["x"], "me.jpg", { type: "image/jpeg" });

describe("mapRegistrationError", () => {
  test.each([
    ["Personal photo is required.", "photo"],
    ["Only PNG, JPG, or JPEG photos are allowed.", "photo"],
    ["Personal photo must be 4MB or smaller.", "photo"],
    ["Your school access has expired. Please enter your school access code again.", "school"],
    ["Enter an Egyptian phone number starting with 01 and 11 digits long.", "phone"],
    ["Phone number is required.", "phone"],
    ["Full name is required.", "fullName"],
    ["Full name must be 80 characters or fewer.", "fullName"],
    ["Email is required.", "email"],
    ["Enter a valid email address.", "email"],
    // the example address contains "name" — it must not be read as the name field
    ["Enter a valid email address, like name@example.com.", "email"],
    ["Something unexpected", "form"]
  ])("4xx %p → %s", (message, field) => {
    const mapped = mapRegistrationError({ status: 422, kind: "http", message });
    expect(mapped.field).toBe(field);
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toBe(message);
  });

  test("network / timeout / 5xx are form-level and retryable", () => {
    for (const error of [
      { kind: "network", message: "offline" },
      { kind: "timeout", message: "slow" },
      { kind: "http", status: 500, message: "boom" }
    ]) {
      const mapped = mapRegistrationError(error);
      expect(mapped.field).toBe("form");
      expect(mapped.retryable).toBe(true);
      expect(mapped.title).not.toBe("");
    }
  });
});

describe("registrationReducer", () => {
  const start = () => createInitialState();

  test("a granted school access code stores the token + school name", () => {
    const next = registrationReducer(start(), { type: "SCHOOL_ACCESS_GRANTED", token: "tok-1", schoolName: "Alpha" });
    expect(next.draft).toMatchObject({ schoolAccessToken: "tok-1", schoolName: "Alpha" });
    expect(next.schoolAccess).toEqual({ status: "idle", error: "" });
  });

  test("school access verification lifecycle", () => {
    let state = registrationReducer(start(), { type: "SCHOOL_ACCESS_VERIFYING" });
    expect(state.schoolAccess.status).toBe("verifying");
    state = registrationReducer(state, { type: "SCHOOL_ACCESS_FAILED", message: "Invalid access code." });
    expect(state.schoolAccess).toEqual({ status: "error", error: "Invalid access code." });
    state = registrationReducer(state, { type: "SCHOOL_ACCESS_GRANTED", token: "tok-2", schoolName: "Beta" });
    expect(state.schoolAccess).toEqual({ status: "idle", error: "" });
    expect(state.draft.schoolAccessToken).toBe("tok-2");
  });

  test("prefill from the lookup overrides a stale draft phone", () => {
    const state = createInitialState({ draft: { phone: "01000000000", fullName: "Kept" }, prefillPhone: "01112223334" });
    expect(state.draft.phone).toBe("01112223334");
    expect(state.draft.fullName).toBe("Kept");
  });

  test("SET_DETAILS stores the email, and leaves it alone when a caller omits it", () => {
    let state = registrationReducer(start(), { type: "SET_DETAILS", fullName: "A B", phone: "0101", email: "a@b.co" });
    expect(state.draft).toMatchObject({ fullName: "A B", phone: "0101", email: "a@b.co" });
    state = registrationReducer(state, { type: "SET_DETAILS", fullName: "A Bc", phone: "0101" });
    expect(state.draft.email).toBe("a@b.co");
  });

  test("a server email error clears only when the email is edited", () => {
    let state = registrationReducer(start(), { type: "SET_DETAILS", fullName: "A B", phone: "0101", email: "bad" });
    state = registrationReducer(state, { type: "SUBMIT_FAILED", error: { field: "email", message: "Enter a valid email address." } });
    state = registrationReducer(state, { type: "SCHOOL_ACCESS_GRANTED", token: "s1", schoolName: "A" });
    expect(state.submit.error).not.toBeNull();
    state = registrationReducer(state, { type: "SET_DETAILS", fullName: "A B", phone: "0101", email: "bad" });
    expect(state.submit.error).not.toBeNull(); // nothing changed
    state = registrationReducer(state, { type: "SET_DETAILS", fullName: "A B", phone: "0101", email: "good@example.com" });
    expect(state.submit.error).toBeNull();
  });

  test("a server error for a field clears only when that field is edited", () => {
    let state = start();
    state = registrationReducer(state, { type: "SUBMIT_FAILED", error: { field: "phone", message: "bad" } });
    state = registrationReducer(state, { type: "SCHOOL_ACCESS_GRANTED", token: "s1", schoolName: "A" });
    expect(state.submit.error).not.toBeNull();
    state = registrationReducer(state, { type: "SET_DETAILS", fullName: "A B", phone: "0101" });
    expect(state.submit.error).toBeNull();
  });

  test("a server school-access error clears only when a new code is granted", () => {
    let state = start();
    state = registrationReducer(state, { type: "SUBMIT_FAILED", error: { field: "school", message: "expired" } });
    state = registrationReducer(state, { type: "SET_DETAILS", fullName: "A B", phone: "0101" });
    expect(state.submit.error).not.toBeNull(); // unrelated field: unaffected
    state = registrationReducer(state, { type: "SCHOOL_ACCESS_GRANTED", token: "s1", schoolName: "A" });
    expect(state.submit.error).toBeNull();
  });

  test("a failed photo replacement keeps the photo already chosen", () => {
    let state = registrationReducer(start(), { type: "PHOTO_READY", file, previewUrl: "blob:1" });
    state = registrationReducer(state, { type: "PHOTO_PROCESSING" });
    state = registrationReducer(state, { type: "PHOTO_FAILED", message: "nope" });
    expect(state.photo.file).toBe(file);
    expect(state.photo.previewUrl).toBe("blob:1");
    expect(state.photo.error).toBe("nope");
    expect(state.photo.processing).toBe(false);
  });

  test("a failed submit keeps the draft and the photo (retry is possible)", () => {
    let state = registrationReducer(start(), { type: "SCHOOL_ACCESS_GRANTED", token: "s1", schoolName: "A" });
    state = registrationReducer(state, { type: "PHOTO_READY", file, previewUrl: "blob:1" });
    state = registrationReducer(state, { type: "SUBMIT_STARTED" });
    expect(state.submit.status).toBe("submitting");
    state = registrationReducer(state, { type: "SUBMIT_FAILED", error: { field: "form", retryable: true, message: "x" } });
    expect(state.submit.status).toBe("error");
    expect(state.draft.schoolAccessToken).toBe("s1");
    expect(state.photo.file).toBe(file);
  });

  test("starting a submit clears a stale photo-replacement error but keeps the photo", () => {
    let state = registrationReducer(start(), { type: "PHOTO_READY", file, previewUrl: "blob:1" });
    state = registrationReducer(state, { type: "PHOTO_FAILED", message: "old" });
    state = registrationReducer(state, { type: "SUBMIT_STARTED" });
    expect(state.photo.error).toBe("");
    expect(state.photo.file).toBe(file);
  });

  test("the state never contains qr / photo-metadata fields", () => {
    const state = registrationReducer(start(), { type: "PHOTO_READY", file, previewUrl: "blob:1" });
    expect(JSON.stringify({ draft: state.draft })).not.toMatch(/qr|photo/i);
  });
});

describe("draft storage", () => {
  beforeEach(() => window.sessionStorage.clear());

  test("persists text only and round-trips", () => {
    writeDraft({ schoolAccessToken: "s1", schoolName: "Alpha", fullName: "Marina Adel", phone: "01012345678", email: "m@x.com", file: "IGNORED" });
    const stored = JSON.parse(window.sessionStorage.getItem("alshayebS2RegistrationDraft"));
    // the whitelist: five text fields, nothing else
    expect(Object.keys(stored).sort()).toEqual(["email", "fullName", "phone", "schoolAccessToken", "schoolName"].sort());
    expect(readDraft()).toEqual({ schoolAccessToken: "s1", schoolName: "Alpha", fullName: "Marina Adel", phone: "01012345678", email: "m@x.com" });
  });

  test("a draft saved before email existed reads back with an empty email", () => {
    window.sessionStorage.setItem(
      "alshayebS2RegistrationDraft",
      JSON.stringify({ schoolAccessToken: "s1", schoolName: "A", fullName: "Marina Adel", phone: "01012345678" })
    );
    expect(readDraft()).toEqual({ schoolAccessToken: "s1", schoolName: "A", fullName: "Marina Adel", phone: "01012345678", email: "" });
  });

  test("an email alone counts as draft content", () => {
    expect(hasDraftContent({ schoolAccessToken: "", schoolName: "", fullName: "", phone: "", email: "a@b.co" })).toBe(true);
  });

  test("an empty draft removes the key; clearDraft removes it", () => {
    writeDraft({ schoolAccessToken: "s1", schoolName: "A", fullName: "", phone: "", email: "" });
    writeDraft({ schoolAccessToken: "", schoolName: "", fullName: "", phone: "", email: "" });
    expect(window.sessionStorage.getItem("alshayebS2RegistrationDraft")).toBeNull();
    writeDraft({ schoolAccessToken: "s1", schoolName: "A", fullName: "", phone: "", email: "" });
    clearDraft();
    expect(readDraft()).toBeNull();
    expect(hasDraftContent(null)).toBe(false);
  });

  test("corrupt storage reads as no draft", () => {
    window.sessionStorage.setItem("alshayebS2RegistrationDraft", "{not json");
    expect(readDraft()).toBeNull();
  });
});

describe("firstIncompleteStep (order: Details -> School -> Photo)", () => {
  const ok = { schoolAccessToken: "s1", schoolName: "A", fullName: "Marina Adel", phone: "01012345678", email: "marina@example.com" };

  test("Details is the first gate: any invalid detail sends you to Details", () => {
    expect(firstIncompleteStep({ ...ok, fullName: "" })).toBe(PATHS.incomerNewDetails);
    expect(firstIncompleteStep({ ...ok, phone: "123" })).toBe(PATHS.incomerNewDetails);
    expect(firstIncompleteStep({ ...ok, email: "" })).toBe(PATHS.incomerNewDetails);
    expect(firstIncompleteStep({ ...ok, email: "not-an-email" })).toBe(PATHS.incomerNewDetails);
  });

  test("Details wins over School: a missing school never masks bad details", () => {
    expect(firstIncompleteStep({ ...ok, schoolAccessToken: "", email: "" })).toBe(PATHS.incomerNewDetails);
    expect(firstIncompleteStep({ schoolAccessToken: "", schoolName: "", fullName: "", phone: "", email: "" })).toBe(PATHS.incomerNewDetails);
  });

  test("School is the second gate: valid Details but no school", () => {
    expect(firstIncompleteStep({ ...ok, schoolAccessToken: "" })).toBe(PATHS.incomerNewSchool);
  });

  test("Photo is reachable only with valid Details AND a school", () => {
    expect(firstIncompleteStep(ok)).toBeNull();
    // an email with stray case / spaces is still valid (it is normalized on Continue)
    expect(firstIncompleteStep({ ...ok, email: "  Marina@Example.COM " })).toBeNull();
  });

  test("detailsIncomplete gates the School step", () => {
    expect(detailsIncomplete(ok)).toBe(false);
    expect(detailsIncomplete({ ...ok, email: "" })).toBe(true);
    expect(detailsIncomplete({ ...ok, schoolAccessToken: "" })).toBe(false); // the school is not a detail
  });
});
