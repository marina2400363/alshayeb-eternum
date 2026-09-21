import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAdminSettings, saveInstaPayLink } from "../../services/admin.api";

//   status: "loading" | "ready" | "error"
export default function useAdminSettings() {
  const [status, setStatus] = useState("loading");
  const [settings, setSettings] = useState(null);
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

    fetchAdminSettings({ signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setSettings(result);
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

  const saveLink = useCallback(async (link) => {
    const result = await saveInstaPayLink(link);
    setSettings(result);
    return result;
  }, []);

  return { status, settings, error, retry, saveLink };
}
