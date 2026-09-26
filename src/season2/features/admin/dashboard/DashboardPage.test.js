import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPage from "./DashboardPage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api");

// Render inside an async act so the first fetch (which resolves on a microtask)
// is flushed inside act rather than after it.
async function renderPage() {
  let view;
  await act(async () => {
    view = render(<DashboardPage />);
  });
  return view;
}

// User events (and the state updates their resolved fetches cause) run inside act.
const user = (action) => act(async () => { await action(); });

function dashboard(overrides = {}) {
  return {
    generatedAt: "2026-09-20T12:00:00.000Z",
    kpis: {
      totalRegisteredIncomers: 1284,
      registeredToday: 17,
      customersWithNoApprovedPayment: 402,
      customersWithApprovedPayment: 882,
      fullPaymentComplete: 96,
      pendingDeposits: 31,
      approvedDeposits: 1010,
      rejectedDeposits: 12,
      totalApprovedAmount: 2450000,
      totalSchools: 9
    },
    schools: [
      {
        schoolId: "s1",
        schoolName: "Mega Heliopolis",
        totalRegistered: 300,
        noApprovedPayment: 100,
        withApprovedPayment: 200,
        fullPaymentComplete: 40,
        pendingDeposits: 7,
        approvedDeposits: 260,
        rejectedDeposits: 3,
        totalApprovedAmount: 640000
      },
      {
        schoolId: "s2",
        schoolName: "Cairo Prep",
        totalRegistered: 0,
        noApprovedPayment: 0,
        withApprovedPayment: 0,
        fullPaymentComplete: 0,
        pendingDeposits: 0,
        approvedDeposits: 0,
        rejectedDeposits: 0,
        totalApprovedAmount: 0
      }
    ],
    recent: {
      registrations: [{ id: "r1", fullName: "Newest Registrant", schoolName: "Mega Heliopolis", at: "2026-09-20T11:00:00.000Z" }],
      depositSubmissions: [
        { id: "d1", attendeeId: "a1", fullName: "Submitter One", amount: 1500, status: "pending", at: "2026-09-20T10:00:00.000Z" }
      ],
      approvedPayments: [{ id: "d2", attendeeId: "a2", fullName: "Payer Two", amount: 2500, at: "2026-09-20T09:00:00.000Z" }]
    },
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("renders all ten KPI numbers from the API", async () => {
  adminApi.fetchAdminDashboard.mockResolvedValue(dashboard());
  await renderPage();

  expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  const value = (key) => screen.getByTestId(`kpi-${key}`).textContent;

  expect(value("totalRegisteredIncomers")).toBe("1,284");
  expect(value("registeredToday")).toBe("17");
  expect(value("customersWithNoApprovedPayment")).toBe("402");
  expect(value("customersWithApprovedPayment")).toBe("882");
  expect(value("fullPaymentComplete")).toBe("96");
  expect(value("pendingDeposits")).toBe("31");
  expect(value("approvedDeposits")).toBe("1,010");
  expect(value("rejectedDeposits")).toBe("12");
  expect(value("totalApprovedAmount")).toBe("2,450,000 EGP");
  expect(value("totalSchools")).toBe("9");

  // Labels match the agreed metric names.
  for (const label of [
    "Total Registered Incomers",
    "Registered Today",
    "No Approved Payment Yet",
    "With Approved Payment",
    "Full Payment Complete",
    "Pending Deposits",
    "Approved Deposits",
    "Rejected Deposits",
    "Total Approved Amount",
    "Total Schools"
  ]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

test("renders the School breakdown, including a school with no customers", async () => {
  adminApi.fetchAdminDashboard.mockResolvedValue(dashboard());
  await renderPage();

  const table = await screen.findByRole("table");
  const rows = within(table).getAllByRole("row");
  // header + two schools
  expect(rows).toHaveLength(3);

  const mega = within(rows[1]);
  expect(mega.getByText("Mega Heliopolis")).toBeInTheDocument();
  expect(mega.getByText("300")).toBeInTheDocument(); // registered
  expect(mega.getByText("100")).toBeInTheDocument(); // no approved payment
  expect(mega.getByText("200")).toBeInTheDocument(); // with approved payment
  expect(mega.getByText("40")).toBeInTheDocument(); // full payment
  expect(mega.getByText("640,000 EGP")).toBeInTheDocument(); // approved amount

  expect(within(rows[2]).getByText("Cairo Prep")).toBeInTheDocument();
  expect(within(rows[2]).getByText("0 EGP")).toBeInTheDocument();

  for (const heading of ["School", "Registered", "No approved payment", "With approved payment", "Full payment", "Pending deposits", "Approved deposits", "Approved amount"]) {
    expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
  }
});

test("renders the three Recent Activity lists", async () => {
  adminApi.fetchAdminDashboard.mockResolvedValue(dashboard());
  await renderPage();

  const registrations = await screen.findByRole("region", { name: "Latest registrations" });
  expect(within(registrations).getByText("Newest Registrant")).toBeInTheDocument();
  expect(within(registrations).getByText("Mega Heliopolis")).toBeInTheDocument();

  const submissions = screen.getByRole("region", { name: "Latest deposit submissions" });
  expect(within(submissions).getByText("Submitter One")).toBeInTheDocument();
  expect(within(submissions).getByText(/1,500 EGP/)).toBeInTheDocument();
  expect(within(submissions).getByText("pending")).toBeInTheDocument();

  const approvals = screen.getByRole("region", { name: "Latest approved payments" });
  expect(within(approvals).getByText("Payer Two")).toBeInTheDocument();
  expect(within(approvals).getByText("2,500 EGP")).toBeInTheDocument();
});

test("empty recent lists show friendly placeholders, not blanks", async () => {
  adminApi.fetchAdminDashboard.mockResolvedValue(
    dashboard({ schools: [], recent: { registrations: [], depositSubmissions: [], approvedPayments: [] } })
  );
  await renderPage();

  expect(await screen.findByText("No registrations yet.")).toBeInTheDocument();
  expect(screen.getByText("No deposits submitted yet.")).toBeInTheDocument();
  expect(screen.getByText("No approved payments yet.")).toBeInTheDocument();
  expect(screen.getByText("No Schools have been set up yet.")).toBeInTheDocument();
});

test("shows a loading state, then an error with Retry that reloads", async () => {
  adminApi.fetchAdminDashboard.mockRejectedValueOnce(Object.assign(new Error("Server unavailable."), { kind: "http" }));
  adminApi.fetchAdminDashboard.mockResolvedValueOnce(dashboard());
  // Plain render (not renderPage) so the very first, still-loading frame is observable.
  render(<DashboardPage />);

  expect(screen.getByText("Loading dashboard")).toBeInTheDocument();
  expect(await screen.findByText("Couldn't load the dashboard")).toBeInTheDocument();
  expect(screen.getByText("Server unavailable.")).toBeInTheDocument();

  await user(() => userEvent.click(screen.getByRole("button", { name: "Retry" })));
  expect(await screen.findByTestId("kpi-totalRegisteredIncomers")).toHaveTextContent("1,284");
  expect(adminApi.fetchAdminDashboard).toHaveBeenCalledTimes(2);
});

test("Refresh reloads the numbers", async () => {
  adminApi.fetchAdminDashboard.mockResolvedValueOnce(dashboard());
  adminApi.fetchAdminDashboard.mockResolvedValueOnce(
    dashboard({ kpis: { ...dashboard().kpis, totalRegisteredIncomers: 1300 } })
  );
  await renderPage();
  expect(await screen.findByTestId("kpi-totalRegisteredIncomers")).toHaveTextContent("1,284");

  await user(() => userEvent.click(screen.getByRole("button", { name: "Refresh" })));
  await waitFor(() => expect(screen.getByTestId("kpi-totalRegisteredIncomers")).toHaveTextContent("1,300"));
});

test("makes exactly one API call — no per-customer or per-deposit fetching from the browser", async () => {
  adminApi.fetchAdminDashboard.mockResolvedValue(dashboard());
  await renderPage();
  await screen.findByTestId("kpi-totalRegisteredIncomers");

  expect(adminApi.fetchAdminDashboard).toHaveBeenCalledTimes(1);
  expect(adminApi.fetchDeposits).not.toHaveBeenCalled();
  expect(adminApi.fetchAdminCustomers).not.toHaveBeenCalled();
});
