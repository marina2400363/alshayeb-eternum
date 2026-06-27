const fs = require('fs');

const css = `
/* HOMEPAGE CSS */
.rooms-homepage {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  background: #000;
  justify-content: space-between;
  align-items: center;
  padding: 4rem 1.5rem 3rem;
  z-index: 100;
  overflow-y: auto;
}

.rooms-homepage-brand {
  text-align: center;
  z-index: 2;
  margin-bottom: 2rem;
}

.brand-alshayeb {
  font-family: var(--font-michroma), sans-serif;
  font-size: 1.5rem;
  letter-spacing: 0.6rem;
  color: #fff;
  font-weight: 300;
  margin-left: 0.6rem;
}

.brand-subtitle {
  font-family: var(--font-michroma), sans-serif;
  font-size: 0.65rem;
  letter-spacing: 0.2rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 0.5rem;
  text-transform: uppercase;
  margin-left: 0.2rem;
}

.rooms-homepage-spade-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100%;
  max-width: 500px;
  z-index: 1;
  pointer-events: none;
}

.rooms-homepage-spade {
  width: 100%;
  height: auto;
  object-fit: contain;
  opacity: 0.8;
  mix-blend-mode: screen;
}

.rooms-homepage-bottom {
  width: 100%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.rooms-homepage-title-area {
  text-align: center;
  margin-bottom: 2.5rem;
}

.rooms-homepage-title {
  font-family: var(--font-michroma), sans-serif;
  font-size: 1.8rem;
  letter-spacing: 0.4rem;
  color: #fff;
  line-height: 1.4;
  margin: 0;
  margin-left: 0.4rem;
}

.rooms-homepage-separator {
  width: 24px;
  height: 2px;
  background: #007bff;
  margin: 1.2rem auto;
  box-shadow: 0 0 10px #007bff, 0 0 20px #007bff;
}

.rooms-homepage-desc {
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.5;
  margin: 0;
  letter-spacing: 0.05rem;
}

.rooms-homepage-actions {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.rooms-btn-filled {
  background: linear-gradient(180deg, #1545A8 0%, #0A2663 100%);
  border: 1px solid rgba(111, 193, 255, 0.3);
  border-radius: 8px;
  padding: 1.2rem;
  color: #fff;
  font-family: var(--font-michroma), sans-serif;
  font-size: 0.85rem;
  letter-spacing: 0.25rem;
  text-transform: uppercase;
  box-shadow: 0 0 20px rgba(21, 69, 168, 0.4), inset 0 0 15px rgba(111, 193, 255, 0.2);
  cursor: pointer;
  transition: all 0.3s ease;
}

.rooms-btn-filled:active {
  transform: scale(0.98);
}

.rooms-btn-outline {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  padding: 1.2rem;
  color: #fff;
  font-family: var(--font-michroma), sans-serif;
  font-size: 0.85rem;
  letter-spacing: 0.25rem;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.3s ease;
}

.rooms-btn-outline:active {
  transform: scale(0.98);
  background: rgba(255, 255, 255, 0.05);
}
`;

let currentCss = fs.readFileSync('src/RoomsApp.css', 'utf8');
if (!currentCss.includes('.rooms-homepage {')) {
  fs.writeFileSync('src/RoomsApp.css', currentCss + '\n' + css);
}
console.log('Appended successfully');
