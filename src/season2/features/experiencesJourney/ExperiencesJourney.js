import React, { useRef } from "react";
import Hero from "./Hero";
import ExperienceCard from "./ExperienceCard";
import EXPERIENCE_CARDS from "./experienceContent";
import useExperienceJourney from "../../motion/useExperienceJourney";
import useRailParallax from "../../motion/useRailParallax";
import "./ExperiencesJourney.css";

// Composition only. All GSAP logic lives in src/season2/motion — this
// component just wires refs.
//
// Hero is a standalone section: it never shares a frame with the cards, so
// there is nothing for the cards to clutter. `.s2-transition` is a normal,
// one-screen section — never pinned or sticky. When enough of it is visible
// each card glides once from the scattered collage into its rail slot (see
// motion/useExperienceJourney); vertical scrolling stays fully native, and
// `.s2-rail` then becomes a plain native horizontal scroller.
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
      <Hero posterSrc="/season2/media/home/hero-main.png" />
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
