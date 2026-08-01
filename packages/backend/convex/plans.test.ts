// V5 — the FIRST storage.getUrl in the codebase, served from tenant-guarded reads.
// A generated attachment's signed download URL is a bearer capability, so it is ONLY ever
// returned from a tenant-guarded query (attachmentUrls / reportForPlan) and NEVER logged (§4).
// convex-test carries a real storage plane, so store→getUrl round-trips here without a network.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
    expect(urls[0]).toMatchObject({ filename: "report.pdf", mimeType: "application/pdf", size: 12 });
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
      t.withIdentity({ subject: "tenant_b" }).mutation(api.plans.setPlanSendTime, { planId, sendAt: 1 }),
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
