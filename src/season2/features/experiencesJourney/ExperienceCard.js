import React, { forwardRef } from "react";
import Card from "../../components/Card";
import "./ExperienceCard.css";

// Thin wrapper around the shared Card primitive. This exact DOM node is what
// useExperienceJourney animates from its scattered hero position into the
// rail — it is never unmounted/remounted between states.
//
// Title/tagline overlay is intentionally not rendered for this pass (real
// card copy/links land separately) — ExperiencesJourney.js still passes
// title/tagline through, so re-enabling the two spans here is a one-line
// change later. mediaTreatment="color" keeps the real photos in full color
// (see Card.js) instead of the shared grayscale grading.
const ExperienceCard = forwardRef(function ExperienceCard({ gradient }, ref) {
  return <Card ref={ref} media={gradient} mediaTreatment="color" className="s2-exp-card" interactive />;
});

export default ExperienceCard;
