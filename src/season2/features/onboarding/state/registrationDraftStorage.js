// Text-only registration draft, kept in sessionStorage so a refresh in the
// middle of the flow doesn't lose what the customer already typed.
//
// File objects are NEVER stored here — the photo lives in memory only and is
// simply asked for again after a refresh.
const STORAGE_KEY = "alshayebS2RegistrationDraft";

export const EMPTY_DRAFT = { schoolId: "", schoolName: "", fullName: "", phone: "", email: "" };

const asString = (value) => (typeof value === "string" ? value : "");

export function readDraft() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      schoolId: asString(parsed?.schoolId),
      schoolName: asString(parsed?.schoolName),
      fullName: asString(parsed?.fullName),
      phone: asString(parsed?.phone),
      // drafts saved before email existed simply read back as ""
      email: asString(parsed?.email)
    };
  } catch {
    return null;
  }
}

export function hasDraftContent(draft) {
  return Boolean(draft && (draft.schoolId || draft.fullName || draft.phone || draft.email));
}

export function writeDraft(draft) {
  try {
    if (hasDraftContent(draft)) {
      // Whitelist: only these five text fields can ever reach storage.
      const text = {
        schoolId: asString(draft.schoolId),
        schoolName: asString(draft.schoolName),
        fullName: asString(draft.fullName),
        phone: asString(draft.phone),
        email: asString(draft.email)
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(text));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage blocked: the in-memory draft still works for this page load.
  }
}

export function clearDraft() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
