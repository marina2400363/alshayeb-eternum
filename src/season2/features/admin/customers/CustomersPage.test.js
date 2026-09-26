import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomersPage from "./CustomersPage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api");

// Render inside an async act so the first fetch (which resolves on a microtask)
// is flushed inside act rather than after it.
async function renderPage() {
  let view;
  await act(async () => {
    view = render(<CustomersPage />);
  });
  return view;
}

// User events (and the state updates their resolved fetches cause) run inside act.
const user = (action) => act(async () => { await action(); });

const PHOTO = "https://res.cloudinary.com/demo/image/upload/v1712/incomers/a1.jpg";

function customer(overrides = {}) {
  return {
    id: "64b000000000000000000001",
    fullName: "Marina Adel",
    phone: "01012345678",
    email: "marina@example.com",
    ticketPrice: 6000,
    schoolId: "school-a",
    schoolName: "Mega Heliopolis",
    registeredAt: "2026-09-10T10:00:00.000Z",
    photoUrl: PHOTO,
    approvedPaymentCount: 2,
    approvedTotalPaid: 2000,
    fullPaymentComplete: false,
    ...overrides
  };
}

// A customer who has never chosen a payment option, uploaded a proof or made a
// Deposit. They must still be listed.
const ZERO_PAYMENT = customer({
  id: "64b000000000000000000002",
  fullName: "Zero Deposits Customer",
  email: null,
  approvedPaymentCount: 0,
  approvedTotalPaid: 0,
  photoUrl: null
});

function page(customers, pagination = {}) {
  return {
    customers,
    pagination: { page: 1, pageSize: 25, total: customers.length, totalPages: 1, ...pagination }
  };
}

function detail(overrides = {}) {
  return {
    id: "64b000000000000000000001",
    fullName: "Marina Adel",
    phone: "01012345678",
    email: "marina@example.com",
    schoolId: "school-a",
    schoolName: "Mega Heliopolis",
    ticketPrice: 6000,
    ticketPriceLocked: true,
    registeredAt: "2026-09-10T10:00:00.000Z",
    photoUrl: PHOTO,
    approvedPaymentCount: 2,
    approvedTotalPaid: 2000,
    fullPayment: { complete: false, confirmedAt: null, lastSyncedAt: null },
    deposits: [
      { id: "dep1", amount: 1500, label: "Second", status: "approved", submittedAt: "2026-09-12T10:00:00.000Z", reviewedAt: "2026-09-12T12:00:00.000Z", rejectionReason: null, proofUrl: "https://cdn.example/p1.jpg" },
      { id: "dep2", amount: 300, label: "Tiny", status: "rejected", submittedAt: "2026-09-11T10:00:00.000Z", reviewedAt: "2026-09-11T12:00:00.000Z", rejectionReason: "Blurry screenshot", proofUrl: null },
      { id: "dep3", amount: 500, label: "First", status: "approved", submittedAt: "2026-09-11T09:00:00.000Z", reviewedAt: "2026-09-11T09:30:00.000Z", rejectionReason: null, proofUrl: null }
    ],
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  adminApi.fetchSchools.mockResolvedValue([
    { _id: "school-a", name: "Mega Heliopolis" },
    { _id: "school-b", name: "Cairo Prep" }
  ]);
});

const lastParams = () => adminApi.fetchAdminCustomers.mock.calls.at(-1)[0];

test("lists every customer with the useful columns, including one with zero payments", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer(), ZERO_PAYMENT]));
  await renderPage();

  expect(await screen.findByText("Marina Adel")).toBeInTheDocument();
  expect(screen.getByText("Zero Deposits Customer")).toBeInTheDocument();

  for (const heading of ["Customer ID", "Full name", "Phone", "Email", "School", "Ticket price", "Registered", "Approved payments", "Approved paid", "Full payment"]) {
    expect(screen.getByRole("columnheader", { name: heading })).toBeInTheDocument();
  }

  const rows = screen.getAllByRole("row");
  const marina = within(rows[1]);
  expect(marina.getByText("64b000000000000000000001")).toBeInTheDocument();
  expect(marina.getByText("01012345678")).toBeInTheDocument();
  expect(marina.getByText("marina@example.com")).toBeInTheDocument();
  expect(marina.getByText("Mega Heliopolis")).toBeInTheDocument();
  expect(marina.getByText("6,000 EGP")).toBeInTheDocument();
  expect(marina.getByText("2,000 EGP")).toBeInTheDocument();
  expect(marina.getByText("Not complete")).toBeInTheDocument();

  // The zero-payment customer: zero approved payments, 0 EGP paid, still listed.
  const zero = within(rows[2]);
  expect(zero.getByText("0")).toBeInTheDocument();
  expect(zero.getByText("0 EGP")).toBeInTheDocument();

  expect(screen.getByText(/2 customers/)).toBeInTheDocument();
});

test("shows only fields Season 2 registration actually stores — no Age or Instagram column", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  await renderPage();
  await screen.findByText("Marina Adel");
  expect(screen.queryByRole("columnheader", { name: /^age$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: /instagram/i })).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(11);
});

test("shows Full Payment Complete from the API flag", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer({ fullPaymentComplete: true })]));
  await renderPage();
  expect(await screen.findByText("Complete")).toBeInTheDocument();
});

test("first request is page 1 of 25 with no filters; the client never sends 'all customers'", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  await renderPage();
  await screen.findByText("Marina Adel");

  expect(adminApi.fetchAdminCustomers).toHaveBeenCalledTimes(1);
  expect(lastParams()).toMatchObject({ page: 1, pageSize: 25, q: "", schoolId: "", payment: "", fullPayment: "" });
  // It does not load deposits to join them in the browser.
  expect(adminApi.fetchDeposits).not.toHaveBeenCalled();
});

test("thumbnails are lazy, small Cloudinary renditions — and never expose a publicId", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([{ ...customer(), publicId: "secret-id" }]));
  const { container } = await renderPage();
  await screen.findByText("Marina Adel");

  const thumb = container.querySelector("img.s2-cust-thumb");
  expect(thumb).toHaveAttribute("loading", "lazy");
  expect(thumb).toHaveAttribute("decoding", "async");
  expect(thumb.getAttribute("src")).toContain("/upload/c_fill,g_face,w_72,h_72,q_auto,f_auto/v1712/");
  expect(document.body.textContent).not.toMatch(/secret-id/);
});

test("search is debounced and sent to the server as one request", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  await renderPage();
  await screen.findByText("Marina Adel");

  await user(() => userEvent.type(screen.getByLabelText("Search customers"), "marina"));
  await waitFor(() => expect(lastParams().q).toBe("marina"));
  // Not one request per keystroke: initial load + the debounced search.
  expect(adminApi.fetchAdminCustomers).toHaveBeenCalledTimes(2);
  expect(lastParams().page).toBe(1);
});

test("School, approved-payment and full-payment filters are sent to the server", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  await renderPage();
  await screen.findByText("Marina Adel");
  await screen.findByRole("option", { name: "Cairo Prep" });

  await user(() => userEvent.selectOptions(screen.getByLabelText("Filter by school"), "school-b"));
  await waitFor(() => expect(lastParams().schoolId).toBe("school-b"));

  await user(() => userEvent.selectOptions(screen.getByLabelText("Filter by approved payment"), "none"));
  await waitFor(() => expect(lastParams().payment).toBe("none"));

  await user(() => userEvent.selectOptions(screen.getByLabelText("Filter by full payment"), "complete"));
  await waitFor(() => expect(lastParams().fullPayment).toBe("complete"));

  expect(lastParams()).toMatchObject({ schoolId: "school-b", payment: "none", fullPayment: "complete", page: 1 });
});

test("optional registration date range is sent to the server", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  const { container } = await renderPage();
  await screen.findByText("Marina Adel");

  const [from, to] = container.querySelectorAll('input[type="date"]');
  await user(() => userEvent.type(from, "2026-09-01"));
  await user(() => userEvent.type(to, "2026-09-30"));
  await waitFor(() => expect(lastParams()).toMatchObject({ from: "2026-09-01", to: "2026-09-30" }));
});

test("pagination: Next/Previous request the adjacent page; a filter change returns to page 1", async () => {
  adminApi.fetchAdminCustomers.mockImplementation(async (params) =>
    page([customer({ fullName: `Customer on page ${params.page}` })], { page: params.page, total: 60, totalPages: 3 })
  );
  await renderPage();
  expect(await screen.findByText("Customer on page 1")).toBeInTheDocument();
  expect(screen.getByText(/Showing 1–1 of 60/)).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

  await user(() => userEvent.click(screen.getByRole("button", { name: "Next" })));
  expect(await screen.findByText("Customer on page 2")).toBeInTheDocument();
  expect(lastParams().page).toBe(2);

  await user(() => userEvent.click(screen.getByRole("button", { name: "Next" })));
  expect(await screen.findByText("Customer on page 3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

  await user(() => userEvent.click(screen.getByRole("button", { name: "Previous" })));
  expect(await screen.findByText("Customer on page 2")).toBeInTheDocument();

  await user(() => userEvent.selectOptions(screen.getByLabelText("Filter by approved payment"), "approved"));
  await waitFor(() => expect(lastParams()).toMatchObject({ payment: "approved", page: 1 }));
});

test("empty results explain themselves, and Clear resets the filters", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  await renderPage();
  await screen.findByText("Marina Adel");

  adminApi.fetchAdminCustomers.mockResolvedValue(page([], { total: 0 }));
  await user(() => userEvent.selectOptions(screen.getByLabelText("Filter by approved payment"), "approved"));
  expect(await screen.findByText("No customers match this search.")).toBeInTheDocument();

  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  await user(() => userEvent.click(screen.getByRole("button", { name: "Clear" })));
  expect(await screen.findByText("Marina Adel")).toBeInTheDocument();
  expect(lastParams()).toMatchObject({ payment: "", q: "", page: 1 });
});

test("a load error keeps the filters visible and Retry reloads", async () => {
  adminApi.fetchAdminCustomers.mockRejectedValueOnce(Object.assign(new Error("Server unavailable."), { kind: "http" }));
  adminApi.fetchAdminCustomers.mockResolvedValueOnce(page([customer()]));
  await renderPage();

  expect(await screen.findByText("Couldn't load customers")).toBeInTheDocument();
  expect(screen.getByLabelText("Search customers")).toBeInTheDocument();

  await user(() => userEvent.click(screen.getByRole("button", { name: "Retry" })));
  expect(await screen.findByText("Marina Adel")).toBeInTheDocument();
});

test("no customers at all → a plain empty message", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([]));
  await renderPage();
  expect(await screen.findByText("No customers have registered yet.")).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

test("selecting a row loads that customer's details lazily: profile, payment summary and history", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  adminApi.fetchAdminCustomer.mockResolvedValue(detail());
  await renderPage();
  const target = await screen.findByText("Marina Adel");
  await user(() => userEvent.click(target));

  const dialog = await screen.findByRole("dialog", { name: "Customer details" });
  expect(adminApi.fetchAdminCustomer).toHaveBeenCalledTimes(1);
  expect(adminApi.fetchAdminCustomer.mock.calls[0][0]).toBe("64b000000000000000000001");

  await within(dialog).findByRole("heading", { name: "Marina Adel" });
  expect(within(dialog).getByText("Customer ID")).toBeInTheDocument();
  expect(within(dialog).getByText("01012345678")).toBeInTheDocument();
  expect(within(dialog).getByText("marina@example.com")).toBeInTheDocument();
  expect(within(dialog).getAllByText("Mega Heliopolis").length).toBeGreaterThan(0);
  expect(within(dialog).getByText("6,000 EGP")).toBeInTheDocument();
  expect(within(dialog).getByText("Ticket price (locked)")).toBeInTheDocument();
  expect(within(dialog).queryByText(/^age$/i)).not.toBeInTheDocument();
  expect(within(dialog).queryByText(/instagram/i)).not.toBeInTheDocument();

  // Payment summary
  expect(within(dialog).getByText("Approved payments")).toBeInTheDocument();
  expect(within(dialog).getByText("2")).toBeInTheDocument();
  expect(within(dialog).getByText("2,000 EGP")).toBeInTheDocument();
  expect(within(dialog).getByText("Not complete")).toBeInTheDocument();

  // History with amounts, statuses, rejection reason and a proof link (no image loaded)
  const history = within(dialog).getByRole("region", { name: "Payment history" });
  expect(within(history).getByText(/1,500 EGP/)).toBeInTheDocument();
  expect(within(history).getByText("Blurry screenshot")).toBeInTheDocument();
  expect(within(history).getAllByText("approved")).toHaveLength(2);
  expect(within(history).getByRole("link", { name: "View proof" })).toHaveAttribute("href", "https://cdn.example/p1.jpg");
  expect(history.querySelector("img")).toBeNull();

  // Customer photo: lazy, small rendition, with a link to the full-size original.
  const photo = within(dialog).getByAltText("Registered customer");
  expect(photo).toHaveAttribute("loading", "lazy");
  expect(photo.getAttribute("src")).toContain("w_160,h_160");
  expect(within(dialog).getByRole("link", { name: "View photo full size" })).toHaveAttribute("href", PHOTO);
});

test("a customer with NO deposits opens normally and shows an empty payment history", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([ZERO_PAYMENT]));
  adminApi.fetchAdminCustomer.mockResolvedValue(
    detail({
      id: ZERO_PAYMENT.id,
      fullName: "Zero Deposits Customer",
      email: null,
      photoUrl: null,
      approvedPaymentCount: 0,
      approvedTotalPaid: 0,
      deposits: []
    })
  );
  await renderPage();
  const target = await screen.findByText("Zero Deposits Customer");
  await user(() => userEvent.click(target));

  const dialog = await screen.findByRole("dialog", { name: "Customer details" });
  await within(dialog).findByRole("heading", { name: "Zero Deposits Customer" });
  expect(within(dialog).getByText(/No payments yet/)).toBeInTheDocument();
  expect(within(dialog).getByText("0 EGP")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("No photo on file")).toBeInTheDocument();
});

test("Full Payment Complete shows in the detail panel when the accountant confirmed it", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer({ fullPaymentComplete: true })]));
  adminApi.fetchAdminCustomer.mockResolvedValue(detail({ fullPayment: { complete: true, confirmedAt: "2026-09-18T00:00:00.000Z", lastSyncedAt: null } }));
  await renderPage();
  const target = await screen.findByText("Marina Adel");
  await user(() => userEvent.click(target));

  const dialog = await screen.findByRole("dialog", { name: "Customer details" });
  expect(await within(dialog).findByText("Complete")).toBeInTheDocument();
});

test("the panel closes with the Close button and with Escape", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  adminApi.fetchAdminCustomer.mockResolvedValue(detail());
  await renderPage();

  const target = await screen.findByText("Marina Adel");

  await user(() => userEvent.click(target));
  await screen.findByRole("dialog", { name: "Customer details" });
  await user(() => userEvent.click(screen.getByRole("button", { name: "Close" })));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user(() => userEvent.click(screen.getByText("Marina Adel")));
  await screen.findByRole("dialog", { name: "Customer details" });
  await user(() => userEvent.keyboard("{Escape}"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a failed detail load shows an error with Retry", async () => {
  adminApi.fetchAdminCustomers.mockResolvedValue(page([customer()]));
  adminApi.fetchAdminCustomer.mockRejectedValueOnce(Object.assign(new Error("Customer not found."), { kind: "http" }));
  adminApi.fetchAdminCustomer.mockResolvedValueOnce(detail());
  await renderPage();
  const target = await screen.findByText("Marina Adel");
  await user(() => userEvent.click(target));

  const dialog = await screen.findByRole("dialog", { name: "Customer details" });
  expect(await within(dialog).findByText("Couldn't load this customer")).toBeInTheDocument();
  await user(() => userEvent.click(within(dialog).getByRole("button", { name: "Retry" })));
  expect(await within(dialog).findByRole("heading", { name: "Marina Adel" })).toBeInTheDocument();
});
