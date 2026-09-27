import React from "react";
import useStatusCounter from "./hooks/useStatusCounter";
import LoadingState from "../../components/LoadingState";
import ErrorState from "../../components/ErrorState";
import "./StatusCounter.css";

// Accepted/Rejected/Pending are manually admin-typed display copy (Season 2
// Admin Settings → Customer Status Counter). This component only reads and
// renders the current configured values — it never computes them from
// Deposits, Attendees, payment approvals or FullPaymentStatus.
const ROWS = [
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "pending", label: "Pending" }
];

export default function StatusCounter() {
  const { status, counter, retry } = useStatusCounter();

  return (
    <div className="s2-status-counter">
      <span className="s2-pay-eyebrow">Status</span>

      {status === "loading" && <LoadingState label="Loading status" />}

      {status === "error" && (
        <ErrorState title="Couldn't load status" message="Please try again." onRetry={retry} />
      )}

      {status === "ready" && (
        <div className="s2-status-counter-rows">
          {ROWS.map(({ key, label }) => (
            <div className="s2-status-counter-row" key={key}>
              <span className="s2-status-counter-label">{label}</span>
              <span className="s2-status-counter-value">{counter[key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
