// The briefing content plane (03.7-02): tenant isolation + latest-row semantics.
//
// `briefings` is the read-only counterpart of `plans` — rows hold the gists/senders the
// BRIEFING card renders (content plane, CLAUDE.md §4: this raw content lives HERE and never
// in an audit/DLQ payload). The card subscribes through the tenantQuery, so the isolation
// guard below is the thing standing between two tenants' mailboxes.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";
const OTHER = "tenant_b";
const THREAD = "thread_1";
const NOW = 1_800_000_000_000;

type T = ReturnType<typeof convexTest>;

/** Insert one briefing row through the real internal writer (never a raw db.insert). */
function seed(
  t: T,
  over: { tenantId?: string; threadId?: string; createdAt?: number; gist?: string } = {},
) {
  return t.mutation(internal.briefings.insert, {
    tenantId: over.tenantId ?? TENANT,
    threadId: over.threadId ?? THREAD,
    range: "today",
    tz: "UTC",
    items: [
      {
        id: "gmail_msg_1",
        bucket: "today" as const,
        sender: "Sarah <sarah@example.com>",
        subject: "Q3 numbers",
        ts: NOW,
        gist: over.gist ?? "asks for the Q3 numbers",
        category: "request",
        needsReply: true,
      },
    ],
    listedCount: 1,
    createdAt: over.createdAt ?? NOW,
  });
}

describe("briefings.byThread (content-plane read)", () => {
  test("the owning tenant reads back the briefing it inserted", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const row = await t
      .withIdentity({ subject: TENANT })
      .query(api.briefings.byThread, { threadId: THREAD });
    expect(row).not.toBeNull();
    expect(row?.items[0]?.gist).toBe("asks for the Q3 numbers");
    expect(row?.listedCount).toBe(1);
  });

  test("another tenant reading the same threadId gets null (no cross-tenant mailbox leak)", async () => {
    const t = convexTest(schema, modules);
    await seed(t); // owned by TENANT
    const row = await t
      .withIdentity({ subject: OTHER })
      .query(api.briefings.byThread, { threadId: THREAD });
    expect(row, "tenant_b read tenant_a's briefing").toBeNull();
  });

  test("re-briefing the same thread returns the LATEST row, not the first", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { createdAt: NOW, gist: "the older briefing" });
    await seed(t, { createdAt: NOW + 60_000, gist: "the newer briefing" });
    const row = await t
      .withIdentity({ subject: TENANT })
      .query(api.briefings.byThread, { threadId: THREAD });
    expect(row?.items[0]?.gist).toBe("the newer briefing");
    expect(row?.createdAt).toBe(NOW + 60_000);
  });

  test("a thread with no briefing returns null (the card renders nothing)", async () => {
    const t = convexTest(schema, modules);
    const row = await t
      .withIdentity({ subject: TENANT })
      .query(api.briefings.byThread, { threadId: "empty" });
    expect(row).toBeNull();
  });
});

/** One briefing carrying `count` items — the projection cap is about ITEMS, not rows. */
function seedWithItems(t: T, count: number, createdAt: number) {
  return t.mutation(internal.briefings.insert, {
    tenantId: TENANT,
    threadId: THREAD,
    range: "today",
    tz: "UTC",
    items: Array.from({ length: count }, (_, i) => ({
      id: `gmail_msg_${i}`,
      bucket: "today" as const,
      sender: `sender${i} <s${i}@example.com>`,
      subject: `Subject ${i}`,
      ts: NOW + i,
      gist: "MODEL PROSE that must not reach the command centre",
      category: "request",
      needsReply: i === 0,
      deadline: "by Friday",
    })),
    listedCount: count + 3,
    synopsis: "the cross-message lede",
    createdAt,
  });
}

describe("briefings.latestForTenant (the Command Center's bounded projection)", () => {
  test("returns the NEWEST briefing across threads, by written createdAt", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { threadId: "thread_old", createdAt: NOW + 60_000, gist: "the newer briefing" });
    // Inserted LAST but back-dated: `_creationTime` order would pick this one, `createdAt` must not.
    await seed(t, { threadId: "thread_new", createdAt: NOW, gist: "the older briefing" });

    const row = await t.withIdentity({ subject: TENANT }).query(api.briefings.latestForTenant, {});
    expect(row?.createdAt).toBe(NOW + 60_000);
    expect(row?.itemCount).toBe(1);
    expect(row?.items[0]?.subject).toBe("Q3 numbers");
    // The window the card puts in its heading. Two adjacent strings from the same row: read in
    // the wrong order the card labels a timezone as the date range, and nothing else notices.
    expect(row?.range).toBe("today");
    expect(row?.tz).toBe("UTC");
  });

  test("a tenant with no briefing at all gets null — not an empty object, not a throw", async () => {
    const t = convexTest(schema, modules);
    await seed(t); // owned by TENANT
    await expect(t.query(api.briefings.latestForTenant, {})).rejects.toThrow(/UNAUTHENTICATED/);
    const row = await t.withIdentity({ subject: OTHER }).query(api.briefings.latestForTenant, {});
    expect(row).toBeNull();
  });

  test("the projection is capped at five items and says so, and carries no model prose", async () => {
    const t = convexTest(schema, modules);
    await seedWithItems(t, 7, NOW);
    const row = await t.withIdentity({ subject: TENANT }).query(api.briefings.latestForTenant, {});

    expect(row?.items).toHaveLength(5);
    expect(row?.itemCount).toBe(7);
    expect(row?.capped).toBe(true);
    expect(row?.listedCount).toBe(10);
    expect(row?.items[0]?.id).toBe("gmail_msg_0");
    expect(row?.items[0]?.needsReply).toBe(true);
    // Code-owned Gmail facts only. `gist`/`category`/`deadline` are MODEL-owned and stay behind.
    expect(Object.keys(row?.items[0] ?? {}).sort()).toEqual([
      "bucket",
      "id",
      "needsReply",
      "sender",
      "subject",
      "ts",
    ]);
    const wire = JSON.stringify(row);
    expect(wire).not.toContain("MODEL PROSE");
    expect(wire).not.toContain("by Friday");
    expect(wire).not.toContain("gmail_msg_5");
    expect(row).not.toHaveProperty("tenantId");
  });

  test("a briefing at or under the cap is not marked capped, and the synopsis crosses as-is", async () => {
    const t = convexTest(schema, modules);
    await seedWithItems(t, 5, NOW);
    const row = await t.withIdentity({ subject: TENANT }).query(api.briefings.latestForTenant, {});
    expect(row?.items).toHaveLength(5);
    expect(row?.capped).toBe(false);
    expect(row?.synopsis).toBe("the cross-message lede");
    // ...and it crosses MARKED. Every other field here is a Gmail/DB fact; this one is the
    // model's sentence, and the wire says so, so a renderer cannot show it as the owner's own.
    expect(row?.synopsisOrigin).toBe("model");
  });

  test("a briefing written without a synopsis reports null, never an empty string", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const row = await t.withIdentity({ subject: TENANT }).query(api.briefings.latestForTenant, {});
    expect(row?.synopsis).toBeNull();
    // The marker describes the FIELD, not the value: an absent lede is still the model's slot.
    expect(row?.synopsisOrigin).toBe("model");
    expect(row?.capped).toBe(false);
  });
});
