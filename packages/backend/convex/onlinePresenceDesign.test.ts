// @vitest-environment node

import { selectDesignProfile } from "@pikar/core/designKnowledge";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { generateText } from "ai";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import limiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  generateStitchDesignEvidence,
  recoverStitchDesignEvidence,
} from "./lib/stitchDesignClient";
import schema from "./schema";

// Boundary test: provider transport and already-validated source snapshot are synthetic.
// Tenant claim/idempotence, ordinary reserve/settle, storage lifecycle and recovery are real.
const state = vi.hoisted(() => ({
  snapshot: {} as Record<string, unknown>,
  finalizeFails: false,
  finalizations: 0,
}));
vi.mock("./onlinePresence", async () => {
  const { internalMutation } = await import("./_generated/server");
  const { v } = await import("convex/values");
  const args = { tenantId: v.string(), planId: v.id("plans"), expectedRevision: v.number() };
  return {
    designSnapshot: internalMutation({ args, handler: async () => state.snapshot }),
    buildProject: internalMutation({
      args: { ...args, designCompletion: v.any() },
      handler: async (_ctx, args) => {
        state.finalizations++;
        if (state.finalizeFails) throw Error("synthetic transient finalization failure");
        return {
          ok: true,
          revision: args.expectedRevision + 1,
          artifact: { version: 1, providerReceipt: args.designCompletion.providerReceipt },
        };
      },
    }),
  };
});
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("./lib/models", () => ({ resolveModel: (modelId: string) => ({ modelId }) }));
vi.mock("./lib/paidBudgetModel", () => ({ paidBudgetModel: (args: unknown) => args }));
vi.mock("./lib/stitchDesignClient", () => ({
  generateStitchDesignEvidence: vi.fn(),
  recoverStitchDesignEvidence: vi.fn(),
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregates = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const limiters = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const run = makeFunctionReference<"action">("onlinePresenceDesign:build");
const hash = (v: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(v)));
const layoutPlan = {
  version: 1,
  hero: "overlay-left",
  sectionLayout: "editorial-columns",
  services: "rows",
  gallery: "carousel",
  spacing: "relaxed",
  headingScale: "balanced",
  motion: "subtle",
};
let calls: string[] = [];
beforeEach(() => {
  calls = [];
  state.finalizeFails = false;
  state.finalizations = 0;
  vi.stubEnv("STITCH_API_KEY", "synthetic");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic");
  vi.stubEnv("PRESENCE_STITCH_BILLING", "included_free_no_overage");
  vi.mocked(generateStitchDesignEvidence).mockReset();
  vi.mocked(recoverStitchDesignEvidence).mockReset();
  vi.mocked(generateText).mockReset();
  vi.mocked(generateStitchDesignEvidence).mockImplementation(async () => {
    calls.push("stitch");
    return {
      status: "complete",
      html: { text: "reference" },
      screenshot: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    } as never;
  });
  vi.mocked(generateText).mockImplementation(async (options) => {
    calls.push("kimi");
    const model = options.model as unknown as {
      ctx: ActionCtx;
      tenantId: string;
      modelId: string;
      websiteDesign: { planId: Id<"plans">; revision: number; runRef: string };
      beforeCall: () => Promise<void>;
      onCost: (n: number) => void;
    };
    expect(model.modelId).toBe("or/moonshotai/kimi-k3.1-pro");
    expect(options.maxRetries).toBe(0);
    await model.beforeCall();
    const reservationId = await model.ctx.runMutation(internal.guardrails.reservePaidCall, {
      tenantId: model.tenantId,
      callId: crypto.randomUUID(),
      model: model.modelId,
      ceilingCents: 428,
      websiteDesign: model.websiteDesign,
    });
    await model.ctx.runMutation(internal.guardrails.settlePaidCall, {
      tenantId: model.tenantId,
      reservationId,
      costUsd: 0.01,
    });
    model.onCost(0.01);
    return {
      text: JSON.stringify({ layoutPlan }),
      response: { modelId: "moonshotai/kimi-k3.1-pro" },
      finishReason: "stop",
    } as never;
  });
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregates);
  t.registerComponent("rateLimiter", limiterSchema, limiters);
  const tenantId = await t.run((ctx) => ctx.db.insert("users", {}));
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId,
    threadId: "native-design",
  });
  const brief = { kind: "website", businessName: "Fieldwork" },
    sourceSnapshots = [{ ref: "source", revision: "revision1" }];
  await t.run((ctx) =>
    ctx.db.insert("onlinePresenceSessions", {
      tenantId,
      planId,
      threadId: "native-design",
      revision: 1,
      humanMessages: [],
      brief,
      sourceSnapshots,
      status: "ready",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  state.snapshot = {
    ok: true,
    revision: 1,
    briefHash: hash({ brief, sourceSnapshots }),
    sourceFingerprint: hash(sourceSnapshots),
    brief,
    slug: "fieldwork",
    recipeRef: { designProfile: selectDesignProfile().profile },
    document: {
      kind: "site",
      title: "Fieldwork",
      brand: { name: "Fieldwork" },
      navigation: [],
      pages: [
        {
          slug: "home",
          title: "Home",
          nodes: [
            { kind: "hero", heading: "Identity with purpose" },
            {
              kind: "media",
              storageRef: `webasset:photo:${"a".repeat(64)}`,
              alt: "Studio materials",
              placement: "hero",
            },
          ],
        },
      ],
    },
  };
  return { t, args: { tenantId, planId, expectedRevision: 1 } };
}
test("ordinary tenant runs both required providers, reserves honestly and persists pending exact-version receipt", async () => {
  const { t, args } = await setup();
  const result = await t.action(run, args);
  expect(result.ok).toBe(true);
  expect(calls).toEqual(["stitch", "kimi"]);
  expect(result.artifact.providerReceipt).toMatchObject({
    pipelineVersion: "stitch-kimi-required-v1",
    pendingBrowser: true,
    sourceFingerprint: state.snapshot.sourceFingerprint,
  });
  const receipts = await t.run((ctx) => ctx.db.query("uploadReceipts").collect());
  expect(receipts.filter((r) => r.tenantId === args.tenantId)).toHaveLength(2);
  const spend = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(spend.some((r) => r.phase === "reserved" && r.tenantId === args.tenantId)).toBe(true);
});
test("completion recovery finalizes without repeating either provider after connection failure", async () => {
  const { t, args } = await setup();
  state.finalizeFails = true;
  expect((await t.action(run, args)).ok).toBe(false);
  state.finalizeFails = false;
  expect((await t.action(run, args)).ok).toBe(true);
  expect(calls).toEqual(["stitch", "kimi"]);
  expect(state.finalizations).toBe(2);
});

test("an uncertain owned Stitch run resumes by reading its existing project without regenerating", async () => {
  const { t, args } = await setup();
  vi.mocked(generateStitchDesignEvidence).mockImplementationOnce(async (_request, services) => {
    calls.push("stitch");
    await services.checkpoint({
      scopeHash: "sha256:" + "a".repeat(64),
      projectName: "projects/owned_project",
    });
    await services.beforeAttempt({
      provider: "stitch",
      operation: "generate_screen_from_text",
      scopeHash: "sha256:" + "a".repeat(64),
      requestHash: "sha256:" + "b".repeat(64),
      potentiallyGenerative: true,
    });
    return {
      status: "unknown",
      reason: "STITCH_SINGLE_DESIGN_REQUIRED",
      evidence: { providerGeneration: "attempted" },
      reconciliationRequired: true,
    } as never;
  });
  expect((await t.action(run, args)).ok).toBe(false);
  vi.mocked(recoverStitchDesignEvidence).mockImplementationOnce(
    async (_request, _services, recovery) => {
      calls.push("stitch-recovery");
      expect(recovery).toEqual({ projectName: "projects/owned_project" });
      return {
        status: "complete",
        html: { text: "recovered reference" },
        screenshot: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
      } as never;
    },
  );
  expect((await t.action(run, args)).ok).toBe(true);
  expect(calls).toEqual(["stitch", "stitch-recovery", "kimi"]);
  expect(generateStitchDesignEvidence).toHaveBeenCalledTimes(1);
  expect(recoverStitchDesignEvidence).toHaveBeenCalledTimes(1);
  const audits = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(audits.filter((row) => row.eventType === "presence_design.claimed")).toHaveLength(1);
  expect(audits.filter((row) => row.payload.recoveryClaimed === true)).toHaveLength(1);
});
test("failed Kimi attempt retains tenant-owned generated blob receipts for cleanup", async () => {
  const { t, args } = await setup();
  vi.mocked(generateText).mockImplementation(async (options) => {
    const model = options.model as unknown as {
      ctx: ActionCtx;
      tenantId: string;
      modelId: string;
      websiteDesign: { planId: Id<"plans">; revision: number; runRef: string };
      beforeCall: () => Promise<void>;
    };
    await model.beforeCall();
    await model.ctx.runMutation(internal.guardrails.reservePaidCall, {
      tenantId: model.tenantId,
      callId: crypto.randomUUID(),
      model: model.modelId,
      ceilingCents: 428,
      websiteDesign: model.websiteDesign,
    });
    throw Error("synthetic uncertain paid provider response");
  });
  expect((await t.action(run, args)).ok).toBe(false);
  const receipts = await t.run((ctx) => ctx.db.query("uploadReceipts").collect());
  expect(receipts).toHaveLength(2);
  expect(
    receipts.every(
      (row) => row.tenantId === args.tenantId && row.storageId && row.expiresAt > Date.now(),
    ),
  ).toBe(true);
  const spend = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(spend.filter((row) => row.phase === "reserved")).toHaveLength(1);
  expect(spend.filter((row) => row.phase === "actual")).toHaveLength(0);
  expect((await t.action(run, args)).ok).toBe(false);
  expect(generateStitchDesignEvidence).toHaveBeenCalledTimes(1);
  expect(generateText).toHaveBeenCalledTimes(1);
});
test("unconfigured billing and repeated failed claims cannot silently use old recipe or repeat spend", async () => {
  const { t, args } = await setup();
  vi.stubEnv("PRESENCE_STITCH_BILLING", "");
  expect((await t.action(run, args)).reason).toBe("stitch_billing_unverified");
  expect(calls).toEqual([]);
  vi.stubEnv("PRESENCE_STITCH_BILLING", "included_free_no_overage");
  vi.mocked(generateStitchDesignEvidence).mockRejectedValue(Error("synthetic unavailable"));
  expect((await t.action(run, args)).ok).toBe(false);
  expect((await t.action(run, args)).reason).toBe("design_already_running_or_needs_reconciliation");
  expect(generateStitchDesignEvidence).toHaveBeenCalledTimes(1);
  expect(generateText).not.toHaveBeenCalled();
  expect(state.finalizations).toBe(0);
});

test.each([
  { status: "failed", reason: "STITCH_TOOL_REFUSED", generation: "not_started", uncertain: false },
  {
    status: "unknown",
    reason: "STITCH_SINGLE_DESIGN_REQUIRED",
    generation: "attempted",
    uncertain: true,
  },
  {
    status: "unknown",
    reason: "https://provider.invalid/private?key=secret",
    generation: "secret",
    uncertain: true,
  },
])("Stitch $status stores bounded diagnostics without repeating generation", async ({
  status,
  reason,
  generation,
  uncertain,
}) => {
  const { t, args } = await setup();
  vi.mocked(generateStitchDesignEvidence).mockResolvedValue({
    status,
    reason,
    evidence: { providerGeneration: generation },
    reconciliationRequired: uncertain,
  } as never);
  expect((await t.action(run, args)).ok).toBe(false);
  const audits = await t.run((ctx) => ctx.db.query("audit").collect());
  const stopped = audits.find((row) => row.payload.stopped === true);
  expect(stopped?.payload).toMatchObject({
    stopped: true,
    provider: "stitch",
    failureReason: reason.startsWith("STITCH_") ? reason : "STITCH_PROVIDER_RESULT_INVALID",
    providerGeneration: generation === "secret" ? "unknown" : generation,
    reconciliationRequired: uncertain,
    phase: "claimed",
  });
  expect(JSON.stringify(audits)).not.toContain("secret");
  expect((await t.action(run, args)).reason).toBe("design_already_running_or_needs_reconciliation");
  expect(generateStitchDesignEvidence).toHaveBeenCalledTimes(1);
  expect(generateText).not.toHaveBeenCalled();
  expect(state.finalizations).toBe(0);
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});
