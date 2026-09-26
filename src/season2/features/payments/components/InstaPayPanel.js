import React from "react";
import { formatCurrency } from "../utils/formatCurrency";
import "./InstaPayPanel.css";

// Reads the real, admin-configured InstaPay destination via useInstaPayLink()
// (backed by the shared /api/settings/public endpoint — see
// payments.api.js). Never hardcodes a link; when none is configured yet
// (link === null), shows an honest unavailable state instead of a fake or
// placeholder destination.
export default function InstaPayPanel({ amount, link }) {
  return (
    <div className="s2-pay-instapay">
      <span className="s2-pay-eyebrow">InstaPay</span>
      <p className="s2-pay-instapay-amount">{formatCurrency(amount)}</p>

      {link ? (
        <>
          <p className="s2-pay-instapay-note">
            Send this amount via InstaPay, then upload your payment screenshot below.
          </p>
          <a className="s2-pay-instapay-link" href={link} target="_blank" rel="noreferrer">
            Open InstaPay
          </a>
        </>
      ) : (
        <p className="s2-pay-instapay-placeholder">
          InstaPay details aren't available right now. Please contact the team before sending a transfer.
        </p>
      )}
    </div>
  );
}
