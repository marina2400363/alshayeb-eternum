import React, { useMemo, useState } from "react";

// Searchable multi-select over the existing Schools. Selection is by School id
// only; the same School can belong to any number of events.
export default function SchoolMultiSelect({ schools, selectedIds, onChange, disabled = false }) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const needle = query.trim().toLowerCase();
  const visible = schools.filter((school) => !needle || school.name.toLowerCase().includes(needle));

  function toggle(id) {
    onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
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
        {visible.length === 0 && <p className="s2-admin-muted-text">No schools match.</p>}
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
