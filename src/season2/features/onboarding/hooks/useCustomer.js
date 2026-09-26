import { useSyncExternalStore } from "react";
import { subscribe, getSnapshot, setCustomer, clearCustomer } from "../state/customerSession";

// The one way any Season 2 screen reads the signed-in customer.
//   session  — { id, phone } | null   (persisted for the tab)
//   customer — sanitized profile | null (in memory; null until hydrated)
// Customer Area content (Sandra's) reads `customer.id` from here; it must
// render inside <CustomerAreaGate>, which guarantees `customer` is set.
export default function useCustomer() {
  const { session, customer } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    session,
    customer,
    signIn: setCustomer,
    signOut: clearCustomer
  };
}
