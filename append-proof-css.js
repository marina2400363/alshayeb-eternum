const fs = require('fs');

const css = `
/* --- Upload Proof Page Styling --- */
.rooms-upload-card {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 16px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-bottom: 2rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.rooms-upload-dashed-area {
  border: 2px dashed rgba(26, 86, 255, 0.4);
  border-radius: 12px;
  width: 100%;
  padding: 3rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: rgba(26, 86, 255, 0.02);
}

.rooms-upload-dashed-area:hover, .rooms-upload-dashed-area.drag-over {
  background: rgba(26, 86, 255, 0.08);
  border-color: #1a56ff;
  box-shadow: 0 0 15px rgba(26, 86, 255, 0.2);
}

.rooms-upload-icon {
  color: #1a56ff;
  margin-bottom: 1.5rem;
}

.rooms-upload-title {
  color: #1a56ff;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 1.1rem;
  letter-spacing: 1px;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
}

.rooms-upload-subtitle {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.85rem;
  margin-bottom: 2rem;
}

.rooms-upload-formats {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.8rem;
  text-align: center;
  line-height: 1.5;
}

.rooms-info-card {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 2rem;
}

.rooms-info-icon {
  width: 24px;
  height: 24px;
  min-width: 24px;
  border: 1px solid #1a56ff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1a56ff;
  font-size: 1rem;
  font-weight: 500;
}

.rooms-info-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rooms-info-title {
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.9rem;
}

.rooms-info-list {
  list-style-type: disc;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.85rem;
  margin-left: 1.2rem;
  padding: 0;
}

.rooms-info-list li {
  margin-bottom: 0.3rem;
}

.rooms-file-selected {
  color: white;
  font-size: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.rooms-file-selected svg {
  color: #1a56ff;
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('Upload Proof CSS appended successfully.');
