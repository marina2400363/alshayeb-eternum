import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import OnboardingStage, { OnboardingHeading } from "../components/OnboardingStage";
import { PhoneField } from "../components/Field";
import Button from "../../../components/Button";
import useEnterCustomerArea from "../hooks/useEnterCustomerArea";
import { lookupIncomer } from "../../../services/onboarding.api";
import { formatPhoneDisplay, normalizePhone, sanitizePhoneInput } from "../utils/phone";
import { validatePhone } from "../utils/validation";
import { PATHS } from "../paths";

// Already Registered: mobile number → lookup → Customer Area.
//   idle → checking → (found → Customer Area)
//                   | notfound (offer registration / another number)
//                   | error    (connection problem; submitting again retries)
//                   | field error (4xx from the backend, shown on the field)
export default function ReturningLookup() {
  const location = useLocation();
  const enterCustomerArea = useEnterCustomerArea();

  const [phone, setPhone] = useState(() => sanitizePhoneInput(location.state?.phone || ""));
  const [fieldError, setFieldError] = useState("");
  const [status, setStatus] = useState("idle"); // idle | checking | notfound | error
  const [failure, setFailure] = useState({ title: "", message: "" });
  const [searchedPhone, setSearchedPhone] = useState("");
  // One-shot notice handed over by the Customer Area gate ("session ended").
  // It goes away as soon as the customer starts a new attempt.
  const [handoverNotice, setHandoverNotice] = useState(location.state?.notice || "");

  const inputRef = useRef(null);
  const inFlight = useRef(false);
  const controllerRef = useRef(null);

  // Cancel any request still running when the customer leaves the screen.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const resetOutcome = () => {
    if (handoverNotice) setHandoverNotice("");
    if (status === "notfound" || status === "error") setStatus("idle");
    if (fieldError) setFieldError("");
  };

  const handleChange = (event) => {
    setPhone(sanitizePhoneInput(event.target.value));
    resetOutcome();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;

    const invalid = validatePhone(phone);
    if (invalid) {
      setFieldError(invalid);
      setStatus("idle");
      inputRef.current?.focus();
      return;
    }

    inFlight.current = true;
    controllerRef.current = new AbortController();
    setFieldError("");
    setStatus("checking");

    try {
      const { found, customer } = await lookupIncomer(phone, { signal: controllerRef.current.signal });

      if (found) {
        enterCustomerArea(customer);
        return; // navigating away; no further state updates
      }

      setSearchedPhone(normalizePhone(phone));
      setStatus("notfound");
    } catch (error) {
      if (error.kind === "aborted") return;

      if (error.isRetryable) {
        const offline = error.kind === "network" || error.kind === "timeout";
        setFailure({ title: offline ? "Connection problem" : "Something went wrong", message: error.message });
        setStatus("error");
      } else {
        // 4xx: the backend's own message is written for the customer.
        setFieldError(error.message);
        setStatus("idle");
        inputRef.current?.focus();
      }
    } finally {
      inFlight.current = false;
    }
  };

  const tryAnotherNumber = () => {
    setPhone("");
    setStatus("idle");
    setFieldError("");
    inputRef.current?.focus();
  };

  const checking = status === "checking";

  return (
    <OnboardingStage backTo={PATHS.incomer} progress={0.58}>
      <OnboardingHeading
        eyebrow="Already registered"
        title={["Welcome", "back"]}
        lede="Enter the mobile number you registered with."
      />

      {handoverNotice && (
        <div className="s2-ob-notice" role="status">
          <p className="s2-ob-notice-text">{handoverNotice}</p>
        </div>
      )}

      <form className="s2-ob-form" onSubmit={handleSubmit} noValidate aria-busy={checking}>
        <PhoneField
          inputRef={inputRef}
          value={phone}
          onChange={handleChange}
          error={fieldError}
          disabled={checking}
        />
        <Button type="submit" className="s2-ob-cta" disabled={checking}>
          {checking ? "Checking…" : "Continue"}
        </Button>
      </form>

      {status === "notfound" && (
        <div className="s2-ob-notice" role="status">
          <h2 className="s2-ob-notice-title">No registration found</h2>
          <p className="s2-ob-notice-text">
            We couldn't find an Incomer registration for {formatPhoneDisplay(searchedPhone)}.
          </p>
          <div className="s2-ob-notice-actions">
            <Link className="s2-ob-linkbtn s2-ob-linkbtn--arrow" to={PATHS.incomerNew} state={{ phone: searchedPhone }}>
              Register now
            </Link>
            <button type="button" className="s2-ob-linkbtn" onClick={tryAnotherNumber}>
              Try another number
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="s2-ob-notice" role="alert">
          <h2 className="s2-ob-notice-title">{failure.title}</h2>
          <p className="s2-ob-notice-text">{failure.message}</p>
        </div>
      )}
    </OnboardingStage>
  );
}
