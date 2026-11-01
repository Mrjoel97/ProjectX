// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import SignInRoute from "../signin/page";
import SignUpRoute from "./page";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  push: vi.fn(),
  valid: true,
  providersLoading: false,
  google: true,
  microsoft: true,
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: mocks.signIn }) }));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "invites:authProviders"
      ? mocks.providersLoading
        ? undefined
        : { google: mocks.google, microsoft: mocks.microsoft, password: true }
      : { valid: mocks.valid, invitedEmailMasked: "t***@example.test" },
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

test("unavailable invites offer continuation without a blocked signup form or OAuth attempt", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.valid = false;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SignUpRoute)));
    expect(container.textContent).toContain("This code can't start a new signup.");
    expect(container.textContent).toContain("send a new verification code");
    expect(container.textContent).toContain("Choose the same provider");
    expect(container.querySelector('a.auth-submit[href="/signin"]')?.textContent).toContain(
      "Continue to sign in",
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('input[aria-label="Password"]')).toBeNull();
    const recovery = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Finish email verification",
    );
    expect(recovery).toBeDefined();
    expect(mocks.signIn).not.toHaveBeenCalled();

    // A corrected live code restores the normal signup path; no admission is bypassed.
    mocks.valid = true;
    await act(async () => root.render(createElement(SignUpRoute)));
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.querySelector('input[aria-label="Password"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="Continue an existing signup"]')).toBeNull();
    expect(mocks.signIn).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test.each([
  ["signup", SignUpRoute],
  ["signin", SignInRoute],
] as const)("%s can request email verification without creating another account", async (_route, Page) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.valid = false;
  mocks.signIn.mockResolvedValue({ signingIn: false });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Page)));
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Finish email verification")
        ?.click(),
    );
    expect(container.textContent).toContain("Verify your email");
    expect(container.textContent).toContain("not the Pikar AI owner's inbox");
    expect(container.querySelector('input[aria-label="Verification code"]')).toBeNull();
    const input = container.querySelector('input[aria-label="Email address"]') as HTMLInputElement;
    await act(async () => {
      input.value = "tester@example.test";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith("password", {
      email: "tester@example.test",
      flow: "email-verification",
    });
    expect(container.textContent).toContain("check tester@example.test");
    expect(container.querySelector('input[aria-label="Verification code"]')).not.toBeNull();
    const email = container.querySelector('input[aria-label="Email address"]') as HTMLInputElement;
    await act(async () => {
      email.value = "another@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Verification code"]')).toBeNull();
    expect(container.textContent).toContain("Send code");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.signIn.mockReset();
  mocks.push.mockReset();
  mocks.valid = true;
  mocks.providersLoading = false;
  mocks.google = true;
  mocks.microsoft = true;
});

test.each([
  ["signup", SignUpRoute],
  ["signin", SignInRoute],
] as const)("%s waits for real provider availability without hiding password access", async (_route, Page) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.providersLoading = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Page)));
    expect(container.textContent).not.toContain("Continue with Google");
    expect(container.querySelector(".auth-or")).toBeNull();
    expect(container.querySelector('input[aria-label="Email Address"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Password"]')).not.toBeNull();
    expect(mocks.signIn).not.toHaveBeenCalled();

    mocks.providersLoading = false;
    mocks.google = false;
    mocks.microsoft = false;
    await act(async () => root.render(createElement(Page)));
    expect(container.textContent).not.toContain("Continue with Google");
    expect(container.querySelector(".auth-or")).toBeNull();
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(false);

    mocks.google = true;
    await act(async () => root.render(createElement(Page)));
    const google = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Continue with Google"),
    );
    expect(google).toBeDefined();
    expect(container.querySelector(".auth-or")).not.toBeNull();
    mocks.signIn.mockResolvedValueOnce({ signingIn: false });
    await act(async () => google?.click());
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith("google", {
      redirectTo: _route === "signin" ? "/dashboard" : "/signup?invite=fixture-code&r=1",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("an unconfigured Google provider leaves the actual email/password sign-in usable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.google = false;
  mocks.microsoft = false;
  mocks.signIn.mockResolvedValueOnce({ signingIn: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SignInRoute)));
    for (const [label, value] of [
      ["Email Address", "fixture@example.test"],
      ["Password", "fixture-password"],
    ]) {
      const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      await act(async () => {
        input.value = value ?? "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith("password", {
      email: "fixture@example.test",
      password: "fixture-password",
      flow: "signIn",
    });
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
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
