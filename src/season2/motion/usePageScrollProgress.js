import { useEffect } from "react";

// Scroll distances, as fractions of the viewport height.
const FADE_IN_VH = 0.12; // after the hero has fully cleared the line
const FADE_OUT_VH = 0.1; // the page's final stretch: fill is full, line fades away

/**
 * Drives the homepage's post-hero progress line (features/scrollProgress).
 * A purely visual read-out of native vertical scroll: it never scrolls,
 * locks or pins anything, and never touches React state.
 *
 * The line only exists after the hero. `startSelector` names the first
 * post-hero section (Moments); progress runs from the scroll position where
 * that section's top edge has passed ABOVE the line's own top (so the line
 * can never sit over any hero pixel) to the page's final stretch:
 *
 *   start = startSectionTop - lineTop          (document px)
 *   end   = maxScroll - FADE_OUT_VH * vh
 *   progress   = clamp((scrollY - start) / (end - start), 0, 1)
 *   visibility = fade-in over FADE_IN_VH after start
 *              x fade-out over the last FADE_OUT_VH of the page
 *
 * start/end are cached and re-measured only on resize (which also fires when
 * a mobile browser's toolbar shows/hides) or when the document's height
 * changes — never per frame. Each frame reads window.scrollY and writes two
 * CSS custom properties (--p for the fill's scaleY, --v for opacity), so the
 * update is compositor-only.
 */
export default function usePageScrollProgress(lineRef, { startSelector }) {
  useEffect(() => {
    const line = lineRef.current;
    if (!line) return undefined;

    let start = 0;
    let end = 1;
    let maxScroll = 1;
    let vh = 1;
    let raf = 0;

    const measure = () => {
      vh = window.innerHeight;
      maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
      const section = document.querySelector(startSelector);
      const sectionTop = section ? section.getBoundingClientRect().top + window.scrollY : 0;
      // The line is position:fixed, so its viewport top is scroll-independent.
      const lineTop = line.getBoundingClientRect().top;
      start = sectionTop - lineTop;
      end = Math.max(start + 1, maxScroll - vh * FADE_OUT_VH);
    };

    const clamp01 = (value) => Math.min(1, Math.max(0, value));

    const paint = () => {
      raf = 0;
      const y = window.scrollY;
      const progress = clamp01((y - start) / (end - start));
      const fadeIn = clamp01((y - start) / (vh * FADE_IN_VH));
      const fadeOut = clamp01((maxScroll - y) / (vh * FADE_OUT_VH));
      line.style.setProperty("--p", progress.toFixed(4));
      line.style.setProperty("--v", (fadeIn * fadeOut).toFixed(3));
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const onResize = () => {
      measure();
      schedule();
    };

    measure();
    paint();

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    // Content height can change without a window resize (media, fonts, the
    // preloader releasing the page) — keep start/end honest.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(document.body);

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      if (ro) ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [lineRef, startSelector]);
}
