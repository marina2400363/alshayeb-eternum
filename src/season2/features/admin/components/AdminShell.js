import React from "react";
import { NavLink, Navigate, Outlet } from "react-router-dom";
import useAdminSession from "../hooks/useAdminSession";
import "./AdminShell.css";

const NAV_ITEMS = [
  { to: "/season2/admin/schools", label: "Schools" },
  { to: "/season2/admin/deposits", label: "Deposits" },
  { to: "/season2/admin/finance", label: "Finance" },
  { to: "/season2/admin/settings", label: "Settings" }
];

// Gate + operational shell for every Admin Portal screen. Redirects to the
// login screen when there is no valid admin session (also reached mid-
// session if any admin.api.js call gets a 401 and clears it) — same
// authentication as the legacy Season 1 dashboard, not a second system.
export default function AdminShell() {
  const { isAuthenticated, session, signOut } = useAdminSession();

  if (!isAuthenticated) {
    return <Navigate to="/season2/admin/login" replace />;
  }

  return (
    <div className="s2-admin">
      <header className="s2-admin-header">
        <span className="s2-admin-wordmark">Alshayeb · Admin</span>
        <nav className="s2-admin-nav" aria-label="Admin sections">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `s2-admin-nav-link ${isActive ? "is-active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="s2-admin-account">
          <span className="s2-admin-account-email">{session?.email}</span>
          <button type="button" className="s2-admin-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="s2-admin-main">
        <Outlet />
      </main>
    </div>
  );
}
