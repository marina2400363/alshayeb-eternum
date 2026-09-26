import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import SOCIAL_LINKS from "../siteFooter/socialLinks";
import "./SiteMenu.css";

export const HOME_PATH = "/";

// Closing plays a short fade before the overlay unmounts. Keep in sync with
// the .s2-menu transition in SiteMenu.css.
const CLOSE_MS = 240;

const ITEMS = [
  { id: "home", label: "Home", to: HOME_PATH },
  ...SOCIAL_LINKS.map((link) => ({ id: link.id, label: link.label, href: link.href }))
];

/**
 * The customer-facing Season 2 menu: a hairline hamburger toggle for the
 * header's end cell, and a full-screen near-black overlay (HOME / INSTAGRAM /
 * TIKTOK).
 *
 * The overlay is portalled to <body>: both headers that host the toggle use
 * backdrop-filter, which would otherwise trap a position:fixed overlay inside
 * the header. The portal carries `.s2-root` so it keeps the Season 2 tokens.
 *
 * Closes on: its own X, choosing HOME, clicking empty overlay space, Escape.
 * While open, page scroll is locked and focus stays inside the overlay.
 */
export default function SiteMenu() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);
  const closeTimer = useRef(0);

  const show = () => {
    clearTimeout(closeTimer.current);
    setMounted(true);
    // Next frame, so the entrance transition runs from the closed state.
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  };

  const hide = useCallback(({ restoreFocus = true } = {}) => {
    setOpen(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setMounted(false);
      if (restoreFocus && toggleRef.current) toggleRef.current.focus({ preventScroll: true });
    }, CLOSE_MS);
  }, []);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // While open: lock page scroll, handle Escape, keep Tab inside the overlay.
  useEffect(() => {
    if (!mounted) return undefined;
    const html = document.documentElement;
    html.classList.add("s2-menu-open");

    const first = panelRef.current && panelRef.current.querySelector(".s2-menu-link");
    if (first) first.focus({ preventScroll: true });

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hide();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll("a[href], button:not([disabled])"));
      if (!focusables.length) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      html.classList.remove("s2-menu-open");
    };
  }, [mounted, hide]);

  // Empty overlay space (not an item or the close button) closes the menu.
  const onBackdropClick = (event) => {
    if (event.target === event.currentTarget) hide();
  };

  const overlay = (
    <div
      className={`s2-root s2-menu${open ? " is-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      id="s2-site-menu"
      ref={panelRef}
      onClick={onBackdropClick}
    >
      <div className="s2-menu-bar" onClick={onBackdropClick}>
        <span className="s2-menu-bar-label" aria-hidden="true">
          Menu
        </span>
        <Link className="s2-menu-wordmark" to={HOME_PATH} aria-label="Go to homepage" onClick={() => hide({ restoreFocus: false })}>
          ALSHAYEB
        </Link>
        <div className="s2-menu-bar-end">
          <button type="button" className="s2-menu-toggle is-close" aria-label="Close menu" onClick={() => hide()}>
            <span className="s2-menu-lines" aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>

      <nav className="s2-menu-nav" aria-label="Site" onClick={onBackdropClick}>
        <ul className="s2-menu-list">
          {ITEMS.map((item, index) => {
            const body = (
              <>
                <span className="s2-menu-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="s2-menu-label">{item.label}</span>
              </>
            );
            return (
              <li key={item.id} className="s2-menu-item" style={{ "--i": index }}>
                {item.to ? (
                  <Link className="s2-menu-link" to={item.to} onClick={() => hide({ restoreFocus: false })}>
                    {body}
                  </Link>
                ) : (
                  <a className="s2-menu-link" href={item.href} target="_blank" rel="noopener noreferrer">
                    {body}
                    <span className="s2-menu-sr">(opens in a new tab)</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="s2-menu-toggle"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={mounted ? "s2-site-menu" : undefined}
        onClick={show}
      >
        <span className="s2-menu-lines" aria-hidden="true">
          <i />
          <i />
        </span>
      </button>
      {mounted && typeof document !== "undefined" ? createPortal(overlay, document.body) : null}
    </>
  );
}
