import React from "react";
import { Outlet } from "react-router-dom";
import RegistrationProvider from "../../state/RegistrationProvider";

// Layout route for /season2/enter/incomer/new/*: one provider instance stays
// mounted across Details → School → Photo, so the draft, the cached school
// list and the chosen photo survive step-to-step navigation (including
// browser Back), and everything is cleaned up when the flow is left.
export default function RegistrationLayout() {
  return (
    <RegistrationProvider>
      <Outlet />
    </RegistrationProvider>
  );
}
