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

// The API now returns one page: { deposits, pagination }.
function listOf(deposits, pagination = {}) {
  return {
    deposits,
    pagination: { page: 1, pageSize: 25, total: deposits.length, totalPages: 1, ...pagination }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("lists pending deposits by default and shows customer/school/amount/status", async () => {
  adminApi.fetchDeposits.mockResolvedValue(listOf([deposit()]));
  render(<DepositsPage />);

  expect(await screen.findByText("Marina Adel")).toBeInTheDocument();
  expect(screen.getByText("Mega Heliopolis")).toBeInTheDocument();
  expect(screen.getByText("500 EGP")).toBeInTheDocument();
  // Pending by default, first page, 25 rows, no search — a single lean request.
  expect(adminApi.fetchDeposits.mock.calls[0][0]).toEqual({ status: "pending", page: 1, pageSize: 25, q: "" });
});

test("switching tabs refetches with the new status filter, from page 1", async () => {
  adminApi.fetchDeposits.mockResolvedValue(listOf([]));
  render(<DepositsPage />);
  const approvedTab = await screen.findByRole("tab", { name: "Approved" });

  await userEvent.click(approvedTab);
  await waitFor(() => expect(adminApi.fetchDeposits.mock.calls[1][0]).toEqual({ status: "approved", page: 1, pageSize: 25, q: "" }));

  await userEvent.click(screen.getByRole("tab", { name: "Rejected" }));
  await waitFor(() => expect(adminApi.fetchDeposits.mock.calls[2][0]).toEqual({ status: "rejected", page: 1, pageSize: 25, q: "" }));

  await userEvent.click(screen.getByRole("tab", { name: "All" }));
  await waitFor(() => expect(adminApi.fetchDeposits.mock.calls[3][0]).toEqual({ status: undefined, page: 1, pageSize: 25, q: "" }));
});

test("search by name/phone/school is done by the SERVER (debounced), so it covers every deposit — not just this page", async () => {
  adminApi.fetchDeposits.mockImplementation(async ({ q }) =>
    q
      ? listOf([deposit({ _id: "dep2", attendeeId: { ...deposit().attendeeId, fullName: "Youssef Hassan", phone: "01099998888" } })])
      : listOf(
          [
            deposit({ _id: "dep1", attendeeId: { ...deposit().attendeeId, fullName: "Marina Adel" } }),
            deposit({ _id: "dep2", attendeeId: { ...deposit().attendeeId, fullName: "Youssef Hassan", phone: "01099998888" } })
          ],
          { total: 60, totalPages: 3 }
        )
  );
  render(<DepositsPage />);
  await screen.findByText("Marina Adel");
  expect(screen.getByText("Youssef Hassan")).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/search by name/i), "youssef");

  await waitFor(() => expect(screen.queryByText("Marina Adel")).not.toBeInTheDocument());
  expect(screen.getByText("Youssef Hassan")).toBeInTheDocument();
  // Initial load + ONE debounced search request (not one per keystroke), sent with the text.
  expect(adminApi.fetchDeposits).toHaveBeenCalledTimes(2);
  expect(adminApi.fetchDeposits.mock.calls[1][0]).toEqual({ status: "pending", page: 1, pageSize: 25, q: "youssef" });
});

describe("pagination", () => {
  function pagedApi(total = 60) {
    adminApi.fetchDeposits.mockImplementation(async ({ page, pageSize }) => {
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const shown = Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
      return listOf(
        Array.from({ length: shown }, (_, i) =>
          deposit({ _id: `p${page}-${i}`, attendeeId: { ...deposit().attendeeId, fullName: `Person p${page} #${i}` } })
        ),
        { page, pageSize, total, totalPages }
      );
    });
  }

  test("shows page position and total, and Previous is disabled on the first page", async () => {
    pagedApi();
    render(<DepositsPage />);
    expect(await screen.findByText("Person p1 #0")).toBeInTheDocument();

    expect(screen.getByText(/Showing 1–25 of 60/)).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("60 deposits")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(25);
  });

  test("Next / Previous request the adjacent page; Next is disabled on the last page", async () => {
    pagedApi();
    render(<DepositsPage />);
    await screen.findByText("Person p1 #0");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Person p2 #0")).toBeInTheDocument();
    expect(adminApi.fetchDeposits.mock.calls.at(-1)[0]).toMatchObject({ page: 2, pageSize: 25 });

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Person p3 #0")).toBeInTheDocument();
    expect(screen.getByText(/Showing 51–60 of 60/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Person p2 #0")).toBeInTheDocument();
  });

  test("rows per page offers 25 / 50 / 100 and returns to page 1", async () => {
    pagedApi();
    render(<DepositsPage />);
    await screen.findByText("Person p1 #0");

    const select = screen.getByLabelText("Rows per page");
    expect([...select.options].map((option) => option.value)).toEqual(["25", "50", "100"]);
    expect(select).toHaveValue("25");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Person p2 #0");

    await userEvent.selectOptions(select, "50");
    expect(await screen.findByText("Person p1 #0")).toBeInTheDocument();
    expect(adminApi.fetchDeposits.mock.calls.at(-1)[0]).toMatchObject({ page: 1, pageSize: 50 });
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  test("changing the status tab or the search goes back to page 1", async () => {
    pagedApi();
    render(<DepositsPage />);
    await screen.findByText("Person p1 #0");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Person p2 #0");

    await userEvent.click(screen.getByRole("tab", { name: "Approved" }));
    await waitFor(() => expect(adminApi.fetchDeposits.mock.calls.at(-1)[0]).toMatchObject({ status: "approved", page: 1 }));

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Person p2 #0");
    await userEvent.type(screen.getByPlaceholderText(/search by name/i), "ma");
    await waitFor(() => expect(adminApi.fetchDeposits.mock.calls.at(-1)[0]).toMatchObject({ q: "ma", page: 1 }));
  });

  test("a single page needs no paging controls beyond the count, and an empty result says so", async () => {
    adminApi.fetchDeposits.mockResolvedValue(listOf([deposit()]));
    render(<DepositsPage />);
    await screen.findByText("Marina Adel");
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByText("1 deposit")).toBeInTheDocument();
  });

  test("reviewing the last deposit on a later page steps back to the last page that still exists", async () => {
    // Page 2 has one deposit. After it is reviewed the server reports 1 page of 25, and page 2 is gone.
    let reviewed = false;
    adminApi.fetchDeposits.mockImplementation(async ({ page }) => {
      if (reviewed) {
        return page === 1
          ? listOf([deposit({ _id: "first-page", attendeeId: { ...deposit().attendeeId, fullName: "Still Pending" } })], { total: 25, totalPages: 1 })
          : listOf([], { page, total: 25, totalPages: 1 });
      }
      return page === 1
        ? listOf(Array.from({ length: 25 }, (_, i) => deposit({ _id: `a${i}`, attendeeId: { ...deposit().attendeeId, fullName: `Row ${i}` } })), { total: 26, totalPages: 2 })
        : listOf([deposit({ _id: "only-on-page-2", attendeeId: { ...deposit().attendeeId, fullName: "Last One" } })], { page: 2, total: 26, totalPages: 2 });
    });
    adminApi.approveDeposit.mockImplementation(async () => {
      reviewed = true;
      return { _id: "only-on-page-2", status: "approved" };
    });

    render(<DepositsPage />);
    await screen.findByText("Row 0");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByText("Last One"));
    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(await screen.findByText("Still Pending")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });
});

test("selecting a row shows the detail panel with the proof image and never the Cloudinary publicId", async () => {
  adminApi.fetchDeposits.mockResolvedValue(listOf([deposit()]));
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
    adminApi.fetchDeposits.mockResolvedValue(listOf([{ ...withPhoto(), _id: "dep1" }, { ...withPhoto(), _id: "dep2" }]));
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
    adminApi.fetchDeposits.mockResolvedValue(listOf([withPhoto({ publicId: "secret-photo-public-id" })]));
    render(<DepositsPage />);
    await userEvent.click(await screen.findByText("Marina Adel"));

    const link = await screen.findByRole("link", { name: /open the customer photo full size/i });
    expect(link).toHaveAttribute("href", PHOTO);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(document.body.textContent).not.toMatch(/secret-photo-public-id/);
  });

  test("a non-Cloudinary photo URL is used as-is; a customer without a photo shows a clear empty state", async () => {
    adminApi.fetchDeposits.mockResolvedValue(
      listOf([
        deposit({ _id: "dep1", attendeeId: { ...deposit().attendeeId, incomerPhoto: { url: "https://cdn.example/plain.jpg" } } }),
        deposit({ _id: "dep2", attendeeId: { ...deposit().attendeeId, fullName: "No Photo Person", incomerPhoto: undefined } })
      ])
    );
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
    // A table thumbnail can ask for a smaller rendition.
    expect(customerPhotoThumbUrl(PHOTO, 72)).toContain("/upload/c_fill,g_face,w_72,h_72,q_auto,f_auto/v1712/");
  });
});

test("approve calls the API, refetches, and disables both actions while in flight", async () => {
  adminApi.fetchDeposits.mockResolvedValue(listOf([deposit()]));
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
  adminApi.fetchDeposits.mockResolvedValueOnce(listOf([deposit()])).mockResolvedValueOnce(listOf([deposit({ status: "approved" })]));
  adminApi.approveDeposit.mockRejectedValue({ message: "This deposit was already reviewed.", status: 409 });

  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));
  await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

  expect(await screen.findByText("This deposit was already reviewed.")).toBeInTheDocument();
  await waitFor(() => expect(adminApi.fetchDeposits).toHaveBeenCalledTimes(2));
});

test("approve surfaces a 422 (would exceed ticket price) without recalculating anything client-side", async () => {
  adminApi.fetchDeposits.mockResolvedValue(listOf([deposit()]));
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
  adminApi.fetchDeposits.mockResolvedValue(listOf([deposit()]));
  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));

  await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));
  await userEvent.click(screen.getByRole("button", { name: /confirm reject/i }));

  expect(await screen.findByText(/rejection reason is required/i)).toBeInTheDocument();
  expect(adminApi.rejectDeposit).not.toHaveBeenCalled();
});

test("reject with a reason calls rejectDeposit({rejectionReason}) and refetches", async () => {
  adminApi.fetchDeposits.mockResolvedValue(listOf([deposit()]));
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
  adminApi.fetchDeposits.mockResolvedValue(listOf([deposit({ status: "approved", reviewedAt: "2026-09-11T10:00:00.000Z" })]));
  render(<DepositsPage />);
  await userEvent.click(await screen.findByText("Marina Adel"));

  expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
});
