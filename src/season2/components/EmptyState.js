import React from "react";
import "./States.css";

export default function EmptyState({ title = "Nothing here yet", message, children }) {
  return (
    <div className="s2-state">
      <span className="s2-state-title">{title}</span>
      {message && <p className="s2-state-message">{message}</p>}
      {children}
    </div>
  );
}
