import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CRITICAL_IMAGES, fontsTask, imageTask, firstFrameTask, trackTasks } from "./homeAssets";
import "./Preloader.css";

// Full-screen homepage preloader. Mounted by the homepage itself, so the
// real page renders (and initialises its motion) UNDERNEATH while this
// covers it; it lifts only once every critical asset is loaded and decoded.
//
// Shown once per page load. public/index.html paints an identical static
// shell (#s2-boot) before the JS bundle arrives; this component replaces it
// on mount, so there is no flash between the two.
//
// Progress is real and byte-weighted (see homeAssets.js). The number on
// screen eases toward the real value — it can trail it by a few frames, but
// never runs ahead of it, and it only reads 100 when everything has settled.

// The four small card forms: scattered at 0%, one clean row at 100% (the
// homepage's own collage -> gallery idea, in miniature). Each fills in when
// its matching card photograph has loaded.
const DECK = [
  { sx: -58, sy: -12, r: -9, fx: -45 },
  { sx: -16, sy: 13, r: 6, fx: -15 },
  { sx: 20, sy: -9, r: -4, fx: 15 },
  { sx: 58, sy: 11, r: 10, fx: 45 }
];

// Task order matters: 0 = hero, 1..4 = cards 01-04, then fonts, then first
// frame. Images go first so their requests are issued first.
const FIRST_CARD_TASK = 1;
const FONT_TASK = CRITICAL_IMAGES.length;

const HOLD_AT_100_MS = 260; // let "100" register before lifting
const LIFT_MS = 1150; // matches the CSS exit (content fade + curtain)
const RELEASE_HOME_MS = 420; // hero title rise + scrolling resume mid-lift
const FONT_FALLBACK_MS = 1500; // show the type even if the font is slow

let hasRun = false;

// Test hook: lets each test start from a fresh page load.
export function resetPreloaderForTests() {
  hasRun = false;
}

export default function Preloader() {
  const [active, setActive] = useState(() => !hasRun && typeof window !== "undefined");
  const [phase, setPhase] = useState("loading"); // loading -> complete -> leaving
  const [typeReady, setTypeReady] = useState(false);
  const [cardsLoaded, setCardsLoaded] = useState(() => DECK.map(() => false));
  const rootRef = useRef(null);
  const countRef = useRef(null);

  // Before first paint: take over from the static shell and hold the page.
  useLayoutEffect(() => {
    if (!active) return undefined;
    hasRun = true;
    const html = document.documentElement;
    html.classList.add("s2-preloading");
    const boot = document.getElementById("s2-boot");
    if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
    return () => html.classList.remove("s2-preloading");
  }, [active]);

  // Load + drive the counter. A LAYOUT effect on purpose: it runs before the
  // browser resolves the homepage's CSS background images, so these tracked
  // fetches are the real downloads (the page's own image requests then wait
  // on the HTTP cache and reuse them) and the bytes stream through the count.
  useLayoutEffect(() => {
    if (!active) return undefined;
    const root = rootRef.current;
    let target = 0;
    let shown = 0;
    let allDone = false;
    let raf = 0;
    let cancelled = false;

    const paint = (value) => {
      const pct = Math.floor(value * 100);
      root.style.setProperty("--p", value.toFixed(4));
      root.setAttribute("aria-valuenow", String(pct));
      if (countRef.current) countRef.current.textContent = String(pct);
    };

    const tick = () => {
      if (cancelled) return;
      const gap = target - shown;
      if (gap > 0) shown = Math.min(target, shown + Math.max(gap * 0.12, 0.006));
      paint(shown);
      if (allDone && shown >= 1) {
        setPhase("complete");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const fontTimer = setTimeout(() => setTypeReady(true), FONT_FALLBACK_MS);

    const tasks = [...CRITICAL_IMAGES.map((src) => imageTask(src)), fontsTask(), firstFrameTask()];
    trackTasks(tasks, {
      onProgress: (fraction, { settled }) => {
        if (cancelled) return;
        target = Math.max(target, fraction);
        if (settled[FONT_TASK]) setTypeReady(true);
        const cards = DECK.map((_, i) => Boolean(settled[FIRST_CARD_TASK + i]));
        setCardsLoaded((prev) => (prev.every((v, i) => v === cards[i]) ? prev : cards));
      }
    }).then(() => {
      if (cancelled) return;
      // Settled, or the safety timeout fired: either way, finish.
      target = 1;
      allDone = true;
      setTypeReady(true);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(fontTimer);
    };
  }, [active]);

  // 100 -> brief hold -> lift -> unmount.
  useEffect(() => {
    if (phase === "complete") {
      const t = setTimeout(() => setPhase("leaving"), HOLD_AT_100_MS);
      return () => clearTimeout(t);
    }
    if (phase === "leaving") {
      const release = setTimeout(() => document.documentElement.classList.remove("s2-preloading"), RELEASE_HOME_MS);
      const unmount = setTimeout(() => setActive(false), LIFT_MS);
      return () => {
        clearTimeout(release);
        clearTimeout(unmount);
      };
    }
    return undefined;
  }, [phase]);

  if (!active) return null;

  return (
    <div
      ref={rootRef}
      className={`s2-pre is-${phase}${typeReady ? " is-type" : ""}`}
      role="progressbar"
      aria-label="Loading ALSHAYEB EXPERIENCE"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
    >
      <div className="s2-pre-stage">
        <div className="s2-pre-deck" aria-hidden="true">
          {DECK.map((c, i) => (
            <i
              key={i}
              className={`s2-pre-card${cardsLoaded[i] ? " is-loaded" : ""}`}
              style={{ "--sx": `${c.sx}px`, "--sy": `${c.sy}px`, "--r": `${c.r}deg`, "--fx": `${c.fx}px` }}
            />
          ))}
        </div>
        <div className="s2-pre-mark" aria-hidden="true">
          <span className="s2-pre-word">Alshayeb</span>
          <span className="s2-pre-sub">Experience</span>
        </div>
      </div>

      <div className="s2-pre-foot" aria-hidden="true">
        <span className="s2-pre-label">Loading</span>
        <span className="s2-pre-count">
          <span ref={countRef}>0</span>
          <span className="s2-pre-pct">%</span>
        </span>
      </div>

      <div className="s2-pre-line" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}
