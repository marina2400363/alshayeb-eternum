import React from "react";
import "./GateAccessAction.css";

// Visual placeholder only — the feature does not exist yet. No onClick
// handler is wired at all (not just `disabled`): there is nothing for a
// click to do, no route to go to, no API to call. Activating this later is a
// separate piece of work.
export default function GateAccessAction() {
  return (
    <div className="s2-gate-action">
      <span className="s2-pay-eyebrow">Access to Gate</span>
      <button type="button" className="s2-gate-action-btn" disabled aria-disabled="true">
        <span className="s2-gate-action-btn-label">Access to Gate</span>
        <span className="s2-gate-action-btn-tag">Not active yet</span>
      </button>
    </div>
  );
}
