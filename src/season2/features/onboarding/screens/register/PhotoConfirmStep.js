import React, { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import OnboardingStage, { OnboardingHeading } from "../../components/OnboardingStage";
import PhotoPicker from "../../components/PhotoPicker";
import Button from "../../../../components/Button";
import { useRegistration } from "../../state/RegistrationProvider";
import useEnterCustomerArea from "../../hooks/useEnterCustomerArea";
import { cleanFullName } from "../../utils/validation";
import { formatPhoneDisplay } from "../../utils/phone";
import { normalizeEmail } from "../../utils/email";
import { firstIncompleteStep } from "../../utils/registrationSteps";
import { PATHS } from "../../paths";

const FIELD_FIX = {
  school: { to: PATHS.incomerNewSchool, label: "Change school" },
  fullName: { to: PATHS.incomerNewDetails, label: "Edit details" },
  phone: { to: PATHS.incomerNewDetails, label: "Edit details" },
  email: { to: PATHS.incomerNewDetails, label: "Edit details" }
};

// Step 3 — Photo + Confirm. Nothing is uploaded until the customer presses
// "Complete registration". The photo is optimized in the browser first; a
// failed submit keeps the draft AND the chosen photo so Retry is one tap.
export default function PhotoConfirmStep() {
  const enterCustomerArea = useEnterCustomerArea();
  const { state, selectPhoto, submit, dismissSubmitError } = useRegistration();
  const { draft, photo } = state;
  const [missingPhoto, setMissingPhoto] = useState(false);

  const redirect = firstIncompleteStep(draft);
  if (redirect) return <Navigate to={redirect} replace />;

  const submitting = state.submit.status === "submitting";
  const submitError = state.submit.error;
  const hasPhoto = Boolean(photo.file);

  const photoError =
    photo.error ||
    (submitError?.field === "photo" ? submitError.message : "") ||
    (missingPhoto && !hasPhoto ? "Add your photo to continue." : "");

  const handleSelect = (file) => {
    setMissingPhoto(false);
    if (submitError) dismissSubmitError();
    selectPhoto(file);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!hasPhoto) {
      setMissingPhoto(true);
      return;
    }

    const result = await submit();
    if (result.ok) enterCustomerArea(result.customer);
  };

  // Errors for fields that live on earlier steps get a direct way back to them.
  const fix = submitError ? FIELD_FIX[submitError.field] : null;
  const formNotice = submitError && submitError.field !== "photo" ? submitError : null;

  let buttonLabel = "Complete registration";
  if (submitting) buttonLabel = "Registering…";
  else if (photo.processing) buttonLabel = "Preparing photo…";
  else if (submitError?.retryable) buttonLabel = "Try again";

  return (
    <OnboardingStage backTo={PATHS.incomerNewSchool} sideLabel="Step 3 / 3" progress={0.86} variant="photo">
      <OnboardingHeading
        eyebrow="New registration"
        title={["Your", "photo"]}
        lede="Add a clear photo of yourself, then check your details."
      />

      <form className="s2-ob-form s2-ob-photoform" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        {state.restored && !hasPhoto && !photo.processing && (
          <p className="s2-ob-hint">We've kept your details. Please choose your photo again.</p>
        )}

        <PhotoPicker
          previewUrl={photo.previewUrl}
          caption={cleanFullName(draft.fullName)}
          processing={photo.processing}
          error={photoError}
          disabled={submitting}
          onSelect={handleSelect}
        />

        <dl className="s2-ob-summary">
          <div className="s2-ob-summary-row">
            <dt>School</dt>
            <dd>{draft.schoolName || "—"}</dd>
            <Link className="s2-ob-summary-edit" to={PATHS.incomerNewSchool} aria-label="Change school">
              Edit
            </Link>
          </div>
          <div className="s2-ob-summary-row">
            <dt>Full name</dt>
            <dd>{cleanFullName(draft.fullName)}</dd>
            <Link className="s2-ob-summary-edit" to={PATHS.incomerNewDetails} aria-label="Edit full name">
              Edit
            </Link>
          </div>
          <div className="s2-ob-summary-row">
            <dt>Mobile</dt>
            <dd>{formatPhoneDisplay(draft.phone)}</dd>
            <Link className="s2-ob-summary-edit" to={PATHS.incomerNewDetails} aria-label="Edit mobile number">
              Edit
            </Link>
          </div>
          <div className="s2-ob-summary-row">
            <dt>Email</dt>
            <dd>{normalizeEmail(draft.email)}</dd>
            <Link className="s2-ob-summary-edit" to={PATHS.incomerNewDetails} aria-label="Edit email">
              Edit
            </Link>
          </div>
        </dl>

        {formNotice && (
          <div className="s2-ob-notice" role="alert">
            {formNotice.title && <h2 className="s2-ob-notice-title">{formNotice.title}</h2>}
            <p className="s2-ob-notice-text">{formNotice.message}</p>
            {fix && (
              <div className="s2-ob-notice-actions">
                <Link className="s2-ob-linkbtn" to={fix.to}>
                  {fix.label}
                </Link>
              </div>
            )}
          </div>
        )}

        <Button type="submit" className="s2-ob-cta" disabled={submitting || photo.processing}>
          {buttonLabel}
        </Button>
        <p className="s2-ob-hint s2-ob-fineprint">Please check your details before you finish.</p>
      </form>
    </OnboardingStage>
  );
}
