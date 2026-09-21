import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDeposits, approveDeposit, rejectDeposit } from "../../services/admin.api";

// Loads the Deposit Review queue for one status filter ("" = all) and
// exposes approve/reject actions. Never recomputes approval math client-
// side — every action calls the backend and refetches the authoritative
// list afterward.
//   status: "loading" | "ready" | "error"   (network/load state — distinct
//     from the `statusFilter` parameter, which is which Deposit.status to show)
export default function useAdminDeposits(statusFilter) {
  const [status, setStatus] = useState("loading");
  const [deposits, setDeposits] = useState([]);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    (signal) => {
      setStatus("loading");
      setError(null);

      return fetchDeposits({ status: statusFilter || undefined }, { signal })
        .then((result) => {
          if (!mounted.current) return;
          setDeposits(result);
          setStatus("ready");
        })
        .catch((failure) => {
          if (failure.kind === "aborted" || !mounted.current) return;
          setError(failure);
          setStatus("error");
        });
    },
    [statusFilter]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const refetch = retry;

  const approve = useCallback(
    async (id) => {
      try {
        return await approveDeposit(id);
      } finally {
        // Refetch even on failure (409 already-reviewed, 422 overpayment):
        // the deposit's real current state may have changed under us
        // (someone else reviewed it, or the ticket price changed), and the
        // list should never keep showing it as still-pending after a
        // conflict.
        await load();
      }
    },
    [load]
  );

  const reject = useCallback(
    async (id, rejectionReason) => {
      try {
        return await rejectDeposit(id, { rejectionReason });
      } finally {
        await load();
      }
    },
    [load]
  );

  return { status, deposits, error, retry, refetch, approve, reject };
}
