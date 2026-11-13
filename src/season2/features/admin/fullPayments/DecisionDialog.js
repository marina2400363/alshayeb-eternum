import React, { useEffect, useRef, useState } from "react";
import Button from "../../../components/Button";
import { formatCurrency } from "../../payments/utils/formatCurrency";

// Individual confirmation for ONE customer's manual decision. It names the
// customer, explains what the action does, and can only be confirmed by an
// explicit click. It never looks at the amounts to allow or block anything —
// they are shown purely so the Admin can see what they are deciding on.
//   mode: "done" | "revoke"
export default function DecisionDialog({ mode, customer, onCancel, onConfirm }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false); // blocks a double-click from sending twice
  const isDone = mode === "done";

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" && !inFlight.current) onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(customer);
    } catch (failure) {
      setError(failure?.message || "Couldn't save this decision. Nothing was changed.");
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="s2-fp-overlay" onClick={() => !submitting && onCancel()}>
      <div
        className="s2-fp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="s2-fp-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="s2-fp-dialog-title" className="s2-fp-dialog-title">
          {isDone ? "Mark Full Payment DONE?" : "Revoke Full Payment DONE?"}
        </h2>

        <dl className="s2-fp-dialog-who">
          <div>
            <dt>Customer</dt>
            <dd>{customer.fullName}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{customer.phone || "—"}</dd>
          </div>
          <div>
            <dt>Customer ID</dt>
            <dd>
              <code className="s2-fp-id">{customer.id}</code>
            </dd>
          </div>
          <div>
            <dt>Full ticket price</dt>
            <dd>{customer.ticketPrice === null ? "—" : formatCurrency(customer.ticketPrice)}</dd>
          </div>
          <div>
            <dt>Total approved deposits</dt>
            <dd>{formatCurrency(customer.approvedTotalPaid)}</dd>
          </div>
        </dl>

        {isDone ? (
          <p className="s2-fp-dialog-text">
            This manually confirms that <strong>{customer.fullName}</strong> has completed their Full Payment. It is your
            decision alone: the amounts above are not checked. The customer&apos;s area will show their payment as
            complete, and they will no longer be able to submit new deposits. This is recorded with your admin name and
            the time.
          </p>
        ) : (
          <p className="s2-fp-dialog-text">
            This removes the DONE decision for <strong>{customer.fullName}</strong> only. They will show as NOT DONE and
            will be able to submit deposits again. This is recorded with your admin name and the time.
          </p>
        )}

        {error && (
          <p className="s2-admin-error-text" role="alert">
            {error}
          </p>
        )}

        <div className="s2-admin-action-row">
          <Button variant="primary" size="sm" onClick={confirm} disabled={submitting}>
            {submitting ? "Saving…" : isDone ? "Confirm — mark DONE" : "Confirm — revoke DONE"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
