import React from "react";
import "./Button.css";

// Neutral enough to carry both an immersive public CTA ("Enter Your
// Experience") and a functional Customer Area action later. Visual variants
// only — no onboarding/payment-specific behavior belongs here.
export default function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  type = "button",
  className = "",
  onClick
}) {
  return (
    <button
      type={type}
      className={`s2-btn s2-btn--${variant} s2-btn--${size} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
