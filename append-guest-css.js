const fs = require('fs');

const css = `
/* --- Guest Details specific styling --- */
.rooms-details-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 16px;
  padding: 2rem 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.rooms-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rooms-input-label {
  font-family: 'Michroma', sans-serif;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 1px;
}

.rooms-input-field {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(26, 86, 255, 0.3);
  border-radius: 8px;
  padding: 1rem;
  color: white;
  font-family: 'Inter', sans-serif;
  font-size: 1rem;
  transition: all 0.3s ease;
}

.rooms-input-field:focus {
  outline: none;
  background: rgba(26, 86, 255, 0.1);
  border-color: #1a56ff;
  box-shadow: 0 0 10px rgba(26, 86, 255, 0.3);
}

.rooms-input-field::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.rooms-input-field.fixed-field {
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.5);
  border-style: dashed;
  cursor: not-allowed;
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('Guest Details CSS appended successfully.');
