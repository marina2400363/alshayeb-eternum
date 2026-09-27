import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GateAccessAction from "./GateAccessAction";

test("renders a visible, clearly disabled Access to Gate action", () => {
  render(<GateAccessAction />);

  const action = screen.getByRole("button", { name: /access to gate/i });
  expect(action).toBeInTheDocument();
  expect(action).toBeDisabled();
  expect(action).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByText(/not active yet/i)).toBeInTheDocument();
});

test("has no click handler at all — clicking it does nothing observable and throws nothing", async () => {
  render(<GateAccessAction />);
  const action = screen.getByRole("button", { name: /access to gate/i });

  expect(action.onclick).toBeNull();
  await userEvent.click(action);
  // Still on the same disabled button afterwards — no navigation, no state change.
  expect(screen.getByRole("button", { name: /access to gate/i })).toBeDisabled();
});

test("is not a link and carries no href/route", () => {
  render(<GateAccessAction />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
