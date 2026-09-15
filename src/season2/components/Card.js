import React, { forwardRef } from "react";
import "./Card.css";

// Generic dark surface with an optional photo-treated media layer. Used for
// Experience cards on the homepage today; must also work as a plain content
// card in the Customer Area later, so it carries no journey-specific logic.
const Card = forwardRef(function Card(
  { children, media = null, className = "", interactive = false, style },
  ref
) {
  return (
    <div
      ref={ref}
      className={`s2-card ${interactive ? "s2-card--interactive" : ""} ${className}`}
      style={style}
    >
      {media && (
        <div className="s2-card-media s2-photo-treatment" style={{ backgroundImage: media }}>
          <div className="s2-tint" />
        </div>
      )}
      <div className="s2-card-content">{children}</div>
    </div>
  );
});

export default Card;
