// Homepage Experiences gallery. To change a card's photograph, replace the
// matching file in public/season2/media/home/ (same name) — nothing else.
// Filenames are case-sensitive in production (Vercel): keep the extension
// exactly as the file has it.
//
// Photos are web-sized, not camera originals: WebP, never upscaled, at least
// 1100px wide and 1650px tall (enough for a 3x phone's cover-fit card), with
// the source's colour profile kept (several are Display P3). A 4000x6000
// camera file here costs ~4MB on every first visit.
const MEDIA_DIR = "/season2/media/home/";

// One entry per card, in gallery order.
export const EXPERIENCE_CARD_FILES = [
  "card1.webp",
  "card2.webp",
  "card3.webp",
  "card4.webp",
  "card5.jpeg",
  "card6.jpeg",
  "card7.webp"
  // "card8.<ext>" — add once public/season2/media/home/card8.* exists.
];

// Only the first N cards take part in the scattered preview and glide into
// the rail; the rest are revealed in the same rail once it lands.
export const PREVIEW_CARD_COUNT = 4;

const EXPERIENCE_CARDS = EXPERIENCE_CARD_FILES.map((file, index) => ({
  id: `card${index + 1}`,
  image: MEDIA_DIR + file,
  // Card.js applies media as a CSS background-image value.
  gradient: `url(${MEDIA_DIR}${file})`
}));

// The homepage hero photograph. Shared with the preloader, which counts it
// (and the preview cards) as critical before revealing the homepage.
export const HOME_HERO_SRC = "/season2/media/home/hero-main.webp";

export default EXPERIENCE_CARDS;
