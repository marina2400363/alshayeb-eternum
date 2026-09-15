import React, { useRef } from "react";
import Hero from "./Hero";
import ExperienceCard from "./ExperienceCard";
import EXPERIENCE_CARDS from "./experienceContent";
import useExperienceJourney from "../../motion/useExperienceJourney";
import useRailParallax from "../../motion/useRailParallax";
import "./ExperiencesJourney.css";

// Composition only. All GSAP/ScrollTrigger logic lives in
// src/season2/motion — this component just wires refs.
//
// Hero is a standalone section: it never shares a frame with the cards, so
// there is nothing for the cards to clutter. `.s2-transition` is the pin
// target for the scattered-to-rail choreography only — once the cards land,
// ScrollTrigger releases it and `.s2-rail` becomes a plain native
// horizontal scroller (see ExperiencesJourney.css).
export default function ExperiencesJourney() {
  const journeyRef = useRef(null);
  const headingRef = useRef(null);
  const railRef = useRef(null);
  const cardRefs = useRef([]);
  cardRefs.current = [];

  useExperienceJourney({ journeyRef, headingRef, railRef, cardRefs });
  useRailParallax({ railRef, cardRefs });

  return (
    <div className="s2-journey">
      <Hero />
      <div className="s2-transition" ref={journeyRef}>
        <h2 className="s2-experiences-heading" ref={headingRef}>
          Alshayeb Experiences
        </h2>
        <div className="s2-rail" ref={railRef}>
          <div className="s2-rail-track">
            {EXPERIENCE_CARDS.map((card, i) => (
              <ExperienceCard
                key={card.id}
                ref={(el) => (cardRefs.current[i] = el)}
                title={card.title}
                tagline={card.tagline}
                gradient={card.gradient}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
