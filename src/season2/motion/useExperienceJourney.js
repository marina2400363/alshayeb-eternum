import { useLayoutEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MEDIA_DESKTOP, MEDIA_TABLET, MEDIA_MOBILE, MEDIA_REDUCED_MOTION } from "../styles/breakpoints";

gsap.registerPlugin(ScrollTrigger);

// Deliberately irregular, art-directed scatter — not a symmetric mirror
// pattern. Cards mix above/below their resting position (not all "rising
// from below"), with varied rotation and scale per card, so the starting
// composition reads as scattered rather than merely offset.
//
// Fixed presets, not measured from the DOM: this is also what makes a
// same-tier resize correct by construction — nothing here depends on a
// live pixel measurement that could go stale between refreshes.
const DESKTOP_ENTRY = [
  { x: -70, y: -130, rotate: -9, scale: 0.8 },
  { x: -88, y: 170, rotate: 5, scale: 0.74 },
  { x: 90, y: -90, rotate: -4, scale: 0.82 },
  { x: 60, y: 200, rotate: 10, scale: 0.76 }
];

const TABLET_ENTRY = [
  { x: -40, y: -70, rotate: -6, scale: 0.86 },
  { x: -44, y: 95, rotate: 3, scale: 0.82 },
  { x: 45, y: -50, rotate: -3, scale: 0.87 },
  { x: 30, y: 110, rotate: 6, scale: 0.84 }
];

// Mobile keeps the same scattered-to-rail concept as desktop/tablet — just
// smaller offsets and minimal rotation so it reads as intentional at this
// size, not a shrunk-down desktop composition.
const MOBILE_ENTRY = [
  { x: -18, y: -40, rotate: -4, scale: 0.9 },
  { x: -24, y: 50, rotate: 2, scale: 0.87 },
  { x: 20, y: -30, rotate: -2, scale: 0.91 },
  { x: 14, y: 55, rotate: 4, scale: 0.88 }
];

/**
 * Owns the GSAP / ScrollTrigger instance for the homepage card-entry
 * transition only. No component outside src/season2/motion imports gsap
 * directly — presentation components only pass refs in.
 *
 * .s2-rail stays overflow:visible (see ExperiencesJourney.css) while the
 * cards are scattered, so nothing clips the composition before it lands —
 * that clipping was why the scatter read as "barely there" before. Only
 * once the pin fully releases (ScrollTrigger's onLeave) does the rail get
 * the .s2-rail--landed class that turns on native horizontal overflow;
 * scrolling back up (onEnterBack) removes it again so the reverse
 * choreography plays against the same unclipped composition.
 */
export default function useExperienceJourney({ journeyRef, headingRef, railRef, cardRefs }) {
  useLayoutEffect(() => {
    const journey = journeyRef.current;
    const rail = railRef.current;
    if (!journey || !rail) return undefined;

    const ctx = gsap.context(() => {
      const cards = cardRefs.current.filter(Boolean);
      const reducedMotion = window.matchMedia(MEDIA_REDUCED_MOTION).matches;

      if (reducedMotion) {
        // Fully accessible static state — no pin, no scrub. The rail goes
        // straight to native horizontal scrolling.
        gsap.set(headingRef.current, { autoAlpha: 1, y: 0 });
        gsap.set(cards, { x: 0, y: 0, rotate: 0, scale: 1, autoAlpha: 1 });
        rail.classList.add("s2-rail--landed");
        return;
      }

      const mm = gsap.matchMedia();
      mm.add(MEDIA_DESKTOP, () => buildEntry(cards, 1.3, DESKTOP_ENTRY));
      mm.add(MEDIA_TABLET, () => buildEntry(cards, 1.0, TABLET_ENTRY));
      mm.add(MEDIA_MOBILE, () => buildEntry(cards, 0.75, MOBILE_ENTRY));
    }, journey);

    function buildEntry(cards, pinMultiplier, entry) {
      if (!cards.length) return undefined;

      rail.classList.remove("s2-rail--landed");

      // Cards are fully visible in their scattered pose from the very start
      // of the pin — the scatter is a composition to be seen, not something
      // that fades in piece by piece. Only their position/rotation/scale
      // animates; opacity never touches the cards.
      cards.forEach((card, i) => {
        const preset = entry[i % entry.length];
        gsap.set(card, { ...preset, autoAlpha: 1 });
      });
      gsap.set(headingRef.current, { autoAlpha: 0, y: 10 });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: journey,
          start: "top top",
          end: () => "+=" + window.innerHeight * pinMultiplier,
          pin: true,
          scrub: 1.25,
          invalidateOnRefresh: true,
          onLeave: () => rail.classList.add("s2-rail--landed"),
          onEnterBack: () => rail.classList.remove("s2-rail--landed")
        }
      });

      tl.to(headingRef.current, { autoAlpha: 1, y: 0, duration: 0.3 }, 0.05);

      cards.forEach((card, i) => {
        tl.to(
          card,
          { x: 0, y: 0, rotate: 0, scale: 1, duration: 0.75, ease: "power3.out" },
          0.15 + i * 0.08
        );
      });

      return () => {
        if (tl.scrollTrigger) tl.scrollTrigger.kill();
        tl.kill();
      };
    }

    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
