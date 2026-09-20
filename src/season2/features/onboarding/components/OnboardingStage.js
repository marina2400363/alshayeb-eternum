import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "./icons";
import { PATHS } from "../paths";
import "../onboarding.css";

// Where the progress line stopped on the previous screen. Each screen is its
// own route (a fresh mount), so remembering this lets the spine grow from the
// last step to the next instead of restarting — the one piece of continuity
// between steps.
let lastProgress = 0;

// The stage every onboarding screen sits on — the same world as the
// homepage: the Hero's graded backdrop (s2-photo-treatment + s2-tint) and the
// grain from .s2-root, with a hairline spine down the left margin that fills
// as the customer moves through the journey. `progress` (0–1) is purely
// visual.
//
// `variant` only selects a layout in CSS:
//   (none)  heading column + a large-type interaction column
//   "split" full-bleed choice panels (Enter / Incomer)
//   "photo" a full-height portrait pane beside the confirmation
export default function OnboardingStage({ children, backTo, backLabel = "Back", sideLabel, progress = 0.2, variant }) {
  const [shown, setShown] = useState(lastProgress);

  // Screens are separate routes; the browser keeps the previous scroll
  // offset, which would open a new screen halfway down (e.g. arriving from
  // the homepage CTA).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setShown(progress);
      lastProgress = progress;
    });
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  const position = `${Math.round(shown * 100)}%`;

  return (
    <div className={`s2-ob-stage${variant ? ` s2-ob-stage--${variant}` : ""}`}>
      <div className="s2-ob-backdrop" aria-hidden="true">
        <div className="s2-ob-backdrop-media s2-photo-treatment" />
        <div className="s2-tint" />
      </div>

      <div className="s2-ob-spine" aria-hidden="true">
        <i style={{ height: position }} />
      </div>

      <header className="s2-ob-header">
        <div className="s2-ob-header-side">
          {backTo && (
            <Link className="s2-ob-back" to={backTo}>
              <ArrowLeftIcon />
              <span>{backLabel}</span>
            </Link>
          )}
        </div>
        <Link className="s2-ob-wordmark" to={PATHS.home}>
          ALSHAYEB
        </Link>
        <div className="s2-ob-header-side s2-ob-header-side--end">{sideLabel}</div>
      </header>

      <main className="s2-ob-main">
        <div className="s2-ob-panel">{children}</div>
      </main>
    </div>
  );
}

// Step key + display title + lede. Focus moves to the title on mount so
// keyboard and screen-reader users land on the new screen, not on stale
// controls from the previous route.
//
// `title` is a string, or an ARRAY OF LINES — the deliberate line breaks
// ("Your" / "school"). Each line is set on one line and the whole title is
// sized from its container to fit the widest line, so the composition is
// chosen here, never by accidental auto-wrapping.
export function OnboardingHeading({ eyebrow, title, lede }) {
  const titleRef = useRef(null);
  const lines = Array.isArray(title) ? title : [title];

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="s2-ob-heading">
      {eyebrow && <p className="s2-ob-eyebrow">{eyebrow}</p>}
      <div className="s2-ob-titlebox">
        <h1 className="s2-ob-title" ref={titleRef} tabIndex={-1}>
          {lines.map((line, index) => (
            <React.Fragment key={line}>
              {index > 0 && " "}
              <span className="s2-ob-title-line">{line}</span>
            </React.Fragment>
          ))}
        </h1>
      </div>
      {lede && <p className="s2-ob-lede">{lede}</p>}
    </div>
  );
}
