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

describe("customer photo in the details view", () => {
  const PHOTO = "https://res.cloudinary.com/demo/image/upload/v1712/alshayeb/incomer-photos/marina.jpg";
  const withPhoto = (extra = {}) =>
    deposit({ attendeeId: { ...deposit().attendeeId, incomerPhoto: { url: PHOTO, ...extra } } });

  test("the list never loads a photo; opening a customer shows ONE small lazy preview", async () => {
    adminApi.fetchDeposits.mockResolvedValue([{ ...withPhoto(), _id: "dep1" }, { ...withPhoto(), _id: "dep2" }]);
    render(<DepositsPage />);
    await screen.findAllByText("Marina Adel");

    // nothing photo-related exists in the table before a row is selected
    expect(screen.queryByAltText(/registered customer/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll("img")).toHaveLength(0);

    await userEvent.click(screen.getAllByText("Marina Adel")[0]);

    const photo = await screen.findByAltText(/registered customer/i);
    expect(photo).toHaveAttribute("loading", "lazy");
    expect(photo).toHaveAttribute("decoding", "async");
    // a small Cloudinary rendition of the SAME stored image (no upload, no copy)
    expect(photo.getAttribute("src")).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,g_face,w_160,h_160,q_auto,f_auto/v1712/alshayeb/incomer-photos/marina.jpg"
    );
    expect(photo).toHaveAttribute("width", "96");
    // only the selected customer's photo is on the page
    expect(document.querySelectorAll('img[alt="Registered customer"]')).toHaveLength(1);
  });

  test("the preview opens the untouched full-size original in a new tab; publicId is never rendered", async () => {
    adminApi.fetchDeposits.mockResolvedValue([withPhoto({ publicId: "secret-photo-public-id" })]);
    render(<DepositsPage />);
    await userEvent.click(await screen.findByText("Marina Adel"));

    const link = await screen.findByRole("link", { name: /open the customer photo full size/i });
    expect(link).toHaveAttribute("href", PHOTO);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(document.body.textContent).not.toMatch(/secret-photo-public-id/);
  });

  test("a non-Cloudinary photo URL is used as-is; a customer without a photo shows a clear empty state", async () => {
    adminApi.fetchDeposits.mockResolvedValue([
      deposit({ _id: "dep1", attendeeId: { ...deposit().attendeeId, incomerPhoto: { url: "https://cdn.example/plain.jpg" } } }),
      deposit({ _id: "dep2", attendeeId: { ...deposit().attendeeId, fullName: "No Photo Person", incomerPhoto: undefined } })
    ]);
    render(<DepositsPage />);

    await userEvent.click(await screen.findByText("Marina Adel"));
    expect(await screen.findByAltText(/registered customer/i)).toHaveAttribute("src", "https://cdn.example/plain.jpg");

    await userEvent.click(screen.getByText("No Photo Person"));
    expect(await screen.findByText(/no photo on file/i)).toBeInTheDocument();
    expect(screen.queryByAltText(/registered customer/i)).not.toBeInTheDocument();
  });

  test("customerPhotoThumbUrl only rewrites versioned Cloudinary upload URLs", () => {
    const { customerPhotoThumbUrl } = require("./customerPhoto");
    expect(customerPhotoThumbUrl("")).toBe("");
    expect(customerPhotoThumbUrl(undefined)).toBe("");
    expect(customerPhotoThumbUrl("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
    // already transformed: left alone (never double-transformed)
    const transformed = "https://res.cloudinary.com/demo/image/upload/c_fill,w_10/v1/a.jpg";
    expect(customerPhotoThumbUrl(transformed)).toBe(transformed);
    expect(customerPhotoThumbUrl(PHOTO)).toContain("/upload/c_fill,g_face,w_160,h_160,q_auto,f_auto/v1712/");
  });
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
