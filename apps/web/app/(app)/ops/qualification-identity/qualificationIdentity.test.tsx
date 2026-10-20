// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "@pikar/backend/api";
import { type FunctionReference, getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const a = "a".repeat(32);
const b = "b".repeat(32);
const state = vi.hoisted(() => ({
  auth: { isLoading: false, isAuthenticated: true },
  profile: { tenantId: "a".repeat(32) } as { tenantId: string } | null | undefined,
  viewer: { isOwner: true } as { isOwner: boolean } | null | undefined,
  queries: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => state.auth,
  useQuery: (ref: unknown, args: unknown) => {
    state.queries(getFunctionName(ref as FunctionReference<"query">), args);
    if (args === "skip") return undefined;
    if (
      getFunctionName(ref as FunctionReference<"query">) === getFunctionName(api.tenantProfile.get)
    )
      return state.profile;
    if (getFunctionName(ref as FunctionReference<"query">) === getFunctionName(api.owner.viewer))
      return state.viewer;
    throw new Error("UNEXPECTED_QUERY");
  },
  // No mutation hook is provided: adding one to the component must fail the rendering tests.
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("IDENTITY_CHECK_NOT_FOUND");
  },
}));

import QualificationIdentityPage from "./page";
import QualificationIdentity from "./QualificationIdentity";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const status = () => host.querySelector('[data-testid="phase23-identity-result"]')?.textContent;
async function render() {
  await act(async () => root.render(<QualificationIdentity expectedAId={a} expectedBId={b} />));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.auth = { isLoading: false, isAuthenticated: true };
  state.profile = { tenantId: a };
  state.viewer = { isOwner: true };
  state.queries.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("observes exact A owner and B non-owner using only native authenticated reads", async () => {
  await render();
  expect(status()).toBe("A_IDENTITY_MATCH");
  expect(state.queries.mock.calls).toEqual([
    ["tenantProfile:get", {}],
    ["owner:viewer", {}],
  ]);
  state.profile = { tenantId: b };
  state.viewer = { isOwner: false };
  await render();
  expect(status()).toBe("B_IDENTITY_MATCH");
  expect(host.querySelector("button, input, form, a")).toBeNull();
  expect(host.textContent).not.toContain(a);
  expect(host.textContent).not.toContain(b);
});

test("distinguishes fresh A non-owner observation from A owner readiness", async () => {
  state.viewer = { isOwner: false };
  await render();
  expect(status()).toBe("A_NON_OWNER_MATCH");
  expect(status()).not.toBe("A_IDENTITY_MATCH");
  expect(host.querySelector("button, input, form, a")).toBeNull();
  state.viewer = { isOwner: true };
  await render();
  expect(status()).toBe("A_IDENTITY_MATCH");
  state.viewer = undefined;
  await render();
  expect(status()).toBe("NOT_READY");
  state.viewer = null;
  await render();
  expect(status()).toBe("NOT_READY");
});

test.each([
  "auth_loading",
  "signed_out",
  "profile_loading",
  "profile_null",
  "wrong_identity",
  "viewer_loading",
  "viewer_null",
  "b_owner",
])("shows NOT_READY for %s", async (condition) => {
  if (condition === "auth_loading") state.auth.isLoading = true;
  if (condition === "signed_out") state.auth.isAuthenticated = false;
  if (condition === "profile_loading") state.profile = undefined;
  if (condition === "profile_null") state.profile = null;
  if (condition === "wrong_identity") state.profile = { tenantId: "c".repeat(32) };
  if (condition === "viewer_loading") state.viewer = undefined;
  if (condition === "viewer_null") state.viewer = null;
  if (condition === "b_owner") state.profile = { tenantId: b };
  await render();
  expect(status()).toBe("NOT_READY");
  if (condition === "auth_loading" || condition === "signed_out")
    expect(state.queries.mock.calls.every(([, args]) => args === "skip")).toBe(true);
});

test("a lost auth or role witness replaces an earlier match", async () => {
  await render();
  expect(status()).toBe("A_IDENTITY_MATCH");
  state.viewer = undefined;
  await render();
  expect(status()).toBe("NOT_READY");
  state.auth.isAuthenticated = false;
  await render();
  expect(status()).toBe("NOT_READY");
});

test("server route requires development opt-in and valid distinct fixed pins", () => {
  vi.stubEnv("PHASE23_ACCESS_CHECK_EXPECTED_A_ID", a);
  vi.stubEnv("PHASE23_ACCESS_CHECK_EXPECTED_B_ID", b);
  for (const mode of ["production", "test", "development"] as const) {
    for (const enabled of ["", "0", "1"]) {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("PHASE23_ACCESS_CHECK_ENABLED", enabled);
      if (mode === "development" && enabled === "1")
        expect(QualificationIdentityPage().props).toEqual({ expectedAId: a, expectedBId: b });
      else expect(() => QualificationIdentityPage()).toThrow("IDENTITY_CHECK_NOT_FOUND");
    }
  }
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PHASE23_ACCESS_CHECK_ENABLED", "1");
  for (const pin of ["PHASE23_ACCESS_CHECK_EXPECTED_A_ID", "PHASE23_ACCESS_CHECK_EXPECTED_B_ID"]) {
    for (const value of [undefined, "", "not-an-id", "a".repeat(31), "a".repeat(33)]) {
      vi.stubEnv(pin, value);
      expect(() => QualificationIdentityPage()).toThrow("IDENTITY_CHECK_NOT_FOUND");
    }
    vi.stubEnv(pin, pin.endsWith("A_ID") ? a : b);
  }
  vi.stubEnv("PHASE23_ACCESS_CHECK_EXPECTED_B_ID", a);
  expect(() => QualificationIdentityPage()).toThrow("IDENTITY_CHECK_NOT_FOUND");
});

test("no token access, account writes, query-string pins or activation surface is introduced", () => {
  const directory = "app/(app)/ops/qualification-identity";
  for (const file of ["page.tsx", "QualificationIdentity.tsx"]) {
    const source = readFileSync(resolve(directory, file), "utf8");
    for (const forbidden of [
      "useMutation",
      "useAction",
      "fetch(",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "searchParams",
      "NEXT_PUBLIC_",
      "bootstrapOwner",
      "candidateId",
    ])
      expect(source).not.toContain(forbidden);
  }
});
