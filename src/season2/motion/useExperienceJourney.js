import { useLayoutEffect } from "react";
import gsap from "gsap";
import { MEDIA_DESKTOP, MEDIA_TABLET, MEDIA_MOBILE, MEDIA_REDUCED_MOTION } from "../styles/breakpoints";

// ---------------------------------------------------------------------------
// SCATTERED EDITORIAL COLLAGE -> CLEAN GALLERY LINE-UP
//
// The cards start in the art-directed scatter. When ~35% of the Experiences
// section is visible, one short time-based timeline plays ONCE per page
// load: each card glides straight from its scattered pose into its resting
// slot in the rail (x/y -> 0, rotate -> 0, scale -> 1), lightly staggered.
// No intermediate states, no overshoot.
//
// No pin, no sticky, no scrub, no scroll-bound progress: vertical scrolling
// stays 100% native and the section is exactly one screen tall. The only
// scroll-related code is one IntersectionObserver, which disconnects after
// it fires. Once the cards land, the rail gets .s2-rail--landed and becomes
// a plain native horizontal scroller (mobile: the swipe rail).
// ---------------------------------------------------------------------------

// Scatter, DESKTOP (>= 1200) — the approved composition, unchanged: fixed
// offsets from each card's resting rail position.
const DESKTOP_ENTRY = [
  { x: -70, y: -130, rotate: -9, scale: 0.8 },
  { x: -88, y: 170, rotate: 5, scale: 0.74 },
  { x: 90, y: -90, rotate: -4, scale: 0.82 },
  { x: 60, y: 200, rotate: 10, scale: 0.76 }
];

// Scatter, TABLET + MOBILE — unchanged anchors: where each card sits ON THE
// SCREEN (fractions of the frame), converted to offsets from its resting
// position and clamped so the rotated card stays inside the frame. (On a
// narrow screen the rail's resting slots run off the right edge, so fixed
// offsets from rest can't produce an on-screen collage.)
const MOBILE_ANCHORS = [
  { ax: 0.34, ay: 0.235, rotate: -7, scale: 0.8 },
  { ax: 0.67, ay: 0.385, rotate: 6, scale: 0.72 },
  { ax: 0.35, ay: 0.625, rotate: -5, scale: 0.76 },
  { ax: 0.66, ay: 0.775, rotate: 8, scale: 0.72 }
];
const TABLET_PORTRAIT_ANCHORS = [
  { ax: 0.3, ay: 0.24, rotate: -6, scale: 0.82 },
  { ax: 0.7, ay: 0.36, rotate: 5, scale: 0.76 },
  { ax: 0.3, ay: 0.66, rotate: -4, scale: 0.8 },
  { ax: 0.7, ay: 0.76, rotate: 7, scale: 0.78 }
];
const TABLET_LANDSCAPE_ANCHORS = [
  { ax: 0.19, ay: 0.36, rotate: -6, scale: 0.84 },
  { ax: 0.4, ay: 0.66, rotate: 4, scale: 0.78 },
  { ax: 0.62, ay: 0.34, rotate: -3, scale: 0.82 },
  { ax: 0.83, ay: 0.64, rotate: 7, scale: 0.8 }
];

const TIMING = {
  glide: 0.55, // per card
  stagger: 0.05, // between cards -> total 0.55 + 3 * 0.05 = 0.70s
  ease: "power3.out"
};

// Share of the section that must be visible to play the sequence.
const TRIGGER_RATIO = 0.35;

const MEDIA_TABLET_PORTRAIT = `${MEDIA_TABLET} and (orientation: portrait)`;
const MEDIA_TABLET_LANDSCAPE = `${MEDIA_TABLET} and (orientation: landscape)`;

// Breathing room kept between a scattered card's rotated edge and the frame.
const EDGE_MARGIN = 6;

const REST = { x: 0, y: 0, rotate: 0, scale: 1 };

/**
 * Owns the GSAP timeline for the homepage Experiences cards. Presentation
 * components only pass refs in.
 *
 * Every pose is a transform relative to the card's resting slot in the rail,
 * computed from layout offsets (which transforms never affect), so the DOM
 * never changes shape and nothing re-lays-out mid-animation.
 */
export default function useExperienceJourney({ journeyRef, headingRef, railRef, cardRefs }) {
  useLayoutEffect(() => {
    const journey = journeyRef.current;
    const rail = railRef.current;
    if (!journey || !rail) return undefined;

    // Once per page load: survives breakpoint changes (matchMedia rebuilds).
    let played = false;

    const ctx = gsap.context(() => {
      const cards = cardRefs.current.filter(Boolean);
      if (!cards.length) return;
      const heading = headingRef.current;

      const settle = () => {
        gsap.set(cards, { ...REST, autoAlpha: 1 });
        gsap.set(heading, { autoAlpha: 1, y: 0 });
        rail.classList.add("s2-rail--landed");
      };

      if (window.matchMedia(MEDIA_REDUCED_MOTION).matches || typeof IntersectionObserver === "undefined") {
        // Static and accessible: the rail, no motion.
        played = true;
        settle();
        return;
      }

      const desktopScatter = (card, i) => DESKTOP_ENTRY[i % DESKTOP_ENTRY.length];

      const anchoredScatter = (anchors) => (card, i) => {
        const a = anchors[i % anchors.length];
        const angle = (a.rotate * Math.PI) / 180;
        const cos = Math.abs(Math.cos(angle));
        const sin = Math.abs(Math.sin(angle));
        const w = card.offsetWidth * a.scale;
        const h = card.offsetHeight * a.scale;
        const hx = (w * cos + h * sin) / 2 + EDGE_MARGIN;
        const hy = (h * cos + w * sin) / 2 + EDGE_MARGIN;
        const W = journey.clientWidth;
        const H = journey.clientHeight;
        const cx = gsap.utils.clamp(hx, Math.max(hx, W - hx), a.ax * W);
        const cy = gsap.utils.clamp(hy, Math.max(hy, H - hy), a.ay * H);
        // Resting centre, frame-relative. The rail is not scrollable (and so
        // at scrollLeft 0) until the cards have landed.
        const restX = rail.offsetLeft + card.offsetLeft + card.offsetWidth / 2;
        const restY = rail.offsetTop + card.offsetTop + card.offsetHeight / 2;
        return { x: cx - restX, y: cy - restY, rotate: a.rotate, scale: a.scale };
      };

      function build(scatter) {
        let tl = null;
        let observer = null;

        const applyScatter = () => cards.forEach((card, i) => gsap.set(card, scatter(card, i)));

        const play = () => {
          if (played) return;
          played = true;
          observer.disconnect();

          tl = gsap.timeline({ onComplete: settle });
          tl.to(heading, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power2.out" }, 0);
          tl.to(cards, { ...REST, duration: TIMING.glide, ease: TIMING.ease, stagger: TIMING.stagger }, 0);
        };

        if (played) {
          // Breakpoint change after the sequence ran: stay in the rail.
          settle();
          return undefined;
        }

        rail.classList.remove("s2-rail--landed");
        applyScatter();
        gsap.set(cards, { autoAlpha: 1 });
        gsap.set(heading, { autoAlpha: 0, y: 10 });

        observer = new IntersectionObserver(
          (entries) => {
            const entry = entries[entries.length - 1];
            // Also play when a fast flick stops PAST the section's top with
            // only its lower slice on screen (ratio never reached 0.35).
            if (entry.intersectionRatio >= TRIGGER_RATIO || (entry.isIntersecting && entry.boundingClientRect.top < 0)) {
              play();
            } else if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
              // Already scrolled past (e.g. restored scroll position on
              // reload): don't animate off-screen, just show the result.
              played = true;
              observer.disconnect();
              settle();
            }
          },
          { threshold: [0, TRIGGER_RATIO] }
        );
        observer.observe(journey);

        // Scatter offsets depend on the frame size; keep them right on
        // resize / rotation until the sequence has played. The final state
        // is the rail itself, so it never needs re-measuring.
        let resizeRaf = 0;
        const onResize = () => {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(() => {
            if (!played) applyScatter();
          });
        };
        window.addEventListener("resize", onResize);

        return () => {
          window.removeEventListener("resize", onResize);
          cancelAnimationFrame(resizeRaf);
          observer.disconnect();
          // Interrupted mid-glide by a breakpoint change: the next build sees
          // `played` and lands the cards in the rail.
          if (tl) tl.kill();
        };
      }

      const mm = gsap.matchMedia();
      mm.add(MEDIA_DESKTOP, () => build(desktopScatter));
      mm.add(MEDIA_TABLET_LANDSCAPE, () => build(anchoredScatter(TABLET_LANDSCAPE_ANCHORS)));
      mm.add(MEDIA_TABLET_PORTRAIT, () => build(anchoredScatter(TABLET_PORTRAIT_ANCHORS)));
      mm.add(MEDIA_MOBILE, () => build(anchoredScatter(MOBILE_ANCHORS)));
    }, journey);

    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
