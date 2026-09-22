import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentArea from "./PaymentArea";
import useCustomer from "../onboarding/hooks/useCustomer";
import * as paymentsApi from "../../services/payments.api";
import { processProof } from "./utils/proof";

jest.mock("../onboarding/hooks/useCustomer");
jest.mock("../../services/payments.api");
jest.mock("./utils/proof", () => ({
  PROOF_ACCEPT_ATTRIBUTE: "image/png,image/jpeg",
  processProof: jest.fn()
}));

const CUSTOMER = { id: "atd1", fullName: "Test User", phone: "01012345678", attendeeType: "incomer" };

// Product rule: the customer-facing summary is CURRENT STATE only. No
// history, no paid/remaining/progress — and the ticket price only when the
// School shows it.
function baseSummary(overrides = {}) {
  return {
    ticketPriceVisible: true,
    ticketPrice: 6000,
    paymentStatus: "ready",
    paymentConfirmation: null,
    latestRejection: null,
    ...overrides
  };
}

// School A: options include one ABOVE the 6000 ticket price.
const OPTIONS = [
  { id: "po-500", amount: 500, label: null },
  { id: "po-1000", amount: 1000, label: null },
  { id: "po-2000", amount: 2000, label: null },
  { id: "po-7000", amount: 7000, label: null }
];

const CONFIRMATION = { depositId: "dep-approved-1" };

// Lets every queued mock promise (and the state updates it triggers) settle.
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function chooseOptionAndUploadProof(name = /^500 EGP/i, file) {
  const optionButton = await screen.findByRole("radio", { name });
  await userEvent.click(optionButton);
  const input = document.querySelector('input[type="file"]');
  await userEvent.upload(input, file || new File(["x"], "screenshot.png", { type: "image/png" }));
  return optionButton;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reassigned fresh every test (not beforeAll): jest.clearAllMocks() clears
  // a jest.fn()'s default implementation along with its call history.
  global.URL.createObjectURL = jest.fn((file) => `blob:${file.name}`);
  global.URL.revokeObjectURL = jest.fn();
  useCustomer.mockReturnValue({
    session: { id: CUSTOMER.id, phone: CUSTOMER.phone },
    customer: CUSTOMER,
    signIn: jest.fn(),
    signOut: jest.fn()
  });
  paymentsApi.fetchInstaPayLink.mockResolvedValue(null);
  paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue(OPTIONS);
});

describe("summary", () => {
  test("shows a loading state while the summary request is in flight", async () => {
    let resolveSummary;
    paymentsApi.fetchCustomerPaymentSummary.mockReturnValue(new Promise((resolve) => (resolveSummary = resolve)));

    render(<PaymentArea />);
    expect(screen.getByText(/Loading your payment details/i)).toBeInTheDocument();

    await act(async () => resolveSummary(baseSummary()));
    await waitFor(() => expect(screen.queryByText(/Loading your payment details/i)).not.toBeInTheDocument());
  });

  test("shows an error with Retry, and Retry re-fetches", async () => {
    paymentsApi.fetchCustomerPaymentSummary
      .mockRejectedValueOnce({ message: "We couldn't reach the server.", kind: "network" })
      .mockResolvedValueOnce(baseSummary());

    render(<PaymentArea />);
    await screen.findByText(/Couldn't load your payment details/i);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Full ticket price");
    expect(paymentsApi.fetchCustomerPaymentSummary).toHaveBeenCalledTimes(2);
    await flush();
  });
});

describe("ticket price visibility", () => {
  test("visible: FULL TICKET PRICE + amount, then CHOOSE YOUR PAYMENT", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());

    render(<PaymentArea />);
    expect(await screen.findByText("Full ticket price")).toBeInTheDocument();
    expect(screen.getByText("6,000 EGP")).toBeInTheDocument();
    expect(screen.getByText("Choose your payment")).toBeInTheDocument();
  });

  test("hidden: no ticket-price block at all — starts at CHOOSE YOUR PAYMENT", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ ticketPriceVisible: false, ticketPrice: null }));

    render(<PaymentArea />);
    expect(await screen.findByText("Choose your payment")).toBeInTheDocument();
    expect(screen.queryByText(/ticket price/i)).not.toBeInTheDocument();
    expect(screen.queryByText("6,000 EGP")).not.toBeInTheDocument();
    expect(document.querySelector(".s2-pay-overview")).toBeNull();
    // Payment still works normally.
    expect(await screen.findByRole("radio", { name: /^7,000 EGP/i })).toBeEnabled();
  });
});

describe("payment options (school-specific, never limited by the ticket price)", () => {
  test("requests options via {attendeeId, phone} — never a School", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());

    render(<PaymentArea />);
    await screen.findByText("Choose your payment");
    expect(paymentsApi.fetchCustomerPaymentOptions.mock.calls[0][0]).toEqual({ attendeeId: "atd1", phone: "01012345678" });
  });

  test("every option is shown and selectable — including 7,000 EGP above a 6,000 EGP ticket", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());

    render(<PaymentArea />);
    for (const name of [/^500 EGP/i, /^1,000 EGP/i, /^2,000 EGP/i, /^7,000 EGP/i]) {
      expect(await screen.findByRole("radio", { name })).toBeEnabled();
    }
    await userEvent.click(screen.getByRole("radio", { name: /^7,000 EGP/i }));
    expect(screen.getByRole("radio", { name: /^7,000 EGP/i })).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText("InstaPay")).toBeInTheDocument();
  });

  test("a DIFFERENT customer (School B) sees School B's options only", async () => {
    useCustomer.mockReturnValue({
      session: { id: "atd-schoolb", phone: "01099998888" },
      customer: { id: "atd-schoolb", fullName: "School B Customer", phone: "01099998888", attendeeType: "incomer" },
      signIn: jest.fn(),
      signOut: jest.fn()
    });
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ ticketPrice: 4500 }));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po-b", amount: 1500, label: null }]);

    render(<PaymentArea />);
    expect(await screen.findByRole("radio", { name: /^1,500 EGP/i })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /^7,000 EGP/i })).not.toBeInTheDocument();
    expect(paymentsApi.fetchCustomerPaymentOptions.mock.calls[0][0]).toEqual({ attendeeId: "atd-schoolb", phone: "01099998888" });
  });

  test("an options-only failure does not take the rest of the screen down", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockRejectedValue({ message: "options down", kind: "network" });

    render(<PaymentArea />);
    await screen.findByText(/Couldn't load payment options/i);
    expect(screen.getByText("6,000 EGP")).toBeInTheDocument();
  });

  test("zero options shows a clean message", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText(/No payment amounts are available/i);
  });
});

describe("InstaPay", () => {
  test("shows the selected amount, the real configured link and an Open InstaPay action", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchInstaPayLink.mockResolvedValue("https://ipn.eg/real-alshayeb-link");

    render(<PaymentArea />);
    await userEvent.click(await screen.findByRole("radio", { name: /^2,000 EGP/i }));

    const link = await screen.findByRole("link", { name: /open instapay/i });
    expect(link).toHaveAttribute("href", "https://ipn.eg/real-alshayeb-link");
  });

  test("no configured link (null) shows a clean unavailable state, never a fake URL", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());

    render(<PaymentArea />);
    await userEvent.click(await screen.findByRole("radio", { name: /^500 EGP/i }));
    expect(await screen.findByText(/aren't available right now/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/instapay\.example/);
  });
});

describe("proof upload", () => {
  test("a processing error is shown and blocks submit", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    processProof.mockResolvedValue({ error: "Please choose a JPG or PNG screenshot." });

    render(<PaymentArea />);
    await chooseOptionAndUploadProof(undefined, new File(["x"], "s.pdf", { type: "application/pdf" }));

    expect(await screen.findByText("Please choose a JPG or PNG screenshot.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit payment/i })).toBeDisabled();
  });

  test("replacing a proof revokes the previous preview URL", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    processProof
      .mockResolvedValueOnce({ file: new File(["x"], "a.jpg", { type: "image/jpeg" }) })
      .mockResolvedValueOnce({ file: new File(["y"], "b.jpg", { type: "image/jpeg" }) });

    render(<PaymentArea />);
    await chooseOptionAndUploadProof(undefined, new File(["x"], "s1.png", { type: "image/png" }));
    await screen.findByAltText(/payment proof preview/i);
    await userEvent.upload(document.querySelector('input[type="file"]'), new File(["y"], "s2.png", { type: "image/png" }));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a.jpg"));
  });
});

describe("submit", () => {
  async function setUpReadyToSubmit(name) {
    const processedFile = new File(["x"], "proof.jpg", { type: "image/jpeg" });
    processProof.mockResolvedValue({ file: processedFile });

    render(<PaymentArea />);
    await chooseOptionAndUploadProof(name);
    const submitButton = await screen.findByRole("button", { name: /submit payment/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    return { submitButton, processedFile };
  }

  test("sends exactly attendeeId, phone, paymentOptionId, proof — never an amount", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.createDeposit.mockResolvedValue({ deposit: { id: "dep1", amount: 7000, status: "pending", createdAt: "x" } });
    const { submitButton, processedFile } = await setUpReadyToSubmit(/^7,000 EGP/i);

    await userEvent.click(submitButton);

    await waitFor(() =>
      expect(paymentsApi.createDeposit).toHaveBeenCalledWith({
        attendeeId: "atd1",
        phone: "01012345678",
        paymentOptionId: "po-7000",
        paymentProof: processedFile
      })
    );
    await flush();
  });

  test("double-submit is guarded", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    let resolveCreate;
    paymentsApi.createDeposit.mockReturnValue(new Promise((resolve) => (resolveCreate = resolve)));
    const { submitButton } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);
    expect(submitButton).toBeDisabled();
    await userEvent.click(submitButton);
    expect(paymentsApi.createDeposit).toHaveBeenCalledTimes(1);

    await act(async () => resolveCreate({ deposit: { id: "dep1", amount: 500, status: "pending", createdAt: "x" } }));
    await flush();
  });

  test("on success the screen moves to PAYMENT UNDER REVIEW and the form is gone", async () => {
    paymentsApi.fetchCustomerPaymentSummary
      .mockResolvedValueOnce(baseSummary())
      .mockResolvedValue(baseSummary({ paymentStatus: "under_review" }));
    paymentsApi.createDeposit.mockResolvedValue({ deposit: { id: "dep1", amount: 500, status: "pending", createdAt: "x" } });
    const { submitButton } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);

    expect(await screen.findByRole("heading", { name: /payment under review/i })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByAltText(/payment proof preview/i)).not.toBeInTheDocument();
  });

  test("network failure preserves the selected option and proof", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.createDeposit.mockRejectedValue({
      message: "We couldn't reach the server. Check your connection and try again.",
      kind: "network"
    });
    const { submitButton } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);

    await screen.findByText(/couldn't reach the server/i);
    expect(screen.getByRole("radio", { name: /^500 EGP/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByAltText(/payment proof preview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit payment/i })).toBeEnabled();
  });

  test("a 409 (payment already in progress) shows the message and refreshes the screen", async () => {
    paymentsApi.fetchCustomerPaymentSummary
      .mockResolvedValueOnce(baseSummary())
      .mockResolvedValue(baseSummary({ paymentStatus: "under_review" }));
    paymentsApi.createDeposit.mockRejectedValue({ message: "You already have a payment in progress.", kind: "http", status: 409 });
    const { submitButton } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);
    expect(await screen.findByRole("heading", { name: /payment under review/i })).toBeInTheDocument();
    expect(paymentsApi.fetchCustomerPaymentSummary).toHaveBeenCalledTimes(2);
  });
});

describe("current-state panels", () => {
  test("PAYMENT UNDER REVIEW: one clean panel, the payment form is hidden", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ paymentStatus: "under_review" }));

    render(<PaymentArea />);
    expect(await screen.findByRole("heading", { name: /payment under review/i })).toBeInTheDocument();
    expect(screen.getByText(/Your payment proof has been received/i)).toBeInTheDocument();
    expect(screen.getByText(/We'll confirm it once it has been reviewed/i)).toBeInTheDocument();
    expect(screen.queryByText("Choose your payment")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  test("FULL PAYMENT COMPLETE: 'Your ticket is fully paid.' and no payment form", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({ paymentStatus: "full_payment_complete" })
    );

    render(<PaymentArea />);
    expect(await screen.findByRole("heading", { name: /full payment complete/i })).toBeInTheDocument();
    expect(screen.getByText("Your ticket is fully paid.")).toBeInTheDocument();
    expect(screen.queryByText("Choose your payment")).not.toBeInTheDocument();
    expect(paymentsApi.createDeposit).not.toHaveBeenCalled();
  });
});

describe("customer privacy — no history", () => {
  test("never renders history, Paid, Remaining or progress", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());

    render(<PaymentArea />);
    await screen.findByRole("radio", { name: /^500 EGP/i });
    expect(screen.queryByText(/^(Approved|Rejected|Pending)$/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/history|paid|remaining|progress|installment/i);
  });

  test("even if an old-shaped response carried deposits, nothing from it is rendered", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({ deposits: [{ id: "d1", amount: 4321, status: "approved" }], approvedTotal: 1234 })
    );

    render(<PaymentArea />);
    await screen.findByText("Choose your payment");
    expect(screen.queryByText("4,321 EGP")).not.toBeInTheDocument();
    expect(screen.queryByText("1,234 EGP")).not.toBeInTheDocument();
  });
});

describe("one-time PAYMENT CONFIRMED screen", () => {
  test("fullscreen with OK, no amount, nothing of the payment screen behind it", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({ paymentStatus: "awaiting_confirmation", paymentConfirmation: CONFIRMATION })
    );

    render(<PaymentArea />);
    const dialog = await screen.findByRole("alertdialog", { name: /payment confirmed/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Your payment has been approved.");
    expect(dialog.textContent).not.toMatch(/EGP|\d/);
    expect(screen.getByRole("button", { name: "OK" })).toHaveFocus();
    expect(screen.queryByText("Full ticket price")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose your payment")).not.toBeInTheDocument();
    await flush();
  });

  test("OK acknowledges, waits for the refetch, then returns to the clean options", async () => {
    let resolveRefetch;
    paymentsApi.fetchCustomerPaymentSummary
      .mockResolvedValueOnce(baseSummary({ paymentStatus: "awaiting_confirmation", paymentConfirmation: CONFIRMATION }))
      .mockReturnValueOnce(new Promise((resolve) => (resolveRefetch = resolve)));
    paymentsApi.acknowledgePaymentConfirmation.mockResolvedValue(undefined);

    render(<PaymentArea />);
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));

    expect(paymentsApi.acknowledgePaymentConfirmation).toHaveBeenCalledWith({
      attendeeId: "atd1",
      phone: "01012345678",
      depositId: "dep-approved-1"
    });

    await waitFor(() => expect(paymentsApi.fetchCustomerPaymentSummary).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /one moment/i })).toBeDisabled();

    await act(async () => resolveRefetch(baseSummary()));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("Choose your payment")).toBeInTheDocument();
    // Any option again — including the one they just paid.
    expect(await screen.findByRole("radio", { name: /^7,000 EGP/i })).toBeEnabled();
    expect(paymentsApi.fetchCustomerPaymentOptions).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toMatch(/paid|remaining|history/i);
  });

  test("never closes before the backend acknowledgement succeeds; a failure shows a quiet retry", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({ paymentStatus: "awaiting_confirmation", paymentConfirmation: CONFIRMATION })
    );
    let rejectAck;
    paymentsApi.acknowledgePaymentConfirmation
      .mockReturnValueOnce(new Promise((resolve, reject) => (rejectAck = reject)))
      .mockResolvedValueOnce(undefined);

    render(<PaymentArea />);
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));
    expect(screen.getByRole("button", { name: /one moment/i })).toBeDisabled();

    await act(async () => rejectAck({ message: "network", kind: "network" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save that just now/i);
    expect(paymentsApi.fetchCustomerPaymentSummary).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(paymentsApi.acknowledgePaymentConfirmation).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(paymentsApi.fetchCustomerPaymentSummary).toHaveBeenCalledTimes(2));
    await flush();
  });

  test("Escape does not dismiss it", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({ paymentStatus: "awaiting_confirmation", paymentConfirmation: CONFIRMATION })
    );

    render(<PaymentArea />);
    await screen.findByRole("alertdialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(paymentsApi.acknowledgePaymentConfirmation).not.toHaveBeenCalled();
    await flush();
  });

  test("a later visit (no confirmation) never shows it again", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    render(<PaymentArea />);
    await screen.findByText("Choose your payment");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  test("two pending confirmations are shown one at a time", async () => {
    const second = { depositId: "dep-approved-2" };
    paymentsApi.fetchCustomerPaymentSummary
      .mockResolvedValueOnce(baseSummary({ paymentStatus: "awaiting_confirmation", paymentConfirmation: CONFIRMATION }))
      .mockResolvedValueOnce(baseSummary({ paymentStatus: "awaiting_confirmation", paymentConfirmation: second }))
      .mockResolvedValue(baseSummary());
    paymentsApi.acknowledgePaymentConfirmation.mockResolvedValue(undefined);

    render(<PaymentArea />);
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));
    await waitFor(() => expect(paymentsApi.acknowledgePaymentConfirmation).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));

    expect(paymentsApi.acknowledgePaymentConfirmation.mock.calls.map((call) => call[0].depositId)).toEqual([
      "dep-approved-1",
      "dep-approved-2"
    ]);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await flush();
  });

  test("with Full Payment confirmed, OK returns to FULL PAYMENT COMPLETE — never a payment form", async () => {
    paymentsApi.fetchCustomerPaymentSummary
      .mockResolvedValueOnce(
        baseSummary({ paymentStatus: "full_payment_complete", paymentConfirmation: CONFIRMATION })
      )
      .mockResolvedValue(baseSummary({ paymentStatus: "full_payment_complete" }));
    paymentsApi.acknowledgePaymentConfirmation.mockResolvedValue(undefined);

    render(<PaymentArea />);
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));

    expect(await screen.findByRole("heading", { name: /full payment complete/i })).toBeInTheDocument();
    expect(screen.queryByText("Choose your payment")).not.toBeInTheDocument();
    await flush();
  });
});

describe("rejected — current-state message only", () => {
  test("the most recent rejection shows one quiet message above the options", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({ latestRejection: { reason: "The amount doesn't match." } })
    );

    render(<PaymentArea />);
    expect(await screen.findByText(/Your last payment wasn't accepted/i)).toBeInTheDocument();
    expect(screen.getByText("The amount doesn't match.")).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /^500 EGP/i })).toBeEnabled();
    expect(screen.queryByText(/^Rejected$/)).not.toBeInTheDocument();
  });

  test("is not shown while a request is under review", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({ paymentStatus: "under_review", latestRejection: { reason: "Old reason." } })
    );

    render(<PaymentArea />);
    await screen.findByRole("heading", { name: /payment under review/i });
    expect(screen.queryByText(/wasn't accepted/i)).not.toBeInTheDocument();
  });
});
