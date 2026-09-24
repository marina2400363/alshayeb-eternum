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
// there is nothing for the cards to clutter. `.s2-transition` is the held
// frame for the scattered-to-rail choreography only — once the cards land it
// is released and `.s2-rail` becomes a plain native horizontal scroller (see
// ExperiencesJourney.css). On desktop ScrollTrigger pins it; on touch tiers
// `.s2-journey-track` supplies the scroll distance and the frame is held by
// native CSS `position: sticky` (see motion/useExperienceJourney).
export default function ExperiencesJourney() {
  const trackRef = useRef(null);
  const journeyRef = useRef(null);
  const headingRef = useRef(null);
  const railRef = useRef(null);
  const cardRefs = useRef([]);
  cardRefs.current = [];

  useExperienceJourney({ trackRef, journeyRef, headingRef, railRef, cardRefs });
  useRailParallax({ railRef, cardRefs });

  return (
    <div className="s2-journey">
      <Hero posterSrc="/season2/media/home/hero-main.png" />
      <div className="s2-journey-track" ref={trackRef}>
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
    </div>
  );
}
