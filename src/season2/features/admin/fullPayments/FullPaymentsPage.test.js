import React from "react";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FullPaymentsPage from "./FullPaymentsPage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api", () => ({
  ...jest.requireActual("../services/admin.api"),
  fetchSchools: jest.fn(),
  fetchFullPayments: jest.fn(),
  fetchFullPaymentDeposits: jest.fn(),
  markFullPaymentDone: jest.fn(),
  revokeFullPaymentDone: jest.fn()
}));

const SCHOOL_A = { _id: "school-a", name: "Fictional School A", ticketPrice: 6000 };
const SCHOOL_B = { _id: "school-b", name: "Fictional School B", ticketPrice: 4500 };

function makeCustomer(overrides = {}) {
  return {
    id: "c1",
    fullName: "Zero Deposits",
    phone: "01000000001",
    customerType: "incomer",
    schoolId: "school-a",
    schoolName: "Fictional School A",
    eventId: null,
    eventName: null,
    ticketPrice: 6000,
    approvedTotalPaid: 0,
    manualStatus: "NOT_DONE",
    doneAt: null,
    doneBy: null,
    ...overrides
  };
}

const page = (customers, extra = {}) => ({
  customers,
  pagination: { page: 1, pageSize: 25, total: customers.length, totalPages: 1, ...extra },
  outcomers: { available: false }
});

const CUSTOMERS = [
  makeCustomer({ id: "c1", fullName: "Zero Deposits", approvedTotalPaid: 0 }),
  makeCustomer({ id: "c2", fullName: "Paid Lower", phone: "01000000002", approvedTotalPaid: 1000 }),
  makeCustomer({ id: "c3", fullName: "Paid Equal", phone: "01000000003", approvedTotalPaid: 6000 }),
  makeCustomer({ id: "c4", fullName: "Paid Higher", phone: "01000000004", approvedTotalPaid: 9000 }),
  makeCustomer({
    id: "c5", fullName: "Already Done", phone: "01000000005", approvedTotalPaid: 2000,
    manualStatus: "DONE", doneAt: "2026-08-20T08:00:00.000Z", doneBy: "boss@example.test"
  })
];

const DETAILS = {
  customer: { id: "c1", fullName: "Zero Deposits", phone: "01000000001", schoolName: "Fictional School A", eventName: null },
  summary: { ticketPrice: 6000, approvedTotalPaid: 1000, manualStatus: "NOT_DONE" },
  deposits: [
    { id: "d1", number: 1, amount: 1000, status: "approved", submittedAt: "2026-09-05T09:00:00.000Z", approvedAt: "2026-09-05T10:00:00.000Z", rejectedAt: null, rejectionReason: null, proofUrl: "https://res.cloudinary.test/proof/d1.jpg" },
    { id: "d2", number: 2, amount: 3000, status: "rejected", submittedAt: "2026-09-05T11:00:00.000Z", approvedAt: null, rejectedAt: "2026-09-05T12:00:00.000Z", rejectionReason: "Wrong amount", proofUrl: null },
    { id: "d3", number: 3, amount: 5000, status: "pending", submittedAt: "2026-09-05T13:00:00.000Z", approvedAt: null, rejectedAt: null, rejectionReason: null, proofUrl: "https://res.cloudinary.test/proof/d3.jpg" }
  ]
};

const lastParams = () => adminApi.fetchFullPayments.mock.calls[adminApi.fetchFullPayments.mock.calls.length - 1][0];

beforeEach(() => {
  jest.clearAllMocks();
  adminApi.fetchSchools.mockResolvedValue([SCHOOL_A, SCHOOL_B]);
  adminApi.fetchFullPayments.mockResolvedValue(page(CUSTOMERS));
  adminApi.fetchFullPaymentDeposits.mockResolvedValue(DETAILS);
});

// Look inside the table only: an open dialog repeats the customer name.
function row(name) {
  return within(screen.getByRole("table")).getByText(name).closest("tr");
}

test("lists every customer with name, phone, ID, type, school, ticket price, approved total and manual status", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");

  const zero = within(row("Zero Deposits"));
  expect(zero.getByText("01000000001")).toBeInTheDocument();
  expect(zero.getByText("c1")).toBeInTheDocument();
  expect(zero.getByText("Incomer")).toBeInTheDocument();
  expect(zero.getByText("Fictional School A")).toBeInTheDocument();
  expect(zero.getByText("6,000 EGP")).toBeInTheDocument();
  expect(zero.getByText("0 EGP")).toBeInTheDocument();
  expect(zero.getByText("NOT DONE")).toBeInTheDocument();

  expect(within(row("Paid Higher")).getByText("9,000 EGP")).toBeInTheDocument();
  expect(within(row("Already Done")).getByText("DONE")).toBeInTheDocument();
  expect(screen.getByText("5 customers")).toBeInTheDocument();
});

test("never shows an automatic payment classification", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  expect(document.body.textContent).not.toMatch(/partially paid|fully paid|eligible|insufficient|automatically completed|remaining/i);
});

test("there is no bulk selection or bulk Mark DONE", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByText(/mark all|select all|bulk/i)).not.toBeInTheDocument();
});

test("the Mark DONE button is available for EVERY not-done customer, whatever they paid", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  for (const name of ["Zero Deposits", "Paid Lower", "Paid Equal", "Paid Higher"]) {
    const button = screen.getByRole("button", { name: `Mark Full Payment DONE for ${name}` });
    expect(button).toBeEnabled();
  }
  // An already-DONE customer offers Revoke instead (also individual).
  expect(screen.queryByRole("button", { name: "Mark Full Payment DONE for Already Done" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revoke DONE for Already Done" })).toBeEnabled();
});

test("loads a deposit history ONLY when View Deposits is clicked (lazy), and shows the full detail", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  expect(adminApi.fetchFullPaymentDeposits).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "View deposits for Zero Deposits" }));
  await screen.findByText("Deposit #1 · 1,000 EGP");
  expect(adminApi.fetchFullPaymentDeposits).toHaveBeenCalledTimes(1);
  expect(adminApi.fetchFullPaymentDeposits.mock.calls[0][0]).toBe("c1");

  const details = within(screen.getByLabelText("Deposit history").closest(".s2-fp-details"));
  // customer information + financial summary
  expect(details.getByText("Customer information")).toBeInTheDocument();
  expect(details.getByText("Fictional School A")).toBeInTheDocument();
  expect(details.getByText("Full ticket price")).toBeInTheDocument();
  expect(details.getByText("Total approved deposits")).toBeInTheDocument();
  expect(details.getByText("Manual Full Payment status")).toBeInTheDocument();
  // every deposit, told apart by status
  expect(details.getByText("Deposit #2 · 3,000 EGP")).toBeInTheDocument();
  expect(details.getByText("Deposit #3 · 5,000 EGP")).toBeInTheDocument();
  expect(details.getByText("Approved")).toBeInTheDocument();
  expect(details.getByText("Rejected")).toBeInTheDocument();
  expect(details.getByText("Pending")).toBeInTheDocument();
  expect(details.getByText(/^Approved \d/)).toBeInTheDocument();
  expect(details.getByText(/^Rejected \d/)).toBeInTheDocument();
  expect(details.getByText("Wrong amount")).toBeInTheDocument();
  // payment proof link where one exists
  const proofs = details.getAllByRole("link", { name: "View payment proof" });
  expect(proofs).toHaveLength(2);
  expect(proofs[0]).toHaveAttribute("href", "https://res.cloudinary.test/proof/d1.jpg");
  expect(details.getByText("No proof on file")).toBeInTheDocument();

  // collapses again, without navigating away
  await userEvent.click(screen.getByRole("button", { name: "Hide deposits for Zero Deposits" }));
  expect(screen.queryByText("Deposit #1 · 1,000 EGP")).not.toBeInTheDocument();
});

test("a customer with no deposits shows 'No deposits submitted yet.'", async () => {
  adminApi.fetchFullPaymentDeposits.mockResolvedValue({
    ...DETAILS,
    summary: { ticketPrice: 6000, approvedTotalPaid: 0, manualStatus: "NOT_DONE" },
    deposits: []
  });
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  await userEvent.click(screen.getByRole("button", { name: "View deposits for Zero Deposits" }));
  expect(await screen.findByText("No deposits submitted yet.")).toBeInTheDocument();
});

test("a failed deposit load shows an error with retry (and does not break the row)", async () => {
  adminApi.fetchFullPaymentDeposits.mockRejectedValueOnce(new Error("Deposits are unavailable."));
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  await userEvent.click(screen.getByRole("button", { name: "View deposits for Zero Deposits" }));
  expect(await screen.findByText("Deposits are unavailable.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(await screen.findByText("Deposit #1 · 1,000 EGP")).toBeInTheDocument();
});

// --- the manual decision -----------------------------------------------

test("Mark DONE: confirmation names the customer; Cancel changes nothing; Confirm saves once and updates the badge", async () => {
  adminApi.markFullPaymentDone.mockResolvedValue({
    success: true, changed: true, manualStatus: "DONE", doneAt: "2026-11-13T10:00:00.000Z", doneBy: "admin@example.test"
  });
  render(<FullPaymentsPage />);
  await screen.findByText("Paid Lower");

  await userEvent.click(screen.getByRole("button", { name: "Mark Full Payment DONE for Paid Lower" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Mark Full Payment DONE?")).toBeInTheDocument();
  expect(within(dialog).getAllByText("Paid Lower").length).toBeGreaterThan(0);
  expect(within(dialog).getByText("01000000002")).toBeInTheDocument();
  expect(within(dialog).getByText("c2")).toBeInTheDocument();
  expect(within(dialog).getByText(/manually confirms/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/amounts above are not checked/i)).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(adminApi.markFullPaymentDone).not.toHaveBeenCalled();
  expect(within(row("Paid Lower")).getByText("NOT DONE")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Mark Full Payment DONE for Paid Lower" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(adminApi.markFullPaymentDone).toHaveBeenCalledTimes(1);
  expect(adminApi.markFullPaymentDone).toHaveBeenCalledWith("c2");
  const updated = within(row("Paid Lower"));
  expect(updated.getByText("DONE")).toBeInTheDocument();
  expect(updated.getByRole("button", { name: "Revoke DONE for Paid Lower" })).toBeInTheDocument();
  // Nobody else changed.
  expect(within(row("Zero Deposits")).getByText("NOT DONE")).toBeInTheDocument();
  expect(within(row("Paid Equal")).getByText("NOT DONE")).toBeInTheDocument();
});

test("a double-click on Confirm sends exactly ONE request", async () => {
  let resolve;
  adminApi.markFullPaymentDone.mockImplementation(
    () => new Promise((r) => { resolve = () => r({ success: true, changed: true, manualStatus: "DONE", doneAt: null, doneBy: null }); })
  );
  render(<FullPaymentsPage />);
  await screen.findByText("Paid Higher");
  await userEvent.click(screen.getByRole("button", { name: "Mark Full Payment DONE for Paid Higher" }));
  const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i });
  await userEvent.dblClick(confirm);
  expect(adminApi.markFullPaymentDone).toHaveBeenCalledTimes(1);
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: /saving/i })).toBeDisabled();
  await act(async () => resolve());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("a failed save is never shown as success: the dialog stays open with the error and the badge is unchanged", async () => {
  adminApi.markFullPaymentDone.mockRejectedValue(new Error("The database is unavailable."));
  render(<FullPaymentsPage />);
  await screen.findByText("Paid Equal");
  await userEvent.click(screen.getByRole("button", { name: "Mark Full Payment DONE for Paid Equal" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The database is unavailable.");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(within(row("Paid Equal")).getByText("NOT DONE")).toBeInTheDocument();
  // The Admin can try again.
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i })).toBeEnabled();
});

test("Revoke DONE needs its own confirmation and affects only that customer", async () => {
  adminApi.revokeFullPaymentDone.mockResolvedValue({ success: true, changed: true, manualStatus: "NOT_DONE", doneAt: null, doneBy: null });
  render(<FullPaymentsPage />);
  await screen.findByText("Already Done");
  await userEvent.click(screen.getByRole("button", { name: "Revoke DONE for Already Done" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Revoke Full Payment DONE?")).toBeInTheDocument();
  expect(adminApi.revokeFullPaymentDone).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));
  await waitFor(() => expect(adminApi.revokeFullPaymentDone).toHaveBeenCalledWith("c5"));
  expect(await within(row("Already Done")).findByText("NOT DONE")).toBeInTheDocument();
  expect(adminApi.markFullPaymentDone).not.toHaveBeenCalled();
});

test("after a decision, an open deposit panel shows the new status too", async () => {
  adminApi.markFullPaymentDone.mockResolvedValue({ success: true, changed: true, manualStatus: "DONE", doneAt: null, doneBy: null });
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  await userEvent.click(screen.getByRole("button", { name: "View deposits for Zero Deposits" }));
  await screen.findByText("Deposit #1 · 1,000 EGP");
  await userEvent.click(screen.getByRole("button", { name: "Mark Full Payment DONE for Zero Deposits" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const details = screen.getByLabelText("Financial summary");
  expect(within(details).getByText("DONE")).toBeInTheDocument();
});

// --- search, filters, paging ----------------------------------------------

test("search is debounced and sent to the server (name, phone or ID), starting from page 1", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  adminApi.fetchFullPayments.mockClear();

  await userEvent.type(screen.getByLabelText("Search customers"), "0100");
  await waitFor(() => expect(adminApi.fetchFullPayments).toHaveBeenCalled());
  expect(lastParams()).toMatchObject({ q: "0100", page: 1 });
  // typed in one go -> one request, not one per keystroke
  expect(adminApi.fetchFullPayments).toHaveBeenCalledTimes(1);
});

test("filters work together: type, school, manual status and page size are all sent", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");

  await userEvent.selectOptions(screen.getByLabelText("Customer type"), "incomer");
  await userEvent.selectOptions(await screen.findByLabelText("Filter by school"), "school-b");
  await userEvent.selectOptions(screen.getByLabelText("Manual confirmation"), "not_done");
  await userEvent.selectOptions(screen.getByLabelText("Customers per page"), "50");
  await userEvent.type(screen.getByLabelText("Search customers"), "Ann");

  await waitFor(() => expect(lastParams()).toMatchObject({
    q: "Ann", customerType: "incomer", schoolId: "school-b", manual: "not_done", pageSize: 50, page: 1
  }));

  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(lastParams()).toMatchObject({ q: "", customerType: "", schoolId: "", manual: "", pageSize: 50 }));
});

test("paging: accurate count, Previous/Next, and a change of filter returns to page 1", async () => {
  adminApi.fetchFullPayments.mockResolvedValue(page(CUSTOMERS, { total: 3000, totalPages: 120 }));
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  expect(screen.getByText("3,000 customers")).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 120")).toBeInTheDocument();
  expect(screen.getByText(/Showing 1–5 of 3,000/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

  adminApi.fetchFullPayments.mockResolvedValue(page(CUSTOMERS, { page: 2, total: 3000, totalPages: 120 }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(lastParams().page).toBe(2));

  await userEvent.selectOptions(screen.getByLabelText("Manual confirmation"), "done");
  await waitFor(() => expect(lastParams()).toMatchObject({ manual: "done", page: 1 }));
});

test("Outcomers: the Event filter is disabled and choosing Outcomers explains registration is not live", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  expect(screen.getByLabelText("Filter by event")).toBeDisabled();

  adminApi.fetchFullPayments.mockResolvedValue(page([], { total: 0 }));
  await userEvent.selectOptions(screen.getByLabelText("Customer type"), "outcomer");
  expect(await screen.findByText(/Outcomer registration is not live yet/)).toBeInTheDocument();
  expect(screen.getByLabelText("Filter by school")).toBeDisabled();
  expect(lastParams()).toMatchObject({ customerType: "outcomer", schoolId: "" });
});

test("a failed list load shows an error with retry", async () => {
  adminApi.fetchFullPayments.mockRejectedValueOnce(new Error("Customers are unavailable."));
  render(<FullPaymentsPage />);
  expect(await screen.findByText("Customers are unavailable.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(await screen.findByText("Zero Deposits")).toBeInTheDocument();
});

test("shows an empty message when nothing matches", async () => {
  render(<FullPaymentsPage />);
  await screen.findByText("Zero Deposits");
  adminApi.fetchFullPayments.mockResolvedValue(page([], { total: 0 }));
  await userEvent.type(screen.getByLabelText("Search customers"), "nobody");
  expect(await screen.findByText("No customers match this search.")).toBeInTheDocument();
});
