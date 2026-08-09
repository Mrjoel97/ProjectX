// V5 — the FIRST storage.getUrl in the codebase, served from tenant-guarded reads.
// A generated attachment's signed download URL is a bearer capability, so it is ONLY ever
// returned from a tenant-guarded query (attachmentUrls / reportForPlan) and NEVER logged (§4).
// convex-test carries a real storage plane, so store→getUrl round-trips here without a network.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";

/** Store a blob and return its _storage id (the send-time bytes an attachment ref points at). */
async function storeBlob(t: ReturnType<typeof convexTest>, body = "hello world") {
  return t.run(async (ctx) => ctx.storage.store(new Blob([body], { type: "text/plain" })));
}

describe("attachmentUrls (V5 — tenant-guarded signed download URLs)", () => {
  test("round-trip: a stored blob on a plan's attachments resolves to a non-null signed url", async () => {
    const t = convexTest(schema, modules);
    const storageId = await storeBlob(t);
    const planId = await t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com"],
        attachments: [{ storageId, filename: "report.pdf", mimeType: "application/pdf", size: 12 }],
        createdAt: Date.now(),
      }),
    );

    const urls = await t
      .withIdentity({ subject: TENANT })
      .query(api.plans.attachmentUrls, { planId });

    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatchObject({
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 12,
    });
    expect(urls[0]?.url).toBeTruthy(); // getUrl resolved — the store→getUrl round-trip works
  });

  test("tenant guard: another tenant's plan yields nothing (no cross-tenant signed URL)", async () => {
    const t = convexTest(schema, modules);
    const storageId = await storeBlob(t);
    const planId = await t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: "tenant_b",
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com"],
        attachments: [{ storageId, filename: "secret.pdf", mimeType: "application/pdf", size: 12 }],
        createdAt: Date.now(),
      }),
    );

    const urls = await t
      .withIdentity({ subject: TENANT }) // tenant_a reading tenant_b's plan
      .query(api.plans.attachmentUrls, { planId });

    expect(urls).toEqual([]);
  });

  test("a plan with no attachments returns an empty array", async () => {
    const t = convexTest(schema, modules);
    const planId = await t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "collecting",
        recipients: [],
        createdAt: Date.now(),
      }),
    );

    const urls = await t
      .withIdentity({ subject: TENANT })
      .query(api.plans.attachmentUrls, { planId });

    expect(urls).toEqual([]);
  });
});

describe("patchPlan recipientBodies (3.4 — per-recipient body override, content-plane only)", () => {
  /** Seed a collecting plan with two recipients; return its id. */
  async function seedPlan(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "collecting",
        recipients: ["bob@x.com", "amy@x.com"],
        body: "Shared body.",
        createdAt: Date.now(),
      }),
    );
  }

  test("patchPlan writes recipientBodies keyed by address; getById reads it back verbatim", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);

    await t.mutation(internal.plans.patchPlan, {
      planId,
      recipientBodies: { "bob@x.com": "Hi Bob, tailored for you." },
    });

    const plan = await t.query(internal.plans.getById, { planId });
    expect(plan?.recipientBodies).toEqual({ "bob@x.com": "Hi Bob, tailored for you." });
    expect(plan?.body).toBe("Shared body."); // shared body untouched
  });

  test("a subject-only patch leaves an existing recipientBodies map untouched (drop-undefined)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);

    await t.mutation(internal.plans.patchPlan, {
      planId,
      recipientBodies: { "bob@x.com": "Hi Bob." },
    });
    // A later patch that carries NO recipientBodies must not clobber the stored map.
    await t.mutation(internal.plans.patchPlan, { planId, subject: "New subject" });

    const plan = await t.query(internal.plans.getById, { planId });
    expect(plan?.subject).toBe("New subject");
    expect(plan?.recipientBodies).toEqual({ "bob@x.com": "Hi Bob." });
  });

  test("a second recipientBodies patch replaces the whole map wholesale", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);

    await t.mutation(internal.plans.patchPlan, {
      planId,
      recipientBodies: { "bob@x.com": "First." },
    });
    // Wave 2's tool passes the full merged map — a second write is a wholesale replace.
    await t.mutation(internal.plans.patchPlan, {
      planId,
      recipientBodies: { "bob@x.com": "First.", "amy@x.com": "Second." },
    });

    const plan = await t.query(internal.plans.getById, { planId });
    expect(plan?.recipientBodies).toEqual({ "bob@x.com": "First.", "amy@x.com": "Second." });
  });
});

describe("patchPlan sendAt + scheduled/canceled status (03.5 — deferred-send content plane)", () => {
  /** Seed an approved plan with two recipients + a shared body; return its id. */
  async function seedPlan(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "approved",
        recipients: ["bob@x.com", "amy@x.com"],
        subject: "Q3 sync",
        body: "Shared body.",
        createdAt: Date.now(),
      }),
    );
  }

  test("patchPlan writes sendAt (absolute epoch ms); getById reads it back verbatim", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);
    const sendAt = Date.UTC(2030, 0, 1, 14, 0, 0);

    await t.mutation(internal.plans.patchPlan, { planId, sendAt });

    const plan = await t.query(internal.plans.getById, { planId });
    expect(plan?.sendAt).toBe(sendAt);
  });

  test("a later subject-only patch preserves the stored sendAt (drop-undefined)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);
    const sendAt = Date.UTC(2030, 0, 1, 14, 0, 0);

    await t.mutation(internal.plans.patchPlan, { planId, sendAt });
    await t.mutation(internal.plans.patchPlan, { planId, subject: "New subject" });

    const plan = await t.query(internal.plans.getById, { planId });
    expect(plan?.subject).toBe("New subject");
    expect(plan?.sendAt).toBe(sendAt); // untouched by the partial patch
  });

  test("setPlanSendTime tenant-guards then writes sendAt; passing undefined clears it (→ immediate)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);
    const sendAt = Date.UTC(2030, 0, 1, 14, 0, 0);
    const asT = t.withIdentity({ subject: TENANT });

    await asT.mutation(api.plans.setPlanSendTime, { planId, sendAt });
    expect((await t.query(internal.plans.getById, { planId }))?.sendAt).toBe(sendAt);

    // Clearing the picker (undefined) removes the field → send immediately on Approve.
    await asT.mutation(api.plans.setPlanSendTime, { planId });
    expect((await t.query(internal.plans.getById, { planId }))?.sendAt).toBeUndefined();
  });

  test("setPlanSendTime tenant guard: another tenant cannot write the picker (plan not found)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t); // tenant_a
    await expect(
      t
        .withIdentity({ subject: "tenant_b" })
        .mutation(api.plans.setPlanSendTime, { planId, sendAt: 1 }),
    ).rejects.toThrow(/plan not found/);
  });

  test("setPlanStatus can move a plan approved → scheduled → canceled (the mirror carries both literals)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);

    await t.mutation(internal.plans.setPlanStatus, { planId, status: "scheduled" });
    let plan = await t.query(internal.plans.getById, { planId });
    expect(plan?.status).toBe("scheduled");

    await t.mutation(internal.plans.setPlanStatus, { planId, status: "canceled" });
    plan = await t.query(internal.plans.getById, { planId });
    expect(plan?.status).toBe("canceled");
  });
});

describe("recordDeliveryTerminal (Phase 26 — exact bounded plan progress)", () => {
  async function seedCounterPlan(
    t: ReturnType<typeof convexTest>,
    complete = true,
    recipients = ["a@example.com", "b@example.com"],
  ) {
    return t.run(async (ctx) => {
      const planId = await ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: `thread_progress_${crypto.randomUUID()}`,
        status: "delivering",
        recipients,
        recipientTotal: complete ? recipients.length : undefined,
        queuedCount: complete ? recipients.length : undefined,
        sentCount: complete ? 0 : undefined,
        failedCount: complete ? 0 : undefined,
        counterComplete: complete ? true : undefined,
        createdAt: Date.now(),
      });
      const requestIds = await Promise.all(
        recipients.map((recipient, index) =>
          ctx.db.insert("requests", {
            tenantId: TENANT,
            correlationId: `progress_${index}_${crypto.randomUUID()}`,
            goal: "Progress test",
            recipient,
            status: "delivering",
            attachmentRefs: [],
            planId,
            createdAt: Date.now(),
          }),
        ),
      );
      return { planId, requestIds };
    });
  }

  test("sent and failed terminals decrement queued and increment exactly once under replay", async () => {
    const t = convexTest(schema, modules);
    const { planId, requestIds } = await seedCounterPlan(t);
    const first = requestIds[0]!;
    const second = requestIds[1]!;

    expect(
      await t.mutation(internal.plans.recordDeliveryTerminal, {
        planId,
        requestId: first,
        outcome: "sent",
      }),
    ).toEqual({ applied: true });
    expect(
      await t.mutation(internal.plans.recordDeliveryTerminal, {
        planId,
        requestId: first,
        outcome: "sent",
      }),
    ).toEqual({ applied: false });
    expect(
      await t.mutation(internal.plans.recordDeliveryTerminal, {
        planId,
        requestId: first,
        outcome: "failed",
      }),
    ).toEqual({ applied: false });

    await t.mutation(internal.plans.recordDeliveryTerminal, {
      planId,
      requestId: second,
      outcome: "failed",
    });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan).toMatchObject({
      recipientTotal: 2,
      queuedCount: 0,
      sentCount: 1,
      failedCount: 1,
      counterComplete: true,
    });
    expect((plan?.sentCount ?? 0) + (plan?.failedCount ?? 0) + (plan?.queuedCount ?? 0)).toBe(
      plan?.recipientTotal,
    );
    expect((await t.run((ctx) => ctx.db.get(first)))?.status).toBe("sent");
    expect((await t.run((ctx) => ctx.db.get(second)))?.status).toBe("failed");
  });

  test("legacy plans transition request status but remain explicitly counter-partial", async () => {
    const t = convexTest(schema, modules);
    const { planId, requestIds } = await seedCounterPlan(t, false);
    const requestId = requestIds[0]!;

    expect(
      await t.mutation(internal.plans.recordDeliveryTerminal, {
        planId,
        requestId,
        outcome: "sent",
      }),
    ).toEqual({ applied: true });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.counterComplete).toBeUndefined();
    expect(plan?.recipientTotal).toBeUndefined();
    expect(plan?.queuedCount).toBeUndefined();
    expect(plan?.sentCount).toBeUndefined();
    expect(plan?.failedCount).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("sent");
  });

  test("foreign or mismatched request refs cannot move plan counters", async () => {
    const t = convexTest(schema, modules);
    const a = await seedCounterPlan(t);
    const b = await seedCounterPlan(t);

    await expect(
      t.mutation(internal.plans.recordDeliveryTerminal, {
        planId: a.planId,
        requestId: b.requestIds[0]!,
        outcome: "failed",
      }),
    ).rejects.toThrow(/delivery request not found/);

    expect(await t.run((ctx) => ctx.db.get(a.planId))).toMatchObject({
      queuedCount: 2,
      sentCount: 0,
      failedCount: 0,
    });
  });

  // 19-05 (Open Question 3, resolved). A suppression discovered at SEND time — created after the
  // approve-time filter had already run — is PERMANENT, unlike `awaiting_reauth`, which resumes on
  // reconnect. Left on the fan-out's bare `continue`, the row would sit at `delivering` forever and
  // `queuedCount` would never reach 0. Decrementing recipientTotal is the truthful statement: the
  // plan now has one fewer recipient, exactly the semantics of the executePlan filter (where a
  // suppressed address never entered the total at all).
  test("a suppressed terminal blocks the row, decrements recipientTotal, and the counters BALANCE", async () => {
    const t = convexTest(schema, modules);
    const { planId, requestIds } = await seedCounterPlan(t, true, [
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
    const [first, second, third] = requestIds as [Id<"requests">, Id<"requests">, Id<"requests">];

    expect(
      await t.mutation(internal.plans.recordDeliveryTerminal, {
        planId,
        requestId: third,
        outcome: "suppressed",
      }),
    ).toEqual({ applied: true });

    // `blocked` is an EXISTING requests.status member — no new state was invented for this.
    expect((await t.run((ctx) => ctx.db.get(third)))?.status).toBe("blocked");
    const afterDrop = await t.run((ctx) => ctx.db.get(planId));
    expect(afterDrop).toMatchObject({
      recipientTotal: 2,
      queuedCount: 2,
      sentCount: 0,
      failedCount: 0,
    });

    await t.mutation(internal.plans.recordDeliveryTerminal, {
      planId,
      requestId: first,
      outcome: "sent",
    });
    await t.mutation(internal.plans.recordDeliveryTerminal, {
      planId,
      requestId: second,
      outcome: "sent",
    });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    // The whole point: queued reaches ZERO and the three numbers still add up to the total.
    expect(plan).toMatchObject({ recipientTotal: 2, queuedCount: 0, sentCount: 2, failedCount: 0 });
    expect((plan?.sentCount ?? 0) + (plan?.failedCount ?? 0) + (plan?.queuedCount ?? 0)).toBe(
      plan?.recipientTotal,
    );
  });

  test("the suppressed terminal is idempotent — a replay applies once and moves no counter", async () => {
    const t = convexTest(schema, modules);
    const { planId, requestIds } = await seedCounterPlan(t);
    const requestId = requestIds[0]!;

    expect(
      await t.mutation(internal.plans.recordDeliveryTerminal, {
        planId,
        requestId,
        outcome: "suppressed",
      }),
    ).toEqual({ applied: true });
    // A workflow/action retry replaying the same terminal must not decrement the total twice.
    expect(
      await t.mutation(internal.plans.recordDeliveryTerminal, {
        planId,
        requestId,
        outcome: "suppressed",
      }),
    ).toEqual({ applied: false });
    // ...and a `blocked` row can never be re-terminated as sent or failed either.
    expect(
      await t.mutation(internal.plans.recordDeliveryTerminal, {
        planId,
        requestId,
        outcome: "sent",
      }),
    ).toEqual({ applied: false });

    expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({
      recipientTotal: 1,
      queuedCount: 1,
      sentCount: 0,
      failedCount: 0,
    });
  });
});

describe("patchPlan reply threading + resetPlan clears it (03.11 RPLY-01, Pitfall 6)", () => {
  /** Seed a collecting plan; return its id. */
  async function seedPlan(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "collecting",
        recipients: [],
        createdAt: Date.now(),
      }),
    );
  }

  const THREADING = {
    replyToMessageId: "fix-reply",
    replyThreadId: "thread-reply-1",
    inReplyTo: "<CAF-reply-1@mail.gmail.com>",
    references: "<CAF-reply-1@mail.gmail.com>",
  };

  test("patchPlan writes all four threading fields; getById reads them back verbatim", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);

    await t.mutation(internal.plans.patchPlan, { planId, ...THREADING });

    const plan = await t.query(internal.plans.getById, { planId });
    expect(plan).toMatchObject(THREADING);
  });

  test("resetPlan clears all four threading fields (no stale thread on the next fresh compose)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t);
    // A reply set the threading, then the user says "start over".
    await t.mutation(internal.plans.patchPlan, { planId, subject: "Re: Q3 numbers", ...THREADING });
    await t.mutation(internal.plans.resetPlan, { planId });

    const plan = await t.query(internal.plans.getById, { planId });
    // Every threading field is gone — a fresh compose can never silently thread into the old convo.
    expect(plan?.replyToMessageId).toBeUndefined();
    expect(plan?.replyThreadId).toBeUndefined();
    expect(plan?.inReplyTo).toBeUndefined();
    expect(plan?.references).toBeUndefined();
    expect(plan?.subject).toBeUndefined(); // and the reply subject too
  });
});

describe("resetPlan clears the media deck AND the render plane (20-02 MEDIA-01)", () => {
  const DECK_AND_RENDER = [
    "shots",
    "artDirection",
    "script",
    "clipSeconds",
    "renderStatus",
    "renderStorageId",
    "sidecarStorageId",
    "sidecarHash",
    "renderReason",
    "renderedAt",
  ] as const;

  test("a staged deck and a finished reel never survive a reset", async () => {
    const t = convexTest(schema, modules);
    const storageId = await storeBlob(t);
    const planId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_media",
        status: "collecting",
        recipients: [],
        createdAt: Date.now(),
      });
      // Direct patch ON PURPOSE: none of these are `patchPlan` args, and that absence is the
      // guarantee. Production writes them the same way — persistStoryboard (20-08), the canvas
      // editor (20-09) and the render terminal (20-16) all go straight to ctx.db.patch.
      await ctx.db.patch(id, {
        clipSeconds: 10,
        script: "A narration script for the whole reel.",
        artDirection: {
          palette: ["#0B0B0C"],
          mood: "assured",
          lighting: "warm golden light from camera left at 45 degrees",
          composition: "centered",
          environment: "a home office at dawn",
          texture: "film grain",
          references: ["Gregory Crewdson"],
          avoid: "stock-photo smiles",
        },
        shots: [
          {
            index: 0,
            type: "VIDEO",
            seconds: 10,
            windowStartMs: 0,
            description: "Founder at a desk",
            prompt: "Wide editorial shot, 35mm",
            narration: "Most teams lose an hour a day to inbox triage.",
          },
        ],
        renderStatus: "rendered",
        renderStorageId: storageId,
        sidecarStorageId: storageId,
        sidecarHash: "sha256:deadbeef",
        renderReason: "ok",
        renderedAt: Date.now(),
      });
      return id;
    });

    await t.mutation(internal.plans.resetPlan, { planId });

    const plan = await t.query(internal.plans.getById, { planId });
    // A deck surviving would re-stage onto the NEXT plan; a surviving renderStorageId would show
    // the previous thread's reel under a brand-new proposal — a lie the user can watch.
    for (const field of DECK_AND_RENDER) {
      expect(plan?.[field], `${field} survived resetPlan`).toBeUndefined();
    }
  });
});

describe("reportForPlan attachment extension (per-recipient delivered attachment url)", () => {
  test("each report row gains attachments derived from the request's attachmentRefs", async () => {
    const t = convexTest(schema, modules);
    const storageId = await storeBlob(t);
    const { planId } = await t.run(async (ctx) => {
      const planId = await ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "delivering",
        recipients: ["a@example.com", "b@example.com"],
        createdAt: Date.now(),
      });
      const attId = await ctx.db.insert("attachments", {
        tenantId: TENANT,
        storageId,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        size: 12,
      });
      // recipient WITH an attachment
      await ctx.db.insert("requests", {
        tenantId: TENANT,
        correlationId: "cid_a",
        goal: "g",
        recipient: "a@example.com",
        status: "sent",
        attachmentRefs: [attId],
        planId,
        createdAt: Date.now(),
      });
      // recipient WITHOUT an attachment → empty array (not missing)
      await ctx.db.insert("requests", {
        tenantId: TENANT,
        correlationId: "cid_b",
        goal: "g",
        recipient: "b@example.com",
        status: "sent",
        attachmentRefs: [],
        planId,
        createdAt: Date.now(),
      });
      return { planId };
    });

    const report = await t
      .withIdentity({ subject: TENANT })
      .query(api.plans.reportForPlan, { planId });

    const byRecipient = Object.fromEntries(report.map((r) => [r.recipient, r]));
    // Bound once each: under `noUncheckedIndexedAccess` a Record lookup is `T | undefined`, and
    // repeating the subscript per assertion repeated the error too. Same assertions, same
    // strictness — `!` here says "the report must contain this recipient", which is exactly what
    // the test is claiming anyway and what the toMatchObject below would fail on if it did not.
    const a = byRecipient["a@example.com"]!;
    const b = byRecipient["b@example.com"]!;
    // existing fields untouched
    expect(a).toMatchObject({ status: "sent", correlationId: "cid_a" });
    // new attachments field: filename + a resolved url
    expect(a.attachments).toHaveLength(1);
    expect(a.attachments[0]).toMatchObject({ filename: "invoice.pdf" });
    expect(a.attachments[0]!.url).toBeTruthy();
    // no-attachment recipient → empty array
    expect(b.attachments).toEqual([]);
  });
});

// ── patchPlan crm_write + resetPlan (19-06, ACTN-05 — VALIDATION row 4) ───────────────────────
//
// PITFALL 1, and the only kind of test that can catch it: `patchPlan`'s `kind` union is a
// HAND-MAINTAINED mirror of `schema.ts`'s. Widen the schema and not the mirror and every typecheck
// in the repo still passes — `Doc<"plans">` comes from the schema — while the RUNTIME arg validator
// rejects the new kind at the first real propose. Only a call through the real validator sees it.
describe("patchPlan accepts kind: crm_write (19-06 — the hand-maintained union mirror)", () => {
  const seed = (t: ReturnType<typeof convexTest>) =>
    t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: `thread_crm_${crypto.randomUUID()}`,
        status: "collecting" as const,
        recipients: [],
        createdAt: Date.now(),
      }),
    );

  test("the RUNTIME validator accepts the fourth kind and its operation list", async () => {
    const t = convexTest(schema, modules);
    const planId = await seed(t);

    await t.mutation(internal.plans.patchPlan, {
      planId,
      kind: "crm_write",
      status: "proposed",
      crmOperations: [{ op: "addContact", email: "bob@x.com", origin: "user-entered" }],
    });

    const row = await t.run((ctx) => ctx.db.get(planId));
    expect(row?.kind).toBe("crm_write");
    expect(row?.crmOperations).toHaveLength(1);
  });

  // Same Pitfall-6 class as the staged event and the media deck: a list surviving a reset would be
  // applied by the NEXT approve in this thread, writing contacts nobody just agreed to.
  test("resetPlan clears crmOperations AND the kind", async () => {
    const t = convexTest(schema, modules);
    const planId = await seed(t);
    await t.mutation(internal.plans.patchPlan, {
      planId,
      kind: "crm_write",
      crmOperations: [{ op: "addContact", email: "bob@x.com", origin: "user-entered" }],
    });

    await t.mutation(internal.plans.resetPlan, { planId });

    const row = await t.run((ctx) => ctx.db.get(planId));
    expect(row?.crmOperations).toBeUndefined();
    expect(row?.kind).toBeUndefined();
    expect(row?.status).toBe("collecting");
  });
});
