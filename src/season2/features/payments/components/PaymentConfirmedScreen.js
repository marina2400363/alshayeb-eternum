import React, { useEffect, useRef } from "react";
import "./PaymentConfirmedScreen.css";

// One-time, fullscreen "PAYMENT CONFIRMED" moment for a single approved
// payment. It is NOT the Full Payment DONE state (that is
// summary.fullPaymentConfirmed, shown by PaymentStatePanel).
//
// It can only be dismissed through OK, and PaymentArea only closes it after
// the backend has recorded the acknowledgement — there is no Escape/backdrop
// dismissal, because closing without the server knowing would bring it back
// on the next visit.
export default function PaymentConfirmedScreen({ acknowledging, error, onAcknowledge }) {
  const okRef = useRef(null);

  useEffect(() => {
    okRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <div
      className="s2-pay-confirmed"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="s2-pay-confirmed-title"
      aria-describedby="s2-pay-confirmed-copy"
    >
      <div className="s2-pay-confirmed-inner">
        <span className="s2-pay-confirmed-mark" aria-hidden="true" />
        <h2 id="s2-pay-confirmed-title" className="s2-pay-confirmed-title">
          <span>Payment</span>
          <span>confirmed</span>
        </h2>
        {/* Deliberately no amount: the customer never sees a previous
            payment, only that the current one went through. */}
        <p id="s2-pay-confirmed-copy" className="s2-pay-confirmed-copy">
          Your payment has been approved.
        </p>

        <div className="s2-pay-confirmed-actions">
          <button
            ref={okRef}
            type="button"
            className="s2-btn s2-btn--primary s2-btn--md s2-pay-confirmed-ok"
            disabled={acknowledging}
            onClick={onAcknowledge}
          >
            {acknowledging ? "One moment…" : "OK"}
          </button>
          {error && (
            <p className="s2-pay-confirmed-error" role="alert">
              We couldn't save that just now. Tap OK to try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
