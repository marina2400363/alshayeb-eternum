import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSchoolPaymentOptions,
  createPaymentOption,
  updatePaymentOption,
  deletePaymentOption
} from "../../services/admin.api";

function byDisplayOrder(a, b) {
  return (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || String(a.createdAt).localeCompare(String(b.createdAt));
}

// Loads and manages one School's Payment Options — every write is
// schoolId-scoped by construction (create always sends the schoolId this
// hook was given; a School's options are never visible from another
// School's instance of this hook). status resets to "loading" whenever
// schoolId changes.
export default function useSchoolPaymentOptions(schoolId) {
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
    if (!schoolId) {
      setOptions([]);
      setStatus("ready");
      return undefined;
    }

    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    fetchSchoolPaymentOptions(schoolId, { signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setOptions([...result].sort(byDisplayOrder));
        setStatus("ready");
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        setError(failure);
        setStatus("error");
      });

    return () => controller.abort();
  }, [schoolId, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const addOption = useCallback(
    async ({ amount, label }) => {
      const nextDisplayOrder = options.length
        ? Math.max(...options.map((o) => o.displayOrder ?? 0)) + 1
        : 1;
      const option = await createPaymentOption({ schoolId, amount, label, enabled: true, displayOrder: nextDisplayOrder });
      setOptions((prev) => [...prev, option].sort(byDisplayOrder));
      return option;
    },
    [schoolId, options]
  );

  const editOption = useCallback(async (id, updates) => {
    const option = await updatePaymentOption(id, updates);
    setOptions((prev) => prev.map((item) => (item._id === id ? option : item)).sort(byDisplayOrder));
    return option;
  }, []);

  const removeOption = useCallback(async (id) => {
    await deletePaymentOption(id);
    setOptions((prev) => prev.filter((item) => item._id !== id));
  }, []);

  const toggleEnabled = useCallback(
    (id, enabled) => editOption(id, { enabled }),
    [editOption]
  );

  // Swaps this option's displayOrder with its immediate neighbor in the
  // current sorted list — a minimal, explicit reorder rather than a
  // drag-and-drop reindex of the whole list.
  const moveOption = useCallback(
    async (id, direction) => {
      const index = options.findIndex((item) => item._id === id);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || targetIndex < 0 || targetIndex >= options.length) return;

      const current = options[index];
      const target = options[targetIndex];
      const currentOrder = current.displayOrder ?? 999;
      const targetOrder = target.displayOrder ?? 999;

      const [updatedCurrent, updatedTarget] = await Promise.all([
        updatePaymentOption(current._id, { displayOrder: targetOrder }),
        updatePaymentOption(target._id, { displayOrder: currentOrder })
      ]);

      setOptions((prev) =>
        prev
          .map((item) => {
            if (item._id === updatedCurrent._id) return updatedCurrent;
            if (item._id === updatedTarget._id) return updatedTarget;
            return item;
          })
          .sort(byDisplayOrder)
      );
    },
    [options]
  );

  return { status, options, error, retry, addOption, editOption, removeOption, toggleEnabled, moveOption };
}
