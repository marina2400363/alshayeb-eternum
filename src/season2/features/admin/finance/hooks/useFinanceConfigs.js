import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchFinanceConfigs,
  saveFinanceConfig,
  syncFinanceSheet,
  syncFullPayment
} from "../../services/admin.api";

// Loads every School's SchoolFinanceConfig in one call (already populated
// with the School name) rather than fetching per-school — the admin's
// School count is small, and this keeps the rail + detail view consistent
// off a single refetch after any write.
//   status: "loading" | "ready" | "error"
export default function useFinanceConfigs() {
  const [status, setStatus] = useState("loading");
  const [configs, setConfigs] = useState([]);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback((signal) => {
    setStatus("loading");
    setError(null);

    return fetchFinanceConfigs({ signal })
      .then((result) => {
        if (!mounted.current) return;
        setConfigs(result);
        setStatus("ready");
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        setError(failure);
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const save = useCallback(
    async (schoolId, updates) => {
      const config = await saveFinanceConfig(schoolId, updates);
      await load();
      return config;
    },
    [load]
  );

  // Both sync actions return their own result to the caller (for an inline
  // success/failure banner) AND refetch the config list afterward, since a
  // successful sheet sync updates lastSync on the config document.
  const runSheetSync = useCallback(
    async (schoolId) => {
      const result = await syncFinanceSheet(schoolId);
      await load();
      return result;
    },
    [load]
  );

  const runFullPaymentSync = useCallback(
    async (schoolId) => {
      const result = await syncFullPayment(schoolId);
      await load();
      return result;
    },
    [load]
  );

  return { status, configs, error, retry, save, runSheetSync, runFullPaymentSync };
}
