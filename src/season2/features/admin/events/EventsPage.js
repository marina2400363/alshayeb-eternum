import React, { useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import Button from "../../../components/Button";
import StatusBadge from "../../../components/StatusBadge";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import useAdminSchools from "../schools/hooks/useAdminSchools";
import useAdminEvents from "./hooks/useAdminEvents";
import EventFormPanel from "./EventFormPanel";
import { EVENT_STATUSES } from "../services/admin.api";
import { STATUS_BADGE, STATUS_LABELS, isMuted } from "./eventStatus";
import "../components/admin-shared.css";
import "./EventsPage.css";

function formatEventWhen(event) {
  const [year, month, day] = event.eventDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
  const [hour, minute] = event.eventTime.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${date} · ${hour12}:${String(minute).padStart(2, "0")} ${suffix} (Cairo)`;
}

function SchoolsCell({ schools }) {
  if (!schools.length) return <span className="s2-admin-muted-text">No schools</span>;
  const shown = schools.slice(0, 2).map((school) => school.name).join(", ");
  const more = schools.length - 2;
  return (
    <span title={schools.map((school) => school.name).join(", ")}>
      {shown}
      {more > 0 && ` +${more}`}
    </span>
  );
}

export default function EventsPage() {
  const { status, events, error, retry, addEvent, editEvent, setThumbnail } = useAdminEvents();
  const { schools, status: schoolsStatus } = useAdminSchools();
  const [mode, setMode] = useState(null); // null | "create" | id of the event being edited
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const editing = mode && mode !== "create" ? events.find((event) => event._id === mode) || null : null;

  async function handleSave(fields, thumbnailFile) {
    setFormError("");
    setSaving(true);
    let saved = null;
    try {
      saved = editing ? await editEvent(editing._id, fields) : await addEvent(fields);
      if (thumbnailFile) {
        await setThumbnail(saved._id, thumbnailFile);
      }
      setMode(null);
    } catch (failure) {
      if (saved) {
        // The event itself is saved; only the thumbnail failed. Keep the form open on it.
        setMode(saved._id);
        setFormError(`Event saved, but the thumbnail was not uploaded: ${failure?.message || "upload failed."}`);
      } else {
        setFormError(failure?.message || "Couldn't save this event.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading" || schoolsStatus === "loading") return <LoadingState label="Loading events" />;
  if (status === "error") return <ErrorState title="Couldn't load events" message={error?.message} onRetry={retry} />;

  const visible = filter ? events.filter((event) => event.status === filter) : events;

  return (
    <div className="s2-admin-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Events</h1>
          <p className="s2-admin-page-subtitle">
            Set up events, their Schools, Outcomer ticket price and dedicated Google Sheet. Nothing here is visible to customers yet.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFormError("");
            setMode(mode === "create" ? null : "create");
          }}
        >
          {mode === "create" ? "Cancel" : "+ New event"}
        </Button>
      </div>

      {mode && (
        <EventFormPanel
          key={mode}
          event={editing}
          schools={schools}
          saving={saving}
          serverError={formError}
          onSave={handleSave}
          onCancel={() => {
            setFormError("");
            setMode(null);
          }}
        />
      )}

      <div className="s2-admin-inline-form">
        <div className="s2-admin-field-row">
          <label className="s2-admin-field-label" htmlFor="ev-filter">Filter by status</label>
          <select id="ev-filter" className="s2-admin-input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            {EVENT_STATUSES.map((value) => (
              <option key={value} value={value}>{STATUS_LABELS[value]}</option>
            ))}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="s2-admin-muted-text">
          {events.length === 0 ? "No events yet. Create one to get started." : "No events with this status."}
        </p>
      ) : (
        <div className="s2-admin-table-overflow">
          <table className="s2-admin-table s2-admin-table--stacks">
            <thead>
              <tr>
                <th>Thumbnail</th>
                <th>Event</th>
                <th>Date &amp; time</th>
                <th>Location</th>
                <th>Schools</th>
                <th>Outcomer price</th>
                <th>Status</th>
                <th>Google Sheet</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event._id} className={isMuted(event.status) ? "s2-events-row--muted" : ""}>
                  <td data-label="Thumbnail">
                    {event.thumbnailUrl ? (
                      <img className="s2-events-thumb" src={event.thumbnailUrl} alt={`${event.name} thumbnail`} loading="lazy" />
                    ) : (
                      <span className="s2-events-thumb s2-events-thumb--empty" aria-label="No thumbnail" />
                    )}
                  </td>
                  <td data-label="Event"><strong>{event.name}</strong></td>
                  <td data-label="Date & time">{formatEventWhen(event)}</td>
                  <td data-label="Location">{event.location}</td>
                  <td data-label="Schools"><SchoolsCell schools={event.schools} /></td>
                  <td data-label="Price">{formatCurrency(event.outcomerTicketPriceEGP)}</td>
                  <td data-label="Status">
                    <StatusBadge status={STATUS_BADGE[event.status]}>{STATUS_LABELS[event.status].toUpperCase()}</StatusBadge>
                  </td>
                  <td data-label="Sheet">
                    {event.sheet?.url ? (
                      <a href={event.sheet.url} target="_blank" rel="noopener noreferrer">Open sheet ↗</a>
                    ) : (
                      <span className="s2-admin-warn-text">No Sheet linked</span>
                    )}
                    <div className="s2-admin-muted-text">Tab: {event.sheet?.tabName || "Sheet1"}</div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="s2-admin-icon-btn"
                      onClick={() => {
                        setFormError("");
                        setMode(event._id);
                      }}
                      aria-label={`Edit ${event.name}`}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
