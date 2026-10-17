// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import SignUpRoute from "./page";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), push: vi.fn(), valid: true }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: mocks.signIn }) }));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => ({
    valid: mocks.valid,
    invitedEmailMasked: "t***@example.test",
    google: false,
    microsoft: false,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams("invite=fixture-code"),
}));
// Keep this test focused on page submission/state; reusable field styling is independent.
vi.mock("../fields", () => {
  const Field = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) =>
    createElement("input", {
      "aria-label": label,
      value,
      onInput: (event: React.FormEvent<HTMLInputElement>) => onChange(event.currentTarget.value),
    });
  return { TextField: Field, PasswordField: Field };
});

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.signIn.mockReset();
  mocks.push.mockReset();
  mocks.valid = true;
});

test.each([
  "AUTHENTICATION_FAILED",
  "network unavailable",
  "Account exists: private metadata",
])("recognition remains code-only and signup failure does not disclose provider error: %s", async (failure) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.signIn.mockRejectedValueOnce(new Error(failure));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SignUpRoute)));
    expect(container.textContent).toContain("Your email has not been checked yet.");
    expect(container.textContent).toContain("including any +suffix");
    for (const [label, value] of [
      ["Full Name", "Fixture"],
      ["Email Address", "test+fixture@example.test"],
      ["Password", "fixture-password"],
      ["Confirm Password", "fixture-password"],
    ]) {
      const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      await act(async () => {
        input.value = value ?? "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mocks.signIn).toHaveBeenCalledWith("password", {
      name: "Fixture",
      email: "test+fixture@example.test",
      password: "fixture-password",
      inviteCode: "fixture-code",
      flow: "signUp",
    });
    expect(container.textContent).toContain("A connection or service problem can also cause this.");
    expect(container.textContent).not.toContain(failure);
    expect(container.querySelector('a[href="/signin"]')).not.toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
