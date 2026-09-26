import React, { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import OnboardingStage from "./components/OnboardingStage";
import LoadingState from "../../components/LoadingState";
import ErrorState from "../../components/ErrorState";
import Button from "../../components/Button";
import useCustomer from "./hooks/useCustomer";
import { lookupIncomer } from "../../services/onboarding.api";
import { PATHS } from "./paths";

const SESSION_ENDED_NOTICE = "We couldn't find your registration. Please look it up again.";

// Access/session gate for the Customer Area. It owns ONLY:
//   • no session on arrival → redirect to the Already Registered lookup
//   • signed out from inside → redirect to the Enter Your Experience screen
//   • session, no profile    → re-hydrate through lookup (after a refresh)
//   • profile ready          → render children
// The gate owns every redirect so a sign-out (from anywhere inside) cannot
// race a second navigation.
// Whatever renders as `children` (payment/deposit content, later) can rely on
// useCustomer().customer being set.
export default function CustomerAreaGate({ children }) {
  const { session, customer, signIn, signOut } = useCustomer();
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  // Why the session is going away, when the gate itself is the cause:
  //   "ended"  — the registration no longer exists (lookup → notice)
  //   "lookup" — the customer chose to use a different number
  // null + a previously live session = an explicit sign-out from inside.
  const [exitReason, setExitReason] = useState(null);
  // True once this gate has seen a live session, so "session went away" can be
  // told apart from "arrived without one".
  const hadSession = useRef(Boolean(session));
  if (session) hadSession.current = true;

  const phone = session?.phone;
  const needsHydration = Boolean(phone) && !customer;

  useEffect(() => {
    if (!needsHydration) return undefined;

    const controller = new AbortController();
    setError(null);

    lookupIncomer(phone, { signal: controller.signal })
      .then(({ found, customer: fresh }) => {
        if (found) {
          signIn(fresh);
          return;
        }
        // The registration this session pointed at no longer exists.
        setExitReason("ended");
        signOut();
      })
      .catch((failure) => {
        if (failure.kind === "aborted") return;
        setError(failure);
      });

    return () => controller.abort();
  }, [needsHydration, phone, attempt, signIn, signOut]);

  if (!session) {
    if (hadSession.current && exitReason === null) {
      return <Navigate to={PATHS.enter} replace />;
    }

    return (
      <Navigate
        to={PATHS.incomerReturning}
        replace
        state={exitReason === "ended" ? { notice: SESSION_ENDED_NOTICE } : undefined}
      />
    );
  }

  if (customer) return children;

  if (error) {
    return (
      <OnboardingStage progress={0.96}>
        <div className="s2-ob-state">
          <ErrorState
            title="Couldn't open your Customer Area"
            message={error.message}
            onRetry={() => setAttempt((count) => count + 1)}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setExitReason("lookup");
              signOut();
            }}
          >
            Use a different number
          </Button>
        </div>
      </OnboardingStage>
    );
  }

  return (
    <OnboardingStage progress={0.96}>
      <LoadingState label="Opening your Customer Area" />
    </OnboardingStage>
  );
}
