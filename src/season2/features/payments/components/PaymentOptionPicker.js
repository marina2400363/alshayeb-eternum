import React from "react";
import { formatCurrency } from "../utils/formatCurrency";
import "./PaymentOptionPicker.css";

// Editorial selectable list of the customer's own School's enabled Payment
// Options — not generic radio cards. `options` is the backend's final list
// (every enabled option of the School, whatever the amount — see
// payments.api.js's fetchCustomerPaymentOptions), so every option shown here
// is selectable and there is no client-side disabled state to compute.
export default function PaymentOptionPicker({ options, selectedId, onSelect, disabled }) {
  if (!options || options.length === 0) {
    return <p className="s2-pay-options-empty">No payment amounts are available right now. Please check back shortly.</p>;
  }

  return (
    <div className="s2-pay-options" role="radiogroup" aria-label="Choose a payment amount">
      {options.map((option) => {
        const isSelected = option.id === selectedId;

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={`s2-pay-option ${isSelected ? "is-selected" : ""}`}
            disabled={disabled}
            onClick={() => onSelect(option.id)}
          >
            <span className="s2-pay-option-mark" aria-hidden="true" />
            <span className="s2-pay-option-amount">{formatCurrency(option.amount)}</span>
            {option.label && <span className="s2-pay-option-label">{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
