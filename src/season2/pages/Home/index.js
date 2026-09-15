import React from "react";
import ExperiencesJourney from "../../features/experiencesJourney/ExperiencesJourney";
import Button from "../../components/Button";
import "./Home.css";

// Thin route-level page: composes the journey feature and the placeholder
// entry point. No onboarding logic starts here yet.
export default function HomePage() {
  return (
    <div className="s2-home">
      <ExperiencesJourney />
      <section className="s2-enter">
        <h2 className="s2-enter-title">Enter Your Experience</h2>
        <p className="s2-enter-sub">The functional customer flow begins here in a later phase.</p>
        <Button variant="ghost" disabled>
          Coming Soon
        </Button>
      </section>
    </div>
  );
}
