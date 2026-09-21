import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FinancePage from "./FinancePage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api");

const SCHOOL_A = { _id: "school-a", name: "Mega Heliopolis", ticketPrice: 6000 };
const SCHOOL_B = { _id: "school-b", name: "Downtown Prep", ticketPrice: 4500 };

beforeEach(() => {
  jest.clearAllMocks();
  adminApi.fetchSchools.mockResolvedValue([SCHOOL_A, SCHOOL_B]);
});

test("School A with no config shows 'Not configured' and empty defaults", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([]);
  render(<FinancePage />);

  await screen.findByDisplayValue("Sheet1");
  expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
});

test("a School with an existing config shows its sheet id/tab/enabled state", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([
    { _id: "cfg1", schoolId: { _id: "school-a", name: "Mega Heliopolis" }, googleSheetId: "sheet-abc", tabName: "Finance", enabled: true }
  ]);
  render(<FinancePage />);

  await screen.findByDisplayValue("sheet-abc");
  expect(screen.getByText("Sync enabled")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Finance")).toBeInTheDocument();
});

test("saving a config calls saveFinanceConfig(schoolId, {googleSheetId, tabName, enabled})", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([]);
  adminApi.saveFinanceConfig.mockResolvedValue({ schoolId: "school-a", googleSheetId: "sheet-xyz", tabName: "Sheet1", enabled: true });

  render(<FinancePage />);
  await screen.findByRole("button", { name: /save config/i });

  await userEvent.type(screen.getByPlaceholderText(/spreadsheet id/i), "sheet-xyz");
  await userEvent.click(screen.getByRole("button", { name: /save config/i }));

  await waitFor(() =>
    expect(adminApi.saveFinanceConfig).toHaveBeenCalledWith("school-a", { googleSheetId: "sheet-xyz", tabName: "Sheet1", enabled: true })
  );
});

test("sync finance to sheet shows a success result with counts", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([
    { _id: "cfg1", schoolId: { _id: "school-a", name: "Mega Heliopolis" }, googleSheetId: "sheet-abc", tabName: "Sheet1", enabled: true }
  ]);
  adminApi.syncFinanceSheet.mockResolvedValue({ success: true, syncedCount: 4, updated: 1, appended: 3 });

  render(<FinancePage />);
  await screen.findByRole("button", { name: /save config/i });

  await userEvent.click(screen.getByRole("button", { name: /^sync finance to sheet$/i }));

  expect(await screen.findByText(/success — 4 row\(s\) synced, 1 updated, 3 appended/i)).toBeInTheDocument();
});

test("sync finance to sheet shows a skipped result (e.g. Google not configured) without throwing", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([
    { _id: "cfg1", schoolId: { _id: "school-a", name: "Mega Heliopolis" }, googleSheetId: "sheet-abc", tabName: "Sheet1", enabled: true }
  ]);
  adminApi.syncFinanceSheet.mockResolvedValue({ success: false, skipped: true, reason: "Google Service Account is not configured." });

  render(<FinancePage />);
  await screen.findByRole("button", { name: /save config/i });
  await userEvent.click(screen.getByRole("button", { name: /^sync finance to sheet$/i }));

  expect(await screen.findByText(/skipped — google service account is not configured/i)).toBeInTheDocument();
});

test("sync finance to sheet shows an error result", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([
    { _id: "cfg1", schoolId: { _id: "school-a", name: "Mega Heliopolis" }, googleSheetId: "sheet-abc", tabName: "Sheet1", enabled: true }
  ]);
  adminApi.syncFinanceSheet.mockResolvedValue({ success: false, error: "Spreadsheet not found." });

  render(<FinancePage />);
  await screen.findByRole("button", { name: /save config/i });
  await userEvent.click(screen.getByRole("button", { name: /^sync finance to sheet$/i }));

  expect(await screen.findByText(/failed — spreadsheet not found/i)).toBeInTheDocument();
});

test("sync full payment from sheet shows a success result with confirmed/unconfirmed counts", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([
    { _id: "cfg1", schoolId: { _id: "school-a", name: "Mega Heliopolis" }, googleSheetId: "sheet-abc", tabName: "Sheet1", enabled: true }
  ]);
  adminApi.syncFullPayment.mockResolvedValue({
    success: true,
    syncedCount: 5,
    confirmedCount: 2,
    unconfirmedCount: 3,
    skippedUnknown: [],
    skippedWrongSchool: [],
    duplicateCustomerIds: []
  });

  render(<FinancePage />);
  await screen.findByRole("button", { name: /save config/i });
  await userEvent.click(screen.getByRole("button", { name: /sync full payment from sheet/i }));

  expect(await screen.findByText(/2 confirmed, 3 not confirmed/i)).toBeInTheDocument();
});

test("sync full payment from sheet shows an error result", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([
    { _id: "cfg1", schoolId: { _id: "school-a", name: "Mega Heliopolis" }, googleSheetId: "sheet-abc", tabName: "Sheet1", enabled: true }
  ]);
  adminApi.syncFullPayment.mockResolvedValue({ success: false, error: "Auth failed." });

  render(<FinancePage />);
  await screen.findByRole("button", { name: /save config/i });
  await userEvent.click(screen.getByRole("button", { name: /sync full payment from sheet/i }));

  expect(await screen.findByText(/failed — auth failed/i)).toBeInTheDocument();
});

test("switching between schools loads that school's own config, never mixing them", async () => {
  adminApi.fetchFinanceConfigs.mockResolvedValue([
    { _id: "cfg1", schoolId: { _id: "school-a", name: "Mega Heliopolis" }, googleSheetId: "sheet-a", tabName: "Sheet1", enabled: true }
  ]);
  render(<FinancePage />);
  await screen.findByDisplayValue("sheet-a");

  await userEvent.click(screen.getByRole("option", { name: /downtown prep/i }));

  await waitFor(() => expect(screen.queryByDisplayValue("sheet-a")).not.toBeInTheDocument());
  expect(await screen.findByText("Not configured")).toBeInTheDocument();
});
