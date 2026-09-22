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

// The School's Payment Options: the amounts its customers may choose from
// for ANY payment, as many times as they like. Not an installment plan —
// there is no sequence, no count and no total to match. Amounts are free:
// an option may even be larger than the ticket price, and nothing here
// compares them to it.
//
// Every option created here is scoped to `schoolId` by useSchoolPaymentOptions
// — there is no way to create one without a School, matching the backend's
// required schoolId. The list order is the order customers see.
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
    <div className="s2-admin-panel s2-po">
      <span className="s2-admin-eyebrow">Payment options</span>
      <p className="s2-admin-muted-text s2-po-intro">
        The amounts this School&apos;s customers can choose for each payment, in this order.
      </p>

      {status === "loading" && <LoadingState label="Loading payment options" />}
      {status === "error" && <ErrorState title="Couldn't load payment options" message={error?.message} onRetry={retry} />}

      {status === "ready" && (
        <>
          {options.length === 0 ? (
            <p className="s2-admin-muted-text">No payment options yet for this School.</p>
          ) : (
            <ol className="s2-po-list" aria-label="Payment options">
              {options.map((option, index) => {
                const isEditing = editingId === option._id;
                const isBusy = busyId === option._id;
                const number = String(index + 1).padStart(2, "0");
                const name = formatCurrency(option.amount);

                return (
                  <li key={option._id} className={`s2-po-row ${option.enabled ? "" : "is-disabled"}`}>
                    <span className="s2-po-index" aria-hidden="true">
                      {number}
                    </span>

                    {isEditing ? (
                      <div className="s2-po-edit">
                        <label className="s2-po-edit-field">
                          <span className="s2-admin-field-label">Amount</span>
                          <input
                            className="s2-admin-input"
                            type="number"
                            min="1"
                            step="1"
                            value={editDraft.amount}
                            onChange={(event) => setEditDraft((d) => ({ ...d, amount: event.target.value }))}
                          />
                        </label>
                        <label className="s2-po-edit-field">
                          <span className="s2-admin-field-label">Label</span>
                          <input
                            className="s2-admin-input"
                            type="text"
                            value={editDraft.label}
                            placeholder="Optional label"
                            onChange={(event) => setEditDraft((d) => ({ ...d, label: event.target.value }))}
                          />
                        </label>
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
                      </div>
                    ) : (
                      <div className="s2-po-main">
                        <span className="s2-po-amount">{name}</span>
                        {option.label && <span className="s2-po-label">{option.label}</span>}
                      </div>
                    )}

                    {!isEditing && (
                      <div className="s2-po-actions">
                        <label className="s2-po-toggle">
                          <input
                            type="checkbox"
                            checked={option.enabled}
                            disabled={isBusy}
                            onChange={() => handleToggle(option)}
                          />
                          {option.enabled ? "Enabled" : "Disabled"}
                        </label>
                        <button
                          type="button"
                          className="s2-admin-icon-btn"
                          disabled={index === 0 || isBusy}
                          onClick={() => handleMove(option, "up")}
                          aria-label={`Move ${name} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="s2-admin-icon-btn"
                          disabled={index === options.length - 1 || isBusy}
                          onClick={() => handleMove(option, "down")}
                          aria-label={`Move ${name} down`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="s2-admin-icon-btn"
                          disabled={isBusy}
                          onClick={() => startEdit(option)}
                          aria-label={`Edit ${name}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="s2-admin-icon-btn s2-admin-icon-btn--danger"
                          disabled={isBusy}
                          onClick={() => handleDelete(option)}
                          aria-label={`Delete ${name}`}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {rowError && (
            <p className="s2-admin-error-text" role="alert">
              {rowError}
            </p>
          )}

          <form className="s2-po-add-form" onSubmit={handleAdd}>
            <label className="s2-po-edit-field">
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
            </label>
            <label className="s2-po-edit-field">
              <span className="s2-admin-field-label">Label (optional)</span>
              <input
                className="s2-admin-input"
                type="text"
                placeholder="e.g. First deposit"
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
              />
            </label>
            <Button type="submit" variant="secondary" size="sm" disabled={submitting}>
              {submitting ? "Adding…" : "+ Add option"}
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
