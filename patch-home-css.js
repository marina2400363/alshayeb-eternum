const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

const startIndex = css.indexOf('.eternum-home {');
const endIndex = css.indexOf('.app-shell.incomer-reference.tone-blue {');

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find the bounds to replace in App.css");
  process.exit(1);
}

const newCSS = `/* =========================================================================
   HOME PORTAL REDESIGN
   ========================================================================= */

.eternum-home-portal {
  position: relative;
  min-height: 100vh;
  width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: var(--eternum-bg);
}

.home-portal-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  background-image: url('../public/spade-reference.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.home-portal-overlay {
  position: absolute;
  inset: 0;
  background: 
    linear-gradient(180deg, rgba(2, 6, 16, 0.45) 0%, rgba(1, 3, 10, 0.75) 100%),
    radial-gradient(ellipse at 50% 30%, transparent 20%, rgba(2, 6, 16, 0.6) 80%);
}

.home-portal-content {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 500px; /* Constrain desktop to match mobile proportions */
  min-height: 100vh;
  padding: 40px 24px;
  justify-content: flex-end; /* Push content towards the bottom */
}

/* Header */
.home-portal-header {
  text-align: center;
  margin-bottom: 24px;
}

.home-portal-title {
  margin: 0;
  font-family: 'Michroma', sans-serif;
  font-size: clamp(20px, 6vw, 28px);
  font-weight: 400;
  letter-spacing: clamp(12px, 3.5vw, 18px);
  color: white;
  text-shadow: 0 0 16px rgba(255, 255, 255, 0.3);
  margin-right: calc(clamp(12px, 3.5vw, 18px) * -1);
}

.home-portal-subtitle {
  margin: 6px 0 12px;
  font-family: 'Michroma', sans-serif;
  font-size: clamp(14px, 4.5vw, 20px);
  font-weight: 300;
  letter-spacing: clamp(16px, 4.5vw, 24px);
  color: white;
  text-shadow: 0 0 16px rgba(255, 255, 255, 0.3);
  margin-right: calc(clamp(16px, 4.5vw, 24px) * -1);
}

.home-portal-tagline {
  margin: 0;
  font-family: 'Outfit', 'Inter', sans-serif;
  font-size: clamp(9px, 2.5vw, 12px);
  font-weight: 500;
  letter-spacing: clamp(5px, 1.5vw, 8px);
  color: rgba(92, 157, 255, 0.85);
  margin-right: calc(clamp(5px, 1.5vw, 8px) * -1);
}

/* Section Label */
.home-portal-section-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 32px;
}

.portal-diamond-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(127,157,255,0.4), transparent);
}

.home-portal-section-label span {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 4px;
  color: rgba(127,157,255,0.8);
  margin-right: -4px;
}

/* Cards */
.home-portal-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 40px;
  width: 100%;
}

.portal-card {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 16px;
  border: 1px solid rgba(127, 157, 255, 0.28);
  border-radius: 12px;
  background: rgba(3, 8, 15, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  text-align: left;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 0 16px rgba(0,0,0,0.5), inset 0 0 12px rgba(127, 157, 255, 0.05);
}

.portal-card:hover, .portal-card:active {
  background: rgba(8, 22, 48, 0.7);
  border-color: rgba(127, 157, 255, 0.5);
  box-shadow: 0 0 24px rgba(127, 157, 255, 0.15), inset 0 0 16px rgba(127, 157, 255, 0.1);
  transform: translateY(-2px);
}

.portal-card-number {
  font-family: 'Michroma', sans-serif;
  font-size: 16px;
  color: rgba(127, 157, 255, 0.5);
  margin-right: 16px;
  padding-right: 16px;
  border-right: 1px solid rgba(127, 157, 255, 0.2);
}

.portal-card-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.portal-card-kicker {
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 2px;
  color: rgba(127, 157, 255, 0.8);
  margin-bottom: 4px;
}

.portal-card-name {
  font-family: 'Michroma', sans-serif;
  font-size: 16px;
  letter-spacing: 4px;
  color: white;
  margin-bottom: 6px;
}

.portal-card-desc {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.4;
  padding-right: 8px;
}

.portal-card-arrow {
  color: rgba(127, 157, 255, 0.6);
  margin-left: 8px;
}

/* Footer */
.home-portal-footer {
  text-align: center;
  margin-top: auto; /* Push to very bottom if content is short */
  padding-bottom: 20px;
}

.home-portal-footer p {
  margin: 0 0 8px;
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 3px;
  color: rgba(255, 255, 255, 0.4);
}

.home-portal-footer .home-portal-footer-brand {
  color: rgba(127, 157, 255, 0.6);
  letter-spacing: 4px;
}

/* -------------------------------------------------------------------------
   END HOME PORTAL REDESIGN
   ------------------------------------------------------------------------- */

/* Incomer exact component reconstruction: Image A layout over Image B decorative background. */
`;

const newCssText = css.slice(0, startIndex) + newCSS + css.slice(endIndex + 75); 
fs.writeFileSync('src/App.css', newCssText);
console.log("Successfully replaced Home CSS in App.css");
