import React, { useEffect, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import Button from "../../../components/Button";
import useAdminSchools from "../schools/hooks/useAdminSchools";
import useFinanceConfigs from "./hooks/useFinanceConfigs";
import "../components/admin-shared.css";
import "./FinancePage.css";

const EMPTY_DRAFT = { googleSheetUrl: "", tabName: "Sheet1", enabled: true };

// Admin-only canonical link for a stored spreadsheet id. Customers never see
// a Google Sheet link anywhere.
function sheetUrlFor(googleSheetId) {
  return googleSheetId ? `https://docs.google.com/spreadsheets/d/${googleSheetId}/edit` : null;
}

function formatDateTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SyncResultBanner({ result }) {
  if (!result) return null;
  if (result.success) {
    return (
      <p className="s2-admin-success-text" role="status">
        Success — {result.syncedCount ?? 0} row(s) synced
        {result.updated !== undefined ? `, ${result.updated} updated, ${result.appended} appended` : ""}
        {result.confirmedCount !== undefined ? `, ${result.confirmedCount} confirmed, ${result.unconfirmedCount} not confirmed` : ""}
        {result.skippedWrongSchool?.length ? `, ${result.skippedWrongSchool.length} row(s) skipped (wrong School)` : ""}
        {result.skippedUnknown?.length ? `, ${result.skippedUnknown.length} row(s) skipped (unknown customer id)` : ""}
        {result.duplicateCustomerIds?.length ? `, ${result.duplicateCustomerIds.length} duplicate id(s) ignored` : ""}.
      </p>
    );
  }
  if (result.skipped) {
    return (
      <p className="s2-admin-warn-text" role="status">
        Skipped — {result.reason}
      </p>
    );
  }
  return (
    <p className="s2-admin-error-text" role="alert">
      Failed — {result.error}
    </p>
  );
}

export default function FinancePage() {
  const { status: schoolsStatus, schools, error: schoolsError, retry: retrySchools } = useAdminSchools();
  const { status: configStatus, configs, error: configError, retry: retryConfigs, save, runSheetSync, runFullPaymentSync } =
    useFinanceConfigs();

  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (!selectedId && schools.length > 0) setSelectedId(schools[0]._id);
  }, [schools, selectedId]);

  const selectedSchool = schools.find((s) => s._id === selectedId) || null;
  const selectedConfig = configs.find((c) => String(c.schoolId?._id || c.schoolId) === selectedId) || null;
  const configuredUrl = sheetUrlFor(selectedConfig?.googleSheetId);

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sheetSyncResult, setSheetSyncResult] = useState(null);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [fullPaymentSyncResult, setFullPaymentSyncResult] = useState(null);
  const [fullPaymentSyncing, setFullPaymentSyncing] = useState(false);

  // Switching School starts from a clean slate.
  useEffect(() => {
    setSaveError("");
    setSaved(false);
    setSheetSyncResult(null);
    setFullPaymentSyncResult(null);
  }, [selectedId]);

  // Re-hydrate from the saved config: the stored id is shown back as the
  // canonical link, so the field always round-trips. Kept separate from the
  // reset above so the "Saved." confirmation isn't wiped by the refetch that
  // a save itself triggers.
  useEffect(() => {
    setDraft(
      selectedConfig
        ? {
            googleSheetUrl: sheetUrlFor(selectedConfig.googleSheetId) || "",
            tabName: selectedConfig.tabName || "Sheet1",
            enabled: selectedConfig.enabled
          }
        : EMPTY_DRAFT
    );
  }, [selectedId, selectedConfig?.googleSheetId, selectedConfig?.tabName, selectedConfig?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(event) {
    event.preventDefault();
    setSaveError("");
    setSaved(false);
    setSaving(true);
    try {
      // The server normalizes a full URL or a bare id into the spreadsheet
      // id — the browser never parses it.
      await save(selectedId, draft);
      setSaved(true);
    } catch (failure) {
      setSaveError(failure?.message || "Couldn't save this finance config.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSheetSync() {
    setSheetSyncResult(null);
    setSheetSyncing(true);
    try {
      setSheetSyncResult(await runSheetSync(selectedId));
    } catch (failure) {
      setSheetSyncResult({ success: false, error: failure?.message || "Sync failed." });
    } finally {
      setSheetSyncing(false);
    }
  }

  async function handleFullPaymentSync() {
    setFullPaymentSyncResult(null);
    setFullPaymentSyncing(true);
    try {
      setFullPaymentSyncResult(await runFullPaymentSync(selectedId));
    } catch (failure) {
      setFullPaymentSyncResult({ success: false, error: failure?.message || "Sync failed." });
    } finally {
      setFullPaymentSyncing(false);
    }
  }

  if (schoolsStatus === "loading" || configStatus === "loading") {
    return <LoadingState label="Loading finance config" />;
  }

  if (schoolsStatus === "error") {
    return <ErrorState title="Couldn't load schools" message={schoolsError?.message} onRetry={retrySchools} />;
  }

  if (configStatus === "error") {
    return <ErrorState title="Couldn't load finance config" message={configError?.message} onRetry={retryConfigs} />;
  }

  return (
    <div className="s2-admin-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Finance</h1>
          <p className="s2-admin-page-subtitle">
            One Google Sheet per School. Mongo is the source of truth: syncing writes columns A–H, and the
            accountant's Full Payment column (I) is never overwritten.
          </p>
        </div>
      </div>

      {schools.length === 0 ? (
        <p className="s2-admin-muted-text">No schools yet — create one under Schools first.</p>
      ) : (
        <div className="s2-admin-split">
          <div className="s2-admin-rail" role="listbox" aria-label="Schools">
            {schools.map((school) => {
              const config = configs.find((c) => String(c.schoolId?._id || c.schoolId) === school._id);
              const configured = Boolean(config?.googleSheetId);
              return (
                <button
                  key={school._id}
                  type="button"
                  role="option"
                  aria-selected={school._id === selectedId}
                  className={`s2-admin-rail-item ${school._id === selectedId ? "is-selected" : ""}`}
                  onClick={() => setSelectedId(school._id)}
                >
                  <span className="s2-admin-rail-item-name">{school.name}</span>
                  <span className="s2-admin-rail-item-meta">
                    {configured ? (config.enabled ? "Sheet connected" : "Sheet disabled") : "Not configured"}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedSchool && (
            <div>
              <form className="s2-admin-panel" onSubmit={handleSave}>
                <span className="s2-admin-eyebrow">{selectedSchool.name} — Google Sheet</span>

                <p className={configuredUrl ? "s2-admin-success-text" : "s2-admin-warn-text"}>
                  {configuredUrl ? "Configured" : "Not configured"}
                </p>

                <div className="s2-admin-field-row">
                  <span className="s2-admin-field-label" id="s2-fin-link-label">
                    Google Sheet link
                  </span>
                  <input
                    className="s2-admin-input"
                    aria-labelledby="s2-fin-link-label"
                    value={draft.googleSheetUrl}
                    onChange={(e) => setDraft((d) => ({ ...d, googleSheetUrl: e.target.value }))}
                    placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                  />
                  <p className="s2-admin-muted-text">
                    Paste the whole link from the browser — the spreadsheet ID is extracted and stored for you.
                  </p>
                </div>

                <div className="s2-admin-field-row">
                  <span className="s2-admin-field-label" id="s2-fin-tab-label">
                    Tab name
                  </span>
                  <input
                    className="s2-admin-input"
                    aria-labelledby="s2-fin-tab-label"
                    value={draft.tabName}
                    onChange={(e) => setDraft((d) => ({ ...d, tabName: e.target.value }))}
                    placeholder="Sheet1"
                  />
                </div>

                <label className="s2-fin-toggle">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                  />
                  Sync enabled for this School
                </label>

                <div className="s2-fin-config-actions">
                  <Button type="submit" variant="secondary" size="sm" disabled={saving}>
                    {saving ? "Saving…" : "Save config"}
                  </Button>
                  {configuredUrl && (
                    <a className="s2-fin-open-sheet" href={configuredUrl} target="_blank" rel="noreferrer">
                      Open sheet
                    </a>
                  )}
                </div>

                {saved && !saveError && (
                  <p className="s2-admin-success-text" role="status">
                    Saved.
                  </p>
                )}
                {saveError && (
                  <p className="s2-admin-error-text" role="alert">
                    {saveError}
                  </p>
                )}
              </form>

              <div className="s2-admin-panel">
                <span className="s2-admin-eyebrow">Sync actions</span>
                <p className="s2-admin-muted-text s2-fin-sync-intro">
                  Two separate, deliberate actions — nothing syncs automatically.
                </p>

                <div className="s2-fin-sync-row">
                  <div className="s2-fin-sync-card">
                    <h2 className="s2-fin-sync-title">Customers → Sheet</h2>
                    <p className="s2-admin-muted-text">
                      Writes this School's customers into columns A–H. Column I is left exactly as the accountant
                      left it.
                    </p>
                    <Button variant="primary" size="sm" disabled={sheetSyncing} onClick={handleSheetSync}>
                      {sheetSyncing ? "Syncing…" : "Sync customers to sheet"}
                    </Button>
                    {selectedConfig?.lastSync?.at && (
                      <p className="s2-admin-muted-text">
                        Last sync: {formatDateTime(selectedConfig.lastSync.at)} — {selectedConfig.lastSync.status}
                      </p>
                    )}
                    <SyncResultBanner result={sheetSyncResult} />
                  </div>

                  <div className="s2-fin-sync-card">
                    <h2 className="s2-fin-sync-title">Full Payment → Mongo</h2>
                    <p className="s2-admin-muted-text">
                      Reads column I. Only “DONE” marks a customer fully paid, which stops any further payment.
                    </p>
                    <Button variant="secondary" size="sm" disabled={fullPaymentSyncing} onClick={handleFullPaymentSync}>
                      {fullPaymentSyncing ? "Syncing…" : "Sync full payment from sheet"}
                    </Button>
                    <SyncResultBanner result={fullPaymentSyncResult} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
