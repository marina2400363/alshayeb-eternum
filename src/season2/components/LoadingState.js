import React from "react";
import "./States.css";

export default function LoadingState({ label = "Loading" }) {
  return (
    <div className="s2-state" role="status" aria-live="polite">
      <span className="s2-spinner" aria-hidden="true" />
      <span className="s2-state-title">{label}</span>
    </div>
  );
}
