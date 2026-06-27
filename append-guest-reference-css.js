const fs = require('fs');

const css = `
/* --- Room Details (Guest Details) Reference Styling --- */
.rooms-details-form-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}

.rooms-detail-box {
  display: flex;
  align-items: center;
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 12px;
  padding: 1.25rem;
  gap: 1.25rem;
  transition: all 0.3s ease;
}

.rooms-detail-box:focus-within {
  background: rgba(26, 86, 255, 0.1);
  border-color: #1a56ff;
  box-shadow: 0 0 15px rgba(26, 86, 255, 0.3);
}

.rooms-detail-icon {
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.rooms-detail-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 0.25rem;
}

.rooms-detail-label {
  font-family: 'Michroma', sans-serif;
  font-size: 0.6rem;
  color: #1a56ff;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.rooms-detail-input {
  background: transparent;
  border: none;
  color: white;
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem;
  padding: 0;
  outline: none;
  width: 100%;
}

.rooms-detail-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.rooms-detail-input:disabled {
  color: rgba(255, 255, 255, 0.8);
}

.rooms-next-btn {
  background: linear-gradient(90deg, #021a5b 0%, #1a56ff 100%);
  border: 1px solid rgba(26, 86, 255, 0.5);
  border-radius: 12px;
  padding: 1.2rem;
  color: white;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 1rem;
  letter-spacing: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.3s ease;
  margin-top: 1.5rem;
}

.rooms-next-btn:disabled {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('Guest Details Custom CSS appended successfully.');
