import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

import {
  assertPhase23PriorAttempt,
  phase23OwnerMode,
} from "../../../../e2e/phase23OwnerContinuation";

const refs = {
  tenantId: "tenant-a",
  threadId: "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
  budgetId: "pppppppppppppppppppppppppppppppp",
  newAuthorizationSha256: "a".repeat(64),
};
const continuation = {
  PIKAR_PHASE23_CONTINUE_EXISTING_OWNER: "1",
  PIKAR_PHASE23_PREVIOUS_THREAD_ID: refs.threadId,
  PIKAR_PHASE23_PREVIOUS_BUDGET_ID: refs.budgetId,
};
const priorProbe = {
  tenantId: refs.tenantId,
  threadId: refs.threadId,
  authorizationSha256: "b".repeat(64),
  expiresAt: 100,
  started: 0,
  finished: 0,
  failed: 0,
  containmentRefusals: 0,
  policyAcceptanceEstablished: false,
};
const priorBudget = {
  budgetId: refs.budgetId,
  closed: true,
  expired: true,
  breached: false,
  callCount: 0,
  settledCount: 0,
  unsettledCount: 0,
  unresolvedCents: 0,
  actualUsd: 0,
};

test("fresh-bootstrap mode retains its explicit grant requirement and rejects implicit continuation", () => {
  expect(() => phase23OwnerMode({})).toThrow("PHASE23_OWNER_BOOTSTRAP_AUTHORIZATION_REQUIRED");
  expect(phase23OwnerMode({ PIKAR_PHASE23_ALLOW_OWNER_BOOTSTRAP: "1" })).toEqual({
    kind: "fresh-bootstrap",
  });
  expect(() =>
    phase23OwnerMode({
      PIKAR_PHASE23_ALLOW_OWNER_BOOTSTRAP: "1",
      PIKAR_PHASE23_PREVIOUS_THREAD_ID: refs.threadId,
    }),
  ).toThrow("PHASE23_CONTINUATION_MODE_REQUIRED");
});

test("existing-owner continuation requires distinct explicit mode and both literal recovery pins", () => {
  expect(phase23OwnerMode(continuation)).toEqual({
    kind: "existing-owner",
    previousThreadId: refs.threadId,
    previousBudgetId: refs.budgetId,
  });
  for (const bootstrap of ["1", "0", ""]) {
    expect(() =>
      phase23OwnerMode({ ...continuation, PIKAR_PHASE23_ALLOW_OWNER_BOOTSTRAP: bootstrap }),
    ).toThrow("PHASE23_OWNER_MODE_CONFLICT");
  }
  expect(() =>
    phase23OwnerMode({ ...continuation, PIKAR_PHASE23_CONTINUE_EXISTING_OWNER: "0" }),
  ).toThrow("PHASE23_OWNER_MODE_CONFLICT");
  for (const key of ["PIKAR_PHASE23_PREVIOUS_THREAD_ID", "PIKAR_PHASE23_PREVIOUS_BUDGET_ID"]) {
    for (const value of [undefined, "", "wrong-ref"]) {
      expect(() => phase23OwnerMode({ ...continuation, [key]: value })).toThrow(
        "PHASE23_PREVIOUS_ATTEMPT_REFS_REQUIRED",
      );
    }
  }
});

test("recovery accepts only terminal zero-use prior state with a different fresh authorization", () => {
  const beforeProbe = structuredClone(priorProbe);
  const beforeBudget = structuredClone(priorBudget);
  expect(assertPhase23PriorAttempt(priorProbe, priorBudget, refs, 200)).toMatchObject({
    budgetId: refs.budgetId,
    threadId: refs.threadId,
    authorizationSha256: priorProbe.authorizationSha256,
    callCount: 0,
    actualUsd: 0,
    closed: true,
    expired: true,
  });
  expect(priorProbe).toEqual(beforeProbe);
  expect(priorBudget).toEqual(beforeBudget);
});

test.each([
  ["tenantId", "tenant-b"],
  ["threadId", "other-thread"],
  ["authorizationSha256", refs.newAuthorizationSha256],
  ["authorizationSha256", "invalid"],
  ["expiresAt", 300],
  ["expiresAt", 0],
  ["expiresAt", NaN],
  ["started", 1],
  ["finished", 1],
  ["failed", 1],
  ["containmentRefusals", 1],
  ["policyAcceptanceEstablished", true],
])("refuses changed or used prior probe field %s", (key, value) => {
  expect(() =>
    assertPhase23PriorAttempt({ ...priorProbe, [key as string]: value }, priorBudget, refs, 200),
  ).toThrow(/^PHASE23_/);
});

test.each([
  ["budgetId", "other-budget"],
  ["closed", false],
  ["expired", false],
  ["breached", true],
  ["callCount", 1],
  ["settledCount", 1],
  ["unsettledCount", 1],
  ["unresolvedCents", 1],
  ["actualUsd", 0.01],
])("refuses ambiguous or charged prior budget field %s", (key, value) => {
  expect(() =>
    assertPhase23PriorAttempt(priorProbe, { ...priorBudget, [key as string]: value }, refs, 200),
  ).toThrow(/^PHASE23_/);
});

test("missing proof values and malformed fresh authorization cannot silently mean zero", () => {
  for (const key of Object.keys(priorProbe)) {
    const changed: Record<string, unknown> = { ...priorProbe };
    delete changed[key];
    expect(() => assertPhase23PriorAttempt(changed, priorBudget, refs, 200)).toThrow(/^PHASE23_/);
  }
  for (const key of Object.keys(priorBudget)) {
    const changed: Record<string, unknown> = { ...priorBudget };
    delete changed[key];
    expect(() => assertPhase23PriorAttempt(priorProbe, changed, refs, 200)).toThrow(/^PHASE23_/);
  }
  expect(() =>
    assertPhase23PriorAttempt(
      priorProbe,
      priorBudget,
      { ...refs, newAuthorizationSha256: "bad" },
      200,
    ),
  ).toThrow("PHASE23_FRESH_CONTINUATION_AUTHORIZATION_REQUIRED");
});

test("actual spec branches never bootstrap an existing owner or replay the stopped attempt", () => {
  const source = readFileSync(resolve("e2e/agent-skill-authoring.spec.ts"), "utf8");
  expect(source).toContain('if (ownerMode.kind === "fresh-bootstrap") {');
  const from = source.indexOf('if (ownerMode.kind === "fresh-bootstrap") {');
  const to = source.indexOf("} else {", from);
  const grant = source.indexOf('query("owner:bootstrapOwner"');
  expect(grant).toBeGreaterThan(from);
  expect(grant).toBeLessThan(to);
  expect(source.match(/query\("owner:bootstrapOwner"/g)).toHaveLength(1);
  expect(source).toMatch(
    /ownerMode\.kind === "existing-owner"\s*\?\s*await existingOwner\(page\)\s*:\s*await nonOwner\(page\)/,
  );
  expect(source.indexOf('resolve(root, "scripts/check-free-gates.mjs")')).toBeLessThan(
    source.indexOf("const primaryId ="),
  );
  expect(source.indexOf('"INTEGRATED_FREE_GATES"')).toBeLessThan(
    source.indexOf("const primaryId ="),
  );
  expect(source.indexOf("previousAttempt = assertPhase23PriorAttempt(")).toBeLessThan(
    source.indexOf('query("authoringProbe:prepare"'),
  );
  expect(source).toContain("prepared.threadId !== ownerMode.previousThreadId");
  expect(source).toContain("prepared.budgetId !== ownerMode.previousBudgetId");
  expect(source).toContain("{ existingOwnerAtStart: true }");
  expect(source).toContain("{ nonOwnerBeforeBootstrap: true }");
  for (const forbidden of [
    "unlinkSync",
    "rmSync",
    "revokeOwner",
    "verifyPhase23PublicRefusal",
    "__convexAuthJWT",
  ])
    expect(source).not.toContain(forbidden);
});
