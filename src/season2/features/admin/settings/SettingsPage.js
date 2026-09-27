import React, { useEffect, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import StatusBadge from "../../../components/StatusBadge";
import Button from "../../../components/Button";
import { INSTAPAY_PLACEHOLDER_LINK } from "../services/admin.api";
import useAdminSettings from "./hooks/useAdminSettings";
import useStatusCounterSettings from "./hooks/useStatusCounterSettings";
import "../components/admin-shared.css";
import "./SettingsPage.css";

const COUNTER_FIELDS = [
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "pending", label: "Pending" }
];

// A manually-typed non-negative whole number only (or "" while the field is
// empty) — the same rule the backend enforces, checked here first so Save
// fails fast with a clear message instead of a round trip.
function isValidCount(raw) {
  if (raw === "") return false;
  return /^\d+$/.test(raw);
}

// Customer Status Counter — Accepted/Rejected/Pending display numbers shown
// in the Customer Area. Manually admin-set only: never computed from
// Deposits, Attendees or payment approvals. Its own Season2Settings document
// (useStatusCounterSettings/admin.api.js), entirely separate from the
// InstaPay panel's legacy SiteSettings document below.
function StatusCounterSettings() {
  const { status, counter, error, retry, save } = useStatusCounterSettings();
  const [draft, setDraft] = useState({ accepted: "", rejected: "", pending: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (counter) {
      setDraft({
        accepted: String(counter.accepted ?? 0),
        rejected: String(counter.rejected ?? 0),
        pending: String(counter.pending ?? 0)
      });
    }
  }, [counter]);

  if (status === "loading") {
    return <LoadingState label="Loading status counter" />;
  }

  if (status === "error") {
    return <ErrorState title="Couldn't load the status counter" message={error?.message} onRetry={retry} />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaveError("");
    setSaved(false);

    for (const { key, label } of COUNTER_FIELDS) {
      if (!isValidCount(draft[key])) {
        setSaveError(`${label} must be a non-negative whole number.`);
        return;
      }
    }

    setSaving(true);
    try {
      await save({
        accepted: Number(draft.accepted),
        rejected: Number(draft.rejected),
        pending: Number(draft.pending)
      });
      setSaved(true);
    } catch (failure) {
      setSaveError(failure?.message || "Couldn't save the status counter.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="s2-admin-panel" aria-label="Customer status counter settings" onSubmit={handleSubmit}>
      <span className="s2-admin-eyebrow">Customer status counter</span>
      <p className="s2-admin-muted-text">
        Manually-set numbers shown to customers in the Customer Area. These are display copy only — they are never
        calculated from Deposits, Attendees or payment approvals.
      </p>

      {COUNTER_FIELDS.map(({ key, label }) => (
        <div className="s2-admin-field-row" key={key}>
          <span className="s2-admin-field-label">{label}</span>
          <input
            className="s2-admin-input"
            aria-label={label}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={draft[key]}
            onChange={(event) => {
              setDraft((current) => ({ ...current, [key]: event.target.value }));
              setSaved(false);
            }}
          />
        </div>
      ))}

      <Button type="submit" variant="primary" size="sm" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>

      {saved && <p className="s2-admin-success-text">Saved.</p>}
      {saveError && (
        <p className="s2-admin-error-text" role="alert">
          {saveError}
        </p>
      )}
    </form>
  );
}

// The exact same SiteSettings document and PUT /api/admin/settings endpoint
// the legacy Season 1 admin already writes to — no new settings storage.
export default function SettingsPage() {
  const { status, settings, error, retry, saveLink } = useAdminSettings();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) setDraft(settings.instapayLink === INSTAPAY_PLACEHOLDER_LINK ? "" : settings.instapayLink || "");
  }, [settings]);

  const currentIsPlaceholder = !settings?.instapayLink || settings.instapayLink === INSTAPAY_PLACEHOLDER_LINK;

  async function handleSubmit(event) {
    event.preventDefault();
    setSaveError("");
    setSaved(false);
    setSaving(true);
    try {
      await saveLink(draft.trim());
      setSaved(true);
    } catch (failure) {
      setSaveError(failure?.message || "Couldn't save the InstaPay link.");
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") {
    return <LoadingState label="Loading settings" />;
  }

  if (status === "error") {
    return <ErrorState title="Couldn't load settings" message={error?.message} onRetry={retry} />;
  }

  return (
    <div className="s2-admin-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Settings</h1>
          <p className="s2-admin-page-subtitle">Shared platform settings — read by the Customer Area's InstaPay panel.</p>
        </div>
      </div>

      <form className="s2-admin-panel" aria-label="InstaPay settings" onSubmit={handleSubmit}>
        <span className="s2-admin-eyebrow">InstaPay link</span>

        <div className="s2-settings-current">
          <span className="s2-admin-field-label">Current status</span>
          {currentIsPlaceholder ? (
            <StatusBadge status="pending">Not configured</StatusBadge>
          ) : (
            <StatusBadge status="success">Configured</StatusBadge>
          )}
        </div>

        <div className="s2-admin-field-row">
          <span className="s2-admin-field-label">Link</span>
          <input
            className="s2-admin-input"
            type="text"
            value={draft}
            placeholder="https://ipn.eg/your-real-handle"
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
          />
          <p className="s2-admin-muted-text">
            Customers see this as the "Open InstaPay" link once selected. Leaving it blank keeps it unconfigured — the
            Customer Area shows a clean unavailable state instead of a placeholder.
          </p>
        </div>

        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>

        {saved && <p className="s2-admin-success-text">Saved.</p>}
        {saveError && (
          <p className="s2-admin-error-text" role="alert">
            {saveError}
          </p>
        )}
      </form>

      <StatusCounterSettings />
    </div>
  );
}
