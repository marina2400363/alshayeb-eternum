import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EnterExperience from "./EnterExperience";
import { PATHS } from "../paths";

// react-router-dom v7 ships an `exports`-only build that CRA's Jest cannot
// resolve, so the router is stubbed: <Link> is a plain anchor (href = `to`).
jest.mock(
  "react-router-dom",
  () => {
    const R = require("react");
    return {
      Link: ({ to, children, ...rest }) => R.createElement("a", { href: to, ...rest }, children)
    };
  },
  { virtual: true }
);

function renderScreen() {
  return render(<EnterExperience />);
}

describe("EnterExperience — Outcomer is COMING SOON", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    // OnboardingStage scrolls to top on mount; jsdom doesn't implement it.
    window.scrollTo = jest.fn();
  });

  test("Incomer stays a working link to the Incomer flow", () => {
    renderScreen();
    const incomer = screen.getByText("Incomer").closest("a");
    expect(incomer).not.toBeNull();
    expect(incomer.getAttribute("href")).toBe(PATHS.incomer);
  });

  test("Outcomer is visible, labelled COMING SOON, and is not a link", () => {
    renderScreen();
    const outcomerTitle = screen.getByText("Outcomer");
    expect(outcomerTitle).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    // No anchor anywhere around it — nothing to navigate to.
    expect(outcomerTitle.closest("a")).toBeNull();
    const panel = outcomerTitle.closest(".s2-ob-choice");
    expect(panel).toHaveAttribute("aria-disabled", "true");
  });

  test("clicking Outcomer does nothing: no navigation, no network call", async () => {
    renderScreen();
    await userEvent.click(screen.getByText("Outcomer"));
    expect(fetchSpy).not.toHaveBeenCalled();
    // Still on the same screen with both choices present.
    expect(screen.getByText("Incomer")).toBeInTheDocument();
    expect(screen.getByText("Outcomer")).toBeInTheDocument();
  });

  test("no link on the screen points at any Outcomer route", () => {
    renderScreen();
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") || "");
    expect(hrefs.some((h) => /outcomer/i.test(h))).toBe(false);
  });
});
