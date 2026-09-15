import React from "react";
import StatusBadge from "../../components/StatusBadge";
import "./Hero.css";

// Standalone, full-bleed hero moment — no longer shares a pinned frame with
// the Experience cards, so it can never be visually cluttered by them.
//
// Media layer is structured for a real local video later: pass `videoSrc`
// (and optionally `posterSrc`) once footage exists. Until then it falls back
// to the gradient placeholder — never an external/stock video, never
// autoplaying anything that isn't ours.
export default function Hero({ videoSrc, posterSrc }) {
  return (
    <section className="s2-hero">
      <div className="s2-hero-media s2-photo-treatment">
        {videoSrc ? (
          <video
            className="s2-hero-video"
            src={videoSrc}
            poster={posterSrc}
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <div
            className="s2-hero-media-fallback"
            style={posterSrc ? { backgroundImage: `url(${posterSrc})` } : undefined}
          />
        )}
      </div>
      <div className="s2-tint" />
      <div className="s2-hero-content">
        <StatusBadge status="live">Season 02 — Registration Open</StatusBadge>
        <h1 className="s2-hero-title">
          <span className="s2-hero-title-line">Alshayeb</span>
          <span className="s2-hero-title-line s2-hero-title-line--sub">Experience</span>
        </h1>
        <div className="s2-scroll-cue">
          <i aria-hidden="true" />
          Scroll to enter
        </div>
      </div>
    </section>
  );
}
