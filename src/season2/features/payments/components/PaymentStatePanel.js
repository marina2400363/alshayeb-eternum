import React from "react";
import "./PaymentStatePanel.css";

// The customer's single CURRENT payment state when there is nothing to pay
// right now. Deliberately NOT a row, list or table — the customer has no
// payment history, only "where am I now". Carries no amount, date or count.
const STATES = {
  under_review: {
    tone: "pending",
    status: "Pending",
    title: ["Payment", "under review"],
    copy: ["Your payment proof has been received.", "We'll confirm it once it has been reviewed."]
  },
  awaiting_confirmation: {
    tone: "success",
    status: "Approved",
    title: ["Payment", "received"],
    copy: ["Your payment has been approved."]
  },
  full_payment_complete: {
    tone: "success",
    status: "Paid in full",
    title: ["Full payment", "complete"],
    copy: ["Your ticket is fully paid."]
  }
};

export default function PaymentStatePanel({ state }) {
  const content = STATES[state];
  if (!content) return null;

  return (
    <section className={`s2-pay-state s2-pay-state--${content.tone}`} aria-live="polite">
      <span className="s2-pay-state-status">
        <span className="s2-pay-state-dot" aria-hidden="true" />
        {content.status}
      </span>
      <h2 className="s2-pay-state-title">
        {content.title.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </h2>
      <p className="s2-pay-state-copy">
        {content.copy.map((line, index) => (
          <React.Fragment key={line}>
            {index > 0 && <br />}
            {line}
          </React.Fragment>
        ))}
      </p>
    </section>
  );
}
