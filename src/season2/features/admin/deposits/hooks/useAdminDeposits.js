import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDeposits, approveDeposit, rejectDeposit } from "../../services/admin.api";

// Loads ONE PAGE of the Deposit Review queue for the given filters and exposes
// approve/reject actions. Paging and searching happen on the server, so the
// page in memory is always small however many deposits exist. Never
// recomputes approval math client-side — every action calls the backend and
// refetches the authoritative page afterward.
//   params: { status ("" = all), page, pageSize, q }
//   status: "loading" | "ready" | "error"   (network/load state — distinct
//     from `params.status`, which is which Deposit.status to show)
export default function useAdminDeposits(params) {
  const [status, setStatus] = useState("loading");
  const [deposits, setDeposits] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  // The params object is rebuilt on every render; compare by content.
  const key = JSON.stringify(params);

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

      const { status: statusFilter, page, pageSize, q } = JSON.parse(key);
      return fetchDeposits({ status: statusFilter || undefined, page, pageSize, q }, { signal })
        .then((result) => {
          if (!mounted.current) return;
          setDeposits(result.deposits);
          setPagination(result.pagination);
          setStatus("ready");
        })
        .catch((failure) => {
          if (failure.kind === "aborted" || !mounted.current) return;
          setError(failure);
          setStatus("error");
        });
    },
    [key]
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

  return { status, deposits, pagination, error, retry, refetch, approve, reject };
}
