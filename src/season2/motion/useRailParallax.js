import { useEffect } from "react";
import { MEDIA_DESKTOP, MEDIA_TABLET, MEDIA_REDUCED_MOTION } from "../styles/breakpoints";

// How far (px) a card's media layer shifts relative to the rail's own
// native scroll — intentionally small, lighter on tablet, off on mobile and
// under reduced motion. Purely decorative: reads the rail's native
// scrollLeft, never sets it. No drag, no momentum simulation, no pointer
// capture — horizontal interaction is 100% native (see ExperiencesJourney.css).
const PARALLAX_FACTOR = { desktop: 0.06, tablet: 0.035, mobile: 0 };
const PARALLAX_CLAMP = 18;

export default function useRailParallax({ railRef, cardRefs }) {
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;

    const reducedMotion = window.matchMedia(MEDIA_REDUCED_MOTION).matches;
    const tierFactor = reducedMotion
      ? 0
      : window.matchMedia(MEDIA_DESKTOP).matches
      ? PARALLAX_FACTOR.desktop
      : window.matchMedia(MEDIA_TABLET).matches
      ? PARALLAX_FACTOR.tablet
      : PARALLAX_FACTOR.mobile;

    if (tierFactor <= 0) return undefined;

    let ticking = false;
    const applyParallax = () => {
      ticking = false;
      const center = rail.scrollLeft + rail.clientWidth / 2;
      cardRefs.current.filter(Boolean).forEach((card) => {
        const media = card.querySelector(".s2-card-media");
        if (!media) return;
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const delta = Math.max(-PARALLAX_CLAMP, Math.min(PARALLAX_CLAMP, (cardCenter - center) * tierFactor));
        media.style.transform = `translateX(${-delta}px)`;
      });
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(applyParallax);
      }
    };

    applyParallax();
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => rail.removeEventListener("scroll", onScroll);
  }, [railRef, cardRefs]);
}
