import { useCallback, useEffect } from "react";
import { useRegistration } from "../state/RegistrationProvider";

// School list for the registration flow. The provider caches it, so going
// Back to the School step never re-fetches or flashes a spinner.
//   status: "idle" | "loading" | "ready" | "error"
export default function useSchools() {
  const { state, loadSchools } = useRegistration();

  useEffect(() => {
    loadSchools();
  }, [loadSchools]);

  const reload = useCallback(() => loadSchools({ force: true }), [loadSchools]);

  return {
    status: state.schools.status,
    schools: state.schools.items,
    error: state.schools.error,
    reload
  };
}
