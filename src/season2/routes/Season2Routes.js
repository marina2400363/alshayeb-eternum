import React from "react";
import { Routes, Route } from "react-router-dom";
import HomePage from "../pages/Home";
import CustomerAreaPage from "../pages/CustomerArea";
import OnboardingPage from "../pages/Onboarding";
import AdminPage from "../pages/Admin";

// Nested under /season2/* — mounted once from src/App.js.
export default function Season2Routes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/enter/*" element={<OnboardingPage />} />
      <Route path="/customer-area" element={<CustomerAreaPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
    </Routes>
  );
}
