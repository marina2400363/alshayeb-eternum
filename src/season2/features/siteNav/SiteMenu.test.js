import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import SiteMenu, { HOME_PATH } from "./SiteMenu";
import SOCIAL_LINKS from "../siteFooter/socialLinks";

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

beforeEach(() => {
  jest.useFakeTimers();
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  document.documentElement.classList.remove("s2-menu-open");
});

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  act(() => jest.runOnlyPendingTimers());
  act(() => jest.runOnlyPendingTimers());
}

function flushClose() {
  act(() => jest.advanceTimersByTime(300));
}

test("closed by default: only the toggle renders, nothing is locked", () => {
  render(<SiteMenu />);
  const toggle = screen.getByRole("button", { name: "Open menu" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.documentElement).not.toHaveClass("s2-menu-open");
});

test("opens an overlay with HOME, INSTAGRAM, TIKTOK in order and locks page scroll", () => {
  render(<SiteMenu />);
  openMenu();
  const dialog = screen.getByRole("dialog", { name: "Menu" });
  expect(dialog).toHaveClass("is-open");
  expect(document.documentElement).toHaveClass("s2-menu-open");
  expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "true");

  const labels = Array.from(dialog.querySelectorAll(".s2-menu-label")).map((el) => el.textContent);
  expect(labels).toEqual(["Home", "Instagram", "TikTok"]);
});

test("HOME goes to / client-side and closes the menu", () => {
  render(<SiteMenu />);
  openMenu();
  const home = screen.getByText("Home").closest("a");
  expect(home).toHaveAttribute("href", HOME_PATH);
  expect(HOME_PATH).toBe("/");
  expect(home).not.toHaveAttribute("target");
  fireEvent.click(home);
  flushClose();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.documentElement).not.toHaveClass("s2-menu-open");
});

test("Instagram and TikTok open the official profiles in a new tab", () => {
  render(<SiteMenu />);
  openMenu();
  const instagram = screen.getByText("Instagram").closest("a");
  const tiktok = screen.getByText("TikTok").closest("a");
  const byId = Object.fromEntries(SOCIAL_LINKS.map((l) => [l.id, l.href]));
  expect(instagram).toHaveAttribute("href", byId.instagram);
  expect(tiktok).toHaveAttribute("href", byId.tiktok);
  expect(byId.instagram).toMatch(/^https:\/\/www\.instagram\.com\/alshayebexperience/);
  expect(byId.tiktok).toMatch(/^https:\/\/www\.tiktok\.com\/@alshayebexperience/);
  for (const link of [instagram, tiktok]) {
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  }
});

test("Escape closes the menu and returns focus to the toggle", () => {
  render(<SiteMenu />);
  openMenu();
  fireEvent.keyDown(document, { key: "Escape" });
  flushClose();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();
});

test("the X closes it; clicking empty overlay space closes it; clicking an item's text does not", () => {
  render(<SiteMenu />);
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
  flushClose();
  expect(screen.queryByRole("dialog")).toBeNull();

  openMenu();
  fireEvent.click(screen.getByText("Instagram"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("dialog"));
  flushClose();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("focus opens on HOME and Tab wraps inside the overlay", () => {
  render(<SiteMenu />);
  openMenu();
  const dialog = screen.getByRole("dialog");
  expect(screen.getByText("Home").closest("a")).toHaveFocus();
  const focusables = Array.from(dialog.querySelectorAll("a[href], button"));
  focusables[focusables.length - 1].focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(focusables[0]).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(focusables[focusables.length - 1]).toHaveFocus();
});
