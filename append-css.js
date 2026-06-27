const fs = require('fs');

const css = `
/* --- Rooms Date Picker --- */
.rooms-dates-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  width: 100%;
}

.rooms-dates-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(4, 10, 30, 0.6);
  border: 1px solid rgba(26, 86, 255, 0.3);
  border-radius: 12px;
  padding: 1rem 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.rooms-dates-box {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.rooms-dates-label {
  font-family: 'Michroma', sans-serif;
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 2px;
}

.rooms-dates-value {
  font-family: 'Michroma', sans-serif;
  font-size: 0.9rem;
  color: white;
}

.rooms-dates-divider {
  color: #1a56ff;
  font-size: 1.5rem;
}

.rooms-datepicker-wrapper {
  background: rgba(4, 10, 30, 0.6);
  border: 1px solid rgba(26, 86, 255, 0.3);
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.rooms-calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.rooms-calendar-title {
  font-family: 'Michroma', sans-serif;
  font-size: 1.1rem;
  color: white;
}

.rooms-calendar-year {
  color: #1a56ff;
}

.rooms-calendar-nav {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
}

.rooms-calendar-nav:hover {
  background: rgba(26, 86, 255, 0.2);
  border-color: #1a56ff;
}

.rooms-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.5rem;
  text-align: center;
}

.rooms-calendar-dow {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 0.5rem;
}

.rooms-calendar-day {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  color: white;
  cursor: pointer;
  border-radius: 50%;
  transition: all 0.2s ease;
  z-index: 1;
}

.rooms-calendar-day.empty {
  visibility: hidden;
}

.rooms-calendar-day.disabled {
  color: rgba(255, 255, 255, 0.2);
  cursor: not-allowed;
}

.rooms-calendar-day:not(.disabled):hover {
  background: rgba(255, 255, 255, 0.1);
}

.rooms-calendar-day.in-range {
  background: rgba(26, 86, 255, 0.15);
  border-radius: 0;
}

.rooms-calendar-day.selected {
  color: white;
  font-weight: bold;
}

.selection-glow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #1a56ff;
  border-radius: 50%;
  z-index: -1;
  box-shadow: 0 0 15px rgba(26, 86, 255, 0.6);
}

.rooms-stay-summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: linear-gradient(180deg, rgba(4, 10, 30, 0) 0%, rgba(26, 86, 255, 0.05) 100%);
  border-bottom: 1px solid rgba(26, 86, 255, 0.2);
  margin-bottom: 1rem;
}

.stay-duration-highlight {
  font-family: 'Michroma', sans-serif;
  font-size: 1.5rem;
  color: #1a56ff;
  text-shadow: 0 0 10px rgba(26, 86, 255, 0.4);
  margin-bottom: 0.5rem;
}

.stay-duration-dates {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 1px;
}

.stay-duration-empty {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('CSS Appended successfully.');
