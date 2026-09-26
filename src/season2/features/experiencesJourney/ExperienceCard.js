import React, { forwardRef } from "react";
import Card from "../../components/Card";
import "./ExperienceCard.css";

// Thin wrapper around the shared Card primitive. This exact DOM node is what
// useExperienceJourney animates from its scattered hero position into the
// rail — it is never unmounted/remounted between states.
//
// No title/tagline overlay: the cards are photographs only.
// mediaTreatment="color" keeps the real photos in full color (see Card.js)
// instead of the shared grayscale grading. `className` adds modifiers such
// as s2-exp-card--extra (cards outside the scattered preview).
const ExperienceCard = forwardRef(function ExperienceCard({ gradient, className = "" }, ref) {
  return (
    <Card
      ref={ref}
      media={gradient}
      mediaTreatment="color"
      className={`s2-exp-card${className ? ` ${className}` : ""}`}
      interactive
    />
  );
});

export default ExperienceCard;
