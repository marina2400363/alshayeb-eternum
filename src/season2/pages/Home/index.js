import React from "react";
import { Link } from "react-router-dom";
import ExperiencesJourney from "../../features/experiencesJourney/ExperiencesJourney";
import SiteFooter from "../../features/siteFooter/SiteFooter";
import Preloader from "../../features/preloader/Preloader";
import { PATHS } from "../../features/onboarding/paths";
import useReveal from "../../motion/useReveal";
import "./Home.css";

// Thin route-level page: composes the journey feature, the entry point into
// the functional customer flow (onboarding, owned separately) and the footer.
export default function HomePage() {
  const [enterRef, revealed] = useReveal();

  return (
    <div className="s2-home">
      {/* Covers the page until its critical media is loaded (first load only). */}
      <Preloader />
      <ExperiencesJourney />
      <section
        className={`s2-enter${revealed ? " is-in" : ""}`}
        ref={enterRef}
        aria-labelledby="s2-enter-title"
      >
        <h2 className="s2-enter-title" id="s2-enter-title">
          <span>Enter your</span> <span>experience</span>
        </h2>
        <p className="s2-enter-sub">Choose how you're joining.</p>

        {/* The CTA is the rule itself: label, a hairline that draws across
            the row on reveal, and an arrowhead where it lands. */}
        <Link className="s2-begin" to={PATHS.enter}>
          <span className="s2-begin-label">Begin</span>
          <span className="s2-begin-rule" aria-hidden="true">
            <i />
            <svg viewBox="0 0 9 16" width="9" height="16" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1 1l7 7-7 7" />
            </svg>
          </span>
        </Link>
      </section>
      <SiteFooter />
    </div>
  );
}
