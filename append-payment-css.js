const fs = require('fs');

const css = `
/* --- Payment Page Styling --- */
.rooms-payment-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

.rooms-summary-card, .rooms-payment-card {
  background: rgba(4, 10, 30, 0.4);
  border: 1px solid rgba(26, 86, 255, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.rooms-card-header-small {
  font-family: 'Michroma', sans-serif;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 1px;
  margin-bottom: 1.5rem;
  text-transform: uppercase;
}

.rooms-summary-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.rooms-summary-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: 'Inter', sans-serif;
  font-size: 0.9rem;
}

.rooms-summary-label {
  color: rgba(255, 255, 255, 0.6);
}

.rooms-summary-value {
  color: white;
  text-align: right;
}

.rooms-summary-value.highlight {
  color: #1a56ff;
}

.rooms-summary-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 1.5rem 0;
}

.rooms-summary-total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: 'Inter', sans-serif;
}

.rooms-summary-total-label {
  color: rgba(255, 255, 255, 0.8);
  font-size: 1rem;
}

.rooms-summary-total-value {
  color: #1a56ff;
  font-size: 1.5rem;
  font-weight: 600;
  text-shadow: 0 0 10px rgba(26, 86, 255, 0.3);
}

.rooms-payment-method-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 2rem;
}

.rooms-payment-method-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.rooms-instapay-icon {
  width: 40px;
  height: 40px;
  background: #501d71;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 0.6rem;
  letter-spacing: 1px;
}

.rooms-payment-method-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.rooms-payment-method-title {
  color: white;
  font-size: 0.95rem;
  font-family: 'Inter', sans-serif;
}

.rooms-payment-method-subtitle {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
}

.rooms-radio-selected {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #1a56ff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rooms-radio-selected-inner {
  width: 10px;
  height: 10px;
  background: #1a56ff;
  border-radius: 50%;
  box-shadow: 0 0 8px #1a56ff;
}

.rooms-payment-instructions-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 2rem;
}

.rooms-instruction-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.rooms-instruction-number {
  width: 24px;
  height: 24px;
  min-width: 24px;
  border: 1px solid #1a56ff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1a56ff;
  font-size: 0.8rem;
  font-weight: 500;
}

.rooms-instruction-text {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.85rem;
  line-height: 1.4;
  padding-top: 0.2rem;
}

.rooms-go-instapay-btn {
  width: 100%;
  background: transparent;
  border: 1px solid rgba(26, 86, 255, 0.4);
  border-radius: 12px;
  padding: 1.2rem;
  color: white;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 0.95rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.3s ease;
  text-decoration: none;
}

.rooms-go-instapay-btn:hover {
  background: rgba(26, 86, 255, 0.1);
  border-color: #1a56ff;
}

.rooms-secure-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.75rem;
  margin-top: 0.5rem;
}

.rooms-confirm-payment-btn {
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
  width: 100%;
  margin-top: 1rem;
}

.rooms-confirm-payment-btn:disabled {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
}
`;

fs.appendFileSync('src/RoomsApp.css', css);
console.log('Payment CSS appended successfully.');
