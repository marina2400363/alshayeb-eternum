import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStatusCounterSettings, saveStatusCounterSettings } from "../../services/admin.api";

// Admin-facing Accepted/Rejected/Pending counter (its own Season2Settings
// document — see admin.api.js). Separate from useAdminSettings on purpose:
// that hook owns the legacy SiteSettings/InstaPay resource, this one owns an
// entirely different backend document.
//   status: "loading" | "ready" | "error"
export default function useStatusCounterSettings() {
  const [status, setStatus] = useState("loading");
  const [counter, setCounter] = useState(null);
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

    fetchStatusCounterSettings({ signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setCounter(result);
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

  const save = useCallback(async (values) => {
    const result = await saveStatusCounterSettings(values);
    setCounter(result);
    return result;
  }, []);

  return { status, counter, error, retry, save };
}
