import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { useLocation } from "react-router-dom";
import { fetchSchools, registerIncomer } from "../../../services/onboarding.api";
import { createInitialState, registrationReducer } from "./registrationReducer";
import { clearDraft, hasDraftContent, readDraft, writeDraft } from "./registrationDraftStorage";
import { processPhoto } from "../utils/photo";
import { cleanFullName } from "../utils/validation";
import { sanitizePhoneInput } from "../utils/phone";
import { normalizeEmail } from "../utils/email";
import { mapRegistrationError } from "../utils/registrationErrors";

const RegistrationContext = createContext(null);

export function useRegistration() {
  const value = useContext(RegistrationContext);
  if (!value) throw new Error("useRegistration must be used inside <RegistrationProvider>");
  return value;
}

// Owns everything with side effects for the New Incomer flow, so the three
// step screens stay thin and browser Back/refresh behave predictably:
//   • the schools list (fetched once, cached for the whole flow)
//   • the photo pipeline (validate → compress → preview URL, with cleanup)
//   • the final submit (single-flight, keeps draft + photo on failure)
//   • the text draft (mirrored to sessionStorage; never the File)
export default function RegistrationProvider({ children }) {
  const location = useLocation();

  const [state, dispatch] = useReducer(registrationReducer, undefined, () => {
    const stored = readDraft();
    return createInitialState({
      draft: stored,
      restored: hasDraftContent(stored),
      prefillPhone: sanitizePhoneInput(location.state?.phone || "")
    });
  });

  // Latest state for callbacks that must not be re-created on every change.
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---- draft persistence (text only) ----
  useEffect(() => {
    writeDraft(state.draft);
  }, [state.draft]);

  // ---- schools ----
  const schoolsInFlight = useRef(false);
  const schoolsAbort = useRef(null);

  const loadSchools = useCallback(async ({ force = false } = {}) => {
    if (schoolsInFlight.current) return;
    if (stateRef.current.schools.status === "ready" && !force) return;

    schoolsInFlight.current = true;
    schoolsAbort.current = new AbortController();
    dispatch({ type: "SCHOOLS_LOADING" });

    try {
      const items = await fetchSchools({ signal: schoolsAbort.current.signal });
      dispatch({ type: "SCHOOLS_LOADED", items });
    } catch (error) {
      if (error.kind !== "aborted") dispatch({ type: "SCHOOLS_FAILED", message: error.message });
    } finally {
      schoolsInFlight.current = false;
    }
  }, []);

  // ---- photo ----
  const photoToken = useRef(0);
  const previewUrlRef = useRef("");

  const releasePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
  }, []);

  const selectPhoto = useCallback(
    async (file) => {
      const token = ++photoToken.current;
      dispatch({ type: "PHOTO_PROCESSING" });

      const result = await processPhoto(file);
      // A newer pick (or leaving the flow) supersedes this one.
      if (token !== photoToken.current) return;

      if (result.error) {
        dispatch({ type: "PHOTO_FAILED", message: result.error });
        return;
      }

      const nextUrl = URL.createObjectURL(result.file);
      releasePreviewUrl();
      previewUrlRef.current = nextUrl;
      dispatch({ type: "PHOTO_READY", file: result.file, previewUrl: nextUrl });
    },
    [releasePreviewUrl]
  );

  // ---- submit ----
  const submitInFlight = useRef(false);
  const submitAbort = useRef(null);

  // Resolves { ok:true, customer, duplicate } | { ok:false }. Never throws.
  // The caller performs the Customer Area handoff on ok.
  const submit = useCallback(async () => {
    if (submitInFlight.current) return { ok: false };

    const { draft, photo } = stateRef.current;
    if (!photo.file) return { ok: false };

    submitInFlight.current = true;
    submitAbort.current = new AbortController();
    dispatch({ type: "SUBMIT_STARTED" });

    try {
      const { duplicate, customer } = await registerIncomer(
        {
          fullName: cleanFullName(draft.fullName),
          phone: draft.phone,
          email: normalizeEmail(draft.email),
          schoolId: draft.schoolId,
          photo: photo.file
        },
        { signal: submitAbort.current.signal }
      );

      if (!customer?.id || !customer.phone) {
        dispatch({
          type: "SUBMIT_FAILED",
          error: mapRegistrationError({ status: 500, message: "Something went wrong. Please try again in a moment." })
        });
        return { ok: false };
      }

      // Registered (201) or recovered as an existing customer (200 duplicate):
      // either way the draft has done its job.
      clearDraft();
      return { ok: true, customer, duplicate };
    } catch (error) {
      if (error.kind !== "aborted") {
        dispatch({ type: "SUBMIT_FAILED", error: mapRegistrationError(error) });
      }
      return { ok: false };
    } finally {
      submitInFlight.current = false;
    }
  }, []);

  // ---- leaving the flow: cancel requests, invalidate photo work, free the URL ----
  useEffect(
    () => () => {
      schoolsAbort.current?.abort();
      submitAbort.current?.abort();
      photoToken.current += 1;
      releasePreviewUrl();
    },
    [releasePreviewUrl]
  );

  const actions = useMemo(
    () => ({
      loadSchools,
      selectPhoto,
      submit,
      chooseSchool: (school) => dispatch({ type: "SET_SCHOOL", id: school.id, name: school.name }),
      setDetails: (fullName, phone, email) => dispatch({ type: "SET_DETAILS", fullName, phone, email }),
      markPrechecked: (phone) => dispatch({ type: "PRECHECK_PASSED", phone }),
      dismissSubmitError: () => dispatch({ type: "SUBMIT_ERROR_DISMISSED" }),
      discardDraft: clearDraft
    }),
    [loadSchools, selectPhoto, submit]
  );

  const value = useMemo(() => ({ state, ...actions }), [state, actions]);

  return <RegistrationContext.Provider value={value}>{children}</RegistrationContext.Provider>;
}
