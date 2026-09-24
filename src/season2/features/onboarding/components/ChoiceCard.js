import React from "react";
import { Link } from "react-router-dom";
import Card from "../../../components/Card";
import { ArrowRightIcon } from "./icons";

// One strong choice, built from the same shared Card the homepage's
// Experience rail uses (graded media layer + hairline border), so it reads as
// a continuation of that world rather than a UI tile. Still a real link:
// keyboard-, middle-click- and screen-reader-correct.
//
// Every panel shares one grid, so titles, indices, arrows and descriptions
// land on the same lines from panel to panel:
//   index ............ arrow      (one row, centred on each other)
//   TITLE                          (single line — sized to fit, never wraps)
//   description
//
// `media` is any CSS background-image value — a placeholder gradient today,
// a real graded photograph later, with no layout change.
//
// `comingSoon` keeps the panel exactly as designed but makes it INERT: it is
// no longer a link (nothing to click, focus or navigate to), and the arrow is
// replaced by a COMING SOON label in the same grid cell.
export default function ChoiceCard({ index, title, description, to, media, comingSoon = false }) {
  const body = (
    <span className="s2-ob-choice-body">
      <span className="s2-ob-choice-index" aria-hidden="true">
        {index}
      </span>
      {comingSoon ? (
        <span className="s2-ob-choice-mark s2-ob-choice-mark--soon">Coming soon</span>
      ) : (
        <span className="s2-ob-choice-mark" aria-hidden="true">
          <ArrowRightIcon />
        </span>
      )}
      <span className="s2-ob-choice-title">{title}</span>
      {description && <span className="s2-ob-choice-desc">{description}</span>}
    </span>
  );

  if (comingSoon) {
    return (
      <div className="s2-ob-choice s2-ob-choice--soon" aria-disabled="true">
        <Card media={media} className="s2-ob-choice-card">
          {body}
        </Card>
      </div>
    );
  }

  return (
    <Link className="s2-ob-choice" to={to}>
      <Card media={media} interactive className="s2-ob-choice-card">
        {body}
      </Card>
    </Link>
  );
}
