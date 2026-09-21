import React from "react";
import StatusBadge from "../../../components/StatusBadge";
import { formatCurrency } from "../utils/formatCurrency";
import "./DepositHistory.css";

const STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected"
};

// success/pending/declined is the shared status vocabulary StatusBadge.js
// was already written to carry for "registration/payment/deposit states".
const STATUS_BADGE_VARIANT = {
  pending: "pending",
  approved: "success",
  rejected: "declined"
};

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Editorial timeline list — thin separators and typography, not individual
// dashboard cards. Shows only amount, optional label, status, createdAt, and
// rejectionReason when rejected: exactly the customer-safe deposit shape
// payments.api.js returns. No proof URL/publicId/activeSlot/attendeeId/
// paymentOptionId/reviewedBy ever reaches this component to begin with.
export default function DepositHistory({ deposits }) {
  if (!deposits || deposits.length === 0) {
    return <p className="s2-pay-history-empty">No payments yet.</p>;
  }

  // Newest first — the backend returns them in creation (oldest-first) order.
  const ordered = [...deposits].reverse();

  return (
    <ul className="s2-pay-history">
      {ordered.map((deposit) => (
        <li key={deposit.id} className="s2-pay-history-row">
          <div className="s2-pay-history-main">
            <span className="s2-pay-history-amount">{formatCurrency(deposit.amount)}</span>
            <StatusBadge status={STATUS_BADGE_VARIANT[deposit.status] || "pending"}>
              {STATUS_LABEL[deposit.status] || "Pending"}
            </StatusBadge>
          </div>
          <div className="s2-pay-history-meta">
            {deposit.label && <span>{deposit.label}</span>}
            <span>{formatDate(deposit.createdAt)}</span>
          </div>
          {deposit.status === "rejected" && deposit.rejectionReason && (
            <p className="s2-pay-history-reason">{deposit.rejectionReason}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
