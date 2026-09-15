import React from "react";
import Button from "./Button";
import "./States.css";

export default function ErrorState({
  title = "Something went wrong",
  message = "Please try again in a moment.",
  onRetry
}) {
  return (
    <div className="s2-state" role="alert">
      <span className="s2-state-title">{title}</span>
      <p className="s2-state-message">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
