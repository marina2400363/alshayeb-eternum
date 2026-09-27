import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerAreaPage from "./index";
import useCustomer from "../../features/onboarding/hooks/useCustomer";
import * as paymentsApi from "../../services/payments.api";
import { fetchStatusCounter } from "../../services/statusCounter.api";

// Full page integration: the existing payment experience (Sandra's, untouched)
// rendering alongside the two new additions (StatusCounter, GateAccessAction)
// in the same Customer Area, without one breaking the other.
//
// The gate and shell are replaced with bare pass-throughs: both only add
// session/routing chrome (react-router Link/Navigate, the hamburger menu)
// that is irrelevant to this test and, for the gate, already covered by its
// own gate logic elsewhere — here we only need "signed-in customer sees the
// page body".
jest.mock("../../features/onboarding/CustomerAreaGate", () => ({ children }) => <>{children}</>);
jest.mock("../../features/customerArea/CustomerAreaShell", () => ({ children }) => <div>{children}</div>);
jest.mock("../../features/onboarding/hooks/useCustomer");
jest.mock("../../services/payments.api");
jest.mock("../../services/statusCounter.api");

const CUSTOMER = { id: "atd1", fullName: "Test User", phone: "01012345678", attendeeType: "incomer" };

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

beforeEach(() => {
  jest.clearAllMocks();
  useCustomer.mockReturnValue({
    session: { id: CUSTOMER.id, phone: CUSTOMER.phone },
    customer: CUSTOMER,
    signIn: jest.fn(),
    signOut: jest.fn()
  });
  paymentsApi.fetchCustomerPaymentSummary.mockResolvedValue(baseSummary());
  paymentsApi.fetchInstaPayLink.mockResolvedValue(null);
  paymentsApi.fetchCustomerPaymentOptions.mockResolvedValue([{ id: "po-500", amount: 500, label: null }]);
  fetchStatusCounter.mockResolvedValue({ accepted: 350, rejected: 12, pending: 8 });
});

test("renders the untouched session bar, ticket price and payment section alongside the new counter and gate action", async () => {
  render(<CustomerAreaPage />);

  // Existing structure, unchanged.
  expect(await screen.findByText("Signed in as")).toBeInTheDocument();
  expect(screen.getByText("Test User")).toBeInTheDocument();
  expect(await screen.findByText("Full ticket price")).toBeInTheDocument();
  expect(screen.getByText("Choose your payment")).toBeInTheDocument();

  // New additions.
  expect(await screen.findByText("350")).toBeInTheDocument(); // accepted
  expect(screen.getByText("12")).toBeInTheDocument(); // rejected
  expect(screen.getByText("8")).toBeInTheDocument(); // pending
  const gate = screen.getByRole("button", { name: /access to gate/i });
  expect(gate).toBeDisabled();
});

test("Gate Access never calls any API and never changes the page", async () => {
  render(<CustomerAreaPage />);
  await screen.findByText("Full ticket price");
  jest.clearAllMocks(); // isolate: only calls made by clicking Gate Access count from here

  const gate = screen.getByRole("button", { name: /access to gate/i });
  await act(async () => {
    await userEvent.click(gate);
  });

  expect(paymentsApi.fetchCustomerPaymentSummary).not.toHaveBeenCalled();
  expect(paymentsApi.fetchCustomerPaymentOptions).not.toHaveBeenCalled();
  expect(fetchStatusCounter).not.toHaveBeenCalled();
  // Still the same page — the click did not trigger any navigation/route change.
  expect(screen.getByText("Choose your payment")).toBeInTheDocument();
});

test("the payment flow is unaffected by the new sidebar: choosing a payment option still works", async () => {
  render(<CustomerAreaPage />);
  const option = await screen.findByRole("radio", { name: /500 EGP/i });
  await userEvent.click(option);
  expect(option).toBeChecked();
});
