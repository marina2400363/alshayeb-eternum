import React, { useEffect, useRef, useState } from "react";
import useCustomer from "../onboarding/hooks/useCustomer";
import LoadingState from "../../components/LoadingState";
import ErrorState from "../../components/ErrorState";
import Button from "../../components/Button";
import PaymentOverview from "./components/PaymentOverview";
import PaymentOptionPicker from "./components/PaymentOptionPicker";
import InstaPayPanel from "./components/InstaPayPanel";
import ProofPicker from "./components/ProofPicker";
import DepositHistory from "./components/DepositHistory";
import usePaymentSummary from "./hooks/usePaymentSummary";
import useCustomerPaymentOptions from "./hooks/useCustomerPaymentOptions";
import useInstaPayLink from "./hooks/useInstaPayLink";
import { processProof } from "./utils/proof";
import { createDeposit } from "../../services/payments.api";
import "./PaymentArea.css";

const MAX_ACTIVE_DEPOSITS = 5;

// Sandra's payment body for the Customer Area. Reads only {id, phone} from
// Marina's session (via useCustomer(), read-only — see that hook's own
// comment: "Customer Area content (Sandra's) reads customer.id from here").
// Owns everything below that: payment overview, choose-payment, InstaPay
// instructions, proof upload/compression and submit, deposit history.
export default function PaymentArea() {
  const { customer } = useCustomer();
  const attendeeId = customer?.id;
  const phone = customer?.phone;

  const {
    status: summaryStatus,
    summary,
    error: summaryError,
    retry: retrySummary,
    refetch: refetchSummary
  } = usePaymentSummary({ attendeeId, phone });

  const {
    status: optionsStatus,
    options,
    error: optionsError,
    retry: retryOptions
  } = useCustomerPaymentOptions({ attendeeId, phone });

  const { link: instaPayLink } = useInstaPayLink();

  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState(null);
  const [proofProcessing, setProofProcessing] = useState(false);
  const [proofError, setProofError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Revoke the current preview URL on unmount, whatever it is at that point.
  const proofPreviewUrlRef = useRef(null);
  useEffect(() => {
    proofPreviewUrlRef.current = proofPreviewUrl;
  }, [proofPreviewUrl]);
  useEffect(
    () => () => {
      if (proofPreviewUrlRef.current) URL.revokeObjectURL(proofPreviewUrlRef.current);
    },
    []
  );

  function clearProof() {
    setProofFile(null);
    setProofPreviewUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return null;
    });
    setProofError("");
  }

  async function handleProofSelect(file) {
    setSubmitError("");
    setProofError("");
    setProofProcessing(true);
    const result = await processProof(file);
    setProofProcessing(false);

    if (result.error) {
      setProofError(result.error);
      return;
    }

    setProofPreviewUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return URL.createObjectURL(result.file);
    });
    setProofFile(result.file);
  }

  function handleSelectOption(optionId) {
    setSubmitError("");
    setSelectedOptionId(optionId);
  }

  async function handleSubmit() {
    if (submitting || !selectedOptionId || !proofFile || !attendeeId || !phone) return;

    setSubmitting(true);
    setSubmitError("");

    try {
      await createDeposit({ attendeeId, phone, paymentOptionId: selectedOptionId, paymentProof: proofFile });
      // Never trust the POST response as the full source of truth — refetch
      // the summary so activeDepositCount/history reflect the server's own
      // recalculation. (Payment Options are not refetched here: only an
      // *approved* deposit can change what fits the customer's — internal,
      // never-exposed — remaining balance, and a fresh deposit starts pending.)
      setSelectedOptionId(null);
      clearProof();
      refetchSummary();
    } catch (failure) {
      // Preserve the chosen option and proof so the customer can retry
      // without redoing the upload.
      setSubmitError(failure?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (summaryStatus === "loading") {
    return <LoadingState label="Loading your payment details" />;
  }

  if (summaryStatus === "error") {
    return (
      <ErrorState
        title="Couldn't load your payment details"
        message={summaryError?.message}
        onRetry={retrySummary}
      />
    );
  }

  const fullPaymentConfirmed = summary.fullPaymentConfirmed;
  const atMaxDeposits = summary.activeDepositCount >= MAX_ACTIVE_DEPOSITS;
  const canSubmitNewDeposit = !fullPaymentConfirmed && !atMaxDeposits;
  const selectedOption = options.find((option) => option.id === selectedOptionId);

  return (
    <div className="s2-pay-area">
      <PaymentOverview summary={summary} />

      {canSubmitNewDeposit && (
        <section className="s2-pay-section">
          <span className="s2-pay-eyebrow">Choose your payment</span>
          {optionsStatus === "loading" && <LoadingState label="Loading payment options" />}
          {optionsStatus === "error" && (
            <ErrorState
              title="Couldn't load payment options"
              message={optionsError?.message}
              onRetry={retryOptions}
            />
          )}
          {optionsStatus === "ready" && (
            <PaymentOptionPicker
              options={options}
              selectedId={selectedOptionId}
              onSelect={handleSelectOption}
              disabled={submitting}
            />
          )}
        </section>
      )}

      {canSubmitNewDeposit && selectedOption && (
        <section className="s2-pay-section s2-pay-reveal">
          <InstaPayPanel amount={selectedOption.amount} link={instaPayLink} />

          <ProofPicker
            previewUrl={proofPreviewUrl}
            processing={proofProcessing}
            error={proofError}
            disabled={submitting}
            onSelect={handleProofSelect}
          />

          {submitError && (
            <p className="s2-pay-submit-error" role="alert">
              {submitError}
            </p>
          )}

          <Button
            className="s2-pay-submit-btn"
            variant="primary"
            size="md"
            disabled={submitting || proofProcessing || !proofFile}
            onClick={handleSubmit}
          >
            {submitting ? "Submitting…" : "Submit deposit"}
          </Button>
        </section>
      )}

      {atMaxDeposits && !fullPaymentConfirmed && (
        <p className="s2-pay-notice">
          You've reached the maximum of 5 active payments. Wait for one to be reviewed before adding another.
        </p>
      )}

      <section className="s2-pay-section">
        <span className="s2-pay-eyebrow">Deposit history</span>
        <DepositHistory deposits={summary.deposits} />
      </section>
    </div>
  );
}
