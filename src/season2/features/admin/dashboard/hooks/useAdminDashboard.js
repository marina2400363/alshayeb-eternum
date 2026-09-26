import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAdminDashboard } from "../../services/admin.api";

// Loads the Dashboard overview (KPIs, per-School breakdown, recent activity).
// Every number is computed by the backend from MongoDB — nothing is derived
// or re-summed here.
//   status: "loading" | "ready" | "error"
export default function useAdminDashboard() {
  const [status, setStatus] = useState("loading");
  const [dashboard, setDashboard] = useState(null);
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

    fetchAdminDashboard({ signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setDashboard(result);
        setStatus("ready");
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        setError(failure);
        setStatus("error");
      });

    return () => controller.abort();
  }, [attempt]);

  const refresh = useCallback(() => setAttempt((count) => count + 1), []);

  return { status, dashboard, error, refresh };
}
