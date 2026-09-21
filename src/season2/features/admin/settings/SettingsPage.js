import React, { useEffect, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import StatusBadge from "../../../components/StatusBadge";
import Button from "../../../components/Button";
import { INSTAPAY_PLACEHOLDER_LINK } from "../services/admin.api";
import useAdminSettings from "./hooks/useAdminSettings";
import "../components/admin-shared.css";
import "./SettingsPage.css";

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

      <form className="s2-admin-panel" onSubmit={handleSubmit}>
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
    </div>
  );
}
