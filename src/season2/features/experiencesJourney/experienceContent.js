// Homepage Experiences gallery. To change a card's photograph, replace the
// matching file in public/season2/media/home/ (same name) — nothing else.
// Filenames are case-sensitive in production (Vercel): keep the extension
// exactly as the file has it.
const MEDIA_DIR = "/season2/media/home/";

// One entry per card, in gallery order.
export const EXPERIENCE_CARD_FILES = [
  "card1.PNG",
  "card2.JPEG",
  "card3.JPEG",
  "card4.JPEG",
  "card5.jpeg",
  "card6.jpeg",
  "card7.JPEG"
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
export const HOME_HERO_SRC = "/season2/media/home/hero-main.png";

export default EXPERIENCE_CARDS;
