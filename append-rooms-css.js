const fs = require('fs');

const css = `
/* --- Room Selection specific styling --- */
.rooms-list-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

.rooms-type-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
}

.rooms-capacity {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.rooms-breakfast-badge {
  font-family: 'Michroma', sans-serif;
  font-size: 0.6rem;
  background: rgba(26, 86, 255, 0.15);
  color: #1a56ff;
  border: 1px solid rgba(26, 86, 255, 0.3);
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.rooms-empty-msg {
  font-family: 'Michroma', sans-serif;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  margin-top: 2rem;
  padding: 2rem;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 12px;
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('Room Selection CSS appended successfully.');
