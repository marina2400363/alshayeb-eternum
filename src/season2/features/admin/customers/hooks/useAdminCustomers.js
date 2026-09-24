import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAdminCustomers } from "../../services/admin.api";

// One PAGE of registered customers for the current search/filters. The server
// does the searching, filtering, paging and the per-customer payment numbers —
// this hook only asks for a page and keeps the previous rows on screen while
// the next page loads (no flash of an empty table on every keystroke/click).
//   status: "loading" | "ready" | "error"
export default function useAdminCustomers(params) {
  const [status, setStatus] = useState("loading");
  const [customers, setCustomers] = useState([]);
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

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    fetchAdminCustomers(JSON.parse(key), { signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setCustomers(result.customers);
        setPagination(result.pagination);
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

  return { status, customers, pagination, error, retry };
}
