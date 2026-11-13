import React, { useMemo, useState } from "react";

// Searchable multi-select over the existing Schools. Selection is by School id
// only; the same School can belong to any number of events.
//   loadStatus: "loading" | "ready" | "error" — the Schools list is loaded
//   separately from the event, so a failure here must never read as "no match".
export default function SchoolMultiSelect({
  schools,
  selectedIds,
  onChange,
  disabled = false,
  loadStatus = "ready",
  loadError = null,
  onRetry
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const needle = query.trim().toLowerCase();
  const visible = schools.filter((school) => !needle || school.name.toLowerCase().includes(needle));

  function toggle(id) {
    onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  if (loadStatus === "loading") {
    return (
      <p className="s2-admin-muted-text" role="status">
        Loading Schools…
      </p>
    );
  }

  if (loadStatus === "error") {
    return (
      <div className="s2-events-schools" role="alert">
        <p className="s2-admin-error-text">
          {loadError?.message || "Couldn't load the Schools list."} Your current selection is kept ({selectedIds.length} selected).
        </p>
        <div className="s2-admin-action-row">
          <button type="button" className="s2-admin-icon-btn" onClick={onRetry}>
            Retry loading Schools
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="s2-events-schools">
      <input
        className="s2-admin-input"
        type="search"
        placeholder="Search schools"
        aria-label="Search schools"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
      />
      <div className="s2-events-schools-list" role="group" aria-label="Participating Schools">
        {schools.length === 0 && <p className="s2-admin-muted-text">No Schools exist yet.</p>}
        {schools.length > 0 && visible.length === 0 && <p className="s2-admin-muted-text">No schools match.</p>}
        {visible.map((school) => (
          <label key={school._id} className="s2-events-school-option">
            <input
              type="checkbox"
              checked={selected.has(school._id)}
              onChange={() => toggle(school._id)}
              disabled={disabled}
            />
            <span>{school.name}</span>
          </label>
        ))}
      </div>
      <p className="s2-admin-muted-text">{selectedIds.length} selected</p>
    </div>
  );
}
