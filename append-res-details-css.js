const fs = require('fs');

const css = `
/* --- Reservation Details Styling --- */
.rooms-rd-status-card {
  border-radius: 16px;
  padding: 2rem 1.5rem;
  margin-bottom: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  overflow: hidden;
}

.rooms-rd-status-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at right center, rgba(26, 86, 255, 0.2) 0%, transparent 60%);
  pointer-events: none;
}

.rooms-rd-status-card.pending {
  background: rgba(4, 10, 30, 0.6);
  border: 1px solid rgba(255, 184, 0, 0.3);
}
.rooms-rd-status-card.pending::before {
  background: radial-gradient(circle at right center, rgba(255, 184, 0, 0.15) 0%, transparent 60%);
}

.rooms-rd-status-card.confirmed {
  background: rgba(4, 10, 30, 0.6);
  border: 1px solid rgba(0, 255, 102, 0.3);
}
.rooms-rd-status-card.confirmed::before {
  background: radial-gradient(circle at right center, rgba(0, 255, 102, 0.15) 0%, transparent 60%);
}

.rooms-rd-status-card.declined {
  background: rgba(4, 10, 30, 0.6);
  border: 1px solid rgba(255, 51, 102, 0.3);
}
.rooms-rd-status-card.declined::before {
  background: radial-gradient(circle at right center, rgba(255, 51, 102, 0.15) 0%, transparent 60%);
}

.rooms-rd-status-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 1;
}

.rooms-rd-status-label {
  font-family: 'Michroma', sans-serif;
  color: #1a56ff;
  font-size: 0.65rem;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.rooms-rd-status-value {
  font-family: 'Michroma', sans-serif;
  color: white;
  font-size: 1.1rem;
  letter-spacing: 2px;
}

.rooms-rd-status-desc {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.8rem;
  margin-top: 0.2rem;
}

.rooms-rd-status-icon-box {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1;
}

.rooms-rd-status-card.pending .rooms-rd-status-icon-box {
  border: 1px solid rgba(255, 184, 0, 0.4);
  box-shadow: 0 0 20px rgba(255, 184, 0, 0.2), inset 0 0 10px rgba(255, 184, 0, 0.1);
  color: #ffb800;
}

.rooms-rd-status-card.confirmed .rooms-rd-status-icon-box {
  border: 1px solid rgba(0, 255, 102, 0.4);
  box-shadow: 0 0 20px rgba(0, 255, 102, 0.2), inset 0 0 10px rgba(0, 255, 102, 0.1);
  color: #00ff66;
}

.rooms-rd-status-card.declined .rooms-rd-status-icon-box {
  border: 1px solid rgba(255, 51, 102, 0.4);
  box-shadow: 0 0 20px rgba(255, 51, 102, 0.2), inset 0 0 10px rgba(255, 51, 102, 0.1);
  color: #ff3366;
}

.rooms-rd-id-card {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 8px;
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.rooms-rd-id-label {
  font-family: 'Michroma', sans-serif;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.7rem;
  letter-spacing: 1.5px;
}

.rooms-rd-id-value {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Michroma', sans-serif;
  color: #1a56ff;
  font-size: 0.8rem;
  letter-spacing: 1px;
}

.rooms-rd-id-copy {
  cursor: pointer;
  color: rgba(255, 255, 255, 0.6);
  transition: color 0.3s ease;
}

.rooms-rd-id-copy:hover {
  color: white;
}

/* Common Section Card */
.rooms-rd-section-card {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  margin-bottom: 1rem;
  display: flex;
  gap: 1.5rem;
  align-items: stretch;
}

.rooms-rd-section-icon {
  width: 50px;
  height: 50px;
  min-width: 50px;
  border-radius: 12px;
  background: rgba(26, 86, 255, 0.05);
  border: 1px solid rgba(26, 86, 255, 0.2);
  display: flex;
  justify-content: center;
  align-items: center;
  color: rgba(255, 255, 255, 0.6);
}

.rooms-rd-section-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Grid Layouts for Content */
.rooms-rd-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  align-items: center;
}

.rooms-rd-grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
}

.rooms-rd-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.rooms-rd-label {
  font-family: 'Michroma', sans-serif;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.6rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.rooms-rd-value {
  color: white;
  font-size: 0.9rem;
  font-family: 'Michroma', sans-serif;
  letter-spacing: 1px;
}

.rooms-rd-subvalue {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
  margin-top: 0.2rem;
}

.rooms-rd-stars {
  display: flex;
  gap: 0.2rem;
  margin-top: 0.4rem;
}

.rooms-rd-star {
  color: #1a56ff;
  width: 12px;
  height: 12px;
}

/* Price specific */
.rooms-rd-price-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.8rem;
}

.rooms-rd-price-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 1rem 0;
}

.rooms-rd-total-amount {
  color: #1a56ff;
  font-family: 'Michroma', sans-serif;
  font-size: 1.1rem;
  letter-spacing: 1px;
}

/* Payment Proof Status */
.rooms-rd-proof-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: white;
  font-size: 0.9rem;
}

.rooms-rd-proof-icon {
  color: #00ff66;
}

/* Full Width Button */
.rooms-rd-back-btn {
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

.rooms-rd-back-btn:hover {
  background: rgba(26, 86, 255, 0.1);
  border-color: #1a56ff;
}

.rooms-rd-info-card {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 12px;
  padding: 1.2rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.rooms-rd-info-icon {
  width: 24px;
  height: 24px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.8rem;
}

.rooms-rd-info-text {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.8rem;
  line-height: 1.4;
}

@media (max-width: 480px) {
  .rooms-rd-grid-3 {
    grid-template-columns: 1fr;
  }
  .rooms-rd-grid-2 {
    grid-template-columns: 1fr;
  }
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('Reservation Details CSS appended successfully.');
