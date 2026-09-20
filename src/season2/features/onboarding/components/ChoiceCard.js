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
export default function ChoiceCard({ index, title, description, to, media }) {
  return (
    <Link className="s2-ob-choice" to={to}>
      <Card media={media} interactive className="s2-ob-choice-card">
        <span className="s2-ob-choice-body">
          <span className="s2-ob-choice-index" aria-hidden="true">
            {index}
          </span>
          <span className="s2-ob-choice-mark" aria-hidden="true">
            <ArrowRightIcon />
          </span>
          <span className="s2-ob-choice-title">{title}</span>
          {description && <span className="s2-ob-choice-desc">{description}</span>}
        </span>
      </Card>
    </Link>
  );
}
