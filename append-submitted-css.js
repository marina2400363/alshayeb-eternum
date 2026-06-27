const fs = require('fs');

const css = `
/* --- Submitted Page Styling --- */
.rooms-submitted-illustration {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 3rem 0 2rem;
}

.rooms-submitted-glow-circle {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: 1px solid rgba(26, 86, 255, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 0 40px rgba(26, 86, 255, 0.2), inset 0 0 20px rgba(26, 86, 255, 0.1);
  background: radial-gradient(circle, rgba(26, 86, 255, 0.1) 0%, rgba(4, 10, 30, 0) 70%);
}

.rooms-submitted-icon {
  color: #1a56ff;
  filter: drop-shadow(0 0 8px rgba(26, 86, 255, 0.5));
}

.rooms-submitted-header {
  text-align: center;
  margin-bottom: 2rem;
}

.rooms-submitted-title {
  font-family: 'Michroma', sans-serif;
  color: white;
  font-size: 1.5rem;
  letter-spacing: 3px;
  margin-bottom: 1rem;
}

.rooms-submitted-subtitle {
  font-family: 'Michroma', sans-serif;
  color: #1a56ff;
  font-size: 0.85rem;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 1.5rem;
  line-height: 1.4;
}

.rooms-submitted-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(26, 86, 255, 0.3) 50%, transparent 100%);
  position: relative;
  margin: 0 auto 2rem;
  width: 80%;
}

.rooms-submitted-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 4px;
  background: #1a56ff;
  border-radius: 50%;
  box-shadow: 0 0 10px #1a56ff, 0 0 20px #1a56ff;
}

.rooms-submitted-desc {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.9rem;
  text-align: center;
  line-height: 1.6;
  margin-bottom: 3rem;
  padding: 0 1rem;
}

.rooms-status-card {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 16px;
  padding: 2rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.rooms-status-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.rooms-status-label {
  font-family: 'Michroma', sans-serif;
  color: #1a56ff;
  font-size: 0.7rem;
  letter-spacing: 2px;
  margin-bottom: 0.5rem;
}

.rooms-status-value {
  font-family: 'Michroma', sans-serif;
  color: white;
  font-size: 1.1rem;
  letter-spacing: 2px;
}

.rooms-status-item {
  display: flex;
  align-items: center;
  gap: 1.2rem;
  padding: 1rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.rooms-status-icon-container {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 50%;
  border: 1px solid rgba(26, 86, 255, 0.4);
  display: flex;
  justify-content: center;
  align-items: center;
  color: #1a56ff;
  background: rgba(26, 86, 255, 0.05);
}

.rooms-status-text {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.rooms-status-text-label {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.85rem;
}

.rooms-status-text-value {
  color: #1a56ff;
  font-size: 0.9rem;
}

.rooms-view-reservations-btn {
  background: transparent;
  border: 1px solid rgba(26, 86, 255, 0.5);
  border-radius: 12px;
  padding: 1.2rem;
  color: white;
  font-family: 'Michroma', sans-serif;
  font-size: 0.8rem;
  letter-spacing: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.3s ease;
  width: 100%;
  margin-top: 1rem;
}

.rooms-view-reservations-btn:hover {
  background: rgba(26, 86, 255, 0.1);
  border-color: #1a56ff;
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('Submitted UI CSS appended successfully.');
