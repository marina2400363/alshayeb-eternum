import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAdminEvents,
  createAdminEvent,
  updateAdminEvent,
  uploadAdminEventThumbnail
} from "../../services/admin.api";

// Loads every event (all statuses) and keeps local state in sync with the
// server's responses — never optimistic; the backend validates.
//   status: "loading" | "ready" | "error"
export default function useAdminEvents() {
  const [status, setStatus] = useState("loading");
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    fetchAdminEvents({ signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setEvents(result);
        setStatus("ready");
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        setError(failure);
        setStatus("error");
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const sortEvents = (list) => [...list].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const upsert = useCallback((event) => {
    setEvents((prev) => sortEvents(prev.some((item) => item._id === event._id) ? prev.map((item) => (item._id === event._id ? event : item)) : [...prev, event]));
  }, []);

  const addEvent = useCallback(async (fields) => {
    const event = await createAdminEvent(fields);
    upsert(event);
    return event;
  }, [upsert]);

  const editEvent = useCallback(async (id, fields) => {
    const event = await updateAdminEvent(id, fields);
    upsert(event);
    return event;
  }, [upsert]);

  const setThumbnail = useCallback(async (id, file) => {
    const event = await uploadAdminEventThumbnail(id, file);
    upsert(event);
    return event;
  }, [upsert]);

  return { status, events, error, retry, addEvent, editEvent, setThumbnail };
}
