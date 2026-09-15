import React from "react";
import "./CustomerAreaShell.css";

// Structural shell only. Shared between Marina's onboarding-adjacent screens
// and Sandra's payment screens — neither owns this file after the split, so
// it must stay free of registration/payment/deposit/ticket logic.
export default function CustomerAreaShell({ nav, children }) {
  return (
    <div className="s2-ca-shell">
      <header className="s2-ca-header">
        <span className="s2-ca-wordmark">ALSHAYEB</span>
        <span className="s2-ca-header-label">Customer Area</span>
      </header>
      <div className="s2-ca-body">
        {nav && <nav className="s2-ca-nav">{nav}</nav>}
        <main className="s2-ca-content">{children}</main>
      </div>
    </div>
  );
}
