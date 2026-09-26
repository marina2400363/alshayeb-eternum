import { EMPTY_DRAFT } from "./registrationDraftStorage";
import { normalizePhone } from "../utils/phone";

// Pure state for the New Incomer registration flow. Side effects (fetching,
// compressing, object URLs, storage, submitting) live in RegistrationProvider.
//
//   draft       — the text the customer entered (persisted to sessionStorage)
//   restored    — the draft was recovered from storage after a reload
//   precheckedPhone — last phone the Details pre-check found NOT registered
//   schools     — Admin-managed school list, cached for the whole flow
//   photo       — in-memory only: the optimized File + its preview URL
//   submit      — final POST status and the last placed error

export function createInitialState({ draft = null, restored = false, prefillPhone = "" } = {}) {
  const base = { ...EMPTY_DRAFT, ...(draft || {}) };
  // "Register now" from the lookup carries the number the customer just typed;
  // that beats a phone left over from an earlier, abandoned draft.
  if (prefillPhone) base.phone = prefillPhone;

  return {
    draft: base,
    restored,
    precheckedPhone: "",
    schools: { status: "idle", items: [], error: "" },
    photo: { file: null, previewUrl: "", processing: false, error: "" },
    submit: { status: "idle", error: null }
  };
}

// A server-side field error is only meaningful until the customer edits that
// field, so edits clear it.
function clearedSubmitError(submit, fields) {
  if (submit.error && fields.includes(submit.error.field)) {
    return { status: "idle", error: null };
  }
  return submit;
}

export function registrationReducer(state, action) {
  switch (action.type) {
    case "SCHOOLS_LOADING":
      return { ...state, schools: { ...state.schools, status: "loading", error: "" } };

    case "SCHOOLS_LOADED":
      return { ...state, schools: { status: "ready", items: action.items, error: "" } };

    case "SCHOOLS_FAILED":
      return { ...state, schools: { ...state.schools, status: "error", error: action.message } };

    case "SET_SCHOOL":
      return {
        ...state,
        draft: { ...state.draft, schoolId: action.id, schoolName: action.name },
        submit: clearedSubmitError(state.submit, ["school"])
      };

    case "SET_DETAILS": {
      // email is optional in the action so callers that only touch name/phone
      // leave it alone
      const email = action.email !== undefined ? action.email : state.draft.email;
      const changed =
        action.fullName !== state.draft.fullName ||
        action.phone !== state.draft.phone ||
        email !== state.draft.email;
      return {
        ...state,
        draft: { ...state.draft, fullName: action.fullName, phone: action.phone, email },
        submit: changed ? clearedSubmitError(state.submit, ["fullName", "phone", "email"]) : state.submit
      };
    }

    case "PRECHECK_PASSED":
      return { ...state, precheckedPhone: normalizePhone(action.phone) };

    case "PHOTO_PROCESSING":
      return { ...state, photo: { ...state.photo, processing: true, error: "" } };

    // A failed replacement keeps the photo that was already chosen.
    case "PHOTO_FAILED":
      return { ...state, photo: { ...state.photo, processing: false, error: action.message } };

    case "PHOTO_READY":
      return {
        ...state,
        photo: { file: action.file, previewUrl: action.previewUrl, processing: false, error: "" },
        submit: clearedSubmitError(state.submit, ["photo"])
      };

    // Pressing submit supersedes an old "couldn't use that photo" message
    // about a replacement attempt — the photo being sent is the one shown.
    case "SUBMIT_STARTED":
      return { ...state, photo: { ...state.photo, error: "" }, submit: { status: "submitting", error: null } };

    case "SUBMIT_FAILED":
      return { ...state, submit: { status: "error", error: action.error } };

    case "SUBMIT_ERROR_DISMISSED":
      return { ...state, submit: { status: "idle", error: null } };

    default:
      return state;
  }
}
