import React, { useState } from "react";
import StatusBadge from "../../../components/StatusBadge";
import Button from "../../../components/Button";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import "./DepositDetailPanel.css";

const STATUS_BADGE_VARIANT = { pending: "pending", approved: "success", rejected: "declined" };

function formatDateTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Admin-only surface: shows the uploaded proof image and every field a
// reviewer needs. Deliberately never renders paymentProof.publicId — only
// the url, for the <img> src. This panel is not reachable from any
// customer-facing route.
export default function DepositDetailPanel({ deposit, onApprove, onReject, onClose }) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const attendee = typeof deposit.attendeeId === "object" ? deposit.attendeeId : null;
  const schoolName = attendee?.schoolId && typeof attendee.schoolId === "object" ? attendee.schoolId.name : null;
  const isPending = deposit.status === "pending";

  async function handleApprove() {
    setActionError("");
    setBusy(true);
    try {
      await onApprove(deposit._id);
    } catch (failure) {
      // 409 (already reviewed) and any other refusal surface the backend's
      // own message verbatim — the backend runs the authoritative checks.
      setActionError(failure?.message || "Couldn't approve this deposit.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setActionError("");
    if (!rejectionReason.trim()) {
      setActionError("A rejection reason is required.");
      return;
    }
    setBusy(true);
    try {
      await onReject(deposit._id, rejectionReason.trim());
      setRejecting(false);
      setRejectionReason("");
    } catch (failure) {
      setActionError(failure?.message || "Couldn't reject this deposit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="s2-admin-panel s2-dep-detail">
      <div className="s2-dep-detail-header">
        <span className="s2-admin-eyebrow">Deposit</span>
        {onClose && (
          <button type="button" className="s2-admin-icon-btn" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <div className="s2-dep-detail-grid">
        <div className="s2-dep-field">
          <span className="s2-admin-field-label">Customer</span>
          <span className="s2-dep-value">{attendee?.fullName || "—"}</span>
        </div>
        <div className="s2-dep-field">
          <span className="s2-admin-field-label">Phone</span>
          <span className="s2-dep-value">{attendee?.phone || "—"}</span>
        </div>
        <div className="s2-dep-field">
          <span className="s2-admin-field-label">School</span>
          <span className="s2-dep-value">{schoolName || "—"}</span>
        </div>
        <div className="s2-dep-field">
          {/* Locked at the customer's first payment request; until then it
              follows the School's current price. */}
          <span className="s2-admin-field-label">
            Ticket price {attendee ? (attendee.ticketPriceLocked ? "(locked)" : "(current)") : ""}
          </span>
          <span className="s2-dep-value">{attendee ? formatCurrency(attendee.ticketPrice) : "—"}</span>
        </div>
        <div className="s2-dep-field">
          <span className="s2-admin-field-label">Payment option</span>
          {/* Frozen on the Deposit at submission — never re-read from the
              live PaymentOption, which Admin may since have edited. */}
          <span className="s2-dep-value">
            {formatCurrency(deposit.amount)}
            {deposit.paymentOptionSnapshot?.label ? ` · ${deposit.paymentOptionSnapshot.label}` : ""}
          </span>
        </div>
        <div className="s2-dep-field">
          <span className="s2-admin-field-label">Status</span>
          <StatusBadge status={STATUS_BADGE_VARIANT[deposit.status] || "pending"}>{deposit.status}</StatusBadge>
        </div>
        <div className="s2-dep-field">
          <span className="s2-admin-field-label">Submitted</span>
          <span className="s2-dep-value">{formatDateTime(deposit.createdAt)}</span>
        </div>
        {!isPending && (
          <div className="s2-dep-field">
            <span className="s2-admin-field-label">Reviewed</span>
            <span className="s2-dep-value">{formatDateTime(deposit.reviewedAt)}</span>
          </div>
        )}
      </div>

      {deposit.status === "rejected" && deposit.rejectionReason && (
        <div className="s2-dep-field">
          <span className="s2-admin-field-label">Rejection reason</span>
          <span className="s2-dep-value">{deposit.rejectionReason}</span>
        </div>
      )}

      <div className="s2-dep-proof">
        <span className="s2-admin-field-label">Payment proof</span>
        {deposit.paymentProof?.url ? (
          <img className="s2-dep-proof-image" src={deposit.paymentProof.url} alt="Payment proof screenshot" />
        ) : (
          <p className="s2-admin-muted-text">No proof image on file.</p>
        )}
      </div>

      {/* actionError stays visible even once the panel re-renders with a
          refetched, no-longer-pending deposit (a 409 means someone else
          just reviewed it) — otherwise the explanation would vanish the
          instant the status flips, leaving only a silent read-only view. */}
      {actionError && (
        <p className="s2-admin-error-text" role="alert">
          {actionError}
        </p>
      )}

      {isPending && (
        <div className="s2-dep-actions">
          {!rejecting ? (
            <div className="s2-admin-action-row">
              <Button variant="primary" size="sm" disabled={busy} onClick={handleApprove}>
                {busy ? "Approving…" : "Approve"}
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </div>
          ) : (
            <div className="s2-dep-reject-form">
              <label className="s2-admin-field-row">
                <span className="s2-admin-field-label">Rejection reason</span>
                <textarea
                  className="s2-admin-input"
                  rows={3}
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="e.g. Screenshot did not clearly show the transfer amount."
                />
              </label>
              <div className="s2-admin-action-row">
                <Button variant="primary" size="sm" disabled={busy} onClick={handleReject}>
                  {busy ? "Rejecting…" : "Confirm reject"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setRejecting(false);
                    setRejectionReason("");
                    setActionError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
