import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FinancePage from "./FinancePage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api");

const SCHOOL_A = { _id: "school-a", name: "Mega Heliopolis", ticketPrice: 6000 };
const SCHOOL_B = { _id: "school-b", name: "Downtown Prep", ticketPrice: 4500 };

const SHEET_ID = "1AbCdEf123456789_ABCDEFGHIJKLMNOPQRSTUVWX";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

const configFor = (school, overrides = {}) => ({
  _id: `cfg-${school._id}`,
  schoolId: { _id: school._id, name: school.name },
  googleSheetId: SHEET_ID,
  tabName: "Sheet1",
  enabled: true,
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  adminApi.fetchSchools.mockResolvedValue([SCHOOL_A, SCHOOL_B]);
});

describe("google sheet config", () => {
  test("a School with no config shows 'Not configured', empty link and no Open sheet", async () => {
    adminApi.fetchFinanceConfigs.mockResolvedValue([]);
    render(<FinancePage />);

    await screen.findByDisplayValue("Sheet1");
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/docs\.google\.com\/spreadsheets/i)).toHaveValue("");
    expect(screen.queryByRole("link", { name: /open sheet/i })).not.toBeInTheDocument();
  });

  test("a configured School shows 'Configured', the canonical link and an Open sheet link", async () => {
    adminApi.fetchFinanceConfigs.mockResolvedValue([configFor(SCHOOL_A, { tabName: "Finance" })]);
    render(<FinancePage />);

    expect(await screen.findByDisplayValue(SHEET_URL)).toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Finance")).toBeInTheDocument();
    expect(screen.getByText("Sheet connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open sheet/i })).toHaveAttribute("href", SHEET_URL);
  });

  test("pasting a FULL url sends it to the backend untouched — the browser never parses it", async () => {
    adminApi.fetchFinanceConfigs.mockResolvedValue([]);
    adminApi.saveFinanceConfig.mockResolvedValue(configFor(SCHOOL_A));

    render(<FinancePage />);
    await screen.findByRole("button", { name: /save config/i });

    const pasted = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;
    await userEvent.type(screen.getByPlaceholderText(/docs\.google\.com\/spreadsheets/i), pasted);
    await userEvent.click(screen.getByRole("button", { name: /save config/i }));

    await waitFor(() =>
      expect(adminApi.saveFinanceConfig).toHaveBeenCalledWith("school-a", {
        googleSheetUrl: pasted,
        tabName: "Sheet1",
        enabled: true
      })
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  test("a bare spreadsheet id can be pasted too", async () => {
    adminApi.fetchFinanceConfigs.mockResolvedValue([]);
    adminApi.saveFinanceConfig.mockResolvedValue(configFor(SCHOOL_A));

    render(<FinancePage />);
    await screen.findByRole("button", { name: /save config/i });
    await userEvent.type(screen.getByPlaceholderText(/docs\.google\.com\/spreadsheets/i), SHEET_ID);
    await userEvent.click(screen.getByRole("button", { name: /save config/i }));

    await waitFor(() =>
      expect(adminApi.saveFinanceConfig).toHaveBeenCalledWith("school-a", expect.objectContaining({ googleSheetUrl: SHEET_ID }))
    );
  });

  test("the backend's 422 for an invalid link is surfaced and nothing is marked saved", async () => {
    adminApi.fetchFinanceConfigs.mockResolvedValue([]);
    adminApi.saveFinanceConfig.mockRejectedValue({
      status: 422,
      message: "Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/…) or the spreadsheet ID itself."
    });

    render(<FinancePage />);
    await screen.findByRole("button", { name: /save config/i });
    await userEvent.type(screen.getByPlaceholderText(/docs\.google\.com\/spreadsheets/i), "https://example.com/nope");
    await userEvent.click(screen.getByRole("button", { name: /save config/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Paste a Google Sheets link/);
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  test("the enabled toggle is saved with the config", async () => {
    adminApi.fetchFinanceConfigs.mockResolvedValue([configFor(SCHOOL_A)]);
    adminApi.saveFinanceConfig.mockResolvedValue(configFor(SCHOOL_A, { enabled: false }));

    render(<FinancePage />);
    await screen.findByDisplayValue(SHEET_URL);
    await userEvent.click(screen.getByRole("checkbox", { name: /sync enabled/i }));
    await userEvent.click(screen.getByRole("button", { name: /save config/i }));

    await waitFor(() =>
      expect(adminApi.saveFinanceConfig).toHaveBeenCalledWith("school-a", expect.objectContaining({ enabled: false }))
    );
  });

  test("switching schools loads that School's own config, never mixing them", async () => {
    adminApi.fetchFinanceConfigs.mockResolvedValue([configFor(SCHOOL_A)]);
    render(<FinancePage />);
    await screen.findByDisplayValue(SHEET_URL);

    await userEvent.click(screen.getByRole("option", { name: /downtown prep/i }));

    await waitFor(() => expect(screen.queryByDisplayValue(SHEET_URL)).not.toBeInTheDocument());
    // Shown twice: in the School rail and as the panel's status.
    expect((await screen.findAllByText("Not configured")).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("link", { name: /open sheet/i })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/docs\.google\.com\/spreadsheets/i)).toHaveValue("");
  });
});

describe("sync actions", () => {
  const renderConfigured = async () => {
    adminApi.fetchFinanceConfigs.mockResolvedValue([
      configFor(SCHOOL_A, { lastSync: { at: "2026-09-20T10:00:00.000Z", status: "success" } })
    ]);
    render(<FinancePage />);
    await screen.findByRole("button", { name: /save config/i });
  };

  test("the two actions are separate, clearly labelled, and neither runs on load", async () => {
    await renderConfigured();

    expect(screen.getByRole("heading", { name: /customers → sheet/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /full payment → mongo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sync customers to sheet$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sync full payment from sheet$/i })).toBeInTheDocument();
    expect(adminApi.syncFinanceSheet).not.toHaveBeenCalled();
    expect(adminApi.syncFullPayment).not.toHaveBeenCalled();
    expect(screen.getByText(/last sync:/i)).toBeInTheDocument();
  });

  test("customers → sheet: loading state, then success counts", async () => {
    await renderConfigured();
    let resolveSync;
    adminApi.syncFinanceSheet.mockReturnValue(new Promise((resolve) => (resolveSync = resolve)));

    await userEvent.click(screen.getByRole("button", { name: /^sync customers to sheet$/i }));
    expect(screen.getByRole("button", { name: /syncing…/i })).toBeDisabled();

    resolveSync({ success: true, syncedCount: 4, updated: 1, appended: 3 });
    expect(await screen.findByText(/success — 4 row\(s\) synced, 1 updated, 3 appended/i)).toBeInTheDocument();
  });

  test("customers → sheet: skipped and error results are readable", async () => {
    await renderConfigured();
    adminApi.syncFinanceSheet.mockResolvedValueOnce({
      success: false,
      skipped: true,
      reason: "Google Service Account is not configured."
    });
    await userEvent.click(screen.getByRole("button", { name: /^sync customers to sheet$/i }));
    expect(await screen.findByText(/skipped — google service account is not configured/i)).toBeInTheDocument();

    adminApi.syncFinanceSheet.mockResolvedValueOnce({ success: false, error: "Spreadsheet not found." });
    await userEvent.click(screen.getByRole("button", { name: /^sync customers to sheet$/i }));
    expect(await screen.findByText(/failed — spreadsheet not found/i)).toBeInTheDocument();
  });

  test("full payment → mongo: confirmed/unconfirmed and skipped counts", async () => {
    await renderConfigured();
    adminApi.syncFullPayment.mockResolvedValue({
      success: true,
      syncedCount: 5,
      confirmedCount: 2,
      unconfirmedCount: 3,
      skippedUnknown: ["x"],
      skippedWrongSchool: ["y"],
      duplicateCustomerIds: ["z"]
    });

    await userEvent.click(screen.getByRole("button", { name: /^sync full payment from sheet$/i }));

    const banner = await screen.findByText(/2 confirmed, 3 not confirmed/i);
    expect(banner).toHaveTextContent(/1 row\(s\) skipped \(wrong School\)/i);
    expect(banner).toHaveTextContent(/1 row\(s\) skipped \(unknown customer id\)/i);
    expect(banner).toHaveTextContent(/1 duplicate id\(s\) ignored/i);
  });

  test("full payment → mongo: an error is surfaced", async () => {
    await renderConfigured();
    adminApi.syncFullPayment.mockResolvedValue({ success: false, error: "Auth failed." });

    await userEvent.click(screen.getByRole("button", { name: /^sync full payment from sheet$/i }));
    expect(await screen.findByText(/failed — auth failed/i)).toBeInTheDocument();
  });
});
