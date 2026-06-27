const fs = require('fs');

const css = `
/* --- My Reservations Styling --- */
.rooms-myres-header {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  margin: 1rem 0 2rem;
}

.rooms-myres-icon {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: 1px solid rgba(26, 86, 255, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 0 15px rgba(26, 86, 255, 0.2);
  color: #1a56ff;
  background: radial-gradient(circle, rgba(26, 86, 255, 0.1) 0%, rgba(4, 10, 30, 0) 70%);
}

.rooms-myres-title-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.rooms-myres-title {
  font-family: 'Michroma', sans-serif;
  color: white;
  font-size: 1.1rem;
  letter-spacing: 2px;
}

.rooms-myres-subtitle {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.85rem;
}

/* Tabs */
.rooms-myres-tabs {
  display: flex;
  border: 1px solid rgba(26, 86, 255, 0.3);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 2rem;
  background: rgba(4, 10, 30, 0.4);
}

.rooms-myres-tab {
  flex: 1;
  padding: 1rem 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Michroma', sans-serif;
  font-size: 0.7rem;
  letter-spacing: 1px;
  cursor: pointer;
  transition: all 0.3s ease;
  border-bottom: 2px solid transparent;
}

.rooms-myres-tab:hover {
  background: rgba(26, 86, 255, 0.05);
}

.rooms-myres-tab.active {
  color: white;
  border-bottom: 2px solid #1a56ff;
  background: radial-gradient(circle at bottom, rgba(26, 86, 255, 0.2) 0%, transparent 70%);
  text-shadow: 0 0 10px rgba(26, 86, 255, 0.5);
}

/* Reservation Card */
.rooms-res-card {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.3);
  border-radius: 16px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}

.rooms-res-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.rooms-res-badge {
  font-family: 'Michroma', sans-serif;
  font-size: 0.6rem;
  padding: 0.4rem 0.8rem;
  border-radius: 20px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.rooms-res-badge.under-review {
  color: #ffb800;
  border: 1px solid #ffb800;
  background: rgba(255, 184, 0, 0.05);
}

.rooms-res-badge.confirmed {
  color: #00ff66;
  border: 1px solid #00ff66;
  background: rgba(0, 255, 102, 0.05);
}

.rooms-res-badge.declined {
  color: #ff3366;
  border: 1px solid #ff3366;
  background: rgba(255, 51, 102, 0.05);
}

.rooms-res-id {
  color: rgba(26, 86, 255, 0.8);
  font-family: 'Michroma', sans-serif;
  font-size: 0.6rem;
  letter-spacing: 1px;
}

/* Hotel Section */
.rooms-res-hotel-row {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.rooms-res-hotel-icon {
  width: 50px;
  height: 50px;
  min-width: 50px;
  border-radius: 12px;
  background: rgba(26, 86, 255, 0.05);
  border: 1px solid rgba(26, 86, 255, 0.2);
  display: flex;
  justify-content: center;
  align-items: center;
  color: rgba(255, 255, 255, 0.8);
}

.rooms-res-hotel-info {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.rooms-res-hotel-name {
  font-family: 'Michroma', sans-serif;
  color: white;
  font-size: 0.95rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.rooms-res-room-type {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.8rem;
}

/* Stay Info Grid */
.rooms-res-stay-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
  padding: 1.5rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 1.5rem;
}

.rooms-res-stay-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.rooms-res-stay-icon {
  color: rgba(255, 255, 255, 0.4);
  margin-top: 2px;
}

.rooms-res-stay-text {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.rooms-res-stay-value {
  color: white;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.rooms-res-stay-label {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.7rem;
}

/* Bottom Row */
.rooms-res-bottom-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.rooms-res-total-col {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.rooms-res-total-label {
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Michroma', sans-serif;
  font-size: 0.55rem;
  letter-spacing: 1px;
}

.rooms-res-total-value {
  color: #1a56ff;
  font-family: 'Michroma', sans-serif;
  font-size: 1rem;
  text-shadow: 0 0 10px rgba(26, 86, 255, 0.3);
  letter-spacing: 1px;
}

.rooms-res-view-btn {
  background: transparent;
  border: 1px solid rgba(26, 86, 255, 0.5);
  border-radius: 8px;
  padding: 0.8rem 1.5rem;
  color: white;
  font-family: 'Michroma', sans-serif;
  font-size: 0.7rem;
  letter-spacing: 1px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.3s ease;
}

.rooms-res-view-btn:hover {
  background: rgba(26, 86, 255, 0.1);
  border-color: #1a56ff;
}

.rooms-lookup-box {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.3);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 2rem;
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('My Reservations CSS appended successfully.');
