// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "@pikar/backend/api";
import { type FunctionReference, getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { isLoading: false, isAuthenticated: true },
  profile: { tenantId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } as
    | { tenantId: string }
    | null
    | undefined,
  viewer: { isOwner: false } as { isOwner: boolean } | undefined,
  activate: vi.fn(),
  queries: vi.fn(),
  mutationRefs: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => state.auth,
  useQuery: (ref: unknown, args: unknown) => {
    state.queries(ref, args);
    if (args === "skip") return undefined;
    return getFunctionName(ref as FunctionReference<"query">) ===
      getFunctionName(api.tenantProfile.get)
      ? state.profile
      : state.viewer;
  },
  useMutation: (ref: unknown) => {
    state.mutationRefs(ref);
    return state.activate;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("LOCAL_CHECK_NOT_FOUND");
  },
}));

import AccessCheck from "./AccessCheck";
import QualificationCheckPage from "./page";

const candidateId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const expectedBId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const button = () => host.querySelector("button") as HTMLButtonElement;
const result = () => host.querySelector('[data-testid="phase23-access-result"]')?.textContent;
async function render(pins = { candidateId, expectedBId }) {
  await act(async () => root.render(<AccessCheck {...pins} />));
}
async function click() {
  await act(async () => button().click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.auth = { isLoading: false, isAuthenticated: true };
  state.profile = { tenantId: expectedBId };
  state.viewer = { isOwner: false };
  state.activate.mockReset().mockRejectedValue(new Error("OWNER_REQUIRED"));
  state.queries.mockReset();
  state.mutationRefs.mockReset();
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

test("native hooks require an explicit click and send only the fixed candidate to the public mutation", async () => {
  await render();
  expect(state.activate).not.toHaveBeenCalled();
  expect(host.textContent).toContain("B_IDENTITY_MATCH");
  expect(host.querySelector("input, form")).toBeNull();
  expect(
    state.mutationRefs.mock.calls.every(
      ([ref]) =>
        getFunctionName(ref as FunctionReference<"mutation">) === "skills:activateAgentCandidate",
    ),
  ).toBe(true);
  expect(
    state.queries.mock.calls.map(([ref]) => getFunctionName(ref as FunctionReference<"query">)),
  ).toEqual(["tenantProfile:get", "owner:viewer"]);
  await click();
  expect(state.activate).toHaveBeenCalledExactlyOnceWith({ candidateId });
  expect(result()).toBe("OWNER_REQUIRED");
  expect(button().disabled).toBe(true);
  await click();
  expect(state.activate).toHaveBeenCalledTimes(1);
});

test.each([
  "auth_loading",
  "signed_out",
  "profile_loading",
  "profile_missing",
  "wrong_identity",
  "viewer_loading",
  "owner",
])("blocks %s before calling the mutation", async (condition) => {
  if (condition === "auth_loading") state.auth.isLoading = true;
  if (condition === "signed_out") state.auth.isAuthenticated = false;
  if (condition === "profile_loading") state.profile = undefined;
  if (condition === "profile_missing") state.profile = null;
  if (condition === "wrong_identity") state.profile = { tenantId: candidateId };
  if (condition === "viewer_loading") state.viewer = undefined;
  if (condition === "owner") state.viewer = { isOwner: true };
  await render();
  expect(host.textContent).toContain("NOT_READY");
  expect(button().disabled).toBe(true);
  await click();
  expect(state.activate).not.toHaveBeenCalled();
  if (condition === "auth_loading" || condition === "signed_out") {
    expect(state.queries.mock.calls.every(([, args]) => args === "skip")).toBe(true);
  }
});

test("two clicks before a render cannot make a second request", async () => {
  let reject: (error: Error) => void = () => {};
  state.activate.mockImplementation(
    () => new Promise((_, rejectPromise) => (reject = rejectPromise)),
  );
  await render();
  await act(async () => {
    button().click();
    button().click();
  });
  expect(result()).toBe("CHECK_RUNNING");
  expect(state.activate).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("OWNER_REQUIRED")));
  expect(result()).toBe("OWNER_REQUIRED");
});

test("accepts the literal owner error line in the installed native Convex client envelope", async () => {
  state.activate.mockRejectedValue(
    new Error(
      "[CONVEX M(skills:activateAgentCandidate)] [Request ID: 123abc] Server Error\n" +
        "Uncaught Error: OWNER_REQUIRED\n    at requireOwner (lib/functions.ts:81)\n  Called by client",
    ),
  );
  await render();
  await click();
  expect(result()).toBe("OWNER_REQUIRED");
});

test.each([
  new Error("OWNER_REQUIRED_EXTRA"),
  new Error("A transport error mentions OWNER_REQUIRED"),
  new Error("EVAL_GATE"),
  new Error("UNAUTHENTICATED"),
  new Error("Uncaught Error: OWNER_REQUIRED"),
  new Error("[CONVEX M(skills:wrongFunction)] Server Error\nUncaught Error: OWNER_REQUIRED"),
  new Error(
    "[CONVEX M(skills:activateAgentCandidate)] Server Error\nUncaught Error: OWNER_REQUIRED extra",
  ),
  { message: "OWNER_REQUIRED" },
  "OWNER_REQUIRED",
])("unrecognized errors fail closed without exposing their messages", async (error) => {
  state.activate.mockRejectedValue(error);
  await render();
  await click();
  expect(result()).toBe("CHECK_FAILED");
  expect(host.textContent).not.toContain("transport error");
  expect(button().disabled).toBe(true);
});

test("unexpected successful activation is a failure and cannot be retried", async () => {
  state.activate.mockResolvedValue({ ok: true, changed: true });
  await render();
  await click();
  expect(result()).toBe("CHECK_FAILED");
  await click();
  expect(state.activate).toHaveBeenCalledTimes(1);
});

test("owner/identity changes before the click disable it, and in-flight changes permanently invalidate proof", async () => {
  await render();
  state.viewer = { isOwner: true };
  await render();
  await click();
  expect(state.activate).not.toHaveBeenCalled();
  state.viewer = { isOwner: false };
  let reject: (error: Error) => void = () => {};
  state.activate.mockImplementation(
    () => new Promise((_, rejectPromise) => (reject = rejectPromise)),
  );
  await render();
  await click();
  state.profile = { tenantId: candidateId };
  await render();
  state.profile = { tenantId: expectedBId };
  await render();
  await act(async () => reject(new Error("OWNER_REQUIRED")));
  expect(result()).toBe("CHECK_FAILED");
});

test("changed server pins invalidate an outstanding observation", async () => {
  await render();
  await click();
  expect(result()).toBe("OWNER_REQUIRED");
  await render({ candidateId: "cccccccccccccccccccccccccccccccc", expectedBId });
  expect(result()).toBe("CHECK_FAILED");
  await render();
  expect(result()).toBe("CHECK_FAILED");
  expect(state.activate).toHaveBeenCalledTimes(1);
});

test("server route is absent except explicit development opt-in with two valid server pins", () => {
  vi.stubEnv("PHASE23_ACCESS_CHECK_CANDIDATE_ID", candidateId);
  vi.stubEnv("PHASE23_ACCESS_CHECK_EXPECTED_B_ID", expectedBId);
  for (const mode of ["production", "test", "development"] as const) {
    for (const enabled of ["", "0", "1"]) {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("PHASE23_ACCESS_CHECK_ENABLED", enabled);
      if (mode === "development" && enabled === "1") {
        expect(QualificationCheckPage().props).toEqual({ candidateId, expectedBId });
      } else {
        expect(() => QualificationCheckPage()).toThrow("LOCAL_CHECK_NOT_FOUND");
      }
    }
  }
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PHASE23_ACCESS_CHECK_ENABLED", "1");
  for (const pin of ["PHASE23_ACCESS_CHECK_CANDIDATE_ID", "PHASE23_ACCESS_CHECK_EXPECTED_B_ID"]) {
    for (const value of ["", "not-an-id", "a".repeat(33)]) {
      vi.stubEnv(pin, value);
      expect(() => QualificationCheckPage()).toThrow("LOCAL_CHECK_NOT_FOUND");
    }
    vi.stubEnv(pin, pin.endsWith("B_ID") ? expectedBId : candidateId);
  }
});

test("local surface and helper expose no credential bridge or caller-controlled pins", () => {
  const directory = "app/(app)/ops/qualification-check";
  const page = readFileSync(resolve(directory, "page.tsx"), "utf8");
  const component = readFileSync(resolve(directory, "AccessCheck.tsx"), "utf8");
  const helper = readFileSync(resolve("e2e/phase23PublicRefusal.ts"), "utf8");
  expect(page).toContain('process.env.NODE_ENV !== "development"');
  expect(page).toContain('process.env.PHASE23_ACCESS_CHECK_ENABLED !== "1"');
  for (const source of [page, component, helper]) {
    for (const forbidden of [
      "NEXT_PUBLIC_",
      "searchParams",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "window.",
      "bootstrapOwner",
      "fetchMutation",
      "internal.",
      "setAuth",
      "Bearer",
    ])
      expect(source).not.toContain(forbidden);
  }
  expect(helper).not.toContain(".fill(");
  expect(helper).toContain('page.goto("/ops/qualification-check")');
  expect(helper).toContain('toHaveText("B_IDENTITY_MATCH")');
  expect(helper).toContain('toHaveText("OWNER_REQUIRED")');
});
