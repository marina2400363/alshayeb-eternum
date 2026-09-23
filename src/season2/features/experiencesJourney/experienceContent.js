// Card copy (title/tagline/id) is still placeholder — swapped for real
// Season 2 content separately. `gradient` now holds the real homepage media
// (public/season2/media/home/experience-card-0N.jpeg) as a CSS
// background-image value; Card.js applies it via `style={{ backgroundImage:
// media }}`, so a plain url() drops in with zero component changes. Order
// matches the real asset filenames 01-04.
const EXPERIENCE_CARDS = [
  { id: "eternity", title: "ETERNITY", tagline: "No beginning. No end.", gradient: "url(/season2/media/home/experience-card-01.jpeg)" },
  { id: "arrival", title: "ARRIVAL", tagline: "The night begins here.", gradient: "url(/season2/media/home/experience-card-02.jpeg)" },
  { id: "prom", title: "PROM", tagline: "One season. One night.", gradient: "url(/season2/media/home/experience-card-03.jpeg)" },
  { id: "season02", title: "SEASON 02", tagline: "The next chapter.", gradient: "url(/season2/media/home/experience-card-04.jpeg)" }
];

export default EXPERIENCE_CARDS;
