import EXPERIENCE_CARDS, { HOME_HERO_SRC } from "../experiencesJourney/experienceContent";

// ---------------------------------------------------------------------------
// What the homepage needs before it may be revealed, and how loading it is
// measured. No React here — Preloader.js drives it, tests exercise it.
//
// Progress is BYTE-WEIGHTED: every task has a size (`total`) and a running
// `loaded`, and overall progress = Σ loaded / Σ total.
//   - Images report real bytes as they stream in (fetch + ReadableStream,
//     total from Content-Length), then are decoded before counting as done.
//   - Fonts and the first painted frame have no byte stream the browser will
//     expose, so each counts as a fixed-size step (0 -> done).
// ---------------------------------------------------------------------------

// Extracts the path from a CSS `url(...)` value (card media is stored that way).
export function cssUrl(value) {
  const match = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(value || "");
  return match ? match[2] : null;
}

// Hero first (it is the first thing the visitor sees), then cards 01-04.
export const CRITICAL_IMAGES = [HOME_HERO_SRC, ...EXPERIENCE_CARDS.map((card) => cssUrl(card.gradient)).filter(Boolean)];

// Byte weights for tasks that can't report bytes, and a placeholder size
// for an image until its Content-Length arrives (usually within one RTT).
export const WEIGHTS = {
  imageHint: 250000,
  fonts: 120000,
  firstFrame: 40000
};

// Safety net: reveal anyway after this long, so a stalled request can never
// trap the visitor on the loader.
export const MAX_WAIT_MS = 15000;

// Decoded images are kept referenced for the page's lifetime so the browser
// keeps them in its memory cache: the hero/cards then paint from memory
// instead of revalidating (production serves max-age=0, must-revalidate).
const keepAlive = [];

function decodeImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    keepAlive.push(img);
    const done = () => resolve();
    img.onload = () => {
      if (typeof img.decode === "function") img.decode().then(done, done);
      else done();
    };
    img.onerror = done;
    img.src = src;
  });
}

/**
 * Loads one image, reporting streamed bytes. Never rejects: a failed image
 * counts as settled (there is nothing more to wait for).
 */
export function imageTask(src, { fetchImpl = typeof fetch === "function" ? fetch : null, decode = decodeImage } = {}) {
  return async (report) => {
    let total = WEIGHTS.imageHint;
    report(0, total);
    try {
      if (!fetchImpl) throw new Error("no fetch");
      const res = await fetchImpl(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      total = Number(res.headers.get("content-length")) || total;
      report(0, total);

      const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
      if (reader) {
        let loaded = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value ? value.length : 0;
          // Download is 95% of an image; decode is the last 5%.
          report(Math.min(loaded, total) * 0.95, total);
        }
      } else {
        await res.blob();
      }
      report(total * 0.95, total);
    } catch (e) {
      // Streaming unavailable or failed: fall back to a plain image load.
    }
    await decode(src);
    report(total, total);
  };
}

/** Archivo (display + body). One variable file covers every weight/width. */
export function fontsTask(fonts = typeof document !== "undefined" ? document.fonts : null) {
  return async (report) => {
    report(0, WEIGHTS.fonts);
    if (fonts && typeof fonts.load === "function") {
      try {
        await Promise.all([
          fonts.load('800 1em "Archivo"', "ALSHAYEB EXPERIENCE"),
          fonts.load('400 1em "Archivo"', "Choose how you're joining.")
        ]);
        if (fonts.ready) await fonts.ready;
      } catch (e) {
        // Font failure never blocks: the fallback stack renders.
      }
    }
    report(WEIGHTS.fonts, WEIGHTS.fonts);
  };
}

/**
 * The homepage (mounted underneath) has committed and painted: GSAP has set
 * the Experiences scatter in a layout effect, and two frames have gone by.
 */
export function firstFrameTask(raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 16)) {
  return (report) =>
    new Promise((resolve) => {
      report(0, WEIGHTS.firstFrame);
      raf(() =>
        raf(() => {
          report(WEIGHTS.firstFrame, WEIGHTS.firstFrame);
          resolve();
        })
      );
    });
}

/**
 * Runs tasks in parallel. `onProgress(fraction, detail)` fires on every
 * report; resolves `{ timedOut }` when all tasks settle or `maxWait` passes.
 * `detail.settled[i]` says whether task i has finished.
 */
export function trackTasks(tasks, { onProgress = () => {}, maxWait = MAX_WAIT_MS } = {}) {
  const loaded = tasks.map(() => 0);
  const totals = tasks.map(() => 1);
  const settled = tasks.map(() => false);
  let finished = false;

  const emit = () => {
    const sumTotal = totals.reduce((a, b) => a + b, 0);
    const sumLoaded = loaded.reduce((a, b) => a + b, 0);
    const fraction = settled.every(Boolean) ? 1 : Math.min(0.999, sumTotal ? sumLoaded / sumTotal : 0);
    onProgress(fraction, { settled: settled.slice() });
  };

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve({ timedOut: true });
    }, maxWait);

    let remaining = tasks.length;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ timedOut: false });
    };
    if (!remaining) {
      emit();
      finish();
      return;
    }

    tasks.forEach((task, i) => {
      const report = (l, t) => {
        if (finished || settled[i]) return;
        totals[i] = Math.max(1, t);
        loaded[i] = Math.max(loaded[i], Math.min(l, totals[i]));
        emit();
      };
      // Started synchronously (not in a microtask) so image requests are
      // issued before anything else on the page can force a style pass.
      let run;
      try {
        run = Promise.resolve(task(report));
      } catch (e) {
        run = Promise.resolve();
      }
      run
        .catch(() => {})
        .then(() => {
          if (finished) return;
          loaded[i] = totals[i];
          settled[i] = true;
          emit();
          remaining -= 1;
          if (!remaining) finish();
        });
    });
  });
}
