import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSchools, createSchool, updateSchool } from "../../services/admin.api";

// Loads all Schools and exposes create/update actions that keep local state
// in sync with the server's response (never optimistic — the backend is
// authoritative for name/ticketPrice validation).
//   status: "loading" | "ready" | "error"
export default function useAdminSchools() {
  const [status, setStatus] = useState("loading");
  const [schools, setSchools] = useState([]);
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

    fetchSchools({ signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setSchools(result);
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

  const addSchool = useCallback(async ({ name, ticketPrice }) => {
    const school = await createSchool({ name, ticketPrice });
    setSchools((prev) => [...prev, school].sort((a, b) => a.name.localeCompare(b.name)));
    return school;
  }, []);

  const editSchool = useCallback(async (id, updates) => {
    const school = await updateSchool(id, updates);
    setSchools((prev) => prev.map((item) => (item._id === id ? school : item)));
    return school;
  }, []);

  return { status, schools, error, retry, addSchool, editSchool };
}
