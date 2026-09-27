import React, { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import OnboardingStage, { OnboardingHeading } from "../../components/OnboardingStage";
import { TextField } from "../../components/Field";
import Button from "../../../../components/Button";
import { useRegistration } from "../../state/RegistrationProvider";
import { validateAccessCode } from "../../utils/validation";
import { detailsIncomplete } from "../../utils/registrationSteps";
import { PATHS } from "../../paths";

// Step 2 — School Access. Needs valid Details first (a refresh, pasted URL or
// stale tab without them is sent back to Details). Every School has its own
// private Access Code from the Admin Portal: there is no public School list
// or search here. A correct code resolves exactly one School server-side —
// the customer never chooses or sees any other School's name, price or
// existence, and the School itself is only shown (on the next step) after
// the code is verified.
export default function SchoolAccessStep() {
  const { state } = useRegistration();
  if (detailsIncomplete(state.draft)) return <Navigate to={PATHS.incomerNewDetails} replace />;
  return <SchoolAccessForm />;
}

function SchoolAccessForm() {
  const navigate = useNavigate();
  const { state, verifySchoolAccess } = useRegistration();
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState("");
  const inputRef = useRef(null);

  const verifying = state.schoolAccess.status === "verifying";
  // A rejection of the final submit (an expired/invalid token) belongs here.
  const serverError = state.submit.error?.field === "school" ? state.submit.error.message : "";
  const error = localError || state.schoolAccess.error || serverError;

  const handleChange = (event) => {
    setCode(event.target.value);
    if (localError) setLocalError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (verifying) return;

    const invalid = validateAccessCode(code);
    if (invalid) {
      setLocalError(invalid);
      inputRef.current?.focus();
      return;
    }

    const result = await verifySchoolAccess(code);
    if (result.ok) navigate(PATHS.incomerNewPhoto);
    else if (!result.aborted) inputRef.current?.focus();
  };

  return (
    <OnboardingStage backTo={PATHS.incomerNewDetails} sideLabel="Step 2 / 3" progress={0.66}>
      <OnboardingHeading
        eyebrow="New registration"
        title={["School", "access"]}
        lede="Enter the access code provided by your school committee."
      />

      <form className="s2-ob-form" onSubmit={handleSubmit} noValidate aria-busy={verifying}>
        <TextField
          id="school-access-code"
          label="School Access Code"
          inputRef={inputRef}
          value={code}
          onChange={handleChange}
          error={error}
          disabled={verifying}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <Button type="submit" className="s2-ob-cta" disabled={verifying}>
          {verifying ? "Checking…" : "Continue"}
        </Button>
      </form>
    </OnboardingStage>
  );
}
