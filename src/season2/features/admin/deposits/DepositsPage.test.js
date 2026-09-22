import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DepositsPage from "./DepositsPage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api");

function deposit(overrides = {}) {
  return {
    _id: "dep1",
    amount: 500,
    status: "pending",
    createdAt: "2026-09-10T10:00:00.000Z",
    paymentOptionSnapshot: { amount: 500, label: "First deposit" },
    paymentProof: { url: "https://cdn.example/proof.jpg", publicId: "hidden-should-not-render" },
    attendeeId: {
      _id: "atd1",
      fullName: "Marina Adel",
      phone: "01012345678",
      ticketPrice: 6000,
      schoolId: { _id: "school-a", name: "Mega Heliopolis" }
    },
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("lists pending deposits by default and shows customer/school/amount/status", async () => {
  adminApi.fetchDeposits.mockResolvedValue([deposit()]);
  render(<DepositsPage />);

  expect(await screen.findByText("Marina Adel")).toBeInTheDocument();
  expect(screen.getByText("Mega Heliopolis")).toBeInTheDocument();
  expect(screen.getByText("500 EGP")).toBeInTheDocument();
  expect(adminApi.fetchDeposits.mock.calls[0][0]).toEqual({ status: "pending" });
});

test("switching tabs refetches with the new status filter", async () => {
  adminApi.fetchDeposits.mockResolvedValue([]);
  render(<DepositsPage />);
  const approvedTab = await screen.findByRole("tab", { name: "Approved" });

  await userEvent.click(approvedTab);
  await waitFor(() => expect(adminApi.fetchDeposits.mock.calls[1][0]).toEqual({ status: "approved" }));

  await userEvent.click(screen.getByRole("tab", { name: "All" }));
  await waitFor(() => expect(adminApi.fetchDeposits.mock.calls[2][0]).toEqual({ status: undefined }));
});

test("client-side search filters the currently-loaded list by name/phone/school", async () => {
  adminApi.fetchDeposits.mockResolvedValue([
    deposit({ _id: "dep1", attendeeId: { ...deposit().attendeeId, fullName: "Marina Adel" } }),
    deposit({ _id: "dep2", attendeeId: { ...deposit().attendeeId, fullName: "Youssef Hassan", phone: "01099998888" } })
  ]);
  render(<DepositsPage />);
  await screen.findByText("Marina Adel");
  expect(screen.getByText("Youssef Hassan")).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/search by name/i), "youssef");

  expect(screen.queryByText("Marina Adel")).not.toBeInTheDocument();
  expect(screen.getByText("Youssef Hassan")).toBeInTheDocument();
  // Confirms this is client-side filtering, not a new server call.
  expect(adminApi.fetchDeposits).toHaveBeenCalledTimes(1);
});

test("selecting a row shows the detail panel with the proof image and never the Cloudinary publicId", async () => {
  adminApi.fetchDeposits.mockResolvedValue([deposit()]);
  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));

  const image = await screen.findByAltText(/payment proof screenshot/i);
  expect(image).toHaveAttribute("src", "https://cdn.example/proof.jpg");
  expect(document.body.textContent).not.toMatch(/hidden-should-not-render/);
  expect(screen.getByText("6,000 EGP")).toBeInTheDocument(); // ticket price
  expect(screen.getByText(/First deposit/)).toBeInTheDocument(); // option label, beside its amount
});

test("approve calls the API, refetches, and disables both actions while in flight", async () => {
  adminApi.fetchDeposits.mockResolvedValue([deposit()]);
  let resolveApprove;
  adminApi.approveDeposit.mockReturnValue(new Promise((resolve) => (resolveApprove = resolve)));

  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));

  const approveBtn = screen.getByRole("button", { name: /^approve$/i });
  const rejectBtn = screen.getByRole("button", { name: /^reject$/i });
  await userEvent.click(approveBtn);

  expect(approveBtn).toBeDisabled();
  expect(rejectBtn).toBeDisabled();

  resolveApprove({ _id: "dep1", status: "approved" });
  await waitFor(() => expect(adminApi.fetchDeposits).toHaveBeenCalledTimes(2));
});

test("approve surfaces a 409 (already reviewed by someone else) and refetches to show the real state", async () => {
  adminApi.fetchDeposits.mockResolvedValueOnce([deposit()]).mockResolvedValueOnce([deposit({ status: "approved" })]);
  adminApi.approveDeposit.mockRejectedValue({ message: "This deposit was already reviewed.", status: 409 });

  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));
  await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

  expect(await screen.findByText("This deposit was already reviewed.")).toBeInTheDocument();
  await waitFor(() => expect(adminApi.fetchDeposits).toHaveBeenCalledTimes(2));
});

test("approve surfaces a 422 (would exceed ticket price) without recalculating anything client-side", async () => {
  adminApi.fetchDeposits.mockResolvedValue([deposit()]);
  adminApi.approveDeposit.mockRejectedValue({
    message: "Approving this deposit (500) would push the approved total (5800) above the ticket price (6000).",
    status: 422
  });

  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));
  await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

  expect(await screen.findByText(/would push the approved total/i)).toBeInTheDocument();
});

test("reject requires a reason before calling the API", async () => {
  adminApi.fetchDeposits.mockResolvedValue([deposit()]);
  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));

  await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));
  await userEvent.click(screen.getByRole("button", { name: /confirm reject/i }));

  expect(await screen.findByText(/rejection reason is required/i)).toBeInTheDocument();
  expect(adminApi.rejectDeposit).not.toHaveBeenCalled();
});

test("reject with a reason calls rejectDeposit({rejectionReason}) and refetches", async () => {
  adminApi.fetchDeposits.mockResolvedValue([deposit()]);
  adminApi.rejectDeposit.mockResolvedValue({ _id: "dep1", status: "rejected" });

  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));
  await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));
  await userEvent.type(screen.getByPlaceholderText(/screenshot did not clearly show/i), "Blurry image");
  await userEvent.click(screen.getByRole("button", { name: /confirm reject/i }));

  await waitFor(() => expect(adminApi.rejectDeposit).toHaveBeenCalledWith("dep1", { rejectionReason: "Blurry image" }));
  await waitFor(() => expect(adminApi.fetchDeposits).toHaveBeenCalledTimes(2));
});

test("an approved/rejected deposit shows no approve/reject controls (already-reviewed state)", async () => {
  adminApi.fetchDeposits.mockResolvedValue([deposit({ status: "approved", reviewedAt: "2026-09-11T10:00:00.000Z" })]);
  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));

  expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
});
