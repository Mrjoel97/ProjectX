import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { cockpitAgentSkillBody } from "@pikar/contracts/skills/cockpitAgent";
import { documentDrafterSkillBody } from "@pikar/contracts/skills/documentDrafter";
import { emailDrafterSkillBody } from "@pikar/contracts/skills/emailDrafter";
import { executiveAgentClassifierSkillBody } from "@pikar/contracts/skills/executiveAgentClassifier";
import { executiveRouterSkillBody } from "@pikar/contracts/skills/executiveRouter";
import { internal } from "./_generated/api";
import schema from "./schema";
import { loadSkill } from "./skills";

// Register every convex module so internal.* function references resolve.
// `import.meta.glob` is a Vite feature; its type is not in the Convex tsconfig
// lib (shared gap across all convex/*.test.ts files), so ignore the type here.
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob("./**/*.*s");

const SKILL_NAME = "executive-agent.classifier";

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
    await expect(
      t.run((ctx) => loadSkill(ctx, "nonexistent")),
    ).rejects.toThrow();
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

  test("seedSkills publishes a NEW version when the active body has drifted from the constant", async () => {
    const t = convexTest(schema, modules);
    // Simulate an older prompt already seeded before an edit.
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

    // The edited constant is published as v2/active; the stale v1 is archived, never mutated.
    const active = await t.run((ctx) => loadSkill(ctx, "cockpit-agent"));
    expect(active.version).toBe(2);
    expect(active.body).toBe(lf(cockpitAgentSkillBody));
    const v1 = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) => q.eq("name", "cockpit-agent").eq("version", 1))
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
        .withIndex("by_name_status", (q) =>
          q.eq("name", SKILL_NAME).eq("status", "active"),
        )
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
        .withIndex("by_name_version", (q) =>
          q.eq("name", SKILL_NAME).eq("version", 1),
        )
        .unique(),
    );
    expect(v1Row).not.toBeNull();
    expect(v1Row!.body).toBe(v1Before.body);
    expect(v1Row!.status).not.toBe("active");
  });
});

describe("no hardcoded agent prompts in convex/", () => {
  test.each([
    ["executive-agent.classifier.md", executiveAgentClassifierSkillBody],
    ["executive-router.md", executiveRouterSkillBody],
    ["email-drafter.md", emailDrafterSkillBody],
    ["cockpit-agent.md", cockpitAgentSkillBody],
    ["document-drafter.md", documentDrafterSkillBody],
  ])("%s seed constant equals its canonical markdown (no drift)", (file, body) => {
    const mdPath = fileURLToPath(
      new URL(`../../contracts/skills/${file}`, import.meta.url),
    );
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
