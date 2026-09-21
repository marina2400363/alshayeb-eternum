import React, { useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import Button from "../../../components/Button";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import useSchoolPaymentOptions from "./hooks/useSchoolPaymentOptions";
import "./PaymentOptionsEditor.css";

function parseAmount(raw) {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

// Every option created here is scoped to `schoolId` by useSchoolPaymentOptions
// — there is no way to create one without a School, matching the backend's
// required schoolId. Amounts are never clamped to <= ticketPrice (the
// backend doesn't enforce that either); instead a quiet warning flags an
// option that customers can never actually be offered once the customer-
// facing affordability filter (see paymentRoutes.js) applies.
export default function PaymentOptionsEditor({ school }) {
  const { status, options, error, retry, addOption, editOption, removeOption, toggleEnabled, moveOption } =
    useSchoolPaymentOptions(school._id);

  const [newAmount, setNewAmount] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ amount: "", label: "" });
  const [rowError, setRowError] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function handleAdd(event) {
    event.preventDefault();
    setFormError("");
    const amount = parseAmount(newAmount);
    if (amount === null) {
      setFormError("Enter a positive amount greater than 0.");
      return;
    }

    setSubmitting(true);
    try {
      await addOption({ amount, label: newLabel.trim() || undefined });
      setNewAmount("");
      setNewLabel("");
    } catch (failure) {
      setFormError(failure?.message || "Couldn't create the payment option.");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(option) {
    setEditingId(option._id);
    setEditDraft({ amount: String(option.amount), label: option.label || "" });
    setRowError("");
  }

  async function saveEdit(id) {
    setRowError("");
    const amount = parseAmount(editDraft.amount);
    if (amount === null) {
      setRowError("Enter a positive amount greater than 0.");
      return;
    }

    setBusyId(id);
    try {
      await editOption(id, { amount, label: editDraft.label.trim() });
      setEditingId(null);
    } catch (failure) {
      setRowError(failure?.message || "Couldn't save this option.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(option) {
    setBusyId(option._id);
    try {
      await toggleEnabled(option._id, !option.enabled);
    } catch {
      // Silently no-op on failure — the list simply reflects the option's
      // last known state; the admin can retry the toggle.
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(option) {
    setBusyId(option._id);
    try {
      await removeOption(option._id);
    } catch (failure) {
      setRowError(failure?.message || "Couldn't delete this option.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(option, direction) {
    setBusyId(option._id);
    try {
      await moveOption(option._id, direction);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="s2-admin-panel">
      <span className="s2-admin-eyebrow">Payment options</span>

      {status === "loading" && <LoadingState label="Loading payment options" />}
      {status === "error" && <ErrorState title="Couldn't load payment options" message={error?.message} onRetry={retry} />}

      {status === "ready" && (
        <>
          {options.length === 0 ? (
            <p className="s2-admin-muted-text">No payment options yet for this School.</p>
          ) : (
            <div className="s2-admin-table-overflow">
              <table className="s2-admin-table s2-po-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Amount</th>
                    <th>Label</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {options.map((option, index) => {
                    const isEditing = editingId === option._id;
                    const isBusy = busyId === option._id;
                    const exceedsTicketPrice = option.amount > school.ticketPrice;

                    return (
                      <tr key={option._id}>
                        <td>
                          <div className="s2-po-reorder">
                            <button
                              type="button"
                              className="s2-admin-icon-btn"
                              disabled={index === 0 || isBusy}
                              onClick={() => handleMove(option, "up")}
                              aria-label={`Move ${formatCurrency(option.amount)} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="s2-admin-icon-btn"
                              disabled={index === options.length - 1 || isBusy}
                              onClick={() => handleMove(option, "down")}
                              aria-label={`Move ${formatCurrency(option.amount)} down`}
                            >
                              ↓
                            </button>
                          </div>
                        </td>

                        {isEditing ? (
                          <>
                            <td>
                              <input
                                className="s2-admin-input"
                                type="number"
                                min="1"
                                step="1"
                                value={editDraft.amount}
                                onChange={(event) => setEditDraft((d) => ({ ...d, amount: event.target.value }))}
                              />
                            </td>
                            <td>
                              <input
                                className="s2-admin-input"
                                type="text"
                                value={editDraft.label}
                                placeholder="Optional label"
                                onChange={(event) => setEditDraft((d) => ({ ...d, label: event.target.value }))}
                              />
                            </td>
                            <td colSpan={2}>
                              <div className="s2-admin-action-row">
                                <button
                                  type="button"
                                  className="s2-admin-icon-btn"
                                  disabled={isBusy}
                                  onClick={() => saveEdit(option._id)}
                                >
                                  {isBusy ? "Saving…" : "Save"}
                                </button>
                                <button type="button" className="s2-admin-icon-btn" onClick={() => setEditingId(null)}>
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td data-label="Amount">
                              <span className="s2-po-amount">{formatCurrency(option.amount)}</span>
                              {exceedsTicketPrice && (
                                <span className="s2-po-warn" title="Above this School's full ticket price — customers will never be offered this option.">
                                  ⚠ above ticket price
                                </span>
                              )}
                            </td>
                            <td data-label="Label">{option.label || <span className="s2-admin-muted-text">—</span>}</td>
                            <td data-label="Status">
                              <label className="s2-po-toggle">
                                <input
                                  type="checkbox"
                                  checked={option.enabled}
                                  disabled={isBusy}
                                  onChange={() => handleToggle(option)}
                                />
                                {option.enabled ? "Enabled" : "Disabled"}
                              </label>
                            </td>
                            <td data-label="Actions">
                              <div className="s2-admin-action-row">
                                <button type="button" className="s2-admin-icon-btn" disabled={isBusy} onClick={() => startEdit(option)}>
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="s2-admin-icon-btn s2-admin-icon-btn--danger"
                                  disabled={isBusy}
                                  onClick={() => handleDelete(option)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rowError && (
            <p className="s2-admin-error-text" role="alert">
              {rowError}
            </p>
          )}

          <form className="s2-admin-inline-form s2-po-add-form" onSubmit={handleAdd}>
            <div className="s2-admin-field-row">
              <span className="s2-admin-field-label">New amount</span>
              <input
                className="s2-admin-input"
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 500"
                value={newAmount}
                onChange={(event) => setNewAmount(event.target.value)}
              />
            </div>
            <div className="s2-admin-field-row">
              <span className="s2-admin-field-label">Label (optional)</span>
              <input
                className="s2-admin-input"
                type="text"
                placeholder="e.g. First deposit"
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={submitting}>
              {submitting ? "Adding…" : "Add option"}
            </Button>
          </form>
          {formError && (
            <p className="s2-admin-error-text" role="alert">
              {formError}
            </p>
          )}
        </>
      )}
    </div>
  );
}
