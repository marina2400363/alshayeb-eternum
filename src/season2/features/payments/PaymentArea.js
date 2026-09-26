import React, { useEffect, useRef, useState } from "react";
import useCustomer from "../onboarding/hooks/useCustomer";
import LoadingState from "../../components/LoadingState";
import ErrorState from "../../components/ErrorState";
import Button from "../../components/Button";
import PaymentOverview from "./components/PaymentOverview";
import PaymentOptionPicker from "./components/PaymentOptionPicker";
import InstaPayPanel from "./components/InstaPayPanel";
import ProofPicker from "./components/ProofPicker";
import PaymentStatePanel from "./components/PaymentStatePanel";
import PaymentConfirmedScreen from "./components/PaymentConfirmedScreen";
import usePaymentSummary from "./hooks/usePaymentSummary";
import useCustomerPaymentOptions from "./hooks/useCustomerPaymentOptions";
import useInstaPayLink from "./hooks/useInstaPayLink";
import { processProof } from "./utils/proof";
import { acknowledgePaymentConfirmation, createDeposit } from "../../services/payments.api";
import "./PaymentArea.css";

// Sandra's payment body for the Customer Area. Reads only {id, phone} from
// Marina's session (via useCustomer(), read-only — see that hook's own
// comment: "Customer Area content (Sandra's) reads customer.id from here").
// Owns everything below that: ticket price (when the School shows it),
// choose-payment, InstaPay instructions, proof upload/compression and submit.
//
// Product rules:
//   • the customer chooses ANY enabled Payment Option of their own School,
//     every time — there is no sequence or plan;
//   • one payment at a time: nothing can be submitted while a payment is
//     under review or awaiting the customer's OK on PAYMENT CONFIRMED;
//   • no payment history — the screen only reflects CURRENT state. Every
//     Deposit still exists server-side for Admin, finance, Sheets and Full
//     Payment.
export default function PaymentArea() {
  const { customer } = useCustomer();
  const attendeeId = customer?.id;
  const phone = customer?.phone;

  const {
    status: summaryStatus,
    summary,
    error: summaryError,
    refreshing: summaryRefreshing,
    retry: retrySummary,
    refetch: refetchSummary
  } = usePaymentSummary({ attendeeId, phone });

  const {
    status: optionsStatus,
    options,
    error: optionsError,
    retry: retryOptions,
    refetch: refetchOptions
  } = useCustomerPaymentOptions({ attendeeId, phone });

  // depositIds the backend has CONFIRMED as acknowledged during this visit.
  // In-memory only (never storage): it just keeps the screen from flashing
  // back while the post-acknowledgement refetch is in flight. The source of
  // truth for "never show again" is the server.
  const [acknowledgedIds, setAcknowledgedIds] = useState(() => new Set());
  // The summary object that was on screen when OK succeeded — the screen
  // stays up until a DIFFERENT (refetched) summary replaces it.
  const [summaryAtAcknowledge, setSummaryAtAcknowledge] = useState(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState(null);

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
      // the summary so the screen reflects the server's own state (it moves
      // to PAYMENT UNDER REVIEW).
      setSelectedOptionId(null);
      clearProof();
      refetchSummary();
    } catch (failure) {
      // Preserve the chosen option and proof so the customer can retry
      // without redoing the upload.
      setSubmitError(failure?.message || "Something went wrong. Please try again.");
      // 409: a payment is already in progress (e.g. from another tab) —
      // refresh so the screen shows it.
      if (failure?.status === 409) refetchSummary();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAcknowledge(confirmation) {
    if (acknowledging || !attendeeId || !phone) return;

    setAcknowledging(true);
    setAcknowledgeError(null);

    try {
      await acknowledgePaymentConfirmation({ attendeeId, phone, depositId: confirmation.depositId });
    } catch (failure) {
      // Stays open — closing without the server knowing would only bring it
      // back next visit.
      setAcknowledgeError(failure);
      setAcknowledging(false);
      return;
    }

    setAcknowledgedIds((previous) => new Set(previous).add(confirmation.depositId));
    setSummaryAtAcknowledge(summary);
    setAcknowledging(false);
    setSubmitError("");
    // Back to a clean payment screen with the School's current options.
    refetchSummary();
    refetchOptions();
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

  const confirmation = summary.paymentConfirmation;
  const confirmationAcknowledged = Boolean(confirmation) && acknowledgedIds.has(confirmation.depositId);
  // If the refetch itself fails, the server has still recorded the OK, so
  // the screen is released onto the (stale but history-free) summary.
  const awaitingRefetch =
    confirmationAcknowledged && summary === summaryAtAcknowledge && !(summaryError && !summaryRefreshing);

  // Shown alone — nothing of the payment screen renders behind it. Held
  // open (in its "One moment…" state) after a successful acknowledgement
  // until the refetched summary arrives, then the normal screen returns.
  if (confirmation && (!confirmationAcknowledged || awaitingRefetch)) {
    return (
      <PaymentConfirmedScreen
        key={confirmation.depositId}
        acknowledging={acknowledging || confirmationAcknowledged}
        error={acknowledgeError}
        onAcknowledge={() => handleAcknowledge(confirmation)}
      />
    );
  }

  const { paymentStatus, latestRejection } = summary;
  const canPay = paymentStatus === "ready";
  const selectedOption = options.find((option) => option.id === selectedOptionId);

  return (
    <div className="s2-pay-area">
      {/* Hidden price: no block at all — and the amount isn't in the API
          response either (see paymentRoutes.js). */}
      {summary.ticketPriceVisible && <PaymentOverview summary={summary} />}

      {!canPay && <PaymentStatePanel state={paymentStatus} />}

      {canPay && latestRejection && (
        <section className="s2-pay-rejected" role="status">
          <span className="s2-pay-rejected-title">Your last payment wasn't accepted</span>
          {latestRejection.reason && <p className="s2-pay-rejected-reason">{latestRejection.reason}</p>}
          <p className="s2-pay-rejected-hint">Choose a payment below to try again.</p>
        </section>
      )}

      {canPay && (
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

      {canPay && selectedOption && (
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
            {submitting ? "Submitting…" : "Submit payment"}
          </Button>
        </section>
      )}
    </div>
  );
}
