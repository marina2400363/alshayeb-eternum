import React, { useEffect, useState } from "react";
import Button from "../../../components/Button";
import SchoolMultiSelect from "./SchoolMultiSelect";
import { EVENT_STATUSES } from "../services/admin.api";
import { STATUS_LABELS } from "./eventStatus";

const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;
const THUMBNAIL_TYPES = ["image/png", "image/jpeg", "image/webp"];

const EMPTY = {
  name: "",
  eventDate: "",
  eventTime: "",
  location: "",
  price: "",
  status: "COMING_SOON",
  schoolIds: [],
  sheetUrl: "",
  sheetTabName: "Sheet1"
};

function draftFrom(event) {
  if (!event) return EMPTY;
  return {
    name: event.name,
    eventDate: event.eventDate,
    eventTime: event.eventTime,
    location: event.location,
    price: String(event.outcomerTicketPriceEGP),
    status: event.status,
    schoolIds: event.schoolIds || [],
    sheetUrl: event.sheet?.url || "",
    sheetTabName: event.sheet?.tabName || "Sheet1"
  };
}

// Create / edit form. Server validation is authoritative; the checks here only
// give the Admin faster feedback.
export default function EventFormPanel({
  event,
  schools,
  schoolsStatus = "ready",
  schoolsError = null,
  onRetrySchools,
  onSave,
  onCancel,
  saving,
  serverError
}) {
  const [draft, setDraft] = useState(() => draftFrom(event));
  const [thumbnail, setThumbnail] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!thumbnail) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(thumbnail);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [thumbnail]);

  const set = (key) => (e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }));

  function handleFile(e) {
    const file = e.target.files?.[0];
    setError("");
    if (!file) {
      setThumbnail(null);
      return;
    }
    if (!THUMBNAIL_TYPES.includes(file.type)) {
      setError("Thumbnail must be a PNG, JPG or WebP image.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      setError("Thumbnail must be 4MB or smaller.");
      e.target.value = "";
      return;
    }
    setThumbnail(file);
  }

  function handleSubmit(submitEvent) {
    submitEvent.preventDefault();
    setError("");
    const price = Number(draft.price);
    if (draft.name.trim().length < 2) return setError("Event name is required.");
    if (!draft.eventDate) return setError("Event date is required.");
    if (!draft.eventTime) return setError("Event time is required.");
    if (draft.location.trim().length < 2) return setError("Event location is required.");
    if (!Number.isFinite(price) || price <= 0) return setError("Outcomer ticket price must be greater than 0 EGP.");
    if (!draft.sheetUrl.trim()) return setError("A dedicated Google Sheet link or ID is required.");

    return onSave(
      {
        name: draft.name.trim(),
        eventDate: draft.eventDate,
        eventTime: draft.eventTime,
        location: draft.location.trim(),
        outcomerTicketPriceEGP: price,
        status: draft.status,
        schoolIds: draft.schoolIds,
        sheetUrl: draft.sheetUrl.trim(),
        sheetTabName: draft.sheetTabName.trim() || "Sheet1"
      },
      thumbnail
    );
  }

  const shownError = error || serverError;
  const currentThumb = preview || event?.thumbnailUrl || null;

  return (
    <form className="s2-admin-panel s2-events-form" onSubmit={handleSubmit} aria-label={event ? "Edit event" : "Create event"}>
      <span className="s2-admin-eyebrow">{event ? "Edit event" : "New event"}</span>

      <div className="s2-events-form-grid">
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-name">Event name</label>
          <input id="ev-name" className="s2-admin-input" value={draft.name} onChange={set("name")} maxLength={120} />
        </div>
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-location">Location</label>
          <input id="ev-location" className="s2-admin-input" value={draft.location} onChange={set("location")} maxLength={200} />
        </div>
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-date">Date</label>
          <input id="ev-date" className="s2-admin-input" type="date" value={draft.eventDate} onChange={set("eventDate")} />
        </div>
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-time">Start time (Egypt time)</label>
          <input id="ev-time" className="s2-admin-input" type="time" value={draft.eventTime} onChange={set("eventTime")} />
        </div>
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-price">Outcomer ticket price (EGP)</label>
          <input id="ev-price" className="s2-admin-input" type="number" min="0.01" step="0.01" value={draft.price} onChange={set("price")} />
        </div>
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-status">Status</label>
          <select id="ev-status" className="s2-admin-input" value={draft.status} onChange={set("status")}>
            {EVENT_STATUSES.map((status) => (
              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="s2-admin-field-row">
        <span className="s2-admin-field-label">Participating Schools</span>
        <SchoolMultiSelect
          schools={schools}
          selectedIds={draft.schoolIds}
          onChange={(schoolIds) => setDraft((prev) => ({ ...prev, schoolIds }))}
          disabled={saving}
          loadStatus={schoolsStatus}
          loadError={schoolsError}
          onRetry={onRetrySchools}
        />
      </div>

      <div className="s2-events-form-grid">
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-sheet">Dedicated Google Sheet (link or ID)</label>
          <input id="ev-sheet" className="s2-admin-input" value={draft.sheetUrl} onChange={set("sheetUrl")} placeholder="https://docs.google.com/spreadsheets/d/..." />
          <p className="s2-admin-muted-text">Must be a new Sheet used only for this event, not a School Finance Sheet.</p>
        </div>
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-tab">Sheet tab name</label>
          <input id="ev-tab" className="s2-admin-input" value={draft.sheetTabName} onChange={set("sheetTabName")} maxLength={100} />
        </div>
      </div>

      <div className="s2-admin-field-row">
        <label className="s2-admin-field-label" htmlFor="ev-thumb">Thumbnail (PNG, JPG or WebP, up to 4MB)</label>
        <div className="s2-events-thumb-row">
          {currentThumb && <img className="s2-events-thumb s2-events-thumb--lg" src={currentThumb} alt="Event thumbnail preview" />}
          <input id="ev-thumb" className="s2-admin-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} disabled={saving} />
        </div>
      </div>

      <p className="s2-admin-muted-text">
        Saving an event only stores its setup. It does not publish the event or open ticket sales.
      </p>

      {shownError && <p className="s2-admin-error-text" role="alert">{shownError}</p>}

      <div className="s2-admin-action-row">
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? "Saving..." : event ? "Save changes" : "Create event"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}
