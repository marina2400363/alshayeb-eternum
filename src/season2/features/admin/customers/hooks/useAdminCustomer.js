import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAdminCustomer } from "../../services/admin.api";

// Full details of ONE customer, fetched only when a row is opened (the list
// response is deliberately lightweight). Works for a customer with no
// Deposits — the history is simply empty.
//   status: "loading" | "ready" | "error"
export default function useAdminCustomer(id) {
  const [status, setStatus] = useState("loading");
  const [customer, setCustomer] = useState(null);
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
    if (!id) return undefined;
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    setCustomer(null);

    fetchAdminCustomer(id, { signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setCustomer(result);
        setStatus("ready");
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        setError(failure);
        setStatus("error");
      });

    return () => controller.abort();
  }, [id, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { status, customer, error, retry };
}
