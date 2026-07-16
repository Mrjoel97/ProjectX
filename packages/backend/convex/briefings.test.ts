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

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";
const OTHER = "tenant_b";
const THREAD = "thread_1";
const NOW = 1_800_000_000_000;

type T = ReturnType<typeof convexTest>;

/** Insert one briefing row through the real internal writer (never a raw db.insert). */
function seed(t: T, over: { tenantId?: string; threadId?: string; createdAt?: number; gist?: string } = {}) {
  return t.mutation(internal.briefings.insert, {
    tenantId: over.tenantId ?? TENANT,
    threadId: over.threadId ?? THREAD,
    range: "today",
    tz: "UTC",
    items: [
      {
        bucket: "today" as const,
        sender: "Sarah <sarah@example.com>",
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
    const row = await t.withIdentity({ subject: TENANT }).query(api.briefings.byThread, { threadId: THREAD });
    expect(row).not.toBeNull();
    expect(row?.items[0]?.gist).toBe("asks for the Q3 numbers");
    expect(row?.listedCount).toBe(1);
  });

  test("another tenant reading the same threadId gets null (no cross-tenant mailbox leak)", async () => {
    const t = convexTest(schema, modules);
    await seed(t); // owned by TENANT
    const row = await t.withIdentity({ subject: OTHER }).query(api.briefings.byThread, { threadId: THREAD });
    expect(row, "tenant_b read tenant_a's briefing").toBeNull();
  });

  test("re-briefing the same thread returns the LATEST row, not the first", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { createdAt: NOW, gist: "the older briefing" });
    await seed(t, { createdAt: NOW + 60_000, gist: "the newer briefing" });
    const row = await t.withIdentity({ subject: TENANT }).query(api.briefings.byThread, { threadId: THREAD });
    expect(row?.items[0]?.gist).toBe("the newer briefing");
    expect(row?.createdAt).toBe(NOW + 60_000);
  });

  test("a thread with no briefing returns null (the card renders nothing)", async () => {
    const t = convexTest(schema, modules);
    const row = await t.withIdentity({ subject: TENANT }).query(api.briefings.byThread, { threadId: "empty" });
    expect(row).toBeNull();
  });
});
