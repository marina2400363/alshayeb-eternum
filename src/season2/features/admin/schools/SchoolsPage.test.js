import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SchoolsPage from "./SchoolsPage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api");

const SCHOOL_A = { _id: "school-a", name: "Mega Heliopolis", ticketPrice: 6000 };
const SCHOOL_B = { _id: "school-b", name: "Downtown Prep", ticketPrice: 4500 };

function optionsForSchool(schoolId) {
  if (schoolId === "school-a") {
    return [
      { _id: "po-a1", schoolId: "school-a", amount: 500, label: null, enabled: true, displayOrder: 1, createdAt: "2026-01-01" },
      { _id: "po-a2", schoolId: "school-a", amount: 1000, label: null, enabled: true, displayOrder: 2, createdAt: "2026-01-02" }
    ];
  }
  return [{ _id: "po-b1", schoolId: "school-b", amount: 750, label: null, enabled: true, displayOrder: 1, createdAt: "2026-01-01" }];
}

beforeEach(() => {
  jest.clearAllMocks();
  adminApi.fetchSchools.mockResolvedValue([SCHOOL_A, SCHOOL_B]);
  adminApi.fetchSchoolPaymentOptions.mockImplementation((schoolId) => Promise.resolve(optionsForSchool(schoolId)));
});

test("lists schools and auto-selects the first one, showing its ticket price and options", async () => {
  render(<SchoolsPage />);
  await screen.findByText("Mega Heliopolis");
  expect(await screen.findByText("500 EGP")).toBeInTheDocument();
  expect(adminApi.fetchSchoolPaymentOptions.mock.calls[0][0]).toBe("school-a");
  expect(screen.getByText("1,000 EGP")).toBeInTheDocument();
});

test("selecting School B loads ONLY School B's options — School A's never leak in", async () => {
  render(<SchoolsPage />);
  await screen.findByText("500 EGP");

  const schoolBOption = screen.getByRole("option", { name: /downtown prep/i });
  await userEvent.click(schoolBOption);

  await waitFor(() => expect(schoolBOption).toHaveAttribute("aria-selected", "true"));
  expect(await screen.findByText("750 EGP")).toBeInTheDocument();
  expect(adminApi.fetchSchoolPaymentOptions.mock.calls.map((call) => call[0])).toEqual(["school-a", "school-b"]);
  expect(screen.queryByText("500 EGP")).not.toBeInTheDocument();
  expect(screen.queryByText("1,000 EGP")).not.toBeInTheDocument();
});

test("editing the ticket price shows the price-lock note and calls updateSchool", async () => {
  adminApi.updateSchool.mockResolvedValue({ ...SCHOOL_A, ticketPrice: 6500 });
  render(<SchoolsPage />);
  await screen.findByText("Mega Heliopolis");

  const priceInput = await screen.findByDisplayValue("6000");
  expect(screen.getByText(/price locks at their first payment request/i)).toBeInTheDocument();
  await userEvent.clear(priceInput);
  await userEvent.type(priceInput, "6500");
  const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
  await userEvent.click(saveButtons[1]); // name save, then price save

  await waitFor(() => expect(adminApi.updateSchool).toHaveBeenCalledWith("school-a", { ticketPrice: 6500 }));
});

test("creating a school validates name and a positive ticket price", async () => {
  render(<SchoolsPage />);
  await screen.findByText("Mega Heliopolis");

  await userEvent.click(screen.getByRole("button", { name: /new school/i }));
  await userEvent.click(screen.getByRole("button", { name: /create school/i }));

  expect(await screen.findByText(/school name is required/i)).toBeInTheDocument();
  expect(adminApi.createSchool).not.toHaveBeenCalled();
});

test("creating a school with valid data calls createSchool with {name, ticketPrice}", async () => {
  adminApi.createSchool.mockResolvedValue({ _id: "school-c", name: "New School", ticketPrice: 3000 });
  render(<SchoolsPage />);
  await screen.findByText("Mega Heliopolis");

  await userEvent.click(screen.getByRole("button", { name: /new school/i }));
  const form = screen.getByRole("button", { name: /create school/i }).closest("form");
  const nameField = within(form).getByText("Name").parentElement.querySelector("input");
  const priceField = within(form).getByText("Full ticket price").parentElement.querySelector("input");
  await userEvent.type(nameField, "New School");
  await userEvent.type(priceField, "3000");
  await userEvent.click(within(form).getByRole("button", { name: /create school/i }));

  await waitFor(() => expect(adminApi.createSchool).toHaveBeenCalledWith({ name: "New School", ticketPrice: 3000 }));
});

describe("ticket price visibility", () => {
  test("shows the switch ON by default and turning it off sends ONLY the visibility flag", async () => {
    adminApi.updateSchool.mockResolvedValue({ ...SCHOOL_A, showTicketPriceToCustomer: false });
    render(<SchoolsPage />);
    await screen.findByText("Mega Heliopolis");

    const toggle = await screen.findByRole("switch", { name: /show ticket price to customer/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);

    await waitFor(() => expect(adminApi.updateSchool).toHaveBeenCalledWith("school-a", { showTicketPriceToCustomer: false }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText(/price hidden/i)).toBeInTheDocument();
  });

  test("a hidden School can be switched back on", async () => {
    adminApi.fetchSchools.mockResolvedValue([{ ...SCHOOL_A, showTicketPriceToCustomer: false }, SCHOOL_B]);
    adminApi.updateSchool.mockResolvedValue({ ...SCHOOL_A, showTicketPriceToCustomer: true });
    render(<SchoolsPage />);

    const toggle = await screen.findByRole("switch", { name: /show ticket price to customer/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    await waitFor(() => expect(adminApi.updateSchool).toHaveBeenCalledWith("school-a", { showTicketPriceToCustomer: true }));
  });

  test("each School has its own setting", async () => {
    adminApi.fetchSchools.mockResolvedValue([SCHOOL_A, { ...SCHOOL_B, showTicketPriceToCustomer: false }]);
    render(<SchoolsPage />);
    const toggle = await screen.findByRole("switch", { name: /show ticket price to customer/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByRole("option", { name: /downtown prep/i }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /show ticket price to customer/i })).toHaveAttribute("aria-checked", "false")
    );
  });
});

describe("school access code", () => {
  test("a School with no code yet shows the empty placeholder and a disabled Copy button", async () => {
    render(<SchoolsPage />);
    await screen.findByText("Mega Heliopolis");

    expect(await screen.findByPlaceholderText("No code set")).toHaveValue("");
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeDisabled();
  });

  test("an existing code is shown and can be copied", async () => {
    adminApi.fetchSchools.mockResolvedValue([{ ...SCHOOL_A, accessCode: "ABCD1234" }, SCHOOL_B]);
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<SchoolsPage />);
    await screen.findByDisplayValue("ABCD1234");
    const copyButton = screen.getByRole("button", { name: /^copy$/i });
    expect(copyButton).not.toBeDisabled();

    await userEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith("ABCD1234");
    expect(await screen.findByRole("button", { name: /^copied!$/i })).toBeInTheDocument();
  });

  test("Generate new code calls setAccessCode with no code and shows the fresh one", async () => {
    adminApi.fetchSchools.mockResolvedValue([{ ...SCHOOL_A, accessCode: "OLDCODE1" }, SCHOOL_B]);
    adminApi.setSchoolAccessCode.mockResolvedValue({ ...SCHOOL_A, accessCode: "NEWCODE2" });

    render(<SchoolsPage />);
    await screen.findByLabelText(/school access code/i);

    await userEvent.click(screen.getByRole("button", { name: /generate new code/i }));

    await waitFor(() => expect(adminApi.setSchoolAccessCode).toHaveBeenCalledWith("school-a", ""));
    await waitFor(() => expect(screen.getByLabelText(/school access code/i)).toHaveValue("NEWCODE2"));
  });

  test("Save sets a custom code and normalizes what is shown", async () => {
    adminApi.setSchoolAccessCode.mockResolvedValue({ ...SCHOOL_A, accessCode: "MYCUSTOM" });
    render(<SchoolsPage />);
    const codeInput = await screen.findByLabelText(/school access code/i);

    await userEvent.type(codeInput, "mycustom");
    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    await userEvent.click(saveButtons[saveButtons.length - 1]); // name save, price save, then access-code save

    await waitFor(() => expect(adminApi.setSchoolAccessCode).toHaveBeenCalledWith("school-a", "MYCUSTOM"));
  });

  test("saving a blank code shows a validation error and never calls the API", async () => {
    render(<SchoolsPage />);
    await screen.findByLabelText(/school access code/i);

    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    await userEvent.click(saveButtons[saveButtons.length - 1]);

    expect(await screen.findByText(/enter an access code, or use generate/i)).toBeInTheDocument();
    expect(adminApi.setSchoolAccessCode).not.toHaveBeenCalled();
  });

  test("a rejected custom code (409, taken by another School) surfaces the backend's message", async () => {
    adminApi.setSchoolAccessCode.mockRejectedValue({ message: "This access code is already used by another School." });
    render(<SchoolsPage />);
    const codeInput = await screen.findByLabelText(/school access code/i);

    await userEvent.type(codeInput, "TAKEN001");
    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    await userEvent.click(saveButtons[saveButtons.length - 1]);

    expect(await screen.findByText(/already used by another school/i)).toBeInTheDocument();
  });

  test("each School has its own access code", async () => {
    adminApi.fetchSchools.mockResolvedValue([{ ...SCHOOL_A, accessCode: "CODEAAAA" }, { ...SCHOOL_B, accessCode: "CODEBBBB" }]);
    render(<SchoolsPage />);
    await waitFor(() => expect(screen.getByLabelText(/school access code/i)).toHaveValue("CODEAAAA"));

    await userEvent.click(screen.getByRole("option", { name: /downtown prep/i }));
    await waitFor(() => expect(screen.getByLabelText(/school access code/i)).toHaveValue("CODEBBBB"));
  });
});

describe("payment options editor (embedded)", () => {
  test("rejects a zero or negative amount", async () => {
    render(<SchoolsPage />);
    await screen.findByText("500 EGP");

    const amountInput = screen.getByPlaceholderText("e.g. 500");
    await userEvent.type(amountInput, "0");
    await userEvent.click(screen.getByRole("button", { name: /add option/i }));

    expect(await screen.findByText(/positive amount greater than 0/i)).toBeInTheDocument();
    expect(adminApi.createPaymentOption).not.toHaveBeenCalled();
  });

  test("creating an option always sends the selected school's schoolId", async () => {
    adminApi.createPaymentOption.mockResolvedValue({
      _id: "po-a3",
      schoolId: "school-a",
      amount: 2000,
      label: null,
      enabled: true,
      displayOrder: 3,
      createdAt: "2026-01-03"
    });
    render(<SchoolsPage />);
    await screen.findByText("500 EGP");

    await userEvent.type(screen.getByPlaceholderText("e.g. 500"), "2000");
    await userEvent.click(screen.getByRole("button", { name: /add option/i }));

    await waitFor(() =>
      expect(adminApi.createPaymentOption).toHaveBeenCalledWith(
        expect.objectContaining({ schoolId: "school-a", amount: 2000 })
      )
    );
  });

  test("an option above the ticket price is allowed — no warning, no block", async () => {
    adminApi.createPaymentOption.mockResolvedValue({
      _id: "po-a3",
      schoolId: "school-a",
      amount: 9999,
      label: null,
      enabled: true,
      displayOrder: 3,
      createdAt: "2026-01-03"
    });
    render(<SchoolsPage />);
    await screen.findByText("500 EGP");

    await userEvent.type(screen.getByPlaceholderText("e.g. 500"), "9999");
    await userEvent.click(screen.getByRole("button", { name: /add option/i }));

    expect(await screen.findByText("9,999 EGP")).toBeInTheDocument();
    expect(adminApi.createPaymentOption).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "school-a", amount: 9999 }));
    expect(screen.queryByText(/above ticket price|does not equal|plan/i)).not.toBeInTheDocument();
  });

  test("toggling enabled/disabled calls updatePaymentOption with {enabled}", async () => {
    adminApi.updatePaymentOption.mockResolvedValue({
      _id: "po-a1",
      schoolId: "school-a",
      amount: 500,
      label: null,
      enabled: false,
      displayOrder: 1,
      createdAt: "2026-01-01"
    });
    render(<SchoolsPage />);
    await screen.findByText("500 EGP");

    const checkbox = screen.getAllByRole("checkbox")[0];
    await userEvent.click(checkbox);

    await waitFor(() => expect(adminApi.updatePaymentOption).toHaveBeenCalledWith("po-a1", { enabled: false }));
  });

  test("deleting an option calls deletePaymentOption and removes it from the list", async () => {
    adminApi.deletePaymentOption.mockResolvedValue({ success: true });
    render(<SchoolsPage />);
    await screen.findByText("500 EGP");

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await userEvent.click(deleteButtons[0]);

    await waitFor(() => expect(adminApi.deletePaymentOption).toHaveBeenCalledWith("po-a1"));
    await waitFor(() => expect(screen.queryByText("500 EGP")).not.toBeInTheDocument());
  });

  test("reordering swaps displayOrder between two adjacent options", async () => {
    adminApi.updatePaymentOption.mockImplementation((id, updates) =>
      Promise.resolve({ ...optionsForSchool("school-a").find((o) => o._id === id), ...updates })
    );
    render(<SchoolsPage />);
    await screen.findByText("500 EGP");

    const moveDownButtons = screen.getAllByRole("button", { name: /move.*down/i });
    await userEvent.click(moveDownButtons[0]); // move 500 EGP (order 1) down

    await waitFor(() => {
      expect(adminApi.updatePaymentOption).toHaveBeenCalledWith("po-a1", { displayOrder: 2 });
      expect(adminApi.updatePaymentOption).toHaveBeenCalledWith("po-a2", { displayOrder: 1 });
    });
  });
});
