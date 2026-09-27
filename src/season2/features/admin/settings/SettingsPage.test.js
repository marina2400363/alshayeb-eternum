import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./SettingsPage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api", () => {
  const actual = jest.requireActual("../services/admin.api");
  return {
    ...actual,
    fetchAdminSettings: jest.fn(),
    saveInstaPayLink: jest.fn(),
    fetchStatusCounterSettings: jest.fn(),
    saveStatusCounterSettings: jest.fn()
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  // Independent of the InstaPay panel under test below — always resolved so
  // its own async effect never leaves an unhandled promise across tests.
  adminApi.fetchStatusCounterSettings.mockResolvedValue({ accepted: 0, rejected: 0, pending: 0 });
});

test("the backend's own placeholder is shown as 'Not configured', never as a real link", async () => {
  adminApi.fetchAdminSettings.mockResolvedValue({ instapayLink: "https://instapay.example/alshayeb" });
  render(<SettingsPage />);

  expect(await screen.findByText("Not configured")).toBeInTheDocument();
  const linkInput = screen.getByPlaceholderText(/https:\/\/ipn\.eg/i);
  expect(linkInput.value).toBe("");
});

test("a real configured link shows 'Configured' and pre-fills the field", async () => {
  adminApi.fetchAdminSettings.mockResolvedValue({ instapayLink: "https://ipn.eg/real-handle" });
  render(<SettingsPage />);

  expect(await screen.findByDisplayValue("https://ipn.eg/real-handle")).toBeInTheDocument();
  expect(screen.getByText("Configured")).toBeInTheDocument();
});

test("saving calls saveInstaPayLink with the trimmed link and shows a success state", async () => {
  adminApi.fetchAdminSettings.mockResolvedValue({ instapayLink: "" });
  adminApi.saveInstaPayLink.mockResolvedValue({ instapayLink: "https://ipn.eg/new-handle" });

  render(<SettingsPage />);
  await screen.findByText("Not configured");

  const instapayForm = screen.getByRole("form", { name: "InstaPay settings" });
  await userEvent.type(screen.getByPlaceholderText(/https:\/\/ipn\.eg/i), "  https://ipn.eg/new-handle  ");
  await userEvent.click(within(instapayForm).getByRole("button", { name: /^save$/i }));

  await waitFor(() => expect(adminApi.saveInstaPayLink).toHaveBeenCalledWith("https://ipn.eg/new-handle"));
  expect(await screen.findByText("Saved.")).toBeInTheDocument();
});

test("a save failure shows the backend's error and does not claim success", async () => {
  adminApi.fetchAdminSettings.mockResolvedValue({ instapayLink: "" });
  adminApi.saveInstaPayLink.mockRejectedValue({ message: "Couldn't save settings right now." });

  render(<SettingsPage />);
  await screen.findByText("Not configured");
  const instapayForm = screen.getByRole("form", { name: "InstaPay settings" });
  await userEvent.type(screen.getByPlaceholderText(/https:\/\/ipn\.eg/i), "https://ipn.eg/x");
  await userEvent.click(within(instapayForm).getByRole("button", { name: /^save$/i }));

  expect(await screen.findByText("Couldn't save settings right now.")).toBeInTheDocument();
  expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
});

describe("customer status counter", () => {
  beforeEach(() => {
    adminApi.fetchAdminSettings.mockResolvedValue({ instapayLink: "" });
  });

  test("pre-fills the three fields from the saved values, defaulting to 0", async () => {
    adminApi.fetchStatusCounterSettings.mockResolvedValue({ accepted: 350, rejected: 12, pending: 8 });
    render(<SettingsPage />);

    expect(await screen.findByDisplayValue("350")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12")).toBeInTheDocument();
    expect(screen.getByDisplayValue("8")).toBeInTheDocument();
  });

  test("defaults every field to 0 when nothing has been configured yet", async () => {
    adminApi.fetchStatusCounterSettings.mockResolvedValue({ accepted: 0, rejected: 0, pending: 0 });
    render(<SettingsPage />);

    const zeros = await screen.findAllByDisplayValue("0");
    expect(zeros).toHaveLength(3);
  });

  test("saving calls saveStatusCounterSettings with the three numbers and shows a success state", async () => {
    adminApi.fetchStatusCounterSettings.mockResolvedValue({ accepted: 0, rejected: 0, pending: 0 });
    adminApi.saveStatusCounterSettings.mockResolvedValue({ accepted: 350, rejected: 12, pending: 8 });

    render(<SettingsPage />);
    await screen.findAllByDisplayValue("0");

    await userEvent.clear(screen.getByLabelText("Accepted"));
    await userEvent.type(screen.getByLabelText("Accepted"), "350");
    await userEvent.clear(screen.getByLabelText("Rejected"));
    await userEvent.type(screen.getByLabelText("Rejected"), "12");
    await userEvent.clear(screen.getByLabelText("Pending"));
    await userEvent.type(screen.getByLabelText("Pending"), "8");

    const counterForm = screen.getByRole("form", { name: "Customer status counter settings" });
    await userEvent.click(within(counterForm).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(adminApi.saveStatusCounterSettings).toHaveBeenCalledWith({ accepted: 350, rejected: 12, pending: 8 })
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  test("rejects a negative or non-integer value client-side, without calling the API", async () => {
    adminApi.fetchStatusCounterSettings.mockResolvedValue({ accepted: 0, rejected: 0, pending: 0 });
    render(<SettingsPage />);
    await screen.findAllByDisplayValue("0");

    await userEvent.clear(screen.getByLabelText("Accepted"));
    await userEvent.type(screen.getByLabelText("Accepted"), "-1");
    const counterForm = screen.getByRole("form", { name: "Customer status counter settings" });
    await userEvent.click(within(counterForm).getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Accepted must be a non-negative whole number.")).toBeInTheDocument();
    expect(adminApi.saveStatusCounterSettings).not.toHaveBeenCalled();
  });

  test("a save failure shows the backend's error and does not claim success", async () => {
    adminApi.fetchStatusCounterSettings.mockResolvedValue({ accepted: 0, rejected: 0, pending: 0 });
    adminApi.saveStatusCounterSettings.mockRejectedValue({ message: "Couldn't save the status counter right now." });

    render(<SettingsPage />);
    await screen.findAllByDisplayValue("0");
    const counterForm = screen.getByRole("form", { name: "Customer status counter settings" });
    await userEvent.click(within(counterForm).getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Couldn't save the status counter right now.")).toBeInTheDocument();
  });
});
