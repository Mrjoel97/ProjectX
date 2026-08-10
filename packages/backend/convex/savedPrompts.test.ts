// Pinned prompts — "routine v0" (21-05, SKILL-01).
//
// The thing under test is deliberately small: a saved prompt is INERT TENANT-OWNED TEXT. There is
// no schedule, cron, trigger, status machine or routines table, and this suite is as much a guard
// against one appearing as it is a test of save/list/remove.
//
// Every zero/absence assertion below sits beside a positive row witness. A "tenant B sees nothing"
// test passes just as well when the fixture never wrote anything at all, and this repo has already
// shipped a phase 22/22 green with the feature broken.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { contentHash } from "./lib/hash";
import {
  derivePromptTitle,
  normalizePromptText,
  SAVED_PROMPT_LIST_LIMIT,
  SAVED_PROMPT_MAX_BYTES,
  SAVED_PROMPT_TITLE_MAX,
} from "./savedPrompts";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "savedPrompts.ts"), "utf8");
// Comments stripped for the source contract below: the scans are about the SHIPPED CODE, not about
// prose. Without this, the module's own note explaining that it schedules nothing fails the
// no-scheduler scan, and the only way to green it would be to delete the explanation — which is how
// a guard gets silently weakened to accommodate itself (the skillAuthoring.test.ts precedent).
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// High-entropy needles: a prompt that leaks across a tenant boundary or into a log plane has to be
// findable by an exact string, not by eyeballing a payload.
const NEEDLE_A = "ZP5ALPHA9c4e2b71";
const NEEDLE_B = "ZP5BRAVO3d8f6a05";
const TEXT_A = `Draft the Monday pipeline nudge for every stalled deal. ${NEEDLE_A}`;
const TEXT_B = `Summarise last week's invoices and chase the unpaid ones. ${NEEDLE_B}`;

const harness = async () => {
  const t = convexTest(schema, modules);
  // REAL `users` rows (the 21-02 idiom): `requireScope` derives tenantId from the userId segment of
  // the subject, so a fabricated subject string is not evidence of an identity.
  const userA = await t.run((ctx) => ctx.db.insert("users", {}));
  const userB = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantA: String(userA),
    tenantB: String(userB),
    asA: t.withIdentity({ subject: `${userA}|session_a` }),
    asB: t.withIdentity({ subject: `${userB}|session_b` }),
  };
};

const allRows = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("savedPrompts").collect());

// `noUncheckedIndexedAccess` is on, and a `!` here would only be muting the compiler. This throws
// with a readable message instead, so a fixture that silently produced no row fails as a fixture
// bug rather than as a confusing `undefined` deref three assertions later.
function at<T>(rows: readonly T[], i: number): T {
  const row = rows[i];
  if (row === undefined)
    throw new Error(`fixture has no row at index ${i} (length ${rows.length})`);
  return row;
}

describe("savedPrompts.save — bounded, normalized, idempotent per tenant", () => {
  test("blank text is refused and writes nothing; an at-cap multibyte prompt is accepted", async () => {
    const { t, asA } = await harness();

    for (const blank of ["", "   ", "\n\n", "\r\n \r\n"]) {
      await expect(asA.mutation(api.savedPrompts.save, { text: blank })).rejects.toThrow(
        /SAVED_PROMPT_EMPTY/,
      );
    }
    expect(await allRows(t)).toHaveLength(0);

    // BYTES, not characters. A character cap lets one multibyte paste carry ~3x what the number
    // implies. The at-cap value is the POSITIVE WITNESS that makes the refusals above meaningful:
    // the boundary really is executed, and the fixture is not simply empty.
    const multibyte = "あ".repeat(Math.floor(SAVED_PROMPT_MAX_BYTES / 3));
    const atCap = multibyte + "x".repeat(SAVED_PROMPT_MAX_BYTES - multibyte.length * 3);
    expect(new TextEncoder().encode(atCap)).toHaveLength(SAVED_PROMPT_MAX_BYTES);
    expect(atCap.length).toBeLessThan(SAVED_PROMPT_MAX_BYTES); // fewer CHARS than bytes
    const ok = await asA.mutation(api.savedPrompts.save, { text: atCap });
    expect(ok.inserted).toBe(true);
    expect(await allRows(t)).toHaveLength(1);

    await expect(asA.mutation(api.savedPrompts.save, { text: `${atCap}あ` })).rejects.toThrow(
      /SAVED_PROMPT_TOO_LONG/,
    );
    expect(await allRows(t)).toHaveLength(1); // the refusal wrote nothing
  });

  test("the title is the bounded first NONBLANK line, and the text is stored whole", async () => {
    const { t, tenantA, asA } = await harness();
    const long = "R".repeat(400);
    await asA.mutation(api.savedPrompts.save, {
      text: `\n\n   ${long}\nsecond line survives in the text\n`,
    });
    const row = at(await allRows(t), 0);
    expect(row.tenantId).toBe(tenantA);
    expect(row.title.length).toBeLessThanOrEqual(SAVED_PROMPT_TITLE_MAX);
    expect(row.title.startsWith("RRRR")).toBe(true);
    expect(row.title).not.toContain("second line");
    // The TEXT is not truncated — only the label is. A truncated prompt would replay a different
    // instruction than the one the user pinned.
    expect(row.text).toContain("second line survives in the text");
    expect(row.text).toBe(
      normalizePromptText(`\n\n   ${long}\nsecond line survives in the text\n`),
    );
  });

  test("the same prompt saves ONCE within a tenant and TWICE across two tenants", async () => {
    const { t, tenantA, tenantB, asA, asB } = await harness();

    const first = await asA.mutation(api.savedPrompts.save, { text: TEXT_A });
    expect(first.inserted).toBe(true);
    // Re-pinned with CRLF and outer whitespace: the dedupe compares the NORMALIZED text, so this
    // is the same prompt, not a near-duplicate that quietly fills the list.
    const again = await asA.mutation(api.savedPrompts.save, { text: `  ${TEXT_A}\r\n  ` });
    expect(again.inserted).toBe(false);
    expect(again.id).toBe(first.id);

    // Tenant B pinning the identical string gets its OWN row — dedupe is per tenant, not global.
    const bSame = await asB.mutation(api.savedPrompts.save, { text: TEXT_A });
    expect(bSame.inserted).toBe(true);
    expect(bSame.id).not.toBe(first.id);

    const rows = await allRows(t);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.tenantId === tenantA)).toHaveLength(1);
    expect(rows.filter((r) => r.tenantId === tenantB)).toHaveLength(1);

    // …and neither tenant's list can see the other's row, even though the TEXT is byte-identical.
    await asB.mutation(api.savedPrompts.save, { text: TEXT_B });
    const listA = await asA.query(api.savedPrompts.list, {});
    const listB = await asB.query(api.savedPrompts.list, {});
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(2);
    // Positive witness beside the absence: A sees its own needle, and B's second prompt is B's.
    expect(JSON.stringify(listA)).toContain(NEEDLE_A);
    expect(JSON.stringify(listA)).not.toContain(NEEDLE_B);
    expect(JSON.stringify(listB)).toContain(NEEDLE_B);
  });
});

describe("savedPrompts.list — newest first, hard-capped, tenant-scoped", () => {
  test("25 saved prompts return the NEWEST 20, in descending order", async () => {
    const { t, tenantA, tenantB, asA } = await harness();
    // Planted directly with explicit distinct `createdAt` values: `list` is the unit under test
    // here, and two `save` calls inside the same millisecond would make "newest first" depend on
    // an index tiebreaker rather than on the ordering this query asks for.
    await t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert("savedPrompts", {
          tenantId: tenantA,
          text: `prompt number ${i}`,
          title: `prompt number ${i}`,
          textHash: `hash-${i}`,
          createdAt: 1_000 + i,
        });
      }
      // A foreign row with the NEWEST timestamp of all — if the cap were reached by an unscoped
      // read, this is the row that would appear first.
      await ctx.db.insert("savedPrompts", {
        tenantId: tenantB,
        text: `foreign ${NEEDLE_B}`,
        title: "foreign",
        textHash: "hash-foreign",
        createdAt: 9_999,
      });
    });

    const rows = await asA.query(api.savedPrompts.list, {});
    expect(rows).toHaveLength(SAVED_PROMPT_LIST_LIMIT);
    expect(at(rows, 0).title).toBe("prompt number 24"); // newest first
    expect(at(rows, rows.length - 1).title).toBe("prompt number 5"); // the oldest 5 fell off
    expect(rows.map((r) => r.createdAt)).toEqual(
      [...rows.map((r) => r.createdAt)].sort((a, b) => b - a),
    );
    expect(JSON.stringify(rows)).not.toContain(NEEDLE_B);
  });

  test("list projects an id, a title, the text and a timestamp — and nothing else", async () => {
    const { asA } = await harness();
    await asA.mutation(api.savedPrompts.save, { text: TEXT_A });
    const row = at(await asA.query(api.savedPrompts.list, {}), 0);
    // Pinned by equality: a future widening of this projection has to be a deliberate edit here.
    // `tenantId` in particular must not travel to a browser that already knows who it is.
    expect(Object.keys(row).sort()).toEqual(["createdAt", "id", "text", "title"]);
    expect(row.text).toContain(NEEDLE_A);
  });
});

describe("savedPrompts.remove — exact-row ownership, and nothing else is touched", () => {
  test("a foreign id and a missing id return the SAME not-found result and mutate nothing", async () => {
    const { t, asA, asB } = await harness();
    const a = await asA.mutation(api.savedPrompts.save, { text: TEXT_A });
    const b = await asB.mutation(api.savedPrompts.save, { text: TEXT_B });

    // B points at A's exact row id. This is the mutation-11 target: delete the tenant comparison
    // and this line starts returning `{removed: true}` and A's positively-witnessed pin vanishes.
    const foreign = await asB.mutation(api.savedPrompts.remove, { id: a.id });
    expect(foreign).toEqual({ removed: false });
    expect(await allRows(t)).toHaveLength(2);
    expect(JSON.stringify(await asA.query(api.savedPrompts.list, {}))).toContain(NEEDLE_A);

    // The owner really can delete it (the positive witness that `removed: false` above is a
    // REFUSAL and not simply a broken delete).
    expect(await asA.mutation(api.savedPrompts.remove, { id: a.id })).toEqual({ removed: true });
    expect(await asA.query(api.savedPrompts.list, {})).toHaveLength(0);
    expect(await asB.query(api.savedPrompts.list, {})).toHaveLength(1);

    // NON-ORACLE: a now-missing id is indistinguishable from a foreign one. A caller must not be
    // able to probe "does this id exist in some other tenant?" from the shape of the answer.
    const missing = await asB.mutation(api.savedPrompts.remove, { id: a.id });
    expect(missing).toEqual(foreign);
    expect(await allRows(t)).toHaveLength(1);
    expect(b.inserted).toBe(true);
  });

  test("deleting a pin deletes the pin — not the chat, its plan, or the tenant's other pins", async () => {
    const { t, tenantA, asA } = await harness();
    const doomed = await asA.mutation(api.savedPrompts.save, { text: TEXT_A });
    const keeper = await asA.mutation(api.savedPrompts.save, { text: TEXT_B });
    // The thread-side row a "delete" could plausibly take with it if the pin were ever modelled as
    // owning a conversation. It is not: a pin is text, and it has no threadId to begin with.
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: tenantA,
        threadId: "thread-that-must-survive",
        status: "proposed",
        subject: "an existing conversation",
        createdAt: 1,
      }),
    );

    expect(await asA.mutation(api.savedPrompts.remove, { id: doomed.id })).toEqual({
      removed: true,
    });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.threadId).toBe("thread-that-must-survive");
    expect(plan?.status).toBe("proposed");
    const left = await asA.query(api.savedPrompts.list, {});
    expect(left).toHaveLength(1);
    expect(at(left, 0).id).toBe(keeper.id);
  });
});

describe("savedPrompts — the log planes never see a prompt", () => {
  test("save and remove write NO audit/dead-letter/telemetry row, and no needle reaches one", async () => {
    const { t, tenantA, asA } = await harness();
    const saved = await asA.mutation(api.savedPrompts.save, { text: TEXT_A });
    const row = at(await allRows(t), 0);

    const logPlanes = async () =>
      t.run(async (ctx) => ({
        audit: await ctx.db.query("audit").collect(),
        deadLetters: await ctx.db.query("deadLetters").collect(),
        telemetry: await ctx.db.query("telemetry").collect(),
      }));

    // The CONTENT plane did receive the prompt. Everything below is only meaningful because of
    // this line — a needle scan over a fixture that never stored the needle proves nothing.
    expect(row.text).toContain(NEEDLE_A);

    await asA.mutation(api.savedPrompts.remove, { id: saved.id });

    // A refs-only CONTROL row, planted by this test rather than by the code under test. It proves
    // the needle scan below actually reads the audit plane — an empty-table scan "passes" for the
    // trivial reason that there is nothing to read, which is exactly the vacuity this repo keeps
    // shipping. It is also the shape §4 permits: a hash and an id, never the text.
    await t.run((ctx) =>
      ctx.db.insert("audit", {
        tenantId: tenantA,
        correlationId: "savedprompts-privacy-control",
        eventType: "test.control",
        actor: "test",
        payload: { savedPromptRef: String(saved.id), textHash: row.textHash },
        ts: 0,
      }),
    );

    // THE NEEDLE SCAN IS THE PRIMARY GUARD and it is asserted FIRST, deliberately. The row counts
    // below are a stronger but narrower fact, and if they were checked first they would short
    // -circuit this assertion — the ledger's named mutation (add the prompt text to an audit
    // payload) must turn THIS line red, not a count on the line above it.
    const after = await logPlanes();
    const serialized = JSON.stringify(after);
    expect(serialized).toContain(row.textHash); // the scan read something
    expect(serialized).not.toContain(NEEDLE_A); // …and the prompt was not in it

    // …and beyond "no content", save/remove emit no log-plane row of ANY kind: exactly the one
    // control row this test planted, and nothing else.
    expect(after.audit).toHaveLength(1);
    expect(at(after.audit, 0).eventType).toBe("test.control");
    expect(after.deadLetters).toHaveLength(0);
    expect(after.telemetry).toHaveLength(0);
  });
});

describe("savedPrompts — pure helpers and the source contract", () => {
  test("normalizePromptText folds CRLF and trims only the OUTSIDE", () => {
    expect(normalizePromptText("  a\r\nb  ")).toBe("a\nb");
    expect(normalizePromptText("a\rb")).toBe("a\nb");
    expect(normalizePromptText("   ")).toBe("");
    // Interior blank lines are part of the prompt the user wrote — folding them would replay a
    // different instruction.
    expect(normalizePromptText("a\n\n\nb")).toBe("a\n\n\nb");
  });

  test("derivePromptTitle takes the first nonblank line and never exceeds the cap", () => {
    expect(derivePromptTitle("\n\n  hello there \nignored")).toBe("hello there");
    const long = derivePromptTitle("Z".repeat(500));
    expect(long).toHaveLength(SAVED_PROMPT_TITLE_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(derivePromptTitle("")).toBe("");
  });

  test("the textHash is a content hash of the NORMALIZED text", async () => {
    const { t, asA } = await harness();
    await asA.mutation(api.savedPrompts.save, { text: `\r\n  ${TEXT_A}  ` });
    const row = at(await allRows(t), 0);
    expect(row.textHash).toBe(await contentHash(TEXT_A));
    // A hash is a fingerprint, never the content (contracts/audit.ts).
    expect(row.textHash).not.toContain(NEEDLE_A);
  });

  // The behavioural bound test above passes just as well with `.collect()` followed by a slice —
  // it returns 20 either way. Only this scan fires. Do not delete it as redundant; that is the
  // 21-02 lesson written down.
  test("the list read is a bounded indexed take, never a history .collect()", () => {
    expect(code).toContain("by_tenant_createdAt");
    expect(code).toContain('.order("desc")');
    expect(code).toContain(`.take(SAVED_PROMPT_LIST_LIMIT)`);
    expect(code).not.toContain(".collect()");
  });

  test("the module is an ADAPTER: tenant wrappers only, one delete, no automation substrate", () => {
    expect(code).toContain("tenantMutation");
    expect(code).toContain("tenantQuery");
    // CLAUDE.md §2 — the raw builders are banned outside lib/functions.ts.
    expect(code).not.toContain("_generated/server");
    // ONE delete, and it is the pin's own row. A second one would mean this module started
    // owning something else's lifetime.
    expect(code.split("ctx.db.delete").length - 1).toBe(1);
    for (const forbidden of [
      "ctx.scheduler",
      "ctx.runMutation",
      "ctx.runAction",
      "cronJobs",
      "cron",
      "schedule",
      "recurrence",
      "nextRunAt",
      "trigger",
      "routines",
      'db.query("plans")',
      'db.query("agentSteps")',
      "audit.log",
      "deadLetters",
    ]) {
      expect(code, `savedPrompts.ts references ${forbidden}`).not.toContain(forbidden);
    }
    // Positive witnesses on the same file: the three functions that DO exist, and the fact that
    // the id the browser hands back is validated as a real `savedPrompts` id — a stray string is
    // refused by the arg validator before the handler runs.
    expect(code).toContain("export const save");
    expect(code).toContain("export const list");
    expect(code).toContain("export const remove");
    expect(code).toContain('id: v.id("savedPrompts")');
  });
});
