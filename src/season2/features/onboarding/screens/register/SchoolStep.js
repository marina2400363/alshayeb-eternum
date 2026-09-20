import React, { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import OnboardingStage, { OnboardingHeading } from "../../components/OnboardingStage";
import SchoolPicker from "../../components/SchoolPicker";
import Button from "../../../../components/Button";
import LoadingState from "../../../../components/LoadingState";
import ErrorState from "../../../../components/ErrorState";
import { useRegistration } from "../../state/RegistrationProvider";
import useSchools from "../../hooks/useSchools";
import { validateSchool } from "../../utils/validation";
import { detailsIncomplete } from "../../utils/registrationSteps";
import { PATHS } from "../../paths";

// Step 2 — School. Needs valid Details first (a refresh, pasted URL or stale
// tab without them is sent back to Details — and the schools list is not even
// fetched for that redirect). The school must already exist in the
// Admin-managed list: no manual entry, no fallback data. Shows names only
// (never prices).
export default function SchoolStep() {
  const { state } = useRegistration();
  if (detailsIncomplete(state.draft)) return <Navigate to={PATHS.incomerNewDetails} replace />;
  return <SchoolPicking />;
}

function SchoolPicking() {
  const navigate = useNavigate();
  const { state, chooseSchool } = useRegistration();
  const { status, schools, error: loadError, reload } = useSchools();
  const [pickError, setPickError] = useState("");

  // A remembered school that is no longer in the list counts as not chosen.
  const selectedId = schools.some((school) => school.id === state.draft.schoolId) ? state.draft.schoolId : "";

  // Set when the final submit was rejected because of the school.
  const serverError = state.submit.error?.field === "school" ? state.submit.error.message : "";

  const handlePick = (school) => {
    setPickError("");
    chooseSchool(school);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const invalid = validateSchool(selectedId, schools);
    if (invalid) {
      setPickError(invalid);
      return;
    }
    navigate(PATHS.incomerNewPhoto);
  };

  const loading = status === "idle" || status === "loading";
  const blocked = status === "ready" && schools.length === 0;

  return (
    <OnboardingStage backTo={PATHS.incomerNewDetails} sideLabel="Step 2 / 3" progress={0.66}>
      <OnboardingHeading
        eyebrow="New registration"
        title={["Your", "school"]}
        lede={blocked ? undefined : "Choose your school from the list."}
      />

      {loading && <LoadingState label="Loading schools" />}

      {status === "error" && (
        <ErrorState title="Couldn't load schools" message={loadError} onRetry={reload} />
      )}

      {blocked && (
        <div className="s2-ob-notice" role="status">
          <h2 className="s2-ob-notice-title">Not available yet</h2>
          <p className="s2-ob-notice-text">Registration is not available for your school yet.</p>
          <div className="s2-ob-notice-actions">
            <Link className="s2-ob-linkbtn" to={PATHS.incomerNewDetails}>
              Back
            </Link>
          </div>
        </div>
      )}

      {status === "ready" && !blocked && (
        <form className="s2-ob-form" onSubmit={handleSubmit} noValidate>
          <SchoolPicker schools={schools} value={selectedId} onChange={handlePick} error={pickError || serverError} />
          <Button type="submit" className="s2-ob-cta">
            Continue
          </Button>
        </form>
      )}
    </OnboardingStage>
  );
}
