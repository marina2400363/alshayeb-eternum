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
    ["A valid schoolId is required.", "school"],
    ["Selected school was not found.", "school"],
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

  test("choosing a school stores id + name", () => {
    const next = registrationReducer(start(), { type: "SET_SCHOOL", id: "s1", name: "Alpha" });
    expect(next.draft).toMatchObject({ schoolId: "s1", schoolName: "Alpha" });
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
    state = registrationReducer(state, { type: "SET_SCHOOL", id: "s1", name: "A" });
    expect(state.submit.error).not.toBeNull();
    state = registrationReducer(state, { type: "SET_DETAILS", fullName: "A B", phone: "0101", email: "bad" });
    expect(state.submit.error).not.toBeNull(); // nothing changed
    state = registrationReducer(state, { type: "SET_DETAILS", fullName: "A B", phone: "0101", email: "good@example.com" });
    expect(state.submit.error).toBeNull();
  });

  test("a server error for a field clears only when that field is edited", () => {
    let state = start();
    state = registrationReducer(state, { type: "SUBMIT_FAILED", error: { field: "phone", message: "bad" } });
    state = registrationReducer(state, { type: "SET_SCHOOL", id: "s1", name: "A" });
    expect(state.submit.error).not.toBeNull();
    state = registrationReducer(state, { type: "SET_DETAILS", fullName: "A B", phone: "0101" });
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
    let state = registrationReducer(start(), { type: "SET_SCHOOL", id: "s1", name: "A" });
    state = registrationReducer(state, { type: "PHOTO_READY", file, previewUrl: "blob:1" });
    state = registrationReducer(state, { type: "SUBMIT_STARTED" });
    expect(state.submit.status).toBe("submitting");
    state = registrationReducer(state, { type: "SUBMIT_FAILED", error: { field: "form", retryable: true, message: "x" } });
    expect(state.submit.status).toBe("error");
    expect(state.draft.schoolId).toBe("s1");
    expect(state.photo.file).toBe(file);
  });

  test("starting a submit clears a stale photo-replacement error but keeps the photo", () => {
    let state = registrationReducer(start(), { type: "PHOTO_READY", file, previewUrl: "blob:1" });
    state = registrationReducer(state, { type: "PHOTO_FAILED", message: "old" });
    state = registrationReducer(state, { type: "SUBMIT_STARTED" });
    expect(state.photo.error).toBe("");
    expect(state.photo.file).toBe(file);
  });

  test("schools lifecycle", () => {
    let state = registrationReducer(start(), { type: "SCHOOLS_LOADING" });
    expect(state.schools.status).toBe("loading");
    state = registrationReducer(state, { type: "SCHOOLS_LOADED", items: [{ id: "a", name: "A" }] });
    expect(state.schools).toEqual({ status: "ready", items: [{ id: "a", name: "A" }], error: "" });
    state = registrationReducer(state, { type: "SCHOOLS_FAILED", message: "down" });
    expect(state.schools.status).toBe("error");
    expect(state.schools.items).toHaveLength(1);
  });

  test("the state never contains qr / photo-metadata fields", () => {
    const state = registrationReducer(start(), { type: "PHOTO_READY", file, previewUrl: "blob:1" });
    expect(JSON.stringify({ draft: state.draft })).not.toMatch(/qr|photo/i);
  });
});

describe("draft storage", () => {
  beforeEach(() => window.sessionStorage.clear());

  test("persists text only and round-trips", () => {
    writeDraft({ schoolId: "s1", schoolName: "Alpha", fullName: "Marina Adel", phone: "01012345678", email: "m@x.com", file: "IGNORED" });
    const stored = JSON.parse(window.sessionStorage.getItem("alshayebS2RegistrationDraft"));
    // the whitelist: five text fields, nothing else
    expect(Object.keys(stored).sort()).toEqual(["email", "fullName", "phone", "schoolId", "schoolName"].sort());
    expect(readDraft()).toEqual({ schoolId: "s1", schoolName: "Alpha", fullName: "Marina Adel", phone: "01012345678", email: "m@x.com" });
  });

  test("a draft saved before email existed reads back with an empty email", () => {
    window.sessionStorage.setItem(
      "alshayebS2RegistrationDraft",
      JSON.stringify({ schoolId: "s1", schoolName: "A", fullName: "Marina Adel", phone: "01012345678" })
    );
    expect(readDraft()).toEqual({ schoolId: "s1", schoolName: "A", fullName: "Marina Adel", phone: "01012345678", email: "" });
  });

  test("an email alone counts as draft content", () => {
    expect(hasDraftContent({ schoolId: "", schoolName: "", fullName: "", phone: "", email: "a@b.co" })).toBe(true);
  });

  test("an empty draft removes the key; clearDraft removes it", () => {
    writeDraft({ schoolId: "s1", schoolName: "A", fullName: "", phone: "", email: "" });
    writeDraft({ schoolId: "", schoolName: "", fullName: "", phone: "", email: "" });
    expect(window.sessionStorage.getItem("alshayebS2RegistrationDraft")).toBeNull();
    writeDraft({ schoolId: "s1", schoolName: "A", fullName: "", phone: "", email: "" });
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
  const ok = { schoolId: "s1", schoolName: "A", fullName: "Marina Adel", phone: "01012345678", email: "marina@example.com" };

  test("Details is the first gate: any invalid detail sends you to Details", () => {
    expect(firstIncompleteStep({ ...ok, fullName: "" })).toBe(PATHS.incomerNewDetails);
    expect(firstIncompleteStep({ ...ok, phone: "123" })).toBe(PATHS.incomerNewDetails);
    expect(firstIncompleteStep({ ...ok, email: "" })).toBe(PATHS.incomerNewDetails);
    expect(firstIncompleteStep({ ...ok, email: "not-an-email" })).toBe(PATHS.incomerNewDetails);
  });

  test("Details wins over School: a missing school never masks bad details", () => {
    expect(firstIncompleteStep({ ...ok, schoolId: "", email: "" })).toBe(PATHS.incomerNewDetails);
    expect(firstIncompleteStep({ schoolId: "", schoolName: "", fullName: "", phone: "", email: "" })).toBe(PATHS.incomerNewDetails);
  });

  test("School is the second gate: valid Details but no school", () => {
    expect(firstIncompleteStep({ ...ok, schoolId: "" })).toBe(PATHS.incomerNewSchool);
  });

  test("Photo is reachable only with valid Details AND a school", () => {
    expect(firstIncompleteStep(ok)).toBeNull();
    // an email with stray case / spaces is still valid (it is normalized on Continue)
    expect(firstIncompleteStep({ ...ok, email: "  Marina@Example.COM " })).toBeNull();
  });

  test("detailsIncomplete gates the School step", () => {
    expect(detailsIncomplete(ok)).toBe(false);
    expect(detailsIncomplete({ ...ok, email: "" })).toBe(true);
    expect(detailsIncomplete({ ...ok, schoolId: "" })).toBe(false); // the school is not a detail
  });
});
