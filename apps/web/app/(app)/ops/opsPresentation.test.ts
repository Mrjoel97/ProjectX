// GOVN-01 presentation contract, rendered in the repository's DOM-free React test runner.
//
// This renders the REAL OpsPage component while replacing only Convex's hook transport. Recording
// every hook reference lets the test prove the important mount property: an unconfirmed viewer
// does not merely receive hidden optimizer markup; React never executes the owner-only panels, so
// their queries and mutations never subscribe. This is component evidence, not a browser/DOM claim.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import OpsPage from "./page";

const hooks = vi.hoisted(() => {
  const state = {
    queryCalls: [] as unknown[],
    mutationCalls: [] as unknown[],
    resolveQuery: (_reference: unknown): unknown => undefined,
  };

  return {
    state,
    useQuery: vi.fn((reference: unknown) => {
      state.queryCalls.push(reference);
      return state.resolveQuery(reference);
    }),
    useMutation: vi.fn((reference: unknown) => {
      state.mutationCalls.push(reference);
      return async () => undefined;
    }),
  };
});

vi.mock("convex/react", () => ({
  useQuery: hooks.useQuery,
  useMutation: hooks.useMutation,
}));

const shellSource = readFileSync(fileURLToPath(new URL("../layout.tsx", import.meta.url)), "utf8");

const signals = {
  reviewOutcomes: { sent: 3, rejected: 0, expired: 0, failed: 0, blocked: 0 },
  // 26-14: the REAL literals the backend emits (`review.ts`'s validator union), with NON-ZERO
  // counts. This mock said `edit: 0` — a key nothing writes, at the one value that cannot tell a
  // correct read from a broken one — so the tile could read `dc.edit` forever and stay green.
  decisionCounts: { approve: 2, edit_text: 3, regenerate: 0, reject: 1 },
  otherDecisions: 0,
  regenerateTotal: 0,
  fallbackCount: 0,
  dlqNew: 1,
  dlqTotal: 1,
  requestCount: 4,
  costPerDeliveredUsd: 0.0123,
  totalCostUsd: 0.0369,
  deliveredCount: 3,
};

type Viewer = { isOwner: boolean } | null | undefined;

function names(references: unknown[]): string[] {
  return references.map((reference) =>
    getFunctionName(reference as Parameters<typeof getFunctionName>[0]),
  );
}

function render(viewer: Viewer): { html: string; queries: string[]; mutations: string[] } {
  hooks.state.resolveQuery = (reference) => {
    switch (getFunctionName(reference as Parameters<typeof getFunctionName>[0])) {
      case "owner:viewer":
        return viewer;
      case "opsSignals:evalSignals":
        return signals;
      case "deadLetters:listNew":
        return [];
      // 25.1-06 (D13). Deliberately NON-EMPTY: an empty result renders the "no dead letters"
      // paragraph, which is indistinguishable from the section never mounting at all — so the
      // owner assertion below would pass against a deleted section.
      case "deadLetters:listAll":
        return {
          cap: 50,
          truncated: false,
          rows: [
            {
              id: "dl_1",
              tenantId: "kn7other",
              workflowId: "media.render",
              source: "workflow",
              correlationId: "batch_9",
              error: "route_bad_response",
              status: "new",
              createdAt: Date.now() - 5 * 60_000,
              payload: { batchId: "batch_9", planId: "plan_1" },
            },
          ],
        };
      case "optimizerConfig:getOptimizerStatus":
        return { enabled: false };
      case "skills:candidatesForReview":
      case "skills:tenantCandidatesForReview":
        return [];
      default:
        throw new Error(
          `Unexpected query mounted: ${getFunctionName(reference as Parameters<typeof getFunctionName>[0])}`,
        );
    }
  };

  const html = renderToStaticMarkup(createElement(OpsPage));
  return {
    html,
    queries: names(hooks.state.queryCalls),
    mutations: names(hooks.state.mutationCalls),
  };
}

beforeEach(() => {
  hooks.state.queryCalls.length = 0;
  hooks.state.mutationCalls.length = 0;
  hooks.useQuery.mockClear();
  hooks.useMutation.mockClear();
});

describe("/ops owner presentation boundary", () => {
  test("exact owner true mounts optimizer content and all owner-only hook subscriptions", () => {
    const result = render({ isOwner: true });

    // Anti-vacuity/mutation witness: if the mount guard is deleted OR made always-false, this owner
    // path loses both the visible heading and the hooks that only OptimizerPanel owns.
    expect(result.html).toContain(">Optimizer</p>");
    expect(result.html).toContain('aria-label="Optimizer kill switch"');
    expect(result.queries).toEqual(
      expect.arrayContaining([
        "optimizerConfig:getOptimizerStatus",
        "skills:candidatesForReview",
        "skills:tenantCandidatesForReview",
      ]),
    );
    expect(result.mutations).toEqual(
      expect.arrayContaining([
        "optimizerConfig:setOptimizerEnabled",
        "skills:activateCandidate",
        "skills:activateTenantCandidate",
        "skills:rollbackTenantSkill",
      ]),
    );

    // D13: the cross-tenant dead-letter section is owner-only on the SAME mounting rule.
    expect(result.html).toContain(">Dead letters — all tenants</p>");
    expect(result.queries).toContain("deadLetters:listAll");
    // A row belonging to a tenant that is not the viewer's actually reaches the markup — the whole
    // point of the section, and what a "renders the heading" assertion alone would not prove.
    expect(result.html).toContain("route_bad_response");
    expect(result.html).toContain("kn7other");
    expect(result.html).toContain("5m old");
    // Read-only: no dead-letter mutation is mounted BY THIS SECTION. `markResolved` is the tenant
    // section's and is expected; nothing owner-scoped joins it.
    expect(result.mutations.filter((m) => m.startsWith("deadLetters:"))).toEqual([
      "deadLetters:markResolved",
    ]);
  });

  test.each([
    ["false", { isOwner: false }],
    ["null", null],
    ["loading", undefined],
  ] as const)("%s viewer never mounts optimizer content or owner-only hooks", (_state, viewer) => {
    const result = render(viewer);
    const mountedHooks = [...result.queries, ...result.mutations];

    expect(result.html).not.toContain(">Optimizer</p>");
    expect(result.html).not.toContain('aria-label="Optimizer kill switch"');
    for (const ownerOnly of [
      "optimizerConfig:getOptimizerStatus",
      "optimizerConfig:setOptimizerEnabled",
      "skills:candidatesForReview",
      "skills:activateCandidate",
      "skills:tenantCandidatesForReview",
      "skills:activateTenantCandidate",
      "skills:rollbackTenantSkill",
      // D13. The sharpest of the set: mounting this one subscribes a non-owner to OTHER TENANTS'
      // failure rows. The server `ownerQuery` would refuse it, but a refused subscription is still
      // an error boundary and a loading state on somebody's screen.
      "deadLetters:listAll",
    ]) {
      expect(mountedHooks, `${ownerOnly} mounted for ${_state}`).not.toContain(ownerOnly);
    }

    // These are the mixed-purpose tenant surface. Removing the owner branch altogether can make
    // the negative assertions pass vacuously; these positive rendered assertions prevent that.
    expect(result.html).toContain(">Eval signals</p>");
    // 26-14 REGRESSION GUARD. The gate tile must render the backend's OWN key. Reading `dc.edit`
    // (the shipped defect) renders "edit 0" against this fixture's `edit_text: 3`, so a
    // backend-only correction — the exact half-fix this plan first shipped — fails here.
    expect(result.html).toContain("approve 2 · edit 3 · reject 1");
    expect(result.html).not.toContain("edit 0");
    expect(result.html).toContain(">DLQ</p>");
    expect(result.html).toContain(">Dead letters — your tenant</p>");
    expect(result.html).toContain("No unresolved dead letters.");
    // …and the owner-only sibling section is absent entirely, not merely empty.
    expect(result.html).not.toContain(">Dead letters — all tenants</p>");
    expect(result.queries).toEqual(
      expect.arrayContaining(["owner:viewer", "opsSignals:evalSignals", "deadLetters:listNew"]),
    );
  });

  test("the shared shell still exposes Compliance and its tenant DLQ badge", () => {
    // The owner branch lives inside OpsPage, while these two affordances live in its unchanged
    // parent shell. This complementary source assertion is intentionally not described as render
    // evidence; it prevents a future cleanup from satisfying the page test while orphaning /ops.
    expect(shellSource.length).toBeGreaterThan(5_000);
    // Asserted as two facts, not one formatted line: Biome wraps this NAV entry across several
    // lines, so pinning the joined form would fail on a pure reformat.
    expect(shellSource).toContain('label: "Compliance"');
    expect(shellSource).toContain('href: "/dashboard/approvals?tab=compliance"');
    expect(shellSource).toContain(
      'item.href === "/dashboard/approvals?tab=compliance" && <DeadLetterBadge />',
    );
    expect(shellSource).toContain("useQuery(api.deadLetters.newCount)");
  });
});
