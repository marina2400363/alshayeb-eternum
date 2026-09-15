import React from "react";
import "./StatusBadge.css";

const DOT_STATUSES = new Set(["live", "success", "pending", "declined", "info"]);

// One shared status vocabulary for registration/payment/deposit states later,
// plus the "LIVE" indicator language carried forward from the funnel mockup.
export default function StatusBadge({ status = "info", children, className = "" }) {
  return (
    <span className={`s2-status s2-status--${status} ${className}`}>
      {DOT_STATUSES.has(status) && <i className="s2-status-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
