import React, { useCallback, useRef, useState } from "react";
import Hero from "./Hero";
import ExperienceCard from "./ExperienceCard";
import EXPERIENCE_CARDS, { HOME_HERO_SRC, PREVIEW_CARD_COUNT } from "./experienceContent";
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
//
// Only the first PREVIEW_CARD_COUNT cards are in the scattered preview. The
// rest sit in the rail from the start (so the rail's layout never changes)
// but stay hidden until it lands, and get their photograph only once the
// glide begins — so they never compete with the preview/preloader for
// bandwidth.
export default function ExperiencesJourney() {
  const journeyRef = useRef(null);
  const headingRef = useRef(null);
  const railRef = useRef(null);
  const cardRefs = useRef([]);
  cardRefs.current = [];
  const [extrasMedia, setExtrasMedia] = useState(false);
  const revealExtras = useCallback(() => setExtrasMedia(true), []);

  useExperienceJourney({
    journeyRef,
    headingRef,
    railRef,
    cardRefs,
    previewCount: PREVIEW_CARD_COUNT,
    onReveal: revealExtras
  });
  useRailParallax({ railRef, cardRefs });

  return (
    <div className="s2-journey">
      <Hero posterSrc={HOME_HERO_SRC} />
      <div className="s2-transition" ref={journeyRef}>
        <h2 className="s2-experiences-heading" ref={headingRef}>
          Alshayeb Experiences
        </h2>
        <div className="s2-rail" ref={railRef}>
          <div className="s2-rail-track">
            {EXPERIENCE_CARDS.map((card, i) => {
              const extra = i >= PREVIEW_CARD_COUNT;
              return (
                <ExperienceCard
                  key={card.id}
                  ref={(el) => (cardRefs.current[i] = el)}
                  className={extra ? "s2-exp-card--extra" : ""}
                  gradient={extra && !extrasMedia ? null : card.gradient}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
