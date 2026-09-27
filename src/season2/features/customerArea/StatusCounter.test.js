import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StatusCounter from "./StatusCounter";
import { fetchStatusCounter } from "../../services/statusCounter.api";

jest.mock("../../services/statusCounter.api");

beforeEach(() => {
  jest.clearAllMocks();
});

test("shows a loading state while the fetch is in flight", async () => {
  let resolve;
  fetchStatusCounter.mockReturnValue(new Promise((r) => (resolve = r)));
  render(<StatusCounter />);

  expect(screen.getByText(/Loading status/i)).toBeInTheDocument();
  await act(async () => resolve({ accepted: 1, rejected: 2, pending: 3 }));
});

test("renders exactly the admin-configured Accepted/Rejected/Pending values, in that order", async () => {
  fetchStatusCounter.mockResolvedValue({ accepted: 350, rejected: 12, pending: 8 });
  render(<StatusCounter />);

  await screen.findByText("350");
  const labels = screen.getAllByText(/Accepted|Rejected|Pending/i).map((node) => node.textContent);
  expect(labels).toEqual(["Accepted", "Rejected", "Pending"]);

  expect(screen.getByText("350")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(screen.getByText("8")).toBeInTheDocument();
});

test("renders zero values as literal 0, not blank", async () => {
  fetchStatusCounter.mockResolvedValue({ accepted: 0, rejected: 0, pending: 0 });
  render(<StatusCounter />);

  const zeros = await screen.findAllByText("0");
  expect(zeros).toHaveLength(3);
});

test("a fetch failure shows an error with Retry, and Retry re-fetches", async () => {
  fetchStatusCounter
    .mockRejectedValueOnce({ message: "We couldn't reach the server.", kind: "network" })
    .mockResolvedValueOnce({ accepted: 5, rejected: 1, pending: 2 });

  render(<StatusCounter />);
  await screen.findByText(/Couldn't load status/i);

  await userEvent.click(screen.getByRole("button", { name: /retry/i }));
  await screen.findByText("5");
  expect(fetchStatusCounter).toHaveBeenCalledTimes(2);
});

test("makes exactly one call on mount — no polling", async () => {
  fetchStatusCounter.mockResolvedValue({ accepted: 1, rejected: 0, pending: 0 });
  render(<StatusCounter />);
  await screen.findByText("1");

  expect(fetchStatusCounter).toHaveBeenCalledTimes(1);
});
