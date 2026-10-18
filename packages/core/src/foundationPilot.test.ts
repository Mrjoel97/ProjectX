import { expect, test } from "vitest";
import { FOUNDATION_PILOT_MAX_MS, foundationPilotExpiresAt } from "./foundationPilot";

const tenantId = "j57aaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const now = 1_800_000_000_000;
const grant = { tenantId, issuedAt: now, expiresAt: now + FOUNDATION_PILOT_MAX_MS };

test("the test window includes setup time before a full fifteen-minute call", () => {
  expect(FOUNDATION_PILOT_MAX_MS).toBe(30 * 60_000);
  expect(foundationPilotExpiresAt(JSON.stringify(grant), tenantId, now + 8 * 60_000)).toBe(
    grant.expiresAt,
  );
});

test("only the exact tenant is admitted during the bounded interval", () => {
  const raw = JSON.stringify(grant);
  expect(foundationPilotExpiresAt(raw, tenantId, now)).toBe(grant.expiresAt);
  expect(foundationPilotExpiresAt(raw, "j57bbbbbbbbbbbbbbbbbbbbbbbbbbbbb", now)).toBeUndefined();
  expect(foundationPilotExpiresAt(raw, tenantId, now - 1)).toBeUndefined();
  expect(foundationPilotExpiresAt(raw, tenantId, grant.expiresAt - 1)).toBe(grant.expiresAt);
  expect(foundationPilotExpiresAt(raw, tenantId, grant.expiresAt)).toBeUndefined();
});

test.each([
  undefined,
  "",
  "{",
  "null",
  "[]",
  "true",
  "x".repeat(513),
  JSON.stringify({ ...grant, expiresAt: grant.expiresAt + 1 }),
  JSON.stringify({ ...grant, issuedAt: now + 1 }),
  JSON.stringify({ ...grant, issuedAt: -1 }),
  JSON.stringify({ ...grant, expiresAt: now }),
  JSON.stringify({ ...grant, expiresAt: String(grant.expiresAt) }),
  JSON.stringify({ ...grant, expiresAt: now + 0.5 }),
  JSON.stringify({ ...grant, tenantId: "*" }),
  JSON.stringify({ ...grant, allowAll: true }),
  JSON.stringify({ tenantId, expiresAt: grant.expiresAt }),
])("malformed or overbroad grants fail closed: %s", (raw) => {
  expect(foundationPilotExpiresAt(raw, tenantId, now)).toBeUndefined();
});
