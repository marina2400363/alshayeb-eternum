import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { MEDIA_DESKTOP, MEDIA_TABLET, MEDIA_MOBILE, MEDIA_REDUCED_MOTION } from "../styles/breakpoints";

// ---------------------------------------------------------------------------
// SCATTERED EDITORIAL COLLAGE <-> CLEAN GALLERY LINE-UP (scroll-scrubbed)
//
// ONE paused GSAP timeline represents the whole scatter -> gallery sequence.
// It is never played or reversed on a timer: a passive scroll listener
// (rAF-coalesced to at most one update per frame) maps the user's actual
// scroll position, linearly, straight onto the timeline's progress —
// tl.progress(p). Scroll slowly and the cards move exactly as slowly; stop
// and they stop; scroll up and the same math naturally runs it backwards.
// There is no autoplay, no separate reverse animation, and the timeline is
// built once per breakpoint and never rebuilt on scroll (only a real resize
// or breakpoint/orientation change rebuilds it).
//
// No pin, no sticky, no scroll-locking, no ScrollTrigger: the section is
// exactly one screen tall (unchanged) and scrolls 100% natively. Progress is
// computed directly from the section's CURRENT getBoundingClientRect().top
// every tick (see START_TOP_VH / END_TOP_VH) — not from a cached document
// position compared against scrollY — so it self-corrects for anything that
// can move the section within the viewport between measurements (e.g. a
// mobile browser's toolbar collapsing/expanding, which changes the visual
// viewport height mid-scroll). Only window.innerHeight (to derive the two
// pixel thresholds) is cached, refreshed on resize/orientation change; the
// per-frame work is one getBoundingClientRect() read (no writes precede it,
// so it never forces a reflow) plus arithmetic.
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

// These are no longer real-time seconds (nothing ever plays on a timer) —
// they are the SAME relative weights as before, purely so tl.progress(p)
// reproduces the original stagger/easing shape at every point along the
// scrub. Unchanged from the previous time-based version.
const TIMING = {
  glide: 1.2, // per card
  stagger: 0.11, // between cards
  ease: "power3.out"
};

// The last slice of the timeline (in the same relative units as TIMING)
// used to cross-fade cards 5+ in — they finish appearing exactly as cards
// 1-4 finish landing, and fade back out first as progress reverses.
const EXTRAS_REVEAL_DURATION = 0.3;

// Where the section's own top edge sits (as a fraction of the viewport
// height, 0 = viewport top, negative = above it) at progress 0 and 1.
// Symmetric around the exact full-screen-alignment instant (top = 0), so the
// section is already substantially on screen (70% of the viewport height,
// i.e. only its bottom 30% showing) before any card moves, and finishes
// landing only once scrolled a further 30% of the viewport height PAST full
// alignment — the whole scrub plays out while the user is actually
// scrolling through the section, never before it arrives or after it's
// already gone.
const START_TOP_VH = 0.3; // progress 0: section top at +30% of the viewport height
const END_TOP_VH = -0.3; // progress 1: section top at -30% of the viewport height

// The rail only becomes a real (native, swipeable) horizontal scroller once
// the scrub is essentially finished, and stops being one the moment scroll
// carries it back below that.
const LANDED_THRESHOLD = 0.98;

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
 * never changes shape and nothing re-lays-out mid-scrub.
 *
 * Only the first `previewCount` cards (capped at the number of scatter
 * presets) are scattered and glide in; the rest ("extras") are part of the
 * SAME timeline (a cross-fade in its last slice, see EXTRAS_REVEAL_DURATION)
 * instead of a separate CSS toggle, so they ease in/out with scroll instead
 * of snapping. `onReveal` fires once, the first time the scrub actually
 * starts, so the page can start loading their media ahead of that cross-fade.
 */
export default function useExperienceJourney({ journeyRef, headingRef, railRef, cardRefs, previewCount = DESKTOP_ENTRY.length, onReveal }) {
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  useLayoutEffect(() => {
    const journey = journeyRef.current;
    const rail = railRef.current;
    if (!journey || !rail) return undefined;

    // Declared OUTSIDE gsap.context's callback (and read/written by rebuild()
    // below via ordinary closure capture) so the outer cleanup can reach it:
    // gsap.context.revert() only ever reverts GSAP-tracked animations, never
    // arbitrary addEventListener calls, so removing our own scroll/resize
    // listeners on unmount is our job, not gsap's.
    let cleanupCurrent = null;

    const ctx = gsap.context(() => {
      // Preview cards only. Never more than there are scatter presets, so no
      // card can ever reuse another card's pose.
      const count = Math.min(previewCount, DESKTOP_ENTRY.length, MOBILE_ANCHORS.length);
      const cards = cardRefs.current.filter(Boolean).slice(0, count);
      if (!cards.length) return;
      const extraCards = cardRefs.current.filter(Boolean).slice(count);
      const heading = headingRef.current;

      // Fires once, ever — extra cards' media starts loading the first time
      // the scrub begins; it never needs to "un-reveal" (only their opacity,
      // driven by the timeline itself, toggles on reverse).
      let revealed = false;
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        if (onRevealRef.current) onRevealRef.current();
      };

      if (window.matchMedia(MEDIA_REDUCED_MOTION).matches) {
        // Static and accessible: the rail, no motion, no scroll coupling.
        reveal();
        gsap.set(cards, { ...REST, autoAlpha: 1 });
        gsap.set(extraCards, { autoAlpha: 1 });
        gsap.set(heading, { autoAlpha: 1, y: 0 });
        rail.classList.add("s2-rail--landed");
        return;
      }

      const desktopScatter = (card, i) => DESKTOP_ENTRY[i];

      const anchoredScatter = (anchors) => (card, i) => {
        const a = anchors[i];
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
        // Resting centre, frame-relative. Only accurate at rail scrollLeft 0
        // — guaranteed below, which always resets it before un-landing.
        const restX = rail.offsetLeft + card.offsetLeft + card.offsetWidth / 2;
        const restY = rail.offsetTop + card.offsetTop + card.offsetHeight / 2;
        return { x: cx - restX, y: cy - restY, rotate: a.rotate, scale: a.scale };
      };

      // Which scatter formula applies right now — re-evaluated on every
      // (re)build, so a resize that crosses a breakpoint picks it up too.
      const pickScatter = () => {
        if (window.matchMedia(MEDIA_DESKTOP).matches) return desktopScatter;
        if (window.matchMedia(MEDIA_TABLET_LANDSCAPE).matches) return anchoredScatter(TABLET_LANDSCAPE_ANCHORS);
        if (window.matchMedia(MEDIA_TABLET_PORTRAIT).matches) return anchoredScatter(TABLET_PORTRAIT_ANCHORS);
        return anchoredScatter(MOBILE_ANCHORS);
      };

      function build() {
        const scatter = pickScatter();
        const applyScatter = () => cards.forEach((card, i) => gsap.set(card, scatter(card, i)));

        applyScatter();
        gsap.set(cards, { autoAlpha: 1 });
        gsap.set(extraCards, { autoAlpha: 0 });
        gsap.set(heading, { autoAlpha: 0, y: 10 });
        rail.classList.remove("s2-rail--landed");

        // ONE paused timeline. Never played/reversed on a timer — only ever
        // driven directly by tl.progress(p) from the scroll mapping below.
        const tl = gsap.timeline({ paused: true });
        tl.to(heading, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power2.out" }, 0);
        tl.to(cards, { ...REST, duration: TIMING.glide, ease: TIMING.ease, stagger: TIMING.stagger }, 0);
        const cardsEnd = TIMING.glide + TIMING.stagger * Math.max(0, cards.length - 1);
        if (extraCards.length) {
          tl.to(
            extraCards,
            { autoAlpha: 1, duration: EXTRAS_REVEAL_DURATION, ease: "power2.out" },
            Math.max(0, cardsEnd - EXTRAS_REVEAL_DURATION)
          );
        }

        let landed = false;
        let startTop = 0;
        let endTop = 0;

        // The only CACHED measurement here: the two pixel thresholds derived
        // from the viewport height. Refreshed on build and on resize/
        // orientation change, never per scroll frame. Deliberately NOT a
        // cached document-space position compared against scrollY — see the
        // file header comment for why.
        const measure = () => {
          const vh = window.innerHeight;
          startTop = vh * START_TOP_VH;
          endTop = vh * END_TOP_VH;
        };
        measure();

        const applyProgress = () => {
          // The one per-frame layout read: the section's CURRENT position.
          // Read first, before any writes below, so it never forces a reflow.
          const rect = journey.getBoundingClientRect();
          const progress = gsap.utils.clamp(0, 1, (startTop - rect.top) / (startTop - endTop));
          tl.progress(progress);
          if (progress > 0) reveal();

          const shouldLand = progress >= LANDED_THRESHOLD;
          if (shouldLand && !landed) {
            landed = true;
            rail.classList.add("s2-rail--landed");
          } else if (!shouldLand && landed) {
            landed = false;
            // Order matters: reset scrollLeft WHILE the rail is still a real
            // (auto-overflow) scroll container, before clipping it — doing
            // it after leaves the old swipe position to silently reappear
            // the next time .s2-rail--landed is re-added.
            rail.scrollLeft = 0;
            rail.classList.remove("s2-rail--landed");
          }
        };
        applyProgress(); // sync immediately (e.g. a restored/back-navigated scroll position)

        // Passive listener, coalesced to at most one measurement+update per
        // animation frame — the only "continuous" work this hook does, and
        // it never triggers layout (window.scrollY never forces a reflow).
        let ticking = false;
        const onScroll = () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            ticking = false;
            applyProgress();
          });
        };
        window.addEventListener("scroll", onScroll, { passive: true });

        let resizeRaf = 0;
        const onResize = () => {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(rebuild);
        };
        window.addEventListener("resize", onResize);

        return () => {
          window.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onResize);
          cancelAnimationFrame(resizeRaf);
          tl.kill();
        };
      }

      // A real resize/orientation change is infrequent (never per-scroll),
      // so rebuilding the timeline and re-measuring here is cheap and
      // correct — it re-picks the scatter formula (in case a breakpoint was
      // crossed) and re-syncs to whatever the current scroll position is.
      function rebuild() {
        if (cleanupCurrent) cleanupCurrent();
        cleanupCurrent = build();
      }

      rebuild();
    }, journey);

    return () => {
      if (cleanupCurrent) cleanupCurrent();
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
