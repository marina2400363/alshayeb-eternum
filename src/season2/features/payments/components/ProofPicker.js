import React, { useRef } from "react";
import { PROOF_ACCEPT_ATTRIBUTE } from "../utils/proof";
import "./ProofPicker.css";

// Choose / preview / replace the payment-proof screenshot. Purely
// presentational — the parent validates, compresses, owns the preview URL
// and its cleanup. Mirrors the architecture of Marina's onboarding
// PhotoPicker (large frame + quiet replace control) but is Sandra's own
// component, tuned for a large, clean proof preview rather than an avatar.
export default function ProofPicker({ previewUrl, processing, error, disabled, onSelect }) {
  const inputRef = useRef(null);
  const hasProof = Boolean(previewUrl);
  const errorId = "s2-pay-proof-error";

  const handleChange = (event) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again (after an error) still fires.
    event.target.value = "";
    if (file) onSelect(file);
  };

  return (
    <div className="s2-pay-proof">
      <span className="s2-pay-eyebrow">Payment proof</span>

      <div className={`s2-pay-proof-frame ${hasProof ? "has-proof" : ""} ${error ? "is-error" : ""}`}>
        {hasProof ? (
          <img className="s2-pay-proof-img" src={previewUrl} alt="Payment proof preview" />
        ) : (
          <div className="s2-pay-proof-empty">No screenshot yet</div>
        )}
        {processing && (
          <div className="s2-pay-proof-busy" role="status">
            <span className="s2-spinner" aria-hidden="true" />
            <span>Preparing your screenshot…</span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        className="s2-pay-sr"
        type="file"
        accept={PROOF_ACCEPT_ATTRIBUTE}
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        type="button"
        className="s2-pay-proof-btn"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || processing}
        aria-describedby={error ? errorId : undefined}
      >
        {hasProof ? "Replace screenshot" : "Choose screenshot"}
      </button>

      {error && (
        <p id={errorId} className="s2-pay-proof-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
