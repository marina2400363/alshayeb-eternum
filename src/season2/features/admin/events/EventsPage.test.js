import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventsPage from "./EventsPage";
import * as adminApi from "../services/admin.api";

jest.mock("../services/admin.api", () => ({
  ...jest.requireActual("../services/admin.api"),
  fetchSchools: jest.fn(),
  fetchAdminEvents: jest.fn(),
  createAdminEvent: jest.fn(),
  updateAdminEvent: jest.fn(),
  uploadAdminEventThumbnail: jest.fn()
}));

const SCHOOL_A = { _id: "school-a", name: "Fictional School A", ticketPrice: 6000 };
const SCHOOL_B = { _id: "school-b", name: "Fictional School B", ticketPrice: 4500 };

function makeEvent(overrides = {}) {
  return {
    _id: "event-1",
    name: "Fictional Prom",
    eventDate: "2026-12-12",
    eventTime: "21:30",
    timezone: "Africa/Cairo",
    startsAt: "2026-12-12T19:30:00.000Z",
    location: "Fictional Venue",
    thumbnailUrl: null,
    schoolIds: ["school-a", "school-b"],
    schools: [
      { _id: "school-a", name: "Fictional School A" },
      { _id: "school-b", name: "Fictional School B" }
    ],
    outcomerTicketPriceEGP: 1500,
    status: "COMING_SOON",
    sheet: { spreadsheetId: "abc", tabName: "Sheet1", url: "https://docs.google.com/spreadsheets/d/abc/edit" },
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  adminApi.fetchSchools.mockResolvedValue([SCHOOL_A, SCHOOL_B]);
  adminApi.fetchAdminEvents.mockResolvedValue([]);
});

test("lists events of every status with badge, schools, price, Sheet link and an Edit action", async () => {
  adminApi.fetchAdminEvents.mockResolvedValue([
    makeEvent({ _id: "e1", name: "Open Event", status: "AVAILABLE" }),
    makeEvent({ _id: "e2", name: "Closed Event", status: "UNAVAILABLE" }),
    makeEvent({ _id: "e3", name: "Soon Event", status: "COMING_SOON" })
  ]);
  render(<EventsPage />);

  await screen.findByText("Open Event");
  expect(screen.getByText("AVAILABLE")).toBeInTheDocument();
  expect(screen.getByText("UNAVAILABLE")).toBeInTheDocument();
  expect(screen.getByText("COMING SOON")).toBeInTheDocument();
  expect(screen.getAllByText("1,500 EGP")).toHaveLength(3);
  expect(screen.getAllByText("Fictional School A, Fictional School B")).toHaveLength(3);
  expect(screen.getAllByRole("link", { name: /open sheet/i })[0]).toHaveAttribute(
    "href",
    "https://docs.google.com/spreadsheets/d/abc/edit"
  );
  // Every event stays editable, whatever its status.
  expect(screen.getByRole("button", { name: "Edit Open Event" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Edit Closed Event" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Edit Soon Event" })).toBeEnabled();
  // No delete anywhere.
  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
});

test("filters the list by status", async () => {
  adminApi.fetchAdminEvents.mockResolvedValue([
    makeEvent({ _id: "e1", name: "Open Event", status: "AVAILABLE" }),
    makeEvent({ _id: "e3", name: "Soon Event", status: "COMING_SOON" })
  ]);
  render(<EventsPage />);
  await screen.findByText("Open Event");

  await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "COMING_SOON");
  expect(screen.queryByText("Open Event")).not.toBeInTheDocument();
  expect(screen.getByText("Soon Event")).toBeInTheDocument();
});

test("creates an event with several Schools, defaulting to COMING SOON, and requires a Sheet and a price above 0", async () => {
  adminApi.createAdminEvent.mockImplementation(async (fields) => makeEvent({ ...fields, _id: "new", schoolIds: fields.schoolIds }));
  render(<EventsPage />);
  await screen.findByText(/no events yet/i);

  await userEvent.click(screen.getByRole("button", { name: "+ New event" }));
  const form = screen.getByRole("form", { name: "Create event" });
  expect(within(form).getByLabelText("Status")).toHaveValue("COMING_SOON");

  await userEvent.type(within(form).getByLabelText("Event name"), "Fictional Gala");
  await userEvent.type(within(form).getByLabelText("Location"), "Fictional Hall");
  await userEvent.type(within(form).getByLabelText("Date"), "2026-12-20");
  await userEvent.type(within(form).getByLabelText(/Start time/), "20:00");
  await userEvent.click(within(form).getByLabelText("Fictional School A"));
  await userEvent.click(within(form).getByLabelText("Fictional School B"));

  // Price 0 and a missing Sheet are blocked before any request is sent.
  await userEvent.type(within(form).getByLabelText(/ticket price/i), "0");
  await userEvent.type(within(form).getByLabelText(/Dedicated Google Sheet/), "https://docs.google.com/spreadsheets/d/xyz/edit");
  await userEvent.click(within(form).getByRole("button", { name: "Create event" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent(/greater than 0/i);
  expect(adminApi.createAdminEvent).not.toHaveBeenCalled();

  await userEvent.clear(within(form).getByLabelText(/ticket price/i));
  await userEvent.type(within(form).getByLabelText(/ticket price/i), "1200");
  await userEvent.clear(within(form).getByLabelText(/Dedicated Google Sheet/));
  await userEvent.click(within(form).getByRole("button", { name: "Create event" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent(/Google Sheet link or ID is required/i);
  expect(adminApi.createAdminEvent).not.toHaveBeenCalled();

  await userEvent.type(within(form).getByLabelText(/Dedicated Google Sheet/), "https://docs.google.com/spreadsheets/d/xyz/edit");
  await userEvent.click(within(form).getByRole("button", { name: "Create event" }));

  await waitFor(() => expect(adminApi.createAdminEvent).toHaveBeenCalledTimes(1));
  expect(adminApi.createAdminEvent).toHaveBeenCalledWith({
    name: "Fictional Gala",
    eventDate: "2026-12-20",
    eventTime: "20:00",
    location: "Fictional Hall",
    outcomerTicketPriceEGP: 1200,
    status: "COMING_SOON",
    schoolIds: ["school-a", "school-b"],
    sheetUrl: "https://docs.google.com/spreadsheets/d/xyz/edit",
    sheetTabName: "Sheet1"
  });
  expect(await screen.findByText("Fictional Gala")).toBeInTheDocument();
  expect(adminApi.uploadAdminEventThumbnail).not.toHaveBeenCalled();
});

test("edits an event and switches its status", async () => {
  adminApi.fetchAdminEvents.mockResolvedValue([makeEvent({ status: "UNAVAILABLE" })]);
  adminApi.updateAdminEvent.mockImplementation(async (id, fields) => makeEvent({ ...fields, status: fields.status, schoolIds: fields.schoolIds }));
  render(<EventsPage />);
  await screen.findByText("Fictional Prom");

  await userEvent.click(screen.getByRole("button", { name: "Edit Fictional Prom" }));
  const form = screen.getByRole("form", { name: "Edit event" });
  expect(within(form).getByLabelText("Status")).toHaveValue("UNAVAILABLE");
  expect(within(form).getByLabelText("Fictional School A")).toBeChecked();

  await userEvent.selectOptions(within(form).getByLabelText("Status"), "AVAILABLE");
  await userEvent.click(within(form).getByLabelText("Fictional School B"));
  await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(adminApi.updateAdminEvent).toHaveBeenCalledTimes(1));
  const [id, fields] = adminApi.updateAdminEvent.mock.calls[0];
  expect(id).toBe("event-1");
  expect(fields.status).toBe("AVAILABLE");
  expect(fields.schoolIds).toEqual(["school-a"]);
  expect(await screen.findByText("AVAILABLE")).toBeInTheDocument();
});

test("rejects an oversized or wrong-type thumbnail before uploading", async () => {
  render(<EventsPage />);
  await screen.findByText(/no events yet/i);
  await userEvent.click(screen.getByRole("button", { name: "+ New event" }));
  const form = screen.getByRole("form", { name: "Create event" });
  const input = within(form).getByLabelText(/Thumbnail/);

  const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
  await userEvent.upload(input, pdf, { applyAccept: false });
  expect(await within(form).findByRole("alert")).toHaveTextContent(/PNG, JPG or WebP/);

  const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
  await userEvent.upload(input, big);
  expect(await within(form).findByRole("alert")).toHaveTextContent(/4MB or smaller/);
  expect(adminApi.uploadAdminEventThumbnail).not.toHaveBeenCalled();
});

test("shows the server's error (e.g. a Sheet already used) without losing the form", async () => {
  adminApi.fetchAdminEvents.mockResolvedValue([makeEvent()]);
  adminApi.updateAdminEvent.mockRejectedValue(new Error("This Sheet is already used as a School Finance Sheet."));
  render(<EventsPage />);
  await screen.findByText("Fictional Prom");
  await userEvent.click(screen.getByRole("button", { name: "Edit Fictional Prom" }));
  const form = screen.getByRole("form", { name: "Edit event" });
  await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent(/School Finance Sheet/);
  expect(within(form).getByLabelText("Event name")).toHaveValue("Fictional Prom");
});

test("Edit sits next to the event name, in the same cell", async () => {
  adminApi.fetchAdminEvents.mockResolvedValue([makeEvent()]);
  render(<EventsPage />);
  const name = await screen.findByText("Fictional Prom");
  const edit = screen.getByRole("button", { name: "Edit Fictional Prom" });
  expect(name.closest("td")).toBe(edit.closest("td"));
});

test("a failed School list shows a clear error with Retry (not 'No schools match') and keeps the form", async () => {
  adminApi.fetchSchools.mockRejectedValueOnce(new Error("Schools are unavailable right now."));
  render(<EventsPage />);
  await screen.findByText(/no events yet/i);

  await userEvent.click(screen.getByRole("button", { name: "+ New event" }));
  const form = screen.getByRole("form", { name: "Create event" });
  await userEvent.type(within(form).getByLabelText("Event name"), "Half filled");

  const alert = await within(form).findByText(/Schools are unavailable right now/);
  expect(alert).toBeInTheDocument();
  expect(within(form).queryByText(/no schools match/i)).not.toBeInTheDocument();
  expect(within(form).queryByLabelText("Search schools")).not.toBeInTheDocument();

  await userEvent.click(within(form).getByRole("button", { name: /retry loading schools/i }));
  expect(await within(form).findByLabelText("Fictional School A")).toBeInTheDocument();
  expect(adminApi.fetchSchools).toHaveBeenCalledTimes(2);
  // The retry did not wipe what the Admin had already typed.
  expect(within(form).getByLabelText("Event name")).toHaveValue("Half filled");
});

test("editing keeps the saved Schools selected when the School list fails to load", async () => {
  adminApi.fetchSchools.mockRejectedValue(new Error("Schools are unavailable right now."));
  adminApi.fetchAdminEvents.mockResolvedValue([makeEvent()]);
  adminApi.updateAdminEvent.mockImplementation(async (id, fields) => makeEvent({ ...fields, schoolIds: fields.schoolIds }));
  render(<EventsPage />);
  await screen.findByText("Fictional Prom");
  await userEvent.click(screen.getByRole("button", { name: "Edit Fictional Prom" }));
  const form = screen.getByRole("form", { name: "Edit event" });
  expect(await within(form).findByText(/2 selected/)).toBeInTheDocument();
  await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(adminApi.updateAdminEvent).toHaveBeenCalled());
  expect(adminApi.updateAdminEvent.mock.calls[0][1].schoolIds).toEqual(["school-a", "school-b"]);
});
