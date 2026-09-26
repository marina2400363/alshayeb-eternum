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

describe("EnterExperience — Outcomer and Guest List are COMING SOON", () => {
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
    const outcomerPanel = outcomerTitle.closest(".s2-ob-choice");
    expect(outcomerPanel).toHaveTextContent(/coming soon/i);
    // No anchor anywhere around it — nothing to navigate to.
    expect(outcomerTitle.closest("a")).toBeNull();
    expect(outcomerPanel).toHaveAttribute("aria-disabled", "true");
  });

  test("clicking Outcomer does nothing: no navigation, no network call", async () => {
    renderScreen();
    await userEvent.click(screen.getByText("Outcomer"));
    expect(fetchSpy).not.toHaveBeenCalled();
    // Still on the same screen with both choices present.
    expect(screen.getByText("Incomer")).toBeInTheDocument();
    expect(screen.getByText("Outcomer")).toBeInTheDocument();
  });

  test("choices are in order: 01 Incomer, 02 Outcomer, 03 Guest List", () => {
    renderScreen();
    const titles = Array.from(document.querySelectorAll(".s2-ob-choice-title")).map((el) => el.textContent);
    const indices = Array.from(document.querySelectorAll(".s2-ob-choice-index")).map((el) => el.textContent);
    expect(titles).toEqual(["Incomer", "Outcomer", "Guest List"]);
    expect(indices).toEqual(["01", "02", "03"]);
  });

  test("Guest List is visible, labelled COMING SOON, and is not a link", () => {
    renderScreen();
    const title = screen.getByText("Guest List");
    expect(title.closest("a")).toBeNull();
    const panel = title.closest(".s2-ob-choice");
    expect(panel).toHaveAttribute("aria-disabled", "true");
    expect(panel).toHaveClass("s2-ob-choice--soon");
    expect(panel).toHaveTextContent(/coming soon/i);
    // Built exactly like Outcomer: same inert panel classes.
    expect(panel.className).toBe(screen.getByText("Outcomer").closest(".s2-ob-choice").className);
  });

  test("clicking Guest List does nothing: no navigation, no network call", async () => {
    renderScreen();
    await userEvent.click(screen.getByText("Guest List"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Incomer")).toBeInTheDocument();
    expect(screen.getByText("Guest List")).toBeInTheDocument();
  });

  test("only Incomer is a link — no link points at any Guest List route", () => {
    renderScreen();
    const choiceHrefs = Array.from(document.querySelectorAll(".s2-ob-choices a")).map((a) => a.getAttribute("href"));
    expect(choiceHrefs).toEqual([PATHS.incomer]);
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") || "");
    expect(hrefs.some((h) => /guest/i.test(h))).toBe(false);
  });

  test("no link on the screen points at any Outcomer route", () => {
    renderScreen();
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") || "");
    expect(hrefs.some((h) => /outcomer/i.test(h))).toBe(false);
  });
});
