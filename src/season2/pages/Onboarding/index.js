import React from "react";
import OnboardingRoutes from "../../features/onboarding/OnboardingRoutes";

// Route-level page stays thin: mounts the Marina-owned onboarding routes.
export default function OnboardingPage() {
  return <OnboardingRoutes />;
}
