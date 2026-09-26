import { useSyncExternalStore } from "react";
import { subscribe, getSnapshot, setAdminSession, clearAdminSession } from "../state/adminSession";

// The one way any Admin Portal screen reads/changes the signed-in admin.
//   session — { email, token } | null
export default function useAdminSession() {
  const { session } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    session,
    isAuthenticated: Boolean(session?.token),
    signIn: setAdminSession,
    signOut: clearAdminSession
  };
}
