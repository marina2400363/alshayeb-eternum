import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SchoolAccessStep from "./SchoolAccessStep";
import { useRegistration } from "../../state/RegistrationProvider";
import { PATHS } from "../../paths";

// react-router-dom v7 ships an `exports`-only build that CRA's Jest cannot
// resolve, so the router is stubbed (mirrors EnterExperience.test.js).
// `mockNavigate` (the "mock" prefix) is the one name jest permits a
// jest.mock() factory to close over despite hoisting.
const mockNavigate = jest.fn();
jest.mock(
  "react-router-dom",
  () => {
    const R = require("react");
    return {
      Link: ({ to, children, ...rest }) => R.createElement("a", { href: to, ...rest }, children),
      Navigate: ({ to }) => R.createElement("div", { "data-testid": "navigate", "data-to": to }),
      useNavigate: () => mockNavigate
    };
  },
  { virtual: true }
);

jest.mock("../../state/RegistrationProvider", () => ({
  useRegistration: jest.fn()
}));

const DETAILS_OK = { fullName: "Marina Adel", phone: "01012345678", email: "marina@example.com" };

function mockRegistration({ draft = {}, schoolAccess = { status: "idle", error: "" }, submitError = null, verifyResult = { ok: true } } = {}) {
  const verifySchoolAccess = jest.fn().mockResolvedValue(verifyResult);
  useRegistration.mockReturnValue({
    state: {
      draft: { ...DETAILS_OK, schoolAccessToken: "", schoolName: "", ...draft },
      schoolAccess,
      submit: { status: "idle", error: submitError }
    },
    verifySchoolAccess
  });
  return { verifySchoolAccess };
}

beforeEach(() => {
  mockNavigate.mockClear();
  window.scrollTo = jest.fn(); // OnboardingStage scrolls to top on mount
});

describe("SchoolAccessStep", () => {
  test("redirects to Details when details are incomplete — the access code form never shows", () => {
    mockRegistration({ draft: { fullName: "" } });
    render(<SchoolAccessStep />);
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", PATHS.incomerNewDetails);
    expect(screen.queryByLabelText(/school access code/i)).not.toBeInTheDocument();
  });

  test("renders the access code form with the required copy", () => {
    mockRegistration();
    render(<SchoolAccessStep />);
    expect(screen.getByText(/enter the access code provided by your school committee/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/school access code/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });

  test("submitting a blank code shows a local error and never calls verifySchoolAccess", async () => {
    const { verifySchoolAccess } = mockRegistration();
    render(<SchoolAccessStep />);
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/enter your school access code/i)).toBeInTheDocument();
    expect(verifySchoolAccess).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("a valid code is verified and navigates to the Photo step on success", async () => {
    const { verifySchoolAccess } = mockRegistration({ verifyResult: { ok: true } });
    render(<SchoolAccessStep />);

    await userEvent.type(screen.getByLabelText(/school access code/i), "ABC12345");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(verifySchoolAccess).toHaveBeenCalledWith("ABC12345");
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(PATHS.incomerNewPhoto));
  });

  test("an invalid code shows the server's inline error and does not navigate", async () => {
    mockRegistration({
      schoolAccess: { status: "error", error: "Invalid access code." },
      verifyResult: { ok: false }
    });
    render(<SchoolAccessStep />);

    await userEvent.type(screen.getByLabelText(/school access code/i), "WRONGCODE");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("Invalid access code.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("an expired-token error from a failed final submit is surfaced here too", () => {
    mockRegistration({ submitError: { field: "school", message: "Your school access has expired. Please enter your school access code again." } });
    render(<SchoolAccessStep />);
    expect(screen.getByText(/school access has expired/i)).toBeInTheDocument();
  });

  test("the Continue button is disabled while verifying", () => {
    mockRegistration({ schoolAccess: { status: "verifying", error: "" } });
    render(<SchoolAccessStep />);
    expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
  });
});
