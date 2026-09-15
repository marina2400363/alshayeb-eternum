import React, { forwardRef } from "react";
import Card from "../../components/Card";
import "./ExperienceCard.css";

// Thin wrapper around the shared Card primitive. This exact DOM node is what
// useExperienceJourney animates from its scattered hero position into the
// rail — it is never unmounted/remounted between states.
const ExperienceCard = forwardRef(function ExperienceCard({ title, tagline, gradient }, ref) {
  return (
    <Card ref={ref} media={gradient} className="s2-exp-card" interactive>
      <span className="s2-exp-card-title">{title}</span>
      <span className="s2-exp-card-tagline">{tagline}</span>
    </Card>
  );
});

export default ExperienceCard;
