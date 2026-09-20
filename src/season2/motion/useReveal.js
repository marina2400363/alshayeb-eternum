import { useEffect, useRef, useState } from "react";

// One-shot "scrolled into view" flag for CSS-driven reveals. The element is
// shown immediately when there is no IntersectionObserver or the visitor
// prefers reduced motion, so nothing ever depends on the animation running.
// Independent of the Experiences journey's GSAP/ScrollTrigger code.
export default function useReveal({ threshold = 0.35 } = {}) {
  const ref = useRef(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, revealed];
}
