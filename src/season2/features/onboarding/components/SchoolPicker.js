import React, { useMemo, useState } from "react";
import { TextField } from "./Field";
import { CheckIcon } from "./icons";

// Above this many schools a search box earns its place; below it the list is
// short enough to scan.
const SEARCH_THRESHOLD = 8;

// Single-choice list of the Admin-managed schools. Native radios underneath,
// so arrow keys, Tab and screen readers behave as a proper radio group. Shows
// school NAMES only.
export default function SchoolPicker({ schools, value, onChange, error }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return schools;
    return schools.filter((school) => school.name.toLowerCase().includes(needle));
  }, [schools, query]);

  const errorId = "school-error";

  return (
    <div className="s2-ob-schoolpicker">
      {schools.length >= SEARCH_THRESHOLD && (
        <TextField
          id="school-search"
          label="Search schools"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      )}

      <fieldset className="s2-ob-fieldset" aria-describedby={error ? errorId : undefined}>
        <legend className="s2-ob-label">School</legend>
        <div className={`s2-ob-schools ${value ? "has-selection" : ""}`}>
          {visible.map((school) => (
            <label className="s2-ob-school" key={school.id}>
              <input
                className="s2-ob-sr s2-ob-school-input"
                type="radio"
                name="school"
                value={school.id}
                checked={value === school.id}
                onChange={() => onChange(school)}
              />
              <span className="s2-ob-school-card">
                <span className="s2-ob-school-name">{school.name}</span>
                <span className="s2-ob-school-check">
                  <CheckIcon />
                </span>
              </span>
            </label>
          ))}
          {visible.length === 0 && <p className="s2-ob-hint">No schools match “{query.trim()}”.</p>}
        </div>
      </fieldset>

      {error && (
        <p id={errorId} className="s2-ob-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
