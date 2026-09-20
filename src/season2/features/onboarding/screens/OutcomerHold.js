import React from "react";
import { Link } from "react-router-dom";
import OnboardingStage, { OnboardingHeading } from "../components/OnboardingStage";
import StatusBadge from "../../../components/StatusBadge";
import { PATHS } from "../paths";

// Minimal holding screen — only gives the Incomer / Outcomer choice a valid
// destination. The legacy Outcomer flow is intentionally not connected yet.
export default function OutcomerHold() {
  return (
    <OnboardingStage backTo={PATHS.enter} progress={0.34}>
      <OnboardingHeading
        eyebrow="Outcomer"
        title={["Opening", "soon"]}
        lede="Outcomer entry isn't open in this step yet. Please check back shortly."
      />
      <div>
        <StatusBadge status="pending">Coming soon</StatusBadge>
      </div>
      <div className="s2-ob-actions">
        <Link className="s2-ob-linkbtn" to={PATHS.enter}>
          Back to choices
        </Link>
      </div>
    </OnboardingStage>
  );
}
