// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/ops",
  auth: "authenticated" as "authenticated" | "loading" | "signedout",
  viewer: undefined as { isOwner: boolean } | null | undefined,
  onboarding: undefined as { needsOnboarding: boolean } | undefined,
  replace: vi.fn(),
  queryNames: [] as string[],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: ReactNode }) =>
    state.auth === "authenticated" ? children : null,
  AuthLoading: ({ children }: { children: ReactNode }) =>
    state.auth === "loading" ? children : null,
  Unauthenticated: ({ children }: { children: ReactNode }) =>
    state.auth === "signedout" ? children : null,
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    state.queryNames.push(name);
    if (name === "owner:viewer") return state.viewer;
    if (name === "onboarding:status") return state.onboarding;
    if (name === "approvals:summary" || name === "deadLetters:newCount") return undefined;
    throw new Error(`Unexpected shell query ${name}`);
  },
}));
vi.mock("./_components/NotificationsBanner", () => ({ NotificationsBanner: () => null }));
vi.mock("./_components/ReconnectBanner", () => ({ ReconnectBanner: () => null }));
vi.mock("./_components/RunningWork", () => ({ RunningWork: () => null }));
vi.mock("./dashboard/voice/AbnormalBriefBanner", () => ({ AbnormalBriefBanner: () => null }));

import AppShell from "./layout";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.pathname = "/ops";
  state.auth = "authenticated";
  state.viewer = undefined;
  state.onboarding = { needsOnboarding: true };
  state.replace.mockClear();
  state.queryNames = [];
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async () => {
  await act(async () =>
    root.render(
      <AppShell>
        <h1>Protected page</h1>
      </AppShell>,
    ),
  );
};
const hasPage = () => container.querySelector("h1")?.textContent === "Protected page";

describe("Shell onboarding gate", () => {
  test.each([
    "/ops",
    "/ops/web-recipes",
  ])("holds %s until authoritative owner read resolves, then admits a fresh owner", async (pathname) => {
    state.pathname = pathname;
    await render();
    expect(hasPage()).toBe(false);
    expect(state.replace).not.toHaveBeenCalled();
    state.viewer = { isOwner: true };
    await render();
    expect(hasPage()).toBe(true);
    expect(state.replace).not.toHaveBeenCalled();
  });

  test.each([
    "/ops",
    "/ops/web-recipes",
  ])("redirects a fresh non-owner on %s once the owner read resolves", async (pathname) => {
    state.pathname = pathname;
    await render();
    expect(state.replace).not.toHaveBeenCalled();
    state.viewer = { isOwner: false };
    await render();
    expect(hasPage()).toBe(false);
    expect(state.replace).toHaveBeenCalledWith("/dashboard/onboarding");
  });

  test.each([
    "/dashboard",
    "/dashboard/sites",
    "/ops/web-recipes/extra",
    "/ops/qualification-identity",
  ])("still requires business onboarding for an owner on %s", async (pathname) => {
    state.pathname = pathname;
    state.viewer = { isOwner: true };
    await render();
    expect(hasPage()).toBe(false);
    expect(state.replace).toHaveBeenCalledWith("/dashboard/onboarding");
  });

  test("holds a customer route while onboarding loads and admits completed customers", async () => {
    state.pathname = "/dashboard/sites";
    state.viewer = { isOwner: false };
    state.onboarding = undefined;
    await render();
    expect(hasPage()).toBe(false);
    expect(state.replace).not.toHaveBeenCalled();
    state.onboarding = { needsOnboarding: false };
    await render();
    expect(hasPage()).toBe(true);
  });

  test("admits only a verified operator while the unrelated business status loads", async () => {
    state.onboarding = undefined;
    await render();
    expect(hasPage()).toBe(false);
    state.viewer = { isOwner: true };
    await render();
    expect(hasPage()).toBe(true);
    expect(state.replace).not.toHaveBeenCalled();
  });

  test("keeps the onboarding page accessible without a redirect loop", async () => {
    state.pathname = "/dashboard/onboarding";
    await render();
    expect(hasPage()).toBe(true);
    expect(state.replace).not.toHaveBeenCalled();
  });

  test.each([
    "loading",
    "signedout",
  ] as const)("keeps %s authentication outside the shell and its private queries", async (auth) => {
    state.auth = auth;
    state.viewer = { isOwner: true };
    await render();
    expect(hasPage()).toBe(false);
    expect(state.queryNames).toEqual([]);
    expect(state.replace).not.toHaveBeenCalled();
    if (auth === "signedout")
      expect(container.querySelector('a[href="/signin"]')?.textContent).toBe("Sign in again");
  });
});
