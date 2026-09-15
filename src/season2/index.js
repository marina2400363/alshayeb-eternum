import React from "react";
import Season2Routes from "./routes/Season2Routes";
import "./styles/tokens.css";

// The single export App.js imports. Everything Season 2 needs — tokens,
// routes, motion — is reachable from this one entry point.
export default function Season2App() {
  return (
    <div className="s2-root">
      <div className="s2-grain" aria-hidden="true" />
      <Season2Routes />
    </div>
  );
}
