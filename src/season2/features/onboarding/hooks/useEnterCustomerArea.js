import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import useCustomer from "./useCustomer";
import { PATHS } from "../paths";

// The single onboarding → Customer Area handoff. Used by every successful
// path (lookup found, new registration, duplicate registration).
//
// `replace` keeps the finished form / lookup out of the history stack, so
// Back from the Customer Area cannot re-open a submitted registration.
export default function useEnterCustomerArea() {
  const { signIn } = useCustomer();
  const navigate = useNavigate();

  return useCallback(
    (customer) => {
      signIn(customer);
      navigate(PATHS.customerArea, { replace: true });
    },
    [signIn, navigate]
  );
}
