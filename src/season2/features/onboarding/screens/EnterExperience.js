import React from "react";
import OnboardingStage, { OnboardingHeading } from "../components/OnboardingStage";
import ChoiceCard from "../components/ChoiceCard";
import { PATHS } from "../paths";

// Placeholder "photography": light-cone gradients that the shared
// s2-photo-treatment grades to monochrome + a blue lift, exactly as it does
// for the homepage cards. Swap for graded photographs later.
const INCOMER_MEDIA = "radial-gradient(85% 125% at 82% 0%, #b3c0dc 0%, #3d4966 32%, #0b0e17 68%, #04060b 100%)";
const OUTCOMER_MEDIA = "radial-gradient(85% 125% at 14% 4%, #bcc0cc 0%, #454955 32%, #0d0e12 68%, #050608 100%)";

// "Enter Your Experience" — the first functional screen after the homepage
// journey. Deliberately two big choices and nothing else.
export default function EnterExperience() {
  return (
    <OnboardingStage backTo={PATHS.home} backLabel="Home" progress={0.18} variant="split">
      <OnboardingHeading title={["Enter your", "experience"]} lede="Choose how you're joining." />
      <div className="s2-ob-choices s2-ob-choices--columns">
        {/* Final wording for what each term means is still to be supplied —
            titles only, deliberately no definitions. */}
        <ChoiceCard index="01" title="Incomer" to={PATHS.incomer} media={INCOMER_MEDIA} />
        <ChoiceCard index="02" title="Outcomer" to={PATHS.outcomer} media={OUTCOMER_MEDIA} />
      </div>
    </OnboardingStage>
  );
}
