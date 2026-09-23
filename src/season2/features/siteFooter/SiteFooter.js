import React from "react";
import SOCIAL_LINKS from "./socialLinks";
import "./SiteFooter.css";

// Minimal closing footer: the mark, where to find us, one fine-print line.
// Type and hairlines only — nothing to click that isn't a real destination.
export default function SiteFooter() {
  return (
    <footer className="s2-footer">
      <div className="s2-footer-row">
        <div className="s2-footer-brand">
          <p className="s2-footer-mark">Alshayeb</p>
          <p className="s2-footer-tag">Experience</p>
        </div>
        <nav className="s2-footer-nav" aria-label="Social">
          {SOCIAL_LINKS.map((link) => (
            <a key={link.id} className="s2-footer-link" href={link.href} target="_blank" rel="noopener noreferrer">
              <span>{link.label}</span>
              <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                <path d="M2 8L8 2M3.2 2H8v4.8" />
              </svg>
              <span className="s2-sr">(opens in a new tab)</span>
            </a>
          ))}
        </nav>
      </div>
      <p className="s2-footer-fine">&copy; 2024</p>
    </footer>
  );
}
