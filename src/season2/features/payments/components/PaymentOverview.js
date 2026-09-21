import React from "react";
import { formatCurrency } from "../utils/formatCurrency";
import "./PaymentOverview.css";

// Editorial payment overview. Product rule (see paymentRoutes.js and
// payments.api.js): the customer sees the FULL TICKET PRICE only — never
// paid/remaining/progress. summary.ticketPrice is the attendee's own
// registration-time snapshot, read-only, never calculated client-side.
// fullPaymentConfirmed is read ONLY from the backend boolean (never inferred
// from arithmetic) and, when true, adds a restrained confirmation line.
export default function PaymentOverview({ summary }) {
  return (
    <section className="s2-pay-overview">
      <div className="s2-pay-rows">
        <div className="s2-pay-row">
          <span className="s2-pay-row-label">Full ticket price</span>
          <span className="s2-pay-row-value">{formatCurrency(summary.ticketPrice)}</span>
        </div>

        {summary.fullPaymentConfirmed && (
          <div className="s2-pay-row">
            <span className="s2-pay-row-label">Status</span>
            <span className="s2-pay-confirmed-value">Payment confirmed</span>
          </div>
        )}
      </div>
    </section>
  );
}
