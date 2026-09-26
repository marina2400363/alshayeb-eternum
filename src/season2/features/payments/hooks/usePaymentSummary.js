import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCustomerPaymentSummary } from "../../../services/payments.api";

// Fetches (and refetches) the customer's payment summary. Independent of
// usePaymentOptions on purpose — Payment Options failing to load must never
// take the overview/history down with it, and vice versa.
//
//   status: "loading" | "ready" | "error"   — "loading" only for the FIRST
//     fetch; once data has loaded once, a retry/refetch never hides it
//     behind a full loading state again — see `refreshing` for that case.
//   refreshing: true while a background refetch (post-submit, or Retry after
//     data already loaded once) is in flight.
export default function usePaymentSummary({ attendeeId, phone }) {
  const [status, setStatus] = useState("loading");
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Bumping this re-runs the effect without changing attendeeId/phone —
  // how Retry and the post-submit refetch both work.
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!attendeeId || !phone) return undefined;

    const controller = new AbortController();
    if (hasLoadedOnce.current) {
      setRefreshing(true);
    } else {
      setStatus("loading");
    }
    setError(null);

    fetchCustomerPaymentSummary({ attendeeId, phone }, { signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        hasLoadedOnce.current = true;
        setSummary(result);
        setStatus("ready");
        setRefreshing(false);
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        setError(failure);
        setRefreshing(false);
        // A background refresh failing after data already loaded once keeps
        // showing the stale (still accurate as of last fetch) summary rather
        // than replacing it with a full error screen.
        if (!hasLoadedOnce.current) setStatus("error");
      });

    return () => controller.abort();
  }, [attendeeId, phone, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  // Same mechanism as retry — refetch just reads better at the post-submit
  // call site.
  const refetch = retry;

  return { status, summary, error, refreshing, retry, refetch };
}
