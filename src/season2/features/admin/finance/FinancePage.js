import React, { useEffect, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import Button from "../../../components/Button";
import useAdminSchools from "../schools/hooks/useAdminSchools";
import useFinanceConfigs from "./hooks/useFinanceConfigs";
import "../components/admin-shared.css";
import "./FinancePage.css";

const EMPTY_DRAFT = { googleSheetId: "", tabName: "Sheet1", enabled: true };

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
      <p className="s2-admin-success-text">
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
    return <p className="s2-admin-warn-text">Skipped — {result.reason}</p>;
  }
  return <p className="s2-admin-error-text">Failed — {result.error}</p>;
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

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sheetSyncResult, setSheetSyncResult] = useState(null);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [fullPaymentSyncResult, setFullPaymentSyncResult] = useState(null);
  const [fullPaymentSyncing, setFullPaymentSyncing] = useState(false);

  useEffect(() => {
    setDraft(
      selectedConfig
        ? { googleSheetId: selectedConfig.googleSheetId || "", tabName: selectedConfig.tabName || "Sheet1", enabled: selectedConfig.enabled }
        : EMPTY_DRAFT
    );
    setSaveError("");
    setSheetSyncResult(null);
    setFullPaymentSyncResult(null);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(event) {
    event.preventDefault();
    setSaveError("");
    setSaving(true);
    try {
      await save(selectedId, draft);
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
      const result = await runSheetSync(selectedId);
      setSheetSyncResult(result);
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
      const result = await runFullPaymentSync(selectedId);
      setFullPaymentSyncResult(result);
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
            Mongo is the source of truth. Sync only writes columns A:H — the accountant's Full Payment column (I) is
            never overwritten.
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
                    {config ? (config.enabled ? "Sync enabled" : "Sync disabled") : "Not configured"}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedSchool && (
            <div>
              <form className="s2-admin-panel" onSubmit={handleSave}>
                <span className="s2-admin-eyebrow">{selectedSchool.name} — finance sheet</span>

                <div className="s2-admin-field-row">
                  <span className="s2-admin-field-label">Google Sheet ID</span>
                  <input
                    className="s2-admin-input"
                    value={draft.googleSheetId}
                    onChange={(e) => setDraft((d) => ({ ...d, googleSheetId: e.target.value }))}
                    placeholder="Spreadsheet ID from the sheet's URL"
                  />
                </div>

                <div className="s2-admin-field-row">
                  <span className="s2-admin-field-label">Tab name</span>
                  <input
                    className="s2-admin-input"
                    value={draft.tabName}
                    onChange={(e) => setDraft((d) => ({ ...d, tabName: e.target.value }))}
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

                <Button type="submit" variant="secondary" size="sm" disabled={saving}>
                  {saving ? "Saving…" : "Save config"}
                </Button>

                {saveError && (
                  <p className="s2-admin-error-text" role="alert">
                    {saveError}
                  </p>
                )}
              </form>

              <div className="s2-admin-panel">
                <span className="s2-admin-eyebrow">Sync actions</span>

                <div className="s2-fin-sync-row">
                  <div>
                    <Button variant="primary" size="sm" disabled={sheetSyncing} onClick={handleSheetSync}>
                      {sheetSyncing ? "Syncing…" : "Sync finance to sheet"}
                    </Button>
                    {selectedConfig?.lastSync?.at && (
                      <p className="s2-admin-muted-text">
                        Last sync: {formatDateTime(selectedConfig.lastSync.at)} — {selectedConfig.lastSync.status}
                      </p>
                    )}
                    <SyncResultBanner result={sheetSyncResult} />
                  </div>

                  <div>
                    <Button variant="secondary" size="sm" disabled={fullPaymentSyncing} onClick={handleFullPaymentSync}>
                      {fullPaymentSyncing ? "Syncing…" : "Sync full payment from sheet"}
                    </Button>
                    <p className="s2-admin-muted-text">
                      Reads the accountant's column I ("DONE") and locks further customer submissions.
                    </p>
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
