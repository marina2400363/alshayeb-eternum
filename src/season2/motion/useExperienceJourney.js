import { useLayoutEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MEDIA_DESKTOP, MEDIA_TABLET, MEDIA_MOBILE, MEDIA_REDUCED_MOTION } from "../styles/breakpoints";

gsap.registerPlugin(ScrollTrigger);

// ---------------------------------------------------------------------------
// DESKTOP composition (>= 1200) — the approved one. Unchanged.
//
// Deliberately irregular, art-directed scatter — not a symmetric mirror
// pattern. Cards mix above/below their resting position (not all "rising
// from below"), with varied rotation and scale per card, so the starting
// composition reads as scattered rather than merely offset.
//
// Fixed offsets from each card's resting rail position, not measured from
// the DOM. That works on desktop because the whole rail is on screen, so a
// small offset from "where the card will rest" IS a scattered composition.
// ---------------------------------------------------------------------------
const DESKTOP_ENTRY = [
  { x: -70, y: -130, rotate: -9, scale: 0.8 },
  { x: -88, y: 170, rotate: 5, scale: 0.74 },
  { x: 90, y: -90, rotate: -4, scale: 0.82 },
  { x: 60, y: 200, rotate: 10, scale: 0.76 }
];

// ---------------------------------------------------------------------------
// TABLET + MOBILE compositions — designed for the screen, not derived from
// the desktop numbers.
//
// Why desktop's approach cannot simply shrink: on a narrow screen the rail's
// resting positions run off the right edge (a phone shows ~1 card at rest),
// so "a small offset from the resting position" leaves most cards outside
// the screen for the whole scatter. Here each card instead gets an ANCHOR —
// where it should sit on the SCREEN at the start of the pin (fractions of the
// pinned frame's width/height) — plus its own rotation and scale. The tween
// is `fromTo` with function-based values that convert "anchor on screen" into
// "offset from this card's resting position", measured from layout (which
// transforms never affect) and re-measured on every refresh/resize.
//
// Anchors are then clamped so the card's ROTATED bounding box stays inside
// the frame: nothing important can end up off-screen at any aspect ratio.
// ---------------------------------------------------------------------------

// Portrait phone: a diagonal, overlapping 2-column collage that fills the
// whole tall canvas. Earlier cards stack ABOVE later ones so every card's
// title (bottom-left) always stays readable.
const MOBILE_COMPOSITION = {
  anchors: [
    { ax: 0.34, ay: 0.235, rotate: -7, scale: 0.8 },
    { ax: 0.67, ay: 0.385, rotate: 6, scale: 0.72 },
    { ax: 0.35, ay: 0.625, rotate: -5, scale: 0.76 },
    { ax: 0.66, ay: 0.775, rotate: 8, scale: 0.72 }
  ],
  pin: 1.15, // pin distance, in viewport heights — more travel for a bigger move
  scrub: 0.9, // tighter than desktop: touch scrolling already has native momentum
  ease: "power2.inOut",
  start: 0.04,
  stagger: 0.09,
  duration: 0.85,
  headingAt: 0.55
};

// Portrait tablet: same idea as the phone, spread wider (bigger canvas, so
// the collage can breathe instead of overlapping as tightly).
const TABLET_PORTRAIT_COMPOSITION = {
  anchors: [
    { ax: 0.3, ay: 0.24, rotate: -6, scale: 0.82 },
    { ax: 0.7, ay: 0.36, rotate: 5, scale: 0.76 },
    { ax: 0.3, ay: 0.66, rotate: -4, scale: 0.8 },
    { ax: 0.7, ay: 0.76, rotate: 7, scale: 0.78 }
  ],
  pin: 1.1,
  scrub: 1.0,
  ease: "power2.inOut",
  start: 0.05,
  stagger: 0.09,
  duration: 0.85,
  headingAt: 0.55
};

// Landscape tablet (and landscape phones wider than 767px): a wide, arcing
// scatter across the width — this canvas is landscape, so the composition is
// too.
const TABLET_LANDSCAPE_COMPOSITION = {
  anchors: [
    { ax: 0.19, ay: 0.36, rotate: -6, scale: 0.84 },
    { ax: 0.4, ay: 0.66, rotate: 4, scale: 0.78 },
    { ax: 0.62, ay: 0.34, rotate: -3, scale: 0.82 },
    { ax: 0.83, ay: 0.64, rotate: 7, scale: 0.8 }
  ],
  pin: 1.0,
  scrub: 1.1,
  ease: "power3.out",
  start: 0.1,
  stagger: 0.08,
  duration: 0.75,
  headingAt: 0.1
};

const MEDIA_TABLET_PORTRAIT = `${MEDIA_TABLET} and (orientation: portrait)`;
const MEDIA_TABLET_LANDSCAPE = `${MEDIA_TABLET} and (orientation: landscape)`;

// Breathing room kept between a scattered card's rotated edge and the frame.
const EDGE_MARGIN = 6;

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
 *
 * Hand-off is identical at every size: GSAP owns the cards only until the
 * pin releases; after that the rail is a plain native overflow-x scroller
 * (no wheel hijacking, no drag logic) and vertical scrolling continues
 * normally.
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
      mm.add(MEDIA_TABLET_LANDSCAPE, () => buildComposedEntry(cards, TABLET_LANDSCAPE_COMPOSITION));
      mm.add(MEDIA_TABLET_PORTRAIT, () => buildComposedEntry(cards, TABLET_PORTRAIT_COMPOSITION));
      mm.add(MEDIA_MOBILE, () => buildComposedEntry(cards, MOBILE_COMPOSITION));
    }, journey);

    // Desktop: fixed offsets from each card's resting position (approved).
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

    // Tablet + mobile: each card starts at an anchor ON THE SCREEN.
    function buildComposedEntry(cards, composition) {
      if (!cards.length) return undefined;

      rail.classList.remove("s2-rail--landed");

      const { anchors, pin, scrub, ease, start, stagger, duration, headingAt } = composition;

      // The pinned frame IS the visible screen when the pin starts. All
      // measurements are layout offsets (unaffected by GSAP's transforms).
      const frameWidth = () => journey.clientWidth;
      const frameHeight = () => journey.clientHeight;

      // Where a card's centre rests, in frame coordinates, before any scroll.
      const restCentre = (card) => ({
        x: rail.offsetLeft + card.offsetLeft + card.offsetWidth / 2 - rail.scrollLeft,
        y: rail.offsetTop + card.offsetTop + card.offsetHeight / 2
      });

      // Anchor → offset from resting position, with the card's rotated,
      // scaled bounding box kept fully inside the frame.
      const offsetFor = (card, anchor, axis) => {
        const angle = (anchor.rotate * Math.PI) / 180;
        const cos = Math.abs(Math.cos(angle));
        const sin = Math.abs(Math.sin(angle));
        const w = card.offsetWidth * anchor.scale;
        const h = card.offsetHeight * anchor.scale;
        const halfW = (w * cos + h * sin) / 2 + EDGE_MARGIN;
        const halfH = (h * cos + w * sin) / 2 + EDGE_MARGIN;
        const rest = restCentre(card);

        if (axis === "x") {
          const target = gsap.utils.clamp(halfW, Math.max(halfW, frameWidth() - halfW), anchor.ax * frameWidth());
          return target - rest.x;
        }
        const target = gsap.utils.clamp(halfH, Math.max(halfH, frameHeight() - halfH), anchor.ay * frameHeight());
        return target - rest.y;
      };

      // Earlier cards stack above later ones while scattered, so no title
      // (bottom-left of each card) is ever covered by the next card.
      const stackCards = () => cards.forEach((card, i) => gsap.set(card, { zIndex: cards.length - i }));
      const releaseStack = () => gsap.set(cards, { clearProps: "zIndex" });
      stackCards();

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: journey,
          start: "top top",
          end: () => "+=" + window.innerHeight * pin,
          pin: true,
          scrub,
          invalidateOnRefresh: true,
          onLeave: () => {
            rail.classList.add("s2-rail--landed");
            releaseStack();
          },
          onEnterBack: () => {
            rail.classList.remove("s2-rail--landed");
            stackCards();
          }
        }
      });

      // The heading arrives once the cards are mostly in flight.
      tl.fromTo(
        headingRef.current,
        { autoAlpha: 0, y: 14 },
        { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out" },
        headingAt
      );

      cards.forEach((card, i) => {
        const anchor = anchors[i % anchors.length];
        tl.fromTo(
          card,
          {
            x: () => offsetFor(card, anchor, "x"),
            y: () => offsetFor(card, anchor, "y"),
            rotate: anchor.rotate,
            scale: anchor.scale,
            autoAlpha: 1
          },
          { x: 0, y: 0, rotate: 0, scale: 1, duration, ease },
          start + i * stagger
        );
      });

      return () => {
        if (tl.scrollTrigger) tl.scrollTrigger.kill();
        tl.kill();
        releaseStack();
      };
    }

    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
