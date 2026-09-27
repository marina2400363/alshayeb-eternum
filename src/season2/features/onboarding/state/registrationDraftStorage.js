// Text-only registration draft, kept in sessionStorage so a refresh in the
// middle of the flow doesn't lose what the customer already typed.
//
// File objects are NEVER stored here — the photo lives in memory only and is
// simply asked for again after a refresh.
const STORAGE_KEY = "alshayebS2RegistrationDraft";

// schoolAccessToken is the short-lived, signed token issued by
// POST /api/school-access/verify after a correct School Access Code — never a
// schoolId. It is the only thing that ties this draft to a School; there is
// no public School list to re-derive one from, so if it goes missing (or the
// backend later rejects it as expired) the customer must enter their code
// again — never a fallback School picker.
export const EMPTY_DRAFT = { schoolAccessToken: "", schoolName: "", fullName: "", phone: "", email: "" };

const asString = (value) => (typeof value === "string" ? value : "");

export function readDraft() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      schoolAccessToken: asString(parsed?.schoolAccessToken),
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
  return Boolean(draft && (draft.schoolAccessToken || draft.fullName || draft.phone || draft.email));
}

export function writeDraft(draft) {
  try {
    if (hasDraftContent(draft)) {
      // Whitelist: only these five text fields can ever reach storage.
      const text = {
        schoolAccessToken: asString(draft.schoolAccessToken),
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
