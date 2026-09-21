import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./SettingsPage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api", () => {
  const actual = jest.requireActual("../services/admin.api");
  return {
    ...actual,
    fetchAdminSettings: jest.fn(),
    saveInstaPayLink: jest.fn()
  };
});

beforeEach(() => {
  jest.clearAllMocks();
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

  await userEvent.type(screen.getByPlaceholderText(/https:\/\/ipn\.eg/i), "  https://ipn.eg/new-handle  ");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await waitFor(() => expect(adminApi.saveInstaPayLink).toHaveBeenCalledWith("https://ipn.eg/new-handle"));
  expect(await screen.findByText("Saved.")).toBeInTheDocument();
});

test("a save failure shows the backend's error and does not claim success", async () => {
  adminApi.fetchAdminSettings.mockResolvedValue({ instapayLink: "" });
  adminApi.saveInstaPayLink.mockRejectedValue({ message: "Couldn't save settings right now." });

  render(<SettingsPage />);
  await screen.findByText("Not configured");
  await userEvent.type(screen.getByPlaceholderText(/https:\/\/ipn\.eg/i), "https://ipn.eg/x");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  expect(await screen.findByText("Couldn't save settings right now.")).toBeInTheDocument();
  expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
});
