import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCustomerPaymentOptions } from "../../../services/payments.api";

// Fetches the calling customer's own School's enabled Payment Options
// (already affordability-filtered server-side). Requires {attendeeId, phone}
// — the same ownership pair every payment endpoint uses — since the option
// list is now School-specific rather than global. Independent of
// usePaymentSummary — see that hook's comment for why these two are never
// coupled: Payment Options failing to load must never take the overview/
// history down with it, and vice versa.
//   status: "loading" | "ready" | "error"
export default function useCustomerPaymentOptions({ attendeeId, phone }) {
  const [status, setStatus] = useState("loading");
  const [options, setOptions] = useState([]);
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
    if (!attendeeId || !phone) return undefined;

    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    fetchCustomerPaymentOptions({ attendeeId, phone }, { signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setOptions(result);
        setStatus("ready");
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        setError(failure);
        setStatus("error");
      });

    return () => controller.abort();
  }, [attendeeId, phone, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const refetch = retry;

  return { status, options, error, retry, refetch };
}
