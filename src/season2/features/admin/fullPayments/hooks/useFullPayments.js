import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFullPayments } from "../../services/admin.api";

// One PAGE of customers for the current search/filters. The server does the
// searching, filtering, counting and paging; this hook only asks for a page and
// keeps the previous rows on screen while the next one loads.
//   status: "loading" | "ready" | "error"
export default function useFullPayments(params) {
  const [status, setStatus] = useState("loading");
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [outcomers, setOutcomers] = useState({ available: false });
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

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    fetchFullPayments(JSON.parse(key), { signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setCustomers(result.customers);
        setPagination(result.pagination);
        setOutcomers(result.outcomers);
        setStatus("ready");
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        setError(failure);
        setStatus("error");
      });

    return () => controller.abort();
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  // Update one row from a server-confirmed decision (never optimistic).
  const patchCustomer = useCallback((id, patch) => {
    setCustomers((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  return { status, customers, pagination, outcomers, error, retry, patchCustomer };
}
