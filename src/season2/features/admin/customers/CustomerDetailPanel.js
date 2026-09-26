import React, { useEffect } from "react";
import StatusBadge from "../../../components/StatusBadge";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import { customerPhotoThumbUrl } from "../deposits/customerPhoto";
import { formatDate, formatDateTime } from "../utils/formatDate";
import useAdminCustomer from "./hooks/useAdminCustomer";
import "./CustomerDetailPanel.css";

const DEPOSIT_BADGE = { pending: "pending", approved: "success", rejected: "declined" };

function Field({ label, children }) {
  return (
    <div className="s2-cust-field">
      <span className="s2-admin-field-label">{label}</span>
      <span className="s2-cust-value">{children}</span>
    </div>
  );
}

// Slide-over with everything about ONE customer. Loaded only when a row is
// opened (the list is deliberately lightweight). Admin-only: never rendered on
// a customer-facing route. Never shows a Cloudinary publicId — only URLs.
export default function CustomerDetailPanel({ customerId, onClose }) {
  const { status, customer, error, retry } = useAdminCustomer(customerId);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="s2-cust-overlay" onClick={onClose}>
      <aside
        className="s2-cust-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Customer details"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="s2-cust-drawer-header">
          <span className="s2-admin-eyebrow">Customer</span>
          <button type="button" className="s2-admin-icon-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {status === "loading" && <LoadingState label="Loading customer" />}
        {status === "error" && <ErrorState title="Couldn't load this customer" message={error?.message} onRetry={retry} />}

        {status === "ready" && customer && (
          <div className="s2-cust-body">
            <div className="s2-cust-identity">
              {customer.photoUrl ? (
                <a
                  className="s2-cust-photo-link"
                  href={customer.photoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the customer photo full size"
                >
                  <img
                    className="s2-cust-photo"
                    src={customerPhotoThumbUrl(customer.photoUrl)}
                    alt="Registered customer"
                    width="96"
                    height="96"
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              ) : (
                <span className="s2-cust-photo s2-cust-photo--empty" aria-label="No photo on file" />
              )}
              <div>
                <h2 className="s2-cust-name">{customer.fullName}</h2>
                <p className="s2-admin-muted-text">{customer.schoolName || "No school"}</p>
                {customer.photoUrl && (
                  <a className="s2-cust-link" href={customer.photoUrl} target="_blank" rel="noopener noreferrer">
                    View photo full size
                  </a>
                )}
              </div>
            </div>

            <div className="s2-cust-grid">
              <Field label="Customer ID">
                <code className="s2-cust-id">{customer.id}</code>
              </Field>
              <Field label="Phone">{customer.phone || "—"}</Field>
              <Field label="Email">{customer.email || "—"}</Field>
              <Field label="School">{customer.schoolName || "—"}</Field>
              <Field label={`Ticket price ${customer.ticketPriceLocked ? "(locked)" : "(current)"}`}>
                {customer.ticketPrice === null ? "—" : formatCurrency(customer.ticketPrice)}
              </Field>
              <Field label="Registered">{formatDate(customer.registeredAt)}</Field>
            </div>

            <div className="s2-cust-summary">
              <Field label="Approved payments">{customer.approvedPaymentCount}</Field>
              <Field label="Approved total">{formatCurrency(customer.approvedTotalPaid)}</Field>
              <Field label="Full payment">
                {/* The accountant's confirmation (FullPaymentStatus) — never inferred from totals. */}
                <StatusBadge status={customer.fullPayment.complete ? "success" : "neutral"}>
                  {customer.fullPayment.complete ? "Complete" : "Not complete"}
                </StatusBadge>
              </Field>
            </div>

            <section className="s2-cust-history" aria-label="Payment history">
              <span className="s2-admin-eyebrow">Payment history</span>
              {customer.deposits.length === 0 ? (
                <p className="s2-admin-muted-text">No payments yet — this customer hasn't submitted any deposits.</p>
              ) : (
                <ul className="s2-cust-history-list">
                  {customer.deposits.map((deposit) => (
                    <li key={deposit.id} className="s2-cust-history-item">
                      <div className="s2-cust-history-top">
                        <span className="s2-cust-history-amount">
                          {formatCurrency(deposit.amount)}
                          {deposit.label ? <span className="s2-cust-history-label"> · {deposit.label}</span> : null}
                        </span>
                        <StatusBadge status={DEPOSIT_BADGE[deposit.status] || "pending"}>{deposit.status}</StatusBadge>
                      </div>
                      <div className="s2-cust-history-meta">
                        <span>Submitted {formatDateTime(deposit.submittedAt)}</span>
                        {deposit.reviewedAt && <span>Reviewed {formatDateTime(deposit.reviewedAt)}</span>}
                        {deposit.proofUrl && (
                          <a className="s2-cust-link" href={deposit.proofUrl} target="_blank" rel="noopener noreferrer">
                            View proof
                          </a>
                        )}
                      </div>
                      {deposit.status === "rejected" && deposit.rejectionReason && (
                        <p className="s2-admin-error-text">{deposit.rejectionReason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
