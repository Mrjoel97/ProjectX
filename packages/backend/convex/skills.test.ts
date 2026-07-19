import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { attachmentExtractorSkillBody } from "@pikar/contracts/skills/attachmentExtractor";
import { cockpitAgentSkillBody } from "@pikar/contracts/skills/cockpitAgent";
import { documentDrafterSkillBody } from "@pikar/contracts/skills/documentDrafter";
import { emailDrafterSkillBody } from "@pikar/contracts/skills/emailDrafter";
import { executiveAgentClassifierSkillBody } from "@pikar/contracts/skills/executiveAgentClassifier";
import { executiveRouterSkillBody } from "@pikar/contracts/skills/executiveRouter";
import { graphExtractorSkillBody } from "@pikar/contracts/skills/graphExtractor";
import { inboxDigestSkillBody } from "@pikar/contracts/skills/inboxDigest";
import { replyDrafterSkillBody } from "@pikar/contracts/skills/replyDrafter";
import { voiceBriefSkillBody } from "@pikar/contracts/skills/voiceBrief";
import { voiceSessionSkillBody } from "@pikar/contracts/skills/voiceSession";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { loadSkill } from "./skills";

// Register every convex module so internal.* function references resolve.
// `import.meta.glob` is a Vite feature; its type is not in the Convex tsconfig
// lib (shared gap across all convex/*.test.ts files), so ignore the type here.
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob("./**/*.*s");

// A seeded, NON-gated skill for the generic loader/activation cases.
const SKILL_NAME = "executive-router";
const CLASSIFIER = "executive-agent.classifier";

// Normalize line endings so a CRLF checkout of the .md never drifts from the
// LF-authored .ts constant (and vice versa).
const lf = (s: string) => s.replace(/\r\n/g, "\n");

describe("skills registry loader + activation", () => {
  test("seedSkills then loadSkill returns the active v1 body", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});

    const loaded = await t.run((ctx) => loadSkill(ctx, SKILL_NAME));
    expect(loaded.version).toBe(1);
    expect(loaded.body.length).toBeGreaterThan(0);
    expect(typeof loaded.skillId).toBe("string");
    expect(loaded.skillId.length).toBeGreaterThan(0);
  });

  test("seedSkills seeds cockpit-agent as an active v1 body", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});

    const loaded = await t.run((ctx) => loadSkill(ctx, "cockpit-agent"));
    expect(loaded.version).toBe(1);
    expect(loaded.body.length).toBeGreaterThan(0);
  });

  test("loadSkill fails closed (throws) when no active skill exists", async () => {
    const t = convexTest(schema, modules);
    await expect(t.run((ctx) => loadSkill(ctx, "nonexistent"))).rejects.toThrow();
  });

  test("seedSkills is idempotent (run twice inserts one v1 row)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});
    await t.mutation(internal.skills.seedSkills, {});

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", SKILL_NAME))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.status).toBe("active");
  });

  test("seedSkills publishes-and-activates a NEW version when a NON-gated active body has drifted", async () => {
    const t = convexTest(schema, modules);
    // Simulate an older prompt already seeded before an edit.
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: "email-drafter",
        version: 1,
        body: "OLD STALE BODY",
        status: "active",
        createdAt: 0,
      }),
    );

    await t.mutation(internal.skills.seedSkills, {});

    // The edited constant is published as v2/active; the stale v1 is archived, never mutated.
    const active = await t.run((ctx) => loadSkill(ctx, "email-drafter"));
    expect(active.version).toBe(2);
    expect(active.body).toBe(lf(emailDrafterSkillBody));
    const v1 = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) => q.eq("name", "email-drafter").eq("version", 1))
        .unique(),
    );
    expect(v1!.status).toBe("archived");
    expect(v1!.body).toBe("OLD STALE BODY"); // immutable-per-version: prior row never rewritten
  });

  test("activateSkill flips atomically; prior version body stays immutable", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});

    // Capture the immutable v1 body before activating v2.
    const v1Before = await t.run((ctx) => loadSkill(ctx, SKILL_NAME));

    // Insert a v2 candidate (a "change" = new row, never a patch of v1).
    await t.run(async (ctx) => {
      await ctx.db.insert("skills", {
        name: SKILL_NAME,
        version: 2,
        body: "v2 candidate body",
        status: "candidate",
        createdAt: Date.now(),
      });
    });

    await t.mutation(internal.skills.activateSkill, {
      name: SKILL_NAME,
      version: 2,
    });

    // Exactly one active row, and it is v2.
    const active = await t.run(async (ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", SKILL_NAME).eq("status", "active"))
        .collect(),
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe(2);

    // The loader now returns v2.
    const loaded = await t.run((ctx) => loadSkill(ctx, SKILL_NAME));
    expect(loaded.version).toBe(2);

    // v1 row still exists, still holds its original body (immutability).
    const v1Row = await t.run(async (ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) => q.eq("name", SKILL_NAME).eq("version", 1))
        .unique(),
    );
    expect(v1Row).not.toBeNull();
    expect(v1Row!.body).toBe(v1Before.body);
    expect(v1Row!.status).not.toBe("active");
  });
});

describe("eval gate on activateSkill (EVAL-01)", () => {
  type SkillStatus = "active" | "candidate" | "rolled_back" | "archived";

  const insertSkill = (
    t: ReturnType<typeof convexTest>,
    fields: { name: string; version: number; body: string; status: SkillStatus; evidence?: string },
  ) => t.run((ctx) => ctx.db.insert("skills", { createdAt: 0, ...fields }));

  const passingEvidence = (name: string, version: number, overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      runner: "eval:golden",
      runId: "r1",
      pass: true,
      casesPassed: 15,
      casesTotal: 15,
      retriedCases: [],
      costUsd: 0.08,
      model: "openai/gpt-4o-mini",
      skillVersions: { [name]: version },
      ts: Date.now(),
      ...overrides,
    });

  const statusOf = (t: ReturnType<typeof convexTest>, name: string, version: number) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
        .unique();
      return row!.status;
    });

  test("gated candidate with NO evidence is refused (EVAL_GATE) and the active row stays active", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insertSkill(t, { name: "cockpit-agent", version: 2, body: "v2", status: "candidate" });

    await expect(
      t.mutation(internal.skills.activateSkill, { name: "cockpit-agent", version: 2 }),
    ).rejects.toThrow(/EVAL_GATE/);

    expect(await statusOf(t, "cockpit-agent", 1)).toBe("active");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("candidate");
  });

  test("gated candidate with passing evidence pinning the exact version activates (v1 archived, v2 active)", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insertSkill(t, {
      name: "cockpit-agent",
      version: 2,
      body: "v2",
      status: "candidate",
      evidence: passingEvidence("cockpit-agent", 2),
    });

    await t.mutation(internal.skills.activateSkill, { name: "cockpit-agent", version: 2 });

    expect(await statusOf(t, "cockpit-agent", 1)).toBe("archived");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("active");
  });

  test("gated candidate with pass:false evidence is refused", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insertSkill(t, {
      name: "cockpit-agent",
      version: 2,
      body: "v2",
      status: "candidate",
      evidence: passingEvidence("cockpit-agent", 2, { pass: false }),
    });

    await expect(
      t.mutation(internal.skills.activateSkill, { name: "cockpit-agent", version: 2 }),
    ).rejects.toThrow(/EVAL_GATE/);
  });

  test("gated candidate with evidence pinning a DIFFERENT version is refused (stale evidence)", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insertSkill(t, {
      name: "cockpit-agent",
      version: 2,
      body: "v2",
      status: "candidate",
      evidence: passingEvidence("cockpit-agent", 1), // pins v1, not v2
    });

    await expect(
      t.mutation(internal.skills.activateSkill, { name: "cockpit-agent", version: 2 }),
    ).rejects.toThrow(/EVAL_GATE/);
  });

  test("gated candidate with unparseable evidence is refused (fail closed)", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insertSkill(t, {
      name: "cockpit-agent",
      version: 2,
      body: "v2",
      status: "candidate",
      evidence: "not json {{",
    });

    await expect(
      t.mutation(internal.skills.activateSkill, { name: "cockpit-agent", version: 2 }),
    ).rejects.toThrow(/EVAL_GATE/);
  });

  test("rollback exemption: an archived target activates with NO evidence (by status alone)", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 1, body: "v1", status: "archived" });
    await insertSkill(t, { name: "cockpit-agent", version: 2, body: "v2", status: "active" });

    await t.mutation(internal.skills.activateSkill, { name: "cockpit-agent", version: 1 });

    expect(await statusOf(t, "cockpit-agent", 1)).toBe("active");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("archived");
  });

  test("rollback exemption: a rolled_back target activates with NO evidence", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 1, body: "v1", status: "rolled_back" });
    await insertSkill(t, { name: "cockpit-agent", version: 2, body: "v2", status: "active" });

    await t.mutation(internal.skills.activateSkill, { name: "cockpit-agent", version: 1 });

    expect(await statusOf(t, "cockpit-agent", 1)).toBe("active");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("archived");
  });

  test("non-gated skill candidate activates without any gate", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "email-drafter", version: 1, body: "v1", status: "active" });
    await insertSkill(t, { name: "email-drafter", version: 2, body: "v2", status: "candidate" });

    await t.mutation(internal.skills.activateSkill, { name: "email-drafter", version: 2 });

    expect(await statusOf(t, "email-drafter", 1)).toBe("archived");
    expect(await statusOf(t, "email-drafter", 2)).toBe("active");
  });

  test("recordEvalEvidence patches ONLY evidence on the pinned row; throws NO_SUCH_SKILL_VERSION when missing", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 2, body: "v2", status: "candidate" });

    const evidence = passingEvidence("cockpit-agent", 2);
    await t.mutation(internal.skills.recordEvalEvidence, {
      name: "cockpit-agent",
      version: 2,
      evidence,
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) => q.eq("name", "cockpit-agent").eq("version", 2))
        .unique(),
    );
    expect(row!.evidence).toBe(evidence);
    expect(row!.body).toBe("v2"); // nothing else patched
    expect(row!.status).toBe("candidate");

    await expect(
      t.mutation(internal.skills.recordEvalEvidence, {
        name: "cockpit-agent",
        version: 99,
        evidence,
      }),
    ).rejects.toThrow(/NO_SUCH_SKILL_VERSION/);
  });

  test("getSkillVersion returns {body, version, skillId} regardless of status; throws NO_SUCH_SKILL_VERSION when missing", async () => {
    const t = convexTest(schema, modules);
    await insertSkill(t, { name: "cockpit-agent", version: 1, body: "archived body", status: "archived" });
    await insertSkill(t, { name: "cockpit-agent", version: 2, body: "candidate body", status: "candidate" });

    const v1 = await t.query(internal.skills.getSkillVersion, { name: "cockpit-agent", version: 1 });
    expect(v1.body).toBe("archived body");
    expect(v1.version).toBe(1);
    expect(typeof v1.skillId).toBe("string");

    const v2 = await t.query(internal.skills.getSkillVersion, { name: "cockpit-agent", version: 2 });
    expect(v2.body).toBe("candidate body");

    await expect(
      t.query(internal.skills.getSkillVersion, { name: "cockpit-agent", version: 99 }),
    ).rejects.toThrow(/NO_SUCH_SKILL_VERSION/);
  });
});

describe("seedSkills gated candidate-publish + classifier archival (EVAL-01)", () => {
  const cockpitRows = (t: ReturnType<typeof convexTest>, name: string) =>
    t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name))
        .collect(),
    );

  test("a changed GATED body publishes as a CANDIDATE; the active row STAYS active", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: "cockpit-agent",
        version: 1,
        body: "OLD STALE BODY",
        status: "active",
        createdAt: 0,
      }),
    );

    await t.mutation(internal.skills.seedSkills, {});

    // The old row is untouched and still what the loader serves (Pitfall 1: the
    // gate would be decorative if seedSkills auto-activated gated edits).
    const active = await t.run((ctx) => loadSkill(ctx, "cockpit-agent"));
    expect(active.version).toBe(1);
    expect(active.body).toBe("OLD STALE BODY");

    const v2 = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) => q.eq("name", "cockpit-agent").eq("version", 2))
        .unique(),
    );
    expect(v2!.status).toBe("candidate");
    expect(v2!.body).toBe(lf(cockpitAgentSkillBody));
  });

  test("gated candidate-publish is idempotent: two seeds after ONE edit mint ONE candidate", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: "cockpit-agent",
        version: 1,
        body: "OLD STALE BODY",
        status: "active",
        createdAt: 0,
      }),
    );

    await t.mutation(internal.skills.seedSkills, {});
    await t.mutation(internal.skills.seedSkills, {});

    const rows = await cockpitRows(t, "cockpit-agent");
    expect(rows).toHaveLength(2); // v1 active + exactly ONE v2 candidate — never v3
    expect(rows.filter((r) => r.status === "candidate")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  test("bootstrap unchanged: a never-seeded gated skill seeds as v1 ACTIVE", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});

    const loaded = await t.run((ctx) => loadSkill(ctx, "document-drafter"));
    expect(loaded.version).toBe(1);
    expect(loaded.body.length).toBeGreaterThan(0);
  });

  test("seedSkills no longer seeds executive-agent.classifier", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});

    expect(await cockpitRows(t, CLASSIFIER)).toHaveLength(0);
  });

  test("archiveSkill flips the active row to archived; a re-seed does NOT resurrect it", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: CLASSIFIER,
        version: 1,
        body: "classifier body",
        status: "active",
        createdAt: 0,
      }),
    );

    await t.mutation(internal.skills.archiveSkill, { name: CLASSIFIER });

    let rows = await cockpitRows(t, CLASSIFIER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("archived");

    await t.mutation(internal.skills.seedSkills, {});

    rows = await cockpitRows(t, CLASSIFIER);
    expect(rows).toHaveLength(1); // no new row (SC4 — the seeds entry is gone)
    expect(rows.find((r) => r.status === "active")).toBeUndefined();
  });

  test("archiveSkill is a no-op when no active row exists", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(internal.skills.archiveSkill, { name: CLASSIFIER });
    expect(result).toEqual({ archived: false });
  });
});

describe("no hardcoded agent prompts in convex/", () => {
  test.each([
    ["executive-agent.classifier.md", executiveAgentClassifierSkillBody],
    ["executive-router.md", executiveRouterSkillBody],
    ["email-drafter.md", emailDrafterSkillBody],
    ["cockpit-agent.md", cockpitAgentSkillBody],
    ["document-drafter.md", documentDrafterSkillBody],
    ["attachment-extractor.md", attachmentExtractorSkillBody],
    ["graph-extractor.md", graphExtractorSkillBody],
    ["inbox-digest.md", inboxDigestSkillBody],
    ["reply-drafter.md", replyDrafterSkillBody],
    ["voice-session.md", voiceSessionSkillBody],
    ["voice-brief.md", voiceBriefSkillBody],
  ])("%s seed constant equals its canonical markdown (no drift)", (file, body) => {
    const mdPath = fileURLToPath(new URL(`../../contracts/skills/${file}`, import.meta.url));
    expect(lf(body)).toBe(lf(readFileSync(mdPath, "utf8")));
  });

  test("no long inline prompt string literals live in convex/ source", () => {
    const convexDir = fileURLToPath(new URL(".", import.meta.url));
    const MAX_INLINE_STRING = 200;

    const sourceFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "_generated" || entry === "node_modules") continue;
        const full = `${dir}/${entry}`;
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts")) continue;
        if (entry.endsWith(".test.ts")) continue;
        sourceFiles.push(full);
      }
    };
    walk(convexDir);

    // Match double-quoted, single-quoted, and backtick string literals.
    // ponytail: a JS/TS '…'/"…" literal cannot span a raw newline, so bar newlines
    // from those two branches — otherwise an apostrophe in a comment ("the user's
    // goal") is read as a multi-line string and false-flags the file. Only the
    // backtick branch spans lines (that IS how a real hardcoded prompt would look).
    const stringLiteral = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(stringLiteral)) {
        const inner = match[0].slice(1, -1);
        if (inner.length > MAX_INLINE_STRING) {
          offenders.push(`${file}: ${inner.length}-char inline string`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
