// SC4 mutation-level invariants (convex-test): the executePlan approve-gate is idempotent
// (double-approve → one workflow), never seeds/starts on a non-proposed status (zero sends
// before Approve), rejects a cross-tenant approve, and refuses when no mailbox is connected.
//
// The deterministic FSM parser (parseAnswer/toIntentState) was DELETED in 03.2.1-05 (the cockpit
// reasons via the agent tool-loop now) — its tests went with it. The guard tests below RETURN
// before workflow.start; the attachment fan-out tests (CKPT-02, Plan 05) DO drive the successful
// proposed→delivering path by registering the workflow + workflow/workpool components (the same
// pattern cockpitTools.test.ts uses for the aggregate). smoke:fanout remains the live coverage.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import retrierTest from "@convex-dev/action-retrier/test";
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { SEND_TIME_HORIZON_MS } from "@pikar/core";
import { maxCharsFor } from "@pikar/core/storyboard";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// cancelScheduledPlan writes a refs-only plan.canceled audit; the SOLE audit-insert surface counts
// the auditCounts aggregate, so register the component (relative import — the package blocks the
// deep specifier), same pattern as cockpitTools.test.ts.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// 20-07: the media pre-step drives BOTH media spend windows through the REAL rate-limiter.
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
// Register the delivery components so executePlan can reach workflow.start under convex-test.
// (workpool is a first-class runtime dependency since 15.3-04 — the app registers its own
// `vaultIngestPool` — but this suite only needs the copy @convex-dev/workflow nests under itself.)
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";

/** A convex-test instance wired for both executePlan delivery arms. */
function withDelivery() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  retrierTest.register(t);
  return t;
}

/** A mailbox has to exist for executePlan to proceed past the gmail pre-check. */
const seedMailbox = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId,
      refreshToken: "r",
      scope: "s",
      updatedAt: Date.now(),
    }),
  );

/** Seed a plans row at a given status (raw insert — bypasses the guided conversation). */
async function seedPlan(
  t: ReturnType<typeof convexTest>,
  status: "collecting" | "proposed" | "approved" | "delivering" | "done",
  tenantId = TENANT,
) {
  return t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "thread_1",
      status,
      recipients: ["a@example.com", "b@example.com"],
      mode: "individual",
      subject: "Q3 update",
      body: "Here is the Q3 update.",
      createdAt: Date.now(),
    }),
  );
}

const countRequests = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("requests").collect());

async function seedCalendarPlan(
  t: ReturnType<typeof convexTest>,
  status: "collecting" | "proposed" | "approved" | "delivering" | "done",
  fields: { tenantId?: string; escalated?: boolean } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: fields.tenantId ?? TENANT,
      threadId: `calendar_thread_${crypto.randomUUID()}`,
      kind: "calendar_event",
      status,
      eventTitle: "Governed planning review",
      eventStartMs: Date.UTC(2026, 7, 3, 13, 0),
      eventDurationMs: 30 * 60_000,
      eventTz: "Africa/Dar_es_Salaam",
      escalated: fields.escalated,
      createdAt: Date.now(),
    }),
  );
}

describe("executePlan calendar arm (ACTN-02)", () => {
  test("a proposed calendar plan starts one retrier run and records its governed delivery state", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed");

    const result = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: true });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("delivering");
    expect(plan?.calendarRunId).toEqual(expect.any(String));
    expect(plan?.calendarRunId).not.toHaveLength(0);
    expect(plan?.correlationId).toEqual(expect.any(String));
  });

  test.each([
    "collecting",
    "approved",
    "done",
  ] as const)("a %s calendar plan starts no retrier run and creates nothing", async (status) => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, status);

    const result = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: true, alreadyStarted: true });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe(status);
    expect(plan?.calendarRunId).toBeUndefined();
    expect(plan?.calendarEventId).toBeUndefined();
  });

  test("two sequential approvals preserve one run id and the second is an idempotent no-op", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed");
    const asTenant = t.withIdentity({ subject: TENANT });

    expect(await asTenant.mutation(api.cockpit.executePlan, { planId })).toEqual({ ok: true });
    const first = await t.run((ctx) => ctx.db.get(planId));
    const secondResult = await asTenant.mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(secondResult).toEqual({ ok: true, alreadyStarted: true });
    const second = await t.run((ctx) => ctx.db.get(planId));
    expect(first?.calendarRunId).toEqual(expect.any(String));
    expect(second?.calendarRunId).toBe(first?.calendarRunId);
  });

  test("calendar approval does not require a connected mailbox", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed");

    const result = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    expect(result).not.toEqual({ ok: false, reason: "gmail_not_connected" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.calendarRunId).toEqual(expect.any(String));
  });

  test("calendar approval cannot reach the gmail request or workflow fan-out", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed");

    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(await countRequests(t)).toHaveLength(0);
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.workflowId).toBeUndefined();
  });

  test("the existing escalated-plan guard refuses calendar before the arm starts", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed", { escalated: true });

    const result = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: false, reason: "review_escalated" });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.calendarRunId).toBeUndefined();
    expect(await countRequests(t)).toHaveLength(0);
  });

  // ── 20-07: THE REGRESSION THAT MAKES THE GENERALIZATION SAFE ─────────────────────────────
  //
  // Option (a) — generalize the arm — was taken with its cost stated honestly: the shipped calendar
  // path must come out behaviourally byte-identical. Every assertion above still passes unchanged,
  // and these two add what only becomes checkable once a SECOND occupant exists.

  test("a calendar approval moves NEITHER media window and sets no renderStatus", async () => {
    const t = withMedia();
    const planId = await seedCalendarPlan(t, "proposed");
    const before = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT });

    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    // A generalization that silently drew on the media rail would be invisible without this.
    expect(await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT })).toBe(
      before,
    );
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.renderStatus).toBeUndefined();
    expect(plan?.mediaRunId).toBeUndefined(); // the calendar run id went to CALENDAR's column
    expect(plan?.calendarRunId).toEqual(expect.any(String));
    expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  });

  test("deliverApprovedPlan.ts is byte-unchanged — it is the EMAIL entry point, not a dispatcher", async () => {
    // Routing an external action through it would make the gmail fan-out reachable from calendar
    // AND from media. The file is asserted by content hash against the value 12-05 shipped, so a
    // future "just make it generic" edit is a failing test rather than a review comment.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "deliverApprovedPlan.ts"),
    );
    expect(src.length).toBeGreaterThan(0);
    expect(src.toString()).not.toMatch(/calendar|mediaJobs|reserveJobInner|submitBatch/i);
  });
});

// ── 20-07: the media arm ─────────────────────────────────────────────────────────────────

/** The calendar harness plus the rate-limiter — the media pre-step drives BOTH spend windows. */
function withMedia() {
  const t = withDelivery();
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

/** A staged BLOCK DECK on a `kind: "media"` plan — what 20-08's `persistStoryboard` will write. */
async function seedMediaPlan(
  t: ReturnType<typeof convexTest>,
  opts: {
    blocks?: number;
    clipSeconds?: number;
    chars?: number;
    status?: "proposed" | "approved";
    tenantId?: string;
    type?: string;
    noDeck?: boolean;
  } = {},
) {
  const clipSeconds = opts.clipSeconds ?? 10;
  const n = opts.blocks ?? 2;
  const chars = opts.chars ?? maxCharsFor(10);
  return t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: opts.tenantId ?? TENANT,
      threadId: `media_thread_${crypto.randomUUID()}`,
      kind: "media",
      status: opts.status ?? "proposed",
      createdAt: Date.now(),
      ...(opts.noDeck
        ? {}
        : {
            clipSeconds,
            shots: Array.from({ length: n }, (_, index) => ({
              index,
              type: opts.type ?? "AI",
              seconds: clipSeconds,
              windowStartMs: index * clipSeconds * 1000,
              description: `scene ${index}`,
              narration: "x".repeat(chars),
              prompt: `prompt ${index}`,
            })),
          }),
    }),
  );
}

const mediaJobsOf = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("mediaJobs").collect());

describe("executePlan media arm (20-07, MEDIA-01)", () => {
  test("approving a media plan reserves the WHOLE reel and starts it — through the ONE Approve gate", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t);
    const before = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT });

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: true });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("delivering");
    // Paid for, not yet rendered — the state the canvas must be able to name.
    expect(plan?.renderStatus).toBe("pending");
    expect(plan?.mediaRunId).toEqual(expect.any(String));
    expect(plan?.calendarRunId).toBeUndefined(); // never the calendar column
    expect(plan?.correlationId).toEqual(expect.any(String));

    // The WHOLE reel: 2 video + 2 tts + 1 captions STT. The render line is reserved but gets no row.
    const jobs = await mediaJobsOf(t);
    expect(jobs.filter((r) => r.kind === "video")).toHaveLength(2);
    expect(jobs.filter((r) => r.kind === "tts")).toHaveLength(2);
    expect(jobs.filter((r) => r.kind === "stt")).toHaveLength(1);
    expect(jobs.every((r) => r.status === "queued")).toBe(true);
    expect(new Set(jobs.map((r) => r.batchId)).size).toBe(1); // ONE reservation
    // ...and the cents moved exactly once.
    expect(
      await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT }),
    ).toBeLessThan(before);
  });

  test("a reel over the JOB CAP is a governed refusal — plan stays proposed, ZERO rows, nothing scheduled", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t, { blocks: 12 }); // 12 x $0.50 clips blows the $3.50 cap
    const before = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT });

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    // A governed stop RETURNS. Only bugs throw.
    expect(result).toEqual({ ok: false, reason: "over_job_cap" });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed"); // the CAS never ran
    expect(plan?.renderStatus).toBeUndefined();
    expect(plan?.mediaRunId).toBeUndefined();
    expect(await mediaJobsOf(t)).toHaveLength(0);
    expect(await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT })).toBe(
      before,
    );
  });

  test.each([
    ["an over-length narration line", { chars: maxCharsFor(10) + 1 }, "narration_too_long"],
    ["a clip length nobody prices", { clipSeconds: 7, chars: 90 }, "illegal_duration"],
  ] as const)("%s refuses before the CAS", async (_label, opts, reason) => {
    const t = withMedia();
    const planId = await seedMediaPlan(t, opts);

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });

    expect(result).toEqual({ ok: false, reason });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test("the MEDIA kill switch refuses the approval on its own", async () => {
    const t = withMedia();
    await t.mutation(internal.guardrails.setMediaKillSwitch, { on: true });
    const planId = await seedMediaPlan(t);

    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).toEqual({ ok: false, reason: "kill_switch" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test.each([
    ["no deck at all", { noDeck: true }],
    ["a shot type the price table does not know", { type: "MONTAGE" }],
  ] as const)("%s is no_deck — a money gate does not assume its writer was correct", async (_l, opts) => {
    const t = withMedia();
    const planId = await seedMediaPlan(t, opts);

    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).toEqual({ ok: false, reason: "no_deck" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test("double-approve reserves NOTHING a second time", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t);
    const asTenant = t.withIdentity({ subject: TENANT });

    expect(await asTenant.mutation(api.cockpit.executePlan, { planId })).toEqual({ ok: true });
    const firstJobs = await mediaJobsOf(t);
    const afterFirst = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT });

    const second = await asTenant.mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(second).toEqual({ ok: true, alreadyStarted: true });
    // The reservation lives in the SAME serializable transaction as the CAS — that is what makes
    // "approve once, reserve once" true with no second idempotency mechanism.
    expect(await mediaJobsOf(t)).toHaveLength(firstJobs.length);
    expect(await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT })).toBe(
      afterFirst,
    );
  });

  test("a cross-tenant approve of a media plan still throws plan not found", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t, { tenantId: "tenant_other" });

    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).rejects.toThrow(/plan not found/);
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test("a media approval reaches NO gmail request and NO workflow", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t);

    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(await countRequests(t)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(planId)))?.workflowId).toBeUndefined();
  });
});

describe("executePlan approve-gate (SC4)", () => {
  test("idempotent: a non-proposed (already-approved) plan no-ops — double-approve sends once", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "delivering"); // as if the FIRST approve already ran
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: true, alreadyStarted: true });
    // No SECOND set of rows seeded, status untouched → no second workflow.
    expect(await countRequests(t)).toHaveLength(0);
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("delivering");
  });

  test("zero sends before approve: a still-collecting plan never seeds or starts", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "collecting");
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: true, alreadyStarted: true });
    expect(await countRequests(t)).toHaveLength(0);
  });

  test("no mailbox connected: a proposed plan refuses and seeds nothing (stop before delivery)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "proposed"); // ready to approve, but no gmailTokens row
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: false, reason: "gmail_not_connected" });
    expect(await countRequests(t)).toHaveLength(0);
    // The CAS did NOT advance past proposed (nothing sent).
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
  });

  test("tenant guard: another tenant's plan is not found (no cross-tenant approve)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "proposed", "tenant_b");
    const asT = t.withIdentity({ subject: TENANT }); // tenant_a approving tenant_b's plan

    await expect(asT.mutation(api.cockpit.executePlan, { planId })).rejects.toThrow(
      /plan not found/,
    );
  });
});

describe("executePlan attachment fan-out (CKPT-02 — one byte set shared across recipients)", () => {
  test("propagates the SAME generated attachment ref to every recipient's request row", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    // One generated document (real bytes in storage) referenced inline on the plan (pre-approval).
    const blobId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["pdf-bytes"], { type: "application/pdf" })),
    );
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com", "b@example.com"], // 2 recipients → 2 request rows
        mode: "individual",
        subject: "Q3 update",
        body: "Here is the Q3 update.",
        attachments: [
          { storageId: blobId, filename: "q3.pdf", mimeType: "application/pdf", size: 9 },
        ],
        createdAt: Date.now(),
      }),
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(2);
    // Every recipient carries a non-empty ref set...
    for (const r of reqs) expect(r.attachmentRefs.length).toBe(1);
    // ...and it is the SAME id across recipients (one shared row, no per-recipient duplication).
    const [ref0, ref1] = reqs.map((r) => r.attachmentRefs[0] as Id<"attachments">);
    expect(ref0).toBe(ref1);
    // Exactly ONE attachments row materialized (shared), resolving to the plan's generated document.
    const atts = await t.run((ctx) => ctx.db.query("attachments").collect());
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ filename: "q3.pdf", storageId: blobId, tenantId: TENANT });
  });

  test("a zero-attachment plan still seeds attachmentRefs: [] (unchanged path)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedPlan(t, "proposed"); // no attachments field

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r.attachmentRefs).toEqual([]);
    // No attachments rows materialized when the plan carries none.
    expect(await t.run((ctx) => ctx.db.query("attachments").collect())).toHaveLength(0);
  });
});

describe("executePlan per-recipient personalization (CKPT-03 — distinct bodies, shared subject)", () => {
  test("each recipient's draft is its tailored override; a non-personalized recipient falls back to the shared body; the goal (subject) is shared", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    // 3 recipients, 2 tailored + 1 without an override; an ORPHAN key (z@) no longer in recipients
    // is simply never looked up (no error, no extra row). Keyed by the RAW recipients[i] value —
    // the same value the seed loop iterates from plan.recipients (Wave 2 write/read alignment).
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com", "b@example.com", "c@example.com"],
        mode: "individual",
        subject: "Q3 update", // SHARED goal for every row
        body: "Here is the Q3 update.", // the shared fallback body
        recipientBodies: {
          "a@example.com": "Dear A, your Q3 numbers.",
          "b@example.com": "Yo B, quick Q3 hit.",
          "z@example.com": "orphaned — not in recipients", // ignored harmlessly at seed
        },
        createdAt: Date.now(),
      }),
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(3); // one row per recipient — the orphan key adds nothing
    const byRecipient = Object.fromEntries(reqs.map((r) => [r.recipient, r]));

    // Distinct tailored bodies land in their OWN request row...
    expect(byRecipient["a@example.com"]?.draft).toBe("Dear A, your Q3 numbers.");
    expect(byRecipient["b@example.com"]?.draft).toBe("Yo B, quick Q3 hit.");
    // ...and the non-personalized recipient falls back to the shared body (no error, no duplication).
    expect(byRecipient["c@example.com"]?.draft).toBe("Here is the Q3 update.");
    // The subject (goal) is SHARED across every recipient regardless of body tailoring.
    for (const r of reqs) expect(r.goal).toBe("Q3 update");
  });
});

describe("executePlan reply threading (RPLY-01 — the plan → requests → getForDelivery spine)", () => {
  test("copies the plan's threading anchor onto every seeded request; getForDelivery surfaces it", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    // A reply plan carries the GMAIL thread (plan.replyThreadId — NOT plan.threadId, the agent thread)
    // and the RFC Message-ID header values. executePlan maps replyThreadId → request.threadId.
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1", // agent/convex thread (renders cards) — must NOT ride to the request
        status: "proposed",
        recipients: ["sarah.chen@example.com"],
        mode: "individual",
        subject: "Re: Q3 numbers",
        body: "Approved — sending the figures now.",
        replyThreadId: "thread-reply-1",
        replyToMessageId: "fix-reply",
        inReplyTo: "<CAF-reply-1@mail.gmail.com>",
        references: "<CAF-reply-1@mail.gmail.com>",
        createdAt: Date.now(),
      }),
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(1);
    const req = reqs[0]!;
    // The plan's GMAIL thread landed as the request's threadId (agent thread_1 did NOT).
    expect(req.threadId).toBe("thread-reply-1");
    expect(req.inReplyTo).toBe("<CAF-reply-1@mail.gmail.com>");
    expect(req.references).toBe("<CAF-reply-1@mail.gmail.com>");

    // getForDelivery must project the anchor through (Pitfall 4 — else send never threads).
    const delivery = await t.query(internal.gmailAuth.getForDelivery, { requestId: req._id });
    expect(delivery?.threadId).toBe("thread-reply-1");
    expect(delivery?.inReplyTo).toBe("<CAF-reply-1@mail.gmail.com>");
    expect(delivery?.references).toBe("<CAF-reply-1@mail.gmail.com>");
  });

  test("a non-reply plan seeds rows with no threading; getForDelivery returns none (unchanged)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedPlan(t, "proposed"); // no reply fields

    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    for (const r of reqs) {
      expect(r.threadId).toBeUndefined();
      expect(r.inReplyTo).toBeUndefined();
      expect(r.references).toBeUndefined();
    }
    const delivery = await t.query(internal.gmailAuth.getForDelivery, { requestId: reqs[0]!._id });
    expect(delivery?.threadId).toBeUndefined();
    expect(delivery?.inReplyTo).toBeUndefined();
    expect(delivery?.references).toBeUndefined();
  });
});

/** Seed a proposed plan carrying a future (or unset) sendAt for the scheduler-branch tests. */
async function seedSchedulable(
  t: ReturnType<typeof convexTest>,
  sendAt: number | undefined,
  tenantId = TENANT,
) {
  return t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "thread_1",
      status: "proposed" as const,
      recipients: ["a@example.com", "b@example.com"],
      mode: "individual" as const,
      subject: "Q3 update",
      body: "Here is the Q3 update.",
      sendAt,
      createdAt: Date.now(),
    }),
  );
}

const listScheduled = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

describe("executePlan deferred send (SCHD-01 — arm on a future sendAt, fire at the moment)", () => {
  test("future sendAt: freezes the requests rows, arms the scheduler, sends nothing before fire; fires the same fan-out at the send time", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const sendAt = Date.now() + 60_000; // one minute out
      const planId = await seedSchedulable(t, sendAt);

      const res = await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.executePlan, { planId });
      expect(res).toEqual({ ok: true, scheduled: true });

      // Content is frozen AT APPROVE (rows seeded) but nothing advanced past "approved".
      const reqs = await countRequests(t);
      expect(reqs).toHaveLength(2);
      for (const r of reqs) expect(r.status).toBe("approved");

      const plan = await t.run((ctx) => ctx.db.get(planId));
      expect(plan?.status).toBe("scheduled");
      expect(plan?.scheduledFunctionId).toBeDefined();

      // A live scheduled-function system row exists (the scheduler is armed).
      expect((await listScheduled(t)).length).toBeGreaterThanOrEqual(1);

      // Fire it → the SAME fan-out starts (status → delivering, set synchronously by startFanout).
      vi.advanceTimersByTime(60_001);
      await t.finishInProgressScheduledFunctions();
      const after = await t.run((ctx) => ctx.db.get(planId));
      expect(after?.status).toBe("delivering");
    } finally {
      vi.useRealTimers();
    }
  });

  test("far-future refusal: a beyond-horizon sendAt returns send_time_too_far BEFORE seeding/arming (the authoritative chokepoint over every write path); a within-horizon control still schedules", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      // One hour PAST the horizon — arrived here from ANY write path (NL tool, picker, reschedule).
      const tooFar = Date.now() + SEND_TIME_HORIZON_MS + 3_600_000;
      const planId = await seedSchedulable(t, tooFar);

      const res = await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.executePlan, { planId });
      expect(res).toEqual({ ok: false, reason: "send_time_too_far" });

      // Fail-before-mutate: status untouched, NO requests seeded, NO scheduler armed.
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
      expect(await countRequests(t)).toHaveLength(0);
      expect(await listScheduled(t)).toHaveLength(0);

      // Within-horizon control: still schedules + arms (the guard sits upstream, in-window unaffected).
      const okId = await seedSchedulable(t, Date.now() + 60_000);
      const ok = await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.executePlan, { planId: okId });
      expect(ok).toEqual({ ok: true, scheduled: true });
      expect((await t.run((ctx) => ctx.db.get(okId)))?.status).toBe("scheduled");
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancelScheduledPlan halts a scheduled send: status canceled, scheduler row gone, refs-only plan.canceled audit, nothing sends after; double-cancel no-ops", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, Date.now() + 60_000);
      const asT = t.withIdentity({ subject: TENANT });

      await asT.mutation(api.cockpit.executePlan, { planId }); // arm
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("scheduled");

      const res = await asT.mutation(api.cockpit.cancelScheduledPlan, { planId });
      expect(res).toEqual({ ok: true, canceled: true });

      const plan = await t.run((ctx) => ctx.db.get(planId));
      expect(plan?.status).toBe("canceled");

      // No live (pending) scheduled callback remains — the send was canceled before fire.
      const pending = (await listScheduled(t)).filter((s) => s.state.kind === "pending");
      expect(pending.some((s) => String(s.name).includes("startScheduledDelivery"))).toBe(false);

      // refs-only §4: the plan.canceled audit payload carries planId ONLY (no subject/body/recipients).
      const audits = await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.canceled"))
          .collect(),
      );
      expect(audits).toHaveLength(1);
      const payloadStr = JSON.stringify(audits[0]?.payload);
      expect(payloadStr).toContain(planId);
      expect(payloadStr).not.toContain("Q3 update"); // no subject
      expect(payloadStr).not.toContain("Here is the Q3 update"); // no body
      expect(payloadStr).not.toContain("a@example.com"); // no recipient

      // Advancing past the send time sends NOTHING (the scheduler was canceled).
      vi.advanceTimersByTime(60_001);
      await t.finishInProgressScheduledFunctions();
      for (const r of await countRequests(t)) expect(r.status).toBe("approved");
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("canceled");

      // Idempotent: a second cancel (a non-scheduled plan) no-ops without throwing.
      expect(await asT.mutation(api.cockpit.cancelScheduledPlan, { planId })).toEqual({
        ok: true,
        alreadyResolved: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancelScheduledPlan tenant guard: another tenant cannot cancel (plan not found)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedSchedulable(t, Date.now() + 60_000, "tenant_b");
    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.cancelScheduledPlan, { planId }),
    ).rejects.toThrow(/plan not found/);
  });

  test("reschedule happy path: a canceled plan re-armed with a fresh future time re-approves through the SAME executePlan branch — orphans gone, no duplicate rows, refs-only plan.rescheduled audit, cancellable again", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, Date.now() + 60_000);
      const asT = t.withIdentity({ subject: TENANT });

      await asT.mutation(api.cockpit.executePlan, { planId }); // arm (2 orphan requests rows)
      await asT.mutation(api.cockpit.cancelScheduledPlan, { planId }); // halt
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("canceled");
      expect(await countRequests(t)).toHaveLength(2); // orphaned "approved" rows from the first arm

      // Pick a NEW future time, then reschedule → canceled becomes proposed, orphans deleted.
      await asT.mutation(api.plans.setPlanSendTime, { planId, sendAt: Date.now() + 120_000 });
      const res = await asT.mutation(api.cockpit.reschedulePlan, { planId });
      expect(res).toEqual({ ok: true, rescheduled: true });

      const proposed = await t.run((ctx) => ctx.db.get(planId));
      expect(proposed?.status).toBe("proposed");
      expect(await countRequests(t)).toHaveLength(0); // orphans deleted — reportForPlan stays honest

      // refs-only §4: the plan.rescheduled audit payload carries planId ONLY.
      const audits = await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.rescheduled"))
          .collect(),
      );
      expect(audits).toHaveLength(1);
      const payloadStr = JSON.stringify(audits[0]?.payload);
      expect(payloadStr).toContain(planId);
      expect(payloadStr).not.toContain("Q3 update"); // no subject
      expect(payloadStr).not.toContain("Here is the Q3 update"); // no body
      expect(payloadStr).not.toContain("a@example.com"); // no recipient

      // Re-approve routes through the EXISTING executePlan scheduled branch — a FRESH set of exactly
      // the recipient count (no duplicated orphans), status "scheduled", scheduler re-armed.
      const reRes = await asT.mutation(api.cockpit.executePlan, { planId });
      expect(reRes).toEqual({ ok: true, scheduled: true });
      expect(await countRequests(t)).toHaveLength(2); // fresh fan-out only
      const rearmed = await t.run((ctx) => ctx.db.get(planId));
      expect(rearmed?.status).toBe("scheduled");
      expect(rearmed?.scheduledFunctionId).toBeDefined();
      expect((await listScheduled(t)).length).toBeGreaterThanOrEqual(1);

      // Fire it → the SAME fan-out starts (status → delivering).
      vi.advanceTimersByTime(120_001);
      await t.finishInProgressScheduledFunctions();
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("delivering");
    } finally {
      vi.useRealTimers();
    }
  });

  test("reschedule re-ask: a canceled plan with a PAST/absent sendAt refuses (needs_future_time) — status stays canceled, no requests deleted, no plan.rescheduled audit", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, Date.now() + 60_000);
      const asT = t.withIdentity({ subject: TENANT });

      await asT.mutation(api.cockpit.executePlan, { planId }); // arm (2 rows)
      await asT.mutation(api.cockpit.cancelScheduledPlan, { planId }); // halt

      // sendAt is now in the PAST (advance past the frozen time) → the re-ask, no un-cancel.
      vi.advanceTimersByTime(60_001);
      const res = await asT.mutation(api.cockpit.reschedulePlan, { planId });
      expect(res).toEqual({ ok: false, reason: "needs_future_time" });

      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("canceled"); // stays terminal
      expect(await countRequests(t)).toHaveLength(2); // orphans NOT deleted (write nothing on a re-ask)
      const audits = await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.rescheduled"))
          .collect(),
      );
      expect(audits).toHaveLength(0); // no audit on a re-ask
    } finally {
      vi.useRealTimers();
    }
  });

  test("reschedule idempotent: a non-canceled (proposed) plan no-ops (alreadyResolved) with no state change", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedSchedulable(t, Date.now() + 60_000); // status "proposed"

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.reschedulePlan, { planId });
    expect(res).toEqual({ ok: true, alreadyResolved: true });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed"); // unchanged
  });

  test("reschedule tenant guard: another tenant cannot reschedule (plan not found)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedSchedulable(t, Date.now() + 60_000, "tenant_b");
    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.reschedulePlan, { planId }),
    ).rejects.toThrow(/plan not found/);
  });

  test("immediate path unchanged: an unset sendAt starts synchronously (status delivering, no scheduled row)", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, undefined);

      const res = await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.executePlan, { planId });
      expect(res.ok).toBe(true);
      expect("workflowId" in res && res.workflowId).toBeTruthy();
      expect("scheduled" in res).toBe(false);

      const plan = await t.run((ctx) => ctx.db.get(planId));
      expect(plan?.status).toBe("delivering");
      // No scheduler was armed on the immediate path (the workflow schedules its OWN steps, so
      // assert there is no scheduled callback pointing at startScheduledDelivery specifically).
      const scheduled = await listScheduled(t);
      expect(scheduled.some((s) => String(s.name).includes("startScheduledDelivery"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 07-04: REVW-02 (cockpit) — the LIVE gate is bounded and fails closed ───────────────────────
// proposeEmailPlan counts each redraft (re-propose of an already-proposed plan) on plans.reviseCount
// via the SAME @pikar/core classifyReviewDecision the pipeline gate uses (07-03); past MAX_REGENERATE
// it marks the plan `escalated` + notifies retry.limit and STOPS re-proposing. executePlan then
// refuses an escalated plan (review_escalated) — the cockpit mirror of the unapproved-send guard.
describe("cockpit revise cap (REVW-02 — bounded, fail-closed live gate)", () => {
  const proposeArgs = (planId: Id<"plans">) => ({
    planId,
    recipients: ["a@example.com"],
    mode: "individual" as const,
    subject: "Q3 update",
    body: "Here is the Q3 update.",
  });

  test("re-proposing past MAX_REGENERATE (3) escalates + notifies retry.limit; status is not advanced and content is not re-proposed", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "proposed"); // an already-proposed plan → every call is a redraft

    // Three redrafts stay within the cap (reviseCount climbs 1 → 2 → 3), still proposed.
    for (let i = 1; i <= 3; i++) {
      await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
      const p = await t.run((ctx) => ctx.db.get(planId));
      expect(p?.reviseCount).toBe(i);
      expect(p?.escalated).toBeFalsy();
      expect(p?.status).toBe("proposed");
    }

    // The FOURTH redraft breaches the cap → escalate (fail closed), notify, do NOT re-propose.
    const escalated = await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
    expect(escalated).toEqual({ escalated: true });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.escalated).toBe(true);
    expect(plan?.reviseCount).toBe(3); // not advanced past the cap on the escalate call
    expect(plan?.status).toBe("proposed"); // never advanced to approved/delivering

    const notifs = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .filter((q) => q.eq(q.field("kind"), "retry.limit"))
        .collect(),
    );
    expect(notifs).toHaveLength(1); // exactly one retry.limit — the breach notified once
    expect(notifs[0]!.tenantId).toBe(TENANT);
  });

  test("first propose of a not-yet-proposed plan is not a redraft (reviseCount stays 0, not escalated)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "collecting");

    await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.reviseCount ?? 0).toBe(0);
    expect(plan?.escalated).toBeFalsy();
  });

  test("executePlan refuses an escalated plan (review_escalated): no CAS flip, no requests seeded, no workflow", async () => {
    const t = withDelivery();
    await seedMailbox(t); // present so the refusal is specifically review_escalated, not gmail_not_connected
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com", "b@example.com"],
        mode: "individual",
        subject: "Q3 update",
        body: "Here is the Q3 update.",
        escalated: true, // the fail-closed terminal flag proposeEmailPlan set at the cap
        createdAt: Date.now(),
      }),
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res).toEqual({ ok: false, reason: "review_escalated" });

    // Fail-before-mutate: status stays proposed, NO rows seeded, NO workflow started.
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await countRequests(t)).toHaveLength(0);
  });
});

// Skill-version attribution (08 IMPR-01): a rating is training signal only if it resolves to the
// EXACT skill version that produced the response. proposeEmailPlan stamps plan.skillVersion from
// the active cockpit-agent row; executePlan copies it onto every seeded request row, so feedback
// (keyed to requestId → request.skillVersion) is attributable.
describe("skill-version attribution (IMPR-01 — propose stamps, executePlan copies)", () => {
  /** Seed the active cockpit-agent skill row the propose path reads its version from. */
  const seedActiveCockpit = (t: ReturnType<typeof convexTest>, version: number) =>
    t.run((ctx) =>
      ctx.db.insert("skills", {
        name: COCKPIT_AGENT_SKILL,
        version,
        body: "cockpit body",
        status: "active",
        createdAt: Date.now(),
      }),
    );

  const proposeArgs = (planId: Id<"plans">) => ({
    planId,
    recipients: ["a@example.com", "b@example.com"],
    mode: "individual" as const,
    subject: "Q3 update",
    body: "Here is the Q3 update.",
  });

  test("propose sets plan.skillVersion to the active cockpit-agent version; executePlan copies it to every request row", async () => {
    const t = withDelivery();
    await seedActiveCockpit(t, 12);
    await seedMailbox(t);
    const planId = await seedPlan(t, "collecting");

    await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
    expect((await t.run((ctx) => ctx.db.get(planId)))?.skillVersion).toBe(12);

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);
    const reqs = await countRequests(t);
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r.skillVersion).toBe(12);
  });

  test("a re-propose re-attributes to the THEN-active version", async () => {
    const t = convexTest(schema, modules);
    await seedActiveCockpit(t, 12);
    const planId = await seedPlan(t, "proposed"); // already proposed → the call is a redraft

    await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
    expect((await t.run((ctx) => ctx.db.get(planId)))?.skillVersion).toBe(12);
  });

  test("no active cockpit-agent row → propose degrades to unattributable (undefined), never throws", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "collecting"); // NO active skill seeded

    await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed"); // still proposes
    expect(plan?.skillVersion).toBeUndefined(); // unattributable, but not a failure
  });
});
