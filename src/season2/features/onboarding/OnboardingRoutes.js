import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import EnterExperience from "./screens/EnterExperience";
import IncomerEntry from "./screens/IncomerEntry";
import OutcomerHold from "./screens/OutcomerHold";
import ReturningLookup from "./screens/ReturningLookup";
import RegistrationLayout from "./screens/register/RegistrationLayout";
import SchoolStep from "./screens/register/SchoolStep";
import DetailsStep from "./screens/register/DetailsStep";
import PhotoConfirmStep from "./screens/register/PhotoConfirmStep";
import { PATHS } from "./paths";

// Mounted at /season2/enter/* (see Season2Routes). Paths here are relative
// to that mount point; PATHS holds the absolute equivalents for links.
export default function OnboardingRoutes() {
  return (
    <Routes>
      <Route index element={<EnterExperience />} />
      <Route path="incomer" element={<IncomerEntry />} />
      <Route path="incomer/returning" element={<ReturningLookup />} />
      <Route path="incomer/new" element={<RegistrationLayout />}>
        <Route index element={<Navigate to={PATHS.incomerNewDetails} replace />} />
        <Route path="details" element={<DetailsStep />} />
        <Route path="school" element={<SchoolStep />} />
        <Route path="photo" element={<PhotoConfirmStep />} />
        <Route path="*" element={<Navigate to={PATHS.incomerNewDetails} replace />} />
      </Route>
      <Route path="outcomer" element={<OutcomerHold />} />
      <Route path="*" element={<Navigate to={PATHS.enter} replace />} />
    </Routes>
  );
}
