import React from "react";
import OnboardingStage, { OnboardingHeading } from "../components/OnboardingStage";
import ChoiceCard from "../components/ChoiceCard";
import { PATHS } from "../paths";

const NEW_MEDIA = "radial-gradient(85% 125% at 78% 0%, #b6c3df 0%, #3f4b69 32%, #0b0e17 68%, #04060b 100%)";
const RETURNING_MEDIA = "radial-gradient(85% 150% at 18% 0%, #b8bcc8 0%, #444854 34%, #0c0d11 70%, #050608 100%)";

// Incomer: new registration, or an existing customer coming back.
export default function IncomerEntry() {
  return (
    <OnboardingStage backTo={PATHS.enter} progress={0.34} variant="split">
      <OnboardingHeading eyebrow="Incomer" title="Welcome in" lede="Are you new, or already registered?" />
      <div className="s2-ob-choices s2-ob-choices--rows">
        <ChoiceCard
          index="01"
          title="New here"
          description="Register in a few quick steps."
          to={PATHS.incomerNew}
          media={NEW_MEDIA}
        />
        <ChoiceCard
          index="02"
          title="Already registered"
          description="Use your mobile number to continue."
          to={PATHS.incomerReturning}
          media={RETURNING_MEDIA}
        />
      </div>
    </OnboardingStage>
  );
}
