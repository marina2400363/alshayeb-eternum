import React, { useRef } from "react";
import usePageScrollProgress from "../../motion/usePageScrollProgress";
import "./ScrollProgress.css";

// A hairline page marker on the far left edge, present only after the hero:
// how far through the rest of the homepage the reader is. Decorative only —
// hidden from assistive tech and transparent to every touch/click.
//
// `startSelector` is the first post-hero section (Moments); the line stays
// invisible until that section's top has passed the line.
export default function ScrollProgress({ startSelector }) {
  const lineRef = useRef(null);
  usePageScrollProgress(lineRef, { startSelector });

  return (
    <div className="s2-scroll-progress" ref={lineRef} aria-hidden="true">
      <i />
    </div>
  );
}
