// Canonical Season 2 breakpoints. Must stay in sync with the reference
// values documented in tokens.css. This is the single source JS reads from —
// motion code and any future responsive component import these, nothing
// hardcodes 768/1200 a second time.
export const MOBILE_MAX = 767;
export const TABLET_MIN = 768;
export const TABLET_MAX = 1199;
export const DESKTOP_MIN = 1200;

export const MEDIA_MOBILE = `(max-width: ${MOBILE_MAX}px)`;
export const MEDIA_TABLET = `(min-width: ${TABLET_MIN}px) and (max-width: ${TABLET_MAX}px)`;
export const MEDIA_DESKTOP = `(min-width: ${DESKTOP_MIN}px)`;
export const MEDIA_REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
