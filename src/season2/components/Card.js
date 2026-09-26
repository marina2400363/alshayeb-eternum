import React, { forwardRef } from "react";
import "./Card.css";

// Generic dark surface with an optional photo-treated media layer. Used for
// Experience cards on the homepage today; must also work as a plain content
// card in the Customer Area later, so it carries no journey-specific logic.
//
// mediaTreatment: "mono" (default, unchanged) applies the shared crushed/
// grayscale grading (.s2-photo-treatment) — what ChoiceCard/onboarding still
// use. "color" applies .s2-photo-treatment-color instead, which keeps real
// photography in full color (used by the homepage Experience cards only).
const Card = forwardRef(function Card(
  { children, media = null, mediaTreatment = "mono", className = "", interactive = false, style },
  ref
) {
  const treatmentClass = mediaTreatment === "color" ? "s2-photo-treatment-color" : "s2-photo-treatment";
  return (
    <div
      ref={ref}
      className={`s2-card ${interactive ? "s2-card--interactive" : ""} ${className}`}
      style={style}
    >
      {media && (
        <div className={`s2-card-media ${treatmentClass}`} style={{ backgroundImage: media }}>
          <div className="s2-tint" />
        </div>
      )}
      <div className="s2-card-content">{children}</div>
    </div>
  );
});

export default Card;
