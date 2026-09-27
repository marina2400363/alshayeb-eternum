import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStatusCounter } from "../../../services/statusCounter.api";

// Fetches the manually admin-set Accepted/Rejected/Pending counter once on
// mount (and again on retry/reload). No polling: these numbers only change
// when an admin edits them in Settings, so a fresh page load is enough to
// pick up the latest values — never derived from live payment/attendee data.
export default function useStatusCounter() {
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

    fetchStatusCounter({ signal: controller.signal })
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

  return { status, counter, error, retry };
}
