import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Button from "../../../components/Button";
import useAdminSession from "../hooks/useAdminSession";
import { loginAdmin } from "../services/admin.api";
import "./AdminLogin.css";

// Posts to the SAME /api/admin/auth/login the legacy Season 1 dashboard
// uses — there is exactly one admin account/JWT system in this backend.
export default function AdminLogin() {
  const navigate = useNavigate();
  const { isAuthenticated, signIn } = useAdminSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/season2/admin/dashboard" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await loginAdmin({ email: email.trim(), password });
      signIn({ email: email.trim().toLowerCase(), token: result.token });
      navigate("/season2/admin/dashboard", { replace: true });
    } catch (failure) {
      setError(failure?.message || "Invalid admin email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="s2-admin-login">
      <form className="s2-admin-login-card" onSubmit={handleSubmit}>
        <span className="s2-admin-login-eyebrow">Alshayeb</span>
        <h1 className="s2-admin-login-title">Admin Portal</h1>

        <label className="s2-admin-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="s2-admin-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && (
          <p className="s2-admin-login-error" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
