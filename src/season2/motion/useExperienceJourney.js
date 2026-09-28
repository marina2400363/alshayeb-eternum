import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { MEDIA_DESKTOP, MEDIA_TABLET, MEDIA_REDUCED_MOTION } from "../styles/breakpoints";

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
// every tick (see measure() in build()) — not from a cached document
// position compared against scrollY — so it self-corrects for anything that
// can move the section within the viewport between measurements (e.g. a
// mobile browser's toolbar collapsing/expanding, which changes the visual
// viewport height mid-scroll). Only the two pixel thresholds are cached,
// refreshed on resize/orientation change; the
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

// NORMALIZED TIMELINE. The scrub timeline is exactly 1 unit long, so its
// time IS its progress and IS the vertical scroll progress: nothing is
// derived from GSAP's own duration/stagger math. Every tween is placed at an
// explicit [start, end] inside 0 -> 1 and none may end after 1.
//
// Preview cards: each one's SCATTER -> REST transform spans (almost) the
// whole scrub, linear (ease "none") so movement is exactly proportional to
// scroll distance. The per-card start offset is a barely-visible stagger;
// ALL of them end at exactly 1.
const CARD_STARTS = [0, 0.01, 0.02, 0.03]; // card i: CARD_STARTS[i] -> 1
const HEADING_RANGE = [0, 0.3]; // heading fade-in, well inside the scrub
const EXTRAS_RANGE = [0.96, 1]; // cards 5+ fade in during the final slice
const TIMELINE_END = 1;

// Where the section's own top edge sits (as a fraction of the viewport
// height, 0 = viewport top, negative = above it) at progress 0 and 1.
// Scrub distance (fraction of the viewport height) from progress 0 to 1 —
// this alone sets the scrub speed. WHERE the window sits is not a constant:
// progress 1 is measured from the final composition (see measure() in
// build()), so the cards land exactly when the heading and the full card row
// are framed together in the viewport.
const SCRUB_RANGE_VH = 0.6;
// Minimum gap between the viewport top and the heading in the landing frame.
const FRAME_MARGIN = 24;

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
 * SAME timeline (a cross-fade inside its final slice, see EXTRAS_RANGE)
 * instead of a separate CSS toggle, so they ease in/out with scroll instead
 * of snapping. `onReveal` fires once, the first time the scrub actually
 * starts, so the page can start loading their media ahead of that cross-fade.
 *
 * The rail's .s2-rail--landed (native horizontal scroll) is on exactly when
 * progress is 1 — the point where every preview card tween has reached REST
 * — and off below it. There is no other unlock threshold.
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

        // ONE paused, normalized (duration exactly 1) timeline. Never
        // played/reversed on a timer — only ever driven by tl.progress(p)
        // from the scroll mapping below, so p is simultaneously scroll
        // progress, timeline time and timeline progress.
        const tl = gsap.timeline({ paused: true, defaults: { ease: "none" } });
        const span = (from, to) => ({ duration: to - from });
        cards.forEach((card, i) => {
          tl.to(card, { ...REST, ...span(CARD_STARTS[i], TIMELINE_END) }, CARD_STARTS[i]);
        });
        tl.to(heading, { autoAlpha: 1, y: 0, ...span(...HEADING_RANGE) }, HEADING_RANGE[0]);
        if (extraCards.length) {
          tl.to(extraCards, { autoAlpha: 1, ...span(...EXTRAS_RANGE) }, EXTRAS_RANGE[0]);
        }
        // Card 1 spans 0 -> 1 and nothing is placed past 1, so this holds by
        // construction; guard it anyway so a future tween can never silently
        // stretch the timeline and compress the cards into part of the scrub.
        if (process.env.NODE_ENV !== "production" && Math.abs(tl.duration() - TIMELINE_END) > 1e-6) {
          console.warn(`Experiences scrub timeline must be exactly ${TIMELINE_END} long, got ${tl.duration()}`);
        }

        let landed = false;
        let startTop = 0;
        let endTop = 0;

        // The only CACHED measurement here: the two pixel thresholds.
        // Refreshed on build and on resize/orientation change, never per
        // scroll frame. Deliberately NOT a cached document-space position
        // compared against scrollY — see the file header comment for why.
        //
        // END comes from the real final composition, not a viewport
        // percentage: the box from the heading's top to the rail's bottom
        // edge (the cards at REST), in section coordinates. offsetTop/
        // offsetHeight are layout values, so the heading's entry offset and
        // the cards' scatter transforms never skew them. progress 1 is the
        // scroll position where that box sits centred in the viewport (never
        // closer than FRAME_MARGIN to the top). START is exactly one scrub
        // range earlier, so the scrub speed never depends on the layout.
        const measure = () => {
          const vh = window.innerHeight;
          const compTop = heading.offsetTop;
          const compBottom = rail.offsetTop + rail.offsetHeight;
          const frameTop = Math.max(FRAME_MARGIN, (vh - (compBottom - compTop)) / 2);
          endTop = frameTop - compTop; // section top, in viewport px, at progress 1
          startTop = endTop + vh * SCRUB_RANGE_VH;
        };
        measure();

        const applyProgress = () => {
          // The one per-frame layout read: the section's CURRENT position.
          // Read first, before any writes below, so it never forces a reflow.
          const rect = journey.getBoundingClientRect();
          const progress = gsap.utils.clamp(0, 1, (startTop - rect.top) / (startTop - endTop));
          tl.progress(progress);
          if (progress > 0) reveal();

          // Landed == the four preview cards are at REST == progress 1 (the
          // end of every card tween). No separate unlock threshold: the very
          // frame the scatter becomes the row, the rail is a native scroller.
          const shouldLand = progress >= TIMELINE_END;
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
