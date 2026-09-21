import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AdminLogin from "../../features/admin/components/AdminLogin";
import AdminShell from "../../features/admin/components/AdminShell";
import SchoolsPage from "../../features/admin/schools/SchoolsPage";
import DepositsPage from "../../features/admin/deposits/DepositsPage";
import FinancePage from "../../features/admin/finance/FinancePage";
import SettingsPage from "../../features/admin/settings/SettingsPage";

// Mounted at /season2/admin/* from Season2Routes.js. AdminShell is the gate:
// it redirects to /season2/admin/login whenever there is no valid admin
// session (same auth as the legacy Season 1 dashboard — see
// features/admin/state/adminSession.js).
export default function AdminPage() {
  return (
    <Routes>
      <Route path="login" element={<AdminLogin />} />
      <Route element={<AdminShell />}>
        <Route index element={<Navigate to="/season2/admin/schools" replace />} />
        <Route path="schools" element={<SchoolsPage />} />
        <Route path="deposits" element={<DepositsPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/season2/admin/schools" replace />} />
      </Route>
    </Routes>
  );
}
