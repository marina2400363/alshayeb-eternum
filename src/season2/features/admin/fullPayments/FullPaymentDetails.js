import React, { useEffect, useState } from "react";
import StatusBadge from "../../../components/StatusBadge";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import { formatDateTime } from "../utils/formatDate";
import { fetchFullPaymentDeposits } from "../services/admin.api";

const DEPOSIT_BADGE = { pending: "pending", approved: "success", rejected: "declined" };
const DEPOSIT_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

function Field({ label, children }) {
  return (
    <div className="s2-fp-field">
      <span className="s2-admin-field-label">{label}</span>
      <span className="s2-fp-value">{children}</span>
    </div>
  );
}

// Everything about ONE customer's money, loaded only when the row is expanded.
// Read-only: it never changes a deposit and never decides anything. The Admin
// compares the numbers and decides. `manualStatus` comes from the row, so the
// badge here always matches the table after a decision.
export default function FullPaymentDetails({ customerId, manualStatus }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: null });
    fetchFullPaymentDeposits(customerId, { signal: controller.signal })
      .then((data) => {
        setState({ status: "ready", data, error: null });
      })
      .catch((failure) => {
        if (failure.kind === "aborted") return;
        setState({ status: "error", data: null, error: failure });
      });
    return () => controller.abort();
  }, [customerId, attempt]);

  if (state.status === "loading") return <LoadingState label="Loading deposits" />;
  if (state.status === "error") {
    return (
      <ErrorState
        title="Couldn't load this customer's deposits"
        message={state.error?.message}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }

  const { customer, summary, deposits } = state.data;

  return (
    <div className="s2-fp-details">
      <section aria-label="Customer information">
        <span className="s2-admin-eyebrow">Customer information</span>
        <div className="s2-fp-grid">
          <Field label="Name">{customer.fullName}</Field>
          <Field label="Phone">{customer.phone || "—"}</Field>
          <Field label="Customer ID">
            <code className="s2-fp-id">{customer.id}</code>
          </Field>
          <Field label={customer.eventName ? "Event" : "School"}>{customer.eventName || customer.schoolName || "—"}</Field>
        </div>
      </section>

      <section aria-label="Financial summary">
        <span className="s2-admin-eyebrow">Financial summary</span>
        <div className="s2-fp-grid">
          <Field label="Full ticket price">{summary.ticketPrice === null ? "—" : formatCurrency(summary.ticketPrice)}</Field>
          <Field label="Total approved deposits">{formatCurrency(summary.approvedTotalPaid)}</Field>
          <Field label="Manual Full Payment status">
            <StatusBadge status={manualStatus === "DONE" ? "success" : "neutral"}>
              {manualStatus === "DONE" ? "DONE" : "NOT DONE"}
            </StatusBadge>
          </Field>
        </div>
        <p className="s2-admin-muted-text">The total counts approved deposits only. It is for information; you decide the status.</p>
      </section>

      <section aria-label="Deposit history">
        <span className="s2-admin-eyebrow">Deposit history</span>
        {deposits.length === 0 ? (
          <p className="s2-admin-muted-text">No deposits submitted yet.</p>
        ) : (
          <ul className="s2-fp-deposits">
            {deposits.map((deposit) => (
              <li key={deposit.id} className={`s2-fp-deposit s2-fp-deposit--${deposit.status}`}>
                <div className="s2-fp-deposit-top">
                  <span className="s2-fp-deposit-title">
                    Deposit #{deposit.number} · {formatCurrency(deposit.amount)}
                  </span>
                  <StatusBadge status={DEPOSIT_BADGE[deposit.status] || "pending"}>
                    {DEPOSIT_LABEL[deposit.status] || deposit.status}
                  </StatusBadge>
                </div>
                <div className="s2-fp-deposit-meta">
                  <span>Submitted {formatDateTime(deposit.submittedAt)}</span>
                  {deposit.approvedAt && <span>Approved {formatDateTime(deposit.approvedAt)}</span>}
                  {deposit.rejectedAt && <span>Rejected {formatDateTime(deposit.rejectedAt)}</span>}
                  {deposit.proofUrl ? (
                    <a className="s2-fp-link" href={deposit.proofUrl} target="_blank" rel="noopener noreferrer">
                      View payment proof
                    </a>
                  ) : (
                    <span>No proof on file</span>
                  )}
                </div>
                {deposit.rejectionReason && <p className="s2-admin-error-text">{deposit.rejectionReason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
