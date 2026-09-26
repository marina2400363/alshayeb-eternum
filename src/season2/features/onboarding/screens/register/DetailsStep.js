import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import OnboardingStage, { OnboardingHeading } from "../../components/OnboardingStage";
import { EmailField, PhoneField, TextField } from "../../components/Field";
import Button from "../../../../components/Button";
import { useRegistration } from "../../state/RegistrationProvider";
import useEnterCustomerArea from "../../hooks/useEnterCustomerArea";
import { lookupIncomer } from "../../../../services/onboarding.api";
import { normalizePhone, sanitizePhoneInput } from "../../utils/phone";
import { normalizeEmail } from "../../utils/email";
import { FULL_NAME_MAX, cleanFullName, validateEmail, validateFullName, validatePhone } from "../../utils/validation";
import { PATHS } from "../../paths";

// Step 1 — Details: full name, Egyptian mobile number and email.
//
// Continue validates all three, then runs a convenience pre-check BY PHONE
// ONLY (email is never used to look anyone up): if the number already belongs
// to an Incomer, registration stops and they are handed to the Customer Area
// as a returning customer. It is only a shortcut — the backend's duplicate
// response is still handled at final submit — so a pre-check that FAILS to
// answer (network / 5xx) never blocks the customer from continuing to School.
export default function DetailsStep() {
  const navigate = useNavigate();
  const enterCustomerArea = useEnterCustomerArea();
  const { state, setDetails, markPrechecked, discardDraft } = useRegistration();
  const { draft } = state;

  const [errors, setErrors] = useState({ fullName: "", phone: "", email: "" });
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const controllerRef = useRef(null);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  const emailRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  // A rejection of the final submit that belongs on this step.
  const serverError = state.submit.error;
  const serverFullName = serverError?.field === "fullName" ? serverError.message : "";
  const serverPhone = serverError?.field === "phone" ? serverError.message : "";
  const serverEmail = serverError?.field === "email" ? serverError.message : "";

  const handleName = (event) => {
    setDetails(event.target.value, draft.phone, draft.email);
    if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: "" }));
  };

  const handlePhone = (event) => {
    setDetails(draft.fullName, sanitizePhoneInput(event.target.value), draft.email);
    if (errors.phone) setErrors((prev) => ({ ...prev, phone: "" }));
  };

  const handleEmail = (event) => {
    setDetails(draft.fullName, draft.phone, event.target.value);
    if (errors.email) setErrors((prev) => ({ ...prev, email: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;

    const nameError = validateFullName(draft.fullName);
    const phoneError = validatePhone(draft.phone);
    const emailError = validateEmail(draft.email);
    if (nameError || phoneError || emailError) {
      setErrors({ fullName: nameError, phone: phoneError, email: emailError });
      // focus the first invalid field, in on-screen order
      (nameError ? nameRef : phoneError ? phoneRef : emailRef).current?.focus();
      return;
    }

    setErrors({ fullName: "", phone: "", email: "" });
    // Store the cleaned values: name spacing, and the email trimmed + lowercased.
    setDetails(cleanFullName(draft.fullName), draft.phone, normalizeEmail(draft.email));

    // Already confirmed as not-registered earlier in this flow: skip the call.
    if (normalizePhone(draft.phone) === state.precheckedPhone) {
      navigate(PATHS.incomerNewSchool);
      return;
    }

    inFlight.current = true;
    controllerRef.current = new AbortController();
    setChecking(true);

    try {
      const { found, customer } = await lookupIncomer(draft.phone, { signal: controllerRef.current.signal });

      if (found) {
        // Existing Incomer: stop registering, treat as returning.
        discardDraft();
        enterCustomerArea(customer);
        return;
      }

      markPrechecked(draft.phone);
      navigate(PATHS.incomerNewSchool);
    } catch (error) {
      if (error.kind === "aborted") return;

      if (error.isRetryable) {
        // Couldn't check — carry on; final submit is the real authority.
        navigate(PATHS.incomerNewSchool);
      } else {
        setErrors((prev) => ({ ...prev, phone: error.message }));
        setChecking(false);
        phoneRef.current?.focus();
      }
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  return (
    <OnboardingStage backTo={PATHS.incomer} sideLabel="Step 1 / 3" progress={0.46}>
      <OnboardingHeading
        eyebrow="New registration"
        title={["Your", "details"]}
        lede="Your name, mobile number and email."
      />

      <form className="s2-ob-form" onSubmit={handleSubmit} noValidate aria-busy={checking}>
        <TextField
          id="fullName"
          label="Full name"
          inputRef={nameRef}
          value={draft.fullName}
          onChange={handleName}
          error={errors.fullName || serverFullName}
          disabled={checking}
          autoComplete="name"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={FULL_NAME_MAX}
          enterKeyHint="next"
          placeholder="Your full name"
        />
        <PhoneField
          inputRef={phoneRef}
          value={draft.phone}
          onChange={handlePhone}
          error={errors.phone || serverPhone}
          disabled={checking}
          enterKeyHint="next"
        />
        <EmailField
          inputRef={emailRef}
          value={draft.email}
          onChange={handleEmail}
          error={errors.email || serverEmail}
          disabled={checking}
          enterKeyHint="go"
        />
        <Button type="submit" className="s2-ob-cta" disabled={checking}>
          {checking ? "Checking…" : "Continue"}
        </Button>
      </form>
    </OnboardingStage>
  );
}
