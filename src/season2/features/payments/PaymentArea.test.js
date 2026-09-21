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

// Product rule (this revision): the customer-facing summary carries only
// {ticketPrice, activeDepositCount, fullPaymentConfirmed, deposits} — no
// approvedTotal/remaining/progress field exists in the fixture at all, so
// any accidental reintroduction in PaymentArea/PaymentOverview would show up
// as a missing-mock-data failure rather than silently passing.
function baseSummary(overrides = {}) {
  return {
    ticketPrice: 6000,
    activeDepositCount: 1,
    fullPaymentConfirmed: false,
    deposits: [
      { id: "d1", amount: 1250, label: "First deposit", status: "approved", createdAt: "2026-01-01T00:00:00.000Z", rejectionReason: null },
      { id: "d2", amount: 750, label: "Second deposit", status: "approved", createdAt: "2026-01-02T00:00:00.000Z", rejectionReason: null }
    ],
    ...overrides
  };
}

async function selectOptionAndUploadProof({ file } = {}) {
  const optionButton = await screen.findByRole("radio", { name: /500 EGP/i });
  await userEvent.click(optionButton);
  const input = document.querySelector('input[type="file"]');
  await userEvent.upload(input, file || new File(["x"], "screenshot.png", { type: "image/png" }));
  return optionButton;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reassigned fresh every test (not beforeAll): jest.clearAllMocks() clears
  // a jest.fn()'s default implementation along with its call history, so a
  // beforeAll-only assignment would silently start returning undefined from
  // the second test onward.
  global.URL.createObjectURL = jest.fn((file) => `blob:${file.name}`);
  global.URL.revokeObjectURL = jest.fn();
  useCustomer.mockReturnValue({
    session: { id: CUSTOMER.id, phone: CUSTOMER.phone },
    customer: CUSTOMER,
    signIn: jest.fn(),
    signOut: jest.fn()
  });
  // Every test renders PaymentArea, which always calls this — default to a
  // harmless "not configured" response so tests that don't care about
  // InstaPay don't need to stub it individually.
  paymentsApi.fetchInstaPayLink.mockResolvedValue(null);
});

describe("summary", () => {
  test("shows a loading state while the summary request is in flight", async () => {
    let resolveSummary;
    paymentsApi.fetchCustomerPaymentSummary.mockReturnValue(new Promise((resolve) => (resolveSummary = resolve)));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    expect(screen.getByText(/Loading your payment details/i)).toBeInTheDocument();

    resolveSummary(baseSummary());
    await waitFor(() => expect(screen.queryByText(/Loading your payment details/i)).not.toBeInTheDocument());
  });

  test("shows an error with Retry, and Retry re-fetches", async () => {
    paymentsApi.fetchCustomerPaymentSummary
      .mockRejectedValueOnce({ message: "We couldn't reach the server.", kind: "network" })
      .mockResolvedValueOnce(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText(/Couldn't load your payment details/i);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Full ticket price");
    expect(paymentsApi.fetchCustomerPaymentSummary).toHaveBeenCalledTimes(2);
  });

  test("renders ONLY the full ticket price from the API value — no Paid/Remaining anywhere", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText("Full ticket price");
    expect(screen.getByText("6,000 EGP")).toBeInTheDocument();

    expect(screen.queryByText(/^Paid$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Remaining$/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/paid|remaining/i);
  });

  test("fullPaymentConfirmed=true hides Choose Payment, shows a confirmed line, keeps history", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ fullPaymentConfirmed: true }));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText("Payment confirmed");
    expect(screen.queryByText("Choose your payment")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit deposit/i })).not.toBeInTheDocument();
    expect(screen.getByText("Deposit history")).toBeInTheDocument();
  });

  test("fullPaymentConfirmed is never inferred from arithmetic — only the backend boolean matters", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ fullPaymentConfirmed: false }));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText("Full ticket price");
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
  });
});

describe("payment options (school-specific, backend-filtered)", () => {
  test("requests options via {attendeeId, phone} — never a generic global list", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText("Full ticket price");
    expect(paymentsApi.fetchCustomerPaymentOptions.mock.calls[0][0]).toEqual({ attendeeId: "atd1", phone: "01012345678" });
  });

  test("an options-only failure does not take down the overview/history", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockRejectedValue({ message: "options down", kind: "network" });

    render(<PaymentArea />);
    await screen.findByText("Full ticket price");
    await screen.findByText(/Couldn't load payment options/i);
    expect(screen.getByText("6,000 EGP")).toBeInTheDocument();
  });

  test("zero options (School has none configured, or none currently fit) shows a clean message", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText(/No payment amounts are available/i);
  });

  test("renders whichever options the backend returns — every option shown is selectable (no client-side disabling)", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([
      { id: "po-a", amount: 500, label: "500 EGP" },
      { id: "po-b", amount: 1000, label: "1000 EGP" }
    ]);

    render(<PaymentArea />);
    const first = await screen.findByRole("radio", { name: /500 EGP/i });
    const second = screen.getByRole("radio", { name: /1000 EGP/i });
    expect(first).toBeEnabled();
    expect(second).toBeEnabled();
  });

  test("a DIFFERENT mock customer (School B) sees School-B-shaped options — proves scoping end to end", async () => {
    useCustomer.mockReturnValue({
      session: { id: "atd-schoolb", phone: "01099998888" },
      customer: { id: "atd-schoolb", fullName: "School B Customer", phone: "01099998888", attendeeType: "incomer" },
      signIn: jest.fn(),
      signOut: jest.fn()
    });
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ ticketPrice: 4000 }));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po-schoolb", amount: 750, label: null }]);

    render(<PaymentArea />);
    await screen.findByText("4,000 EGP");
    expect(paymentsApi.fetchCustomerPaymentOptions.mock.calls[0][0]).toEqual({ attendeeId: "atd-schoolb", phone: "01099998888" });
    expect(await screen.findByRole("radio", { name: /750 EGP/i })).toBeInTheDocument();
  });

  test("selecting an option reveals InstaPay + proof upload", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po1", amount: 500, label: "Standard" }]);

    render(<PaymentArea />);
    const optionButton = await screen.findByRole("radio", { name: /500 EGP/i });
    await userEvent.click(optionButton);

    expect(await screen.findByText("InstaPay")).toBeInTheDocument();
    expect(screen.getByText("Payment proof")).toBeInTheDocument();
    expect(optionButton).toHaveAttribute("aria-checked", "true");
  });
});

describe("InstaPay", () => {
  test("shows the real configured link and an Open InstaPay action", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po1", amount: 500, label: "Standard" }]);
    paymentsApi.fetchInstaPayLink.mockResolvedValue("https://ipn.eg/real-alshayeb-link");

    render(<PaymentArea />);
    await userEvent.click(await screen.findByRole("radio", { name: /500 EGP/i }));

    const link = await screen.findByRole("link", { name: /open instapay/i });
    expect(link).toHaveAttribute("href", "https://ipn.eg/real-alshayeb-link");
  });

  test("no configured link (null) shows a clean unavailable state, never a fake URL", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po1", amount: 500, label: "Standard" }]);
    paymentsApi.fetchInstaPayLink.mockResolvedValue(null);

    render(<PaymentArea />);
    await userEvent.click(await screen.findByRole("radio", { name: /500 EGP/i }));

    expect(await screen.findByText(/aren't available right now/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open instapay/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/instapay\.example/);
  });
});

describe("proof upload", () => {
  test("a processing error is shown and blocks submit", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po1", amount: 500, label: "Standard" }]);
    processProof.mockResolvedValue({ error: "Please choose a JPG or PNG screenshot." });

    render(<PaymentArea />);
    await selectOptionAndUploadProof({ file: new File(["x"], "s.pdf", { type: "application/pdf" }) });

    expect(await screen.findByText("Please choose a JPG or PNG screenshot.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit deposit/i })).toBeDisabled();
  });

  test("a successful proof shows a preview and enables submit", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po1", amount: 500, label: "Standard" }]);
    processProof.mockResolvedValue({ file: new File(["x"], "proof.jpg", { type: "image/jpeg" }) });

    render(<PaymentArea />);
    await selectOptionAndUploadProof();

    expect(await screen.findByAltText(/payment proof preview/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /submit deposit/i })).toBeEnabled());
  });

  test("replacing a proof revokes the previous preview URL", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po1", amount: 500, label: "Standard" }]);
    processProof
      .mockResolvedValueOnce({ file: new File(["x"], "a.jpg", { type: "image/jpeg" }) })
      .mockResolvedValueOnce({ file: new File(["y"], "b.jpg", { type: "image/jpeg" }) });

    render(<PaymentArea />);
    await selectOptionAndUploadProof({ file: new File(["x"], "s1.png", { type: "image/png" }) });
    await screen.findByAltText(/payment proof preview/i);

    const input = document.querySelector('input[type="file"]');
    await userEvent.upload(input, new File(["y"], "s2.png", { type: "image/png" }));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a.jpg"));
  });
});

describe("submit", () => {
  async function setUpReadyToSubmit(overrides = {}) {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary(overrides));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po1", amount: 500, label: "Standard" }]);
    const processedFile = new File(["x"], "proof.jpg", { type: "image/jpeg" });
    processProof.mockResolvedValue({ file: processedFile });

    render(<PaymentArea />);
    await selectOptionAndUploadProof();
    const submitButton = await screen.findByRole("button", { name: /submit deposit/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    return { submitButton, processedFile };
  }

  test("sends exactly attendeeId, phone, paymentOptionId, proof — never amount", async () => {
    paymentsApi.createDeposit.mockResolvedValue({
      deposit: { id: "dep1", amount: 500, label: "Standard", status: "pending", createdAt: "x" }
    });
    const { submitButton, processedFile } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);

    await waitFor(() =>
      expect(paymentsApi.createDeposit).toHaveBeenCalledWith({
        attendeeId: "atd1",
        phone: "01012345678",
        paymentOptionId: "po1",
        paymentProof: processedFile
      })
    );

    // Success also triggers a background summary refetch — let its mocked
    // promise settle before the test unmounts.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  });

  test("double-submit is guarded — the button disables immediately and a second click does nothing", async () => {
    let resolveCreate;
    paymentsApi.createDeposit.mockReturnValue(new Promise((resolve) => (resolveCreate = resolve)));
    const { submitButton } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);
    expect(submitButton).toBeDisabled();

    await userEvent.click(submitButton);
    expect(paymentsApi.createDeposit).toHaveBeenCalledTimes(1);

    resolveCreate({ deposit: { id: "dep1", amount: 500, status: "pending", createdAt: "x" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /submit deposit/i })).not.toBeInTheDocument());

    // Success also triggers a background summary refetch — let its mocked
    // promise settle before the test unmounts, so its state update doesn't
    // land after cleanup.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  });

  test("on success: clears selection/proof and refetches the summary (not the options list)", async () => {
    paymentsApi.createDeposit.mockResolvedValue({
      deposit: { id: "dep1", amount: 500, label: "Standard", status: "pending", createdAt: "x" }
    });
    const { submitButton } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);

    await waitFor(() => expect(paymentsApi.fetchCustomerPaymentSummary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("InstaPay")).not.toBeInTheDocument());
    expect(screen.queryByAltText(/payment proof preview/i)).not.toBeInTheDocument();
    // A new pending deposit never changes what fits the (internal) remaining
    // balance — only an approval would — so options are not re-fetched.
    expect(paymentsApi.fetchCustomerPaymentOptions).toHaveBeenCalledTimes(1);

    // Let the refetch's own resolution (not just the call) settle before the
    // test unmounts.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  });

  test("network failure preserves the selected option and proof", async () => {
    paymentsApi.createDeposit.mockRejectedValue({
      message: "We couldn't reach the server. Check your connection and try again.",
      kind: "network"
    });
    const { submitButton } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);

    await screen.findByText(/couldn't reach the server/i);
    expect(screen.getByRole("radio", { name: /500 EGP/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByAltText(/payment proof preview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit deposit/i })).toBeEnabled();
  });

  test("a wrong-phone ownership error from the backend is surfaced", async () => {
    paymentsApi.createDeposit.mockRejectedValue({
      message: "We couldn't verify this account. Check your details and try again.",
      kind: "http",
      status: 404
    });
    const { submitButton } = await setUpReadyToSubmit();

    await userEvent.click(submitButton);
    await screen.findByText(/We couldn't verify this account/i);
  });

  test("fullPaymentConfirmed=true never renders a submit control at all", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ fullPaymentConfirmed: true }));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText("Payment confirmed");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit deposit/i })).not.toBeInTheDocument();
    expect(paymentsApi.createDeposit).not.toHaveBeenCalled();
  });

  test("activeDepositCount=5 hides the submission form and shows a restrained message", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ activeDepositCount: 5 }));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po1", amount: 500, label: "Standard" }]);

    render(<PaymentArea />);
    await screen.findByText("Full ticket price");
    expect(screen.queryByText("Choose your payment")).not.toBeInTheDocument();
    expect(screen.getByText(/maximum of 5 active payments/i)).toBeInTheDocument();
    expect(paymentsApi.createDeposit).not.toHaveBeenCalled();
  });
});

describe("deposit history", () => {
  test("renders an empty state with no deposits", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary({ deposits: [] }));
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);
    render(<PaymentArea />);
    expect(await screen.findByText("No payments yet.")).toBeInTheDocument();
  });

  test("renders pending, approved and rejected rows with statuses — never a total-paid figure", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({
        deposits: [
          { id: "d1", amount: 1000, label: "1000 EGP", status: "approved", createdAt: "2026-01-01T00:00:00.000Z", rejectionReason: null },
          { id: "d2", amount: 500, label: null, status: "pending", createdAt: "2026-01-02T00:00:00.000Z", rejectionReason: null },
          { id: "d3", amount: 300, label: "300 EGP", status: "rejected", createdAt: "2026-01-03T00:00:00.000Z", rejectionReason: "Screenshot illegible." }
        ]
      })
    );
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText("Approved");
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("Screenshot illegible.")).toBeInTheDocument();
    // 1000 + 500 = 1500 must never appear as a computed total anywhere.
    expect(screen.queryByText("1,500 EGP")).not.toBeInTheDocument();
  });

  test("never renders proof/internal fields even if the API accidentally sent them", async () => {
    paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(
      baseSummary({
        deposits: [
          {
            id: "d1",
            amount: 500,
            label: "Standard",
            status: "pending",
            createdAt: "2026-01-01T00:00:00.000Z",
            rejectionReason: null,
            paymentOptionId: "po1",
            activeSlot: 2,
            attendeeId: "atd1"
          }
        ]
      })
    );
    paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([]);

    render(<PaymentArea />);
    await screen.findByText("500 EGP");
    expect(document.body.textContent).not.toMatch(/paymentOptionId|activeSlot|atd1/);
  });
});
