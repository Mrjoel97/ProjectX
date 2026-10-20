import type { Page } from "@playwright/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  read: vi.fn(),
  visible: vi.fn(),
  hidden: vi.fn(),
  count: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawnSync: (...args: unknown[]) => state.read(...args) }));
vi.mock("@playwright/test", () => ({
  expect: () => ({
    toBeVisible: state.visible,
    toBeHidden: state.hidden,
    toHaveCount: state.count,
  }),
}));

import { existingOwner, nonOwner, verifyInspectionTarget } from "../../../../e2e/phase23NativeAuth";

const primaryId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const foreignId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const response = (userId = primaryId, owner = true) => ({
  status: 0,
  stdout: JSON.stringify({ userId, owner }),
});
function fakePage() {
  const locator = {
    or: vi.fn(),
    isVisible: vi.fn().mockResolvedValue(false),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
  };
  locator.or.mockReturnValue(locator);
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    getByRole: vi.fn().mockReturnValue(locator),
    getByLabel: vi.fn().mockReturnValue(locator),
    getByText: vi.fn().mockReturnValue(locator),
  };
  return { page: page as unknown as Page, calls: page, locator };
}
beforeEach(() => {
  state.read.mockReset().mockReturnValue(response());
  for (const mock of [state.visible, state.hidden, state.count])
    mock.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("E2E_USER_EMAIL", "primary@example.test");
  vi.stubEnv("E2E_USER_PASSWORD", "synthetic-primary-only");
  vi.stubEnv("E2E_FOREIGN_USER_EMAIL", "foreign@example.test");
  vi.stubEnv("E2E_FOREIGN_USER_PASSWORD", "synthetic-foreign-only");
  vi.stubEnv("PIKAR_PHASE23_PRIMARY_USER_ID", primaryId);
  vi.stubEnv("PIKAR_PHASE23_FOREIGN_USER_ID", foreignId);
  vi.stubEnv("PIKAR_CONVEX_TARGET", "dev");
  vi.stubEnv("CONVEX_URL", "https://woozy-wren-368.convex.cloud");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("native inspection guard checks the exact dashboard without authentication or mutation", () => {
  state.read.mockReturnValue({
    status: 0,
    stdout: "https://dashboard.convex.dev/d/woozy-wren-368\n",
  });
  expect(() => verifyInspectionTarget()).not.toThrow();
  expect(state.read).toHaveBeenCalledTimes(1);
  const args = state.read.mock.calls[0]?.[1];
  expect(args?.slice(1)).toEqual(["dashboard", "--no-open"]);
  vi.stubEnv("PIKAR_CONVEX_TARGET", "prod");
  vi.stubEnv("CONVEX_URL", "https://opulent-octopus-494.convex.cloud");
  state.read.mockReturnValue({
    status: 0,
    stdout: "https://dashboard.convex.dev/d/opulent-octopus-494",
  });
  verifyInspectionTarget();
  expect(state.read.mock.calls[1]?.[1].slice(1)).toEqual(["dashboard", "--prod", "--no-open"]);
});

test("missing or credential-bearing inspection URL refuses before any CLI or auth operation", () => {
  for (const url of [
    "",
    "https://private@woozy-wren-368.convex.cloud",
    "https://woozy-wren-368.convex.cloud?private",
  ]) {
    vi.stubEnv("CONVEX_URL", url);
    expect(() => verifyInspectionTarget()).toThrow("PHASE23_EXPLICIT_INSPECTION_URL_REQUIRED");
  }
  expect(state.read).not.toHaveBeenCalled();
});

test.each([
  { status: 0, stdout: "https://dashboard.convex.dev/d/opulent-octopus-494" },
  { status: 1, stdout: "private diagnostic", stderr: "private-token" },
  { status: null, error: { code: "ETIMEDOUT" }, stdout: "private diagnostic" },
  { status: 0 },
])("wrong target or uncertain dashboard read fails with a fixed diagnostic", (result) => {
  state.read.mockReturnValue(result);
  expect(() => verifyInspectionTarget()).toThrow(/^PHASE23_INSPECTION_TARGET_FAILED$/);
  expect(state.read).toHaveBeenCalledTimes(1);
});

test("shared existing-owner helper signs in natively and checks exact identity and role before and after", async () => {
  const { page, calls, locator } = fakePage();
  await expect(existingOwner(page)).resolves.toBe(primaryId);
  expect(calls.goto.mock.calls).toEqual([["/signin"], ["/ops"]]);
  expect(locator.fill).toHaveBeenCalledWith("primary@example.test");
  expect(calls.getByText).toHaveBeenCalledWith("Tenant skill candidates", { exact: true });
  expect(state.read).toHaveBeenCalledTimes(2);
  for (const [, args] of state.read.mock.calls) {
    expect(args).toContain("owner:findUserIdByEmail");
    expect(JSON.parse(args.at(-1))).toEqual({ email: "primary@example.test" });
    expect(args).not.toContain("--identity");
  }
});

test.each([
  [foreignId, true],
  [primaryId, false],
])("post-sign-in changed identity/role fails even when the owner panel was visible", async (id, owner) => {
  state.read
    .mockReturnValueOnce(response())
    .mockReturnValueOnce(response(id as string, owner as boolean));
  const { page, calls } = fakePage();
  await expect(existingOwner(page)).rejects.toThrow("PHASE23_AUTH_OWNER_UI_FAILED");
  expect(calls.goto.mock.calls).toEqual([["/signin"], ["/ops"]]);
  expect(state.read).toHaveBeenCalledTimes(2);
});

test("wrong existing-owner identity is refused before any form sign-in", async () => {
  state.read.mockReturnValue(response(foreignId));
  const { page, calls } = fakePage();
  await expect(existingOwner(page)).rejects.toThrow("PHASE23_AUTH_IDENTITY_FAILED");
  expect(calls.goto).not.toHaveBeenCalled();
});

test("native owner-panel failure stops without producing a successful identity witness", async () => {
  state.visible
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("private detail"));
  const { page } = fakePage();
  await expect(existingOwner(page)).rejects.toThrow("PHASE23_AUTH_OWNER_UI_FAILED");
  expect(state.read).toHaveBeenCalledTimes(1);
});

test("fresh non-owner mode remains role-strict and does not require continuation/spend flags", async () => {
  state.read.mockReturnValue(response(primaryId, false));
  const { page } = fakePage();
  await expect(nonOwner(page)).resolves.toBe(primaryId);
  expect(state.read).toHaveBeenCalledTimes(1);
  expect(state.count).toHaveBeenCalledWith(0);
});

test("foreign non-owner still uses its separately pinned native identity", async () => {
  state.read.mockReturnValue(response(foreignId, false));
  const { page, locator } = fakePage();
  await expect(nonOwner(page, true)).resolves.toBe(foreignId);
  expect(locator.fill).toHaveBeenCalledWith("foreign@example.test");
  expect(JSON.parse(state.read.mock.calls[0]?.[1].at(-1))).toEqual({
    email: "foreign@example.test",
  });
});
