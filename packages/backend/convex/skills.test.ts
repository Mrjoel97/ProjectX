import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COCKPIT_AGENT_SKILL,
  CONTENT_DRAFTER_SKILL,
  composeUserSkillBody,
  type EvalEvidenceTenantTarget,
  hasPassingEvidence,
  hasPassingTenantEvidence,
  isGatedSkill,
  LEAD_ENGINE_SKILL,
  OFFER_ARCHITECT_SKILL,
  USER_AUTHORABLE_SKILL_METADATA,
  USER_SKILL_ADAPTATION_MAX_BYTES,
  USER_SKILL_ADAPTATION_SECTION,
} from "@pikar/contracts/skill";
import { attachmentExtractorSkillBody } from "@pikar/contracts/skills/attachmentExtractor";
import { businessProfileSkillBody } from "@pikar/contracts/skills/businessProfile";
import { cockpitAgentSkillBody } from "@pikar/contracts/skills/cockpitAgent";
import { contentDrafterSkillBody } from "@pikar/contracts/skills/contentDrafter";
import { documentDrafterSkillBody } from "@pikar/contracts/skills/documentDrafter";
import { emailDrafterSkillBody } from "@pikar/contracts/skills/emailDrafter";
import { executiveAgentClassifierSkillBody } from "@pikar/contracts/skills/executiveAgentClassifier";
import { executiveRouterSkillBody } from "@pikar/contracts/skills/executiveRouter";
import { graphExtractorSkillBody } from "@pikar/contracts/skills/graphExtractor";
import { inboxDigestSkillBody } from "@pikar/contracts/skills/inboxDigest";
import { replyDrafterSkillBody } from "@pikar/contracts/skills/replyDrafter";
import { voiceBriefSkillBody } from "@pikar/contracts/skills/voiceBrief";
import { voiceSessionSkillBody } from "@pikar/contracts/skills/voiceSession";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
// 21-02: `publishUserCandidate` writes ONE refs-only audit row, and `audit.log` mirrors every
// insert into the auditCounts aggregate (OPSG-01). Register the component (relative import — the
// package blocks the deep specifier) so the REAL audit path runs instead of throwing
// "component not registered". The dispatch.test.ts / contacts.test.ts idiom, verbatim.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { contentHash } from "./lib/hash";
import schema from "./schema";
import { loadSkill } from "./skills";

// Register every convex module so internal.* function references resolve.
// `import.meta.glob` is a Vite feature; its type is not in the Convex tsconfig
// lib (shared gap across all convex/*.test.ts files), so ignore the type here.
const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

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

  // Phase 18 (ACTN-04). The whole reason short-form got its OWN row rather than an edit to the
  // GATED `document-drafter`: a brand-new name hits seedSkills' `rows.length === 0` branch and
  // lands at v1 ACTIVE with no eval cycle and no paid run.
  test("seedSkills seeds content-drafter as an active v1 body (ungated, no eval cycle)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});

    const loaded = await t.run((ctx) => loadSkill(ctx, CONTENT_DRAFTER_SKILL));
    expect(loaded.version).toBe(1);
    expect(loaded.body).toBe(lf(contentDrafterSkillBody));
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
    t: TestConvex<typeof schema>,
    fields: { name: string; version: number; body: string; status: SkillStatus; evidence?: string },
  ) => t.run((ctx) => ctx.db.insert("skills", { createdAt: 0, ...fields }));

  const passingEvidence = (
    name: string,
    version: number,
    overrides: Record<string, unknown> = {},
  ) =>
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

  const statusOf = (t: TestConvex<typeof schema>, name: string, version: number) =>
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
    await insertSkill(t, {
      name: "cockpit-agent",
      version: 1,
      body: "archived body",
      status: "archived",
    });
    await insertSkill(t, {
      name: "cockpit-agent",
      version: 2,
      body: "candidate body",
      status: "candidate",
    });

    const v1 = await t.query(internal.skills.getSkillVersion, {
      name: "cockpit-agent",
      version: 1,
    });
    expect(v1.body).toBe("archived body");
    expect(v1.version).toBe(1);
    expect(typeof v1.skillId).toBe("string");

    const v2 = await t.query(internal.skills.getSkillVersion, {
      name: "cockpit-agent",
      version: 2,
    });
    expect(v2.body).toBe("candidate body");

    await expect(
      t.query(internal.skills.getSkillVersion, { name: "cockpit-agent", version: 99 }),
    ).rejects.toThrow(/NO_SUCH_SKILL_VERSION/);
  });
});

describe("seedSkills gated candidate-publish + classifier archival (EVAL-01)", () => {
  const cockpitRows = (t: TestConvex<typeof schema>, name: string) =>
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

describe("insertCandidate — SkillOpt write-back seam (IMPR-02/03)", () => {
  const insert = (
    t: TestConvex<typeof schema>,
    fields: {
      name: string;
      version: number;
      body: string;
      status: "active" | "candidate" | "archived";
    },
  ) => t.run((ctx) => ctx.db.insert("skills", { createdAt: 0, ...fields }));

  const rowsOf = (t: TestConvex<typeof schema>, name: string) =>
    t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name))
        .collect(),
    );

  test("an external body → a NEW candidate (maxVer+1); the active row stays active + immutable", async () => {
    const t = convexTest(schema, modules);
    // A gated skill live at v11 (a couple of archived priors to prove maxVer+1, not active+1).
    await insert(t, { name: "cockpit-agent", version: 10, body: "v10", status: "archived" });
    await insert(t, { name: "cockpit-agent", version: 11, body: "v11 ACTIVE", status: "active" });

    const res = await t.mutation(internal.skills.insertCandidate, {
      name: "cockpit-agent",
      body: "OPTIMIZED BODY",
    });

    // Returns the before/after the audit records.
    expect(res).toEqual({ name: "cockpit-agent", fromVersion: 11, toVersion: 12, inserted: true });

    const rows = await rowsOf(t, "cockpit-agent");
    const v12 = rows.find((r) => r.version === 12)!;
    expect(v12.status).toBe("candidate"); // NEVER active — activation is the owner's separate click
    expect(v12.body).toBe("OPTIMIZED BODY");
    // The active row is untouched (immutable, still active — the loader still serves v11).
    const active = await t.run((ctx) => loadSkill(ctx, "cockpit-agent"));
    expect(active.version).toBe(11);
    expect(active.body).toBe("v11 ACTIVE");
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  test("a NON-gated skill name is rejected (only eval-gated skills route through the gate)", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "email-drafter", version: 1, body: "v1", status: "active" });

    await expect(
      t.mutation(internal.skills.insertCandidate, { name: "email-drafter", body: "NEW" }),
    ).rejects.toThrow(/NOT_GATED/);

    // Nothing inserted — the registry is unchanged.
    expect(await rowsOf(t, "email-drafter")).toHaveLength(1);
  });

  test("a byte-identical NEWEST body is idempotent — inserts nothing, returns the existing version", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 11, body: "v11 ACTIVE", status: "active" });
    await insert(t, {
      name: "cockpit-agent",
      version: 12,
      body: "CANDIDATE BODY",
      status: "candidate",
    });

    const res = await t.mutation(internal.skills.insertCandidate, {
      name: "cockpit-agent",
      body: "CANDIDATE BODY", // identical to the newest row
    });

    expect(res).toEqual({ name: "cockpit-agent", fromVersion: 11, toVersion: 12, inserted: false });
    // No churn: still exactly the two rows, no v13 minted.
    expect(await rowsOf(t, "cockpit-agent")).toHaveLength(2);
  });
});

describe("activateCandidate + candidatesForReview — ops panel (IMPR-02/03)", () => {
  // GOVN-01: authority is the `users.owner` boolean, so these fixtures insert REAL user rows.
  // A fabricated subject string is no longer evidence of anything.
  const identities = async (t: TestConvex<typeof schema>) => {
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const plainId = await t.run((ctx) => ctx.db.insert("users", {}));
    return {
      asOwner: t.withIdentity({ subject: `${ownerId}|session_a` }),
      asNonOwner: t.withIdentity({ subject: `${plainId}|session_a` }),
    };
  };
  const insert = (
    t: TestConvex<typeof schema>,
    fields: { name: string; version: number; body: string; status: SkillStatus; evidence?: string },
  ) => t.run((ctx) => ctx.db.insert("skills", { createdAt: 0, ...fields }));

  type SkillStatus = "active" | "candidate" | "rolled_back" | "archived";

  const passing = (name: string, version: number) =>
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
      ts: 0,
    });

  const statusOf = (t: TestConvex<typeof schema>, name: string, version: number) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
        .unique();
      return row!.status;
    });

  test("activateCandidate routes through the SHARED EVAL_GATE — an unevaluated gated candidate is refused", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insert(t, { name: "cockpit-agent", version: 2, body: "v2", status: "candidate" });
    const { asOwner } = await identities(t);

    await expect(
      asOwner.mutation(api.skills.activateCandidate, { name: "cockpit-agent", version: 2 }),
    ).rejects.toThrow(/EVAL_GATE/);
    // The gate held — the active row is untouched.
    expect(await statusOf(t, "cockpit-agent", 1)).toBe("active");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("candidate");
  });

  test("activateCandidate flips a candidate with passing evidence (v1 archived, v2 active)", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insert(t, {
      name: "cockpit-agent",
      version: 2,
      body: "v2",
      status: "candidate",
      evidence: passing("cockpit-agent", 2),
    });
    const { asOwner } = await identities(t);

    const res = await asOwner.mutation(api.skills.activateCandidate, {
      name: "cockpit-agent",
      version: 2,
    });
    expect(res).toEqual({ ok: true, name: "cockpit-agent", version: 2 });
    expect(await statusOf(t, "cockpit-agent", 1)).toBe("archived");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("active");
  });

  test("activateCandidate requires an authenticated identity (owner gate)", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await expect(
      t.mutation(api.skills.activateCandidate, { name: "cockpit-agent", version: 1 }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("candidatesForReview lists newest candidate per gated skill with before/after + gate status", async () => {
    const t = convexTest(schema, modules);
    // cockpit-agent: active v11 + a passing candidate v12.
    await insert(t, { name: "cockpit-agent", version: 11, body: "OLD BODY", status: "active" });
    await insert(t, {
      name: "cockpit-agent",
      version: 12,
      body: "NEW BODY",
      status: "candidate",
      evidence: passing("cockpit-agent", 12),
    });
    // document-drafter: active v1 + an UNEVALUATED candidate v2 (gate will refuse).
    await insert(t, { name: "document-drafter", version: 1, body: "d1", status: "active" });
    await insert(t, { name: "document-drafter", version: 2, body: "d2", status: "candidate" });
    // inbox-digest: only an active row → NOT listed (no candidate awaiting review).
    await insert(t, { name: "inbox-digest", version: 1, body: "i1", status: "active" });
    const { asOwner } = await identities(t);

    const list = await asOwner.query(api.skills.candidatesForReview, {});
    const cockpit = list.find((c) => c.name === "cockpit-agent")!;
    expect(cockpit).toMatchObject({
      fromVersion: 11,
      fromBody: "OLD BODY",
      toVersion: 12,
      toBody: "NEW BODY",
      gatePassed: true,
    });
    const doc = list.find((c) => c.name === "document-drafter")!;
    expect(doc).toMatchObject({ fromVersion: 1, toVersion: 2, gatePassed: false });
    // Only skills WITH a candidate appear — inbox-digest (active-only) is absent.
    expect(list.find((c) => c.name === "inbox-digest")).toBeUndefined();
  });

  test("a candidate BEHIND the active version is never offered for review", async () => {
    const t = convexTest(schema, modules);
    // The live shape observed 2026-08-09: an upgrade landed at v17 and the optimizer's older
    // dry-run candidate stayed behind at v16. The panel kept offering `v17 -> v16`, whose only
    // outcomes are an EVAL_GATE refusal or — with evidence — a SILENT ROLLBACK of a live agent.
    await insert(t, { name: "cockpit-agent", version: 16, body: "stale", status: "candidate" });
    await insert(t, { name: "cockpit-agent", version: 17, body: "live", status: "active" });
    // Same version as active is also not an upgrade.
    await insert(t, { name: "document-drafter", version: 3, body: "d3", status: "active" });
    await insert(t, { name: "document-drafter", version: 3, body: "d3c", status: "candidate" });
    // A genuine forward candidate still appears, so this is not vacuously empty.
    await insert(t, { name: "inbox-digest", version: 1, body: "i1", status: "active" });
    await insert(t, { name: "inbox-digest", version: 2, body: "i2", status: "candidate" });
    const { asOwner } = await identities(t);

    const list = await asOwner.query(api.skills.candidatesForReview, {});

    expect(list.find((c) => c.name === "cockpit-agent")).toBeUndefined();
    expect(list.find((c) => c.name === "document-drafter")).toBeUndefined();
    expect(list.find((c) => c.name === "inbox-digest")).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
    });
    // Anti-vacuity: the stale rows really are in the table and really are candidates.
    const stale = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) => q.eq("name", "cockpit-agent").eq("version", 16))
        .unique(),
    );
    expect(stale?.status).toBe("candidate");
  });

  test("a candidate with no active row at all is still offered", async () => {
    const t = convexTest(schema, modules);
    // First-ever candidate for a skill: `active` is null, so there is nothing to be behind.
    await insert(t, { name: "cockpit-agent", version: 1, body: "first", status: "candidate" });
    const { asOwner } = await identities(t);

    const list = await asOwner.query(api.skills.candidatesForReview, {});
    expect(list.find((c) => c.name === "cockpit-agent")).toMatchObject({
      fromVersion: null,
      toVersion: 1,
    });
  });

  // GOVN-01 — authentication is NOT authorization. Skill rows are a GLOBAL registry, so
  // before this gate any signed-in tenant could read every candidate prompt body in the
  // deployment and flip any skill live.

  test("a non-owner cannot read candidate BODIES", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 11, body: "OLD BODY", status: "active" });
    await insert(t, {
      name: "cockpit-agent",
      version: 12,
      body: "SECRET NEW BODY",
      status: "candidate",
      evidence: passing("cockpit-agent", 12),
    });
    const { asOwner, asNonOwner } = await identities(t);

    await expect(asNonOwner.query(api.skills.candidatesForReview, {})).rejects.toThrow(
      /OWNER_REQUIRED/,
    );

    // Anti-vacuity: the refusal is the no-body boundary, so prove the fixture REALLY holds
    // the body a non-owner just failed to read. Without this the test would pass against an
    // empty registry.
    const list = await asOwner.query(api.skills.candidatesForReview, {});
    expect(list.find((c) => c.name === "cockpit-agent")?.toBody).toBe("SECRET NEW BODY");
  });

  test("a non-owner activation is refused and NO status changes", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insert(t, {
      name: "cockpit-agent",
      version: 2,
      body: "v2",
      status: "candidate",
      evidence: passing("cockpit-agent", 2),
    });
    const { asNonOwner } = await identities(t);

    await expect(
      asNonOwner.mutation(api.skills.activateCandidate, { name: "cockpit-agent", version: 2 }),
    ).rejects.toThrow(/OWNER_REQUIRED/);

    // The candidate carries PASSING evidence, so EVAL_GATE would have let this through —
    // only the owner check stopped it. That is what makes this test about authorization
    // rather than about the evidence gate.
    expect(await statusOf(t, "cockpit-agent", 1)).toBe("active");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("candidate");
  });

  test("a non-owner ROLLBACK is refused — evidence-exempt does not mean auth-exempt", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 1, body: "v1", status: "archived" });
    await insert(t, { name: "cockpit-agent", version: 2, body: "v2", status: "active" });
    const { asNonOwner } = await identities(t);

    // v1 is `archived`, so EVAL_GATE exempts it BY STATUS (rollback must work mid-incident).
    // Authorization is the only thing standing here — and it must still stand.
    await expect(
      asNonOwner.mutation(api.skills.activateCandidate, { name: "cockpit-agent", version: 1 }),
    ).rejects.toThrow(/OWNER_REQUIRED/);

    expect(await statusOf(t, "cockpit-agent", 1)).toBe("archived");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("active");
  });

  test("an OWNER still cannot bypass EVAL_GATE — the two gates are independent", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 1, body: "v1", status: "active" });
    await insert(t, { name: "cockpit-agent", version: 2, body: "v2", status: "candidate" });
    const { asOwner } = await identities(t);

    // Owner authority answers "may this caller act?", never "has this body earned it?".
    await expect(
      asOwner.mutation(api.skills.activateCandidate, { name: "cockpit-agent", version: 2 }),
    ).rejects.toThrow(/EVAL_GATE/);
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("candidate");
  });

  test("the INTERNAL activate path still works with no identity, and rollback stays evidence-exempt", async () => {
    const t = convexTest(schema, modules);
    await insert(t, { name: "cockpit-agent", version: 1, body: "v1", status: "archived" });
    await insert(t, { name: "cockpit-agent", version: 2, body: "v2", status: "active" });

    // The eval runner / seed path has no browser identity at all. Owner-gating the PUBLIC
    // wrappers must not have gated this.
    await t.mutation(internal.skills.activateSkill, { name: "cockpit-agent", version: 1 });

    expect(await statusOf(t, "cockpit-agent", 1)).toBe("active");
    expect(await statusOf(t, "cockpit-agent", 2)).toBe("archived");
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
    ["business-profile.md", businessProfileSkillBody],
    // Phase 18 (ACTN-04): the short-form drafter. `skillBodies.test.ts` is a CLOSED enumeration of
    // the Phase-12/14/15.1/16/17.1 bodies — this table is content-drafter's only drift guard.
    ["content-drafter.md", contentDrafterSkillBody],
  ])("%s seed constant equals its canonical markdown (no drift)", (file, body) => {
    const mdPath = fileURLToPath(new URL(`../../contracts/skills/${file}`, import.meta.url));
    expect(lf(body)).toBe(lf(readFileSync(mdPath, "utf8")));
  });

  /**
   * The ONE exemption from the long-inline-string scan below, and it is deliberately narrow: an
   * exact path, not a directory and not a raised threshold.
   *
   * `render/assembleScript.ts` is a bundler-safe mirror of `render/assemble_final.sh` — it is
   * **CODE, not a prompt.** CLAUDE.md §5 makes PROMPTS versioned `skills` rows; generalising that
   * to this file would be remote code execution, because a registry row is mutable by a database
   * write and this string is executed as a shell script in a VM holding tenant media. The file's
   * own header says so, and `llmRedaction.test.ts` proves no `render/`-sourced body ever reaches
   * a `skills.ts` seed.
   *
   * Raising MAX_INLINE_STRING instead would have blinded this guard for every file at once, which
   * is the opposite of what one legitimate exception warrants. Found RED on `main` by plan 20-04
   * (2026-08-02) — the scan and 20-13's mirror landed in different plans and never met.
   */
  const ASSEMBLER_MIRROR = "/render/assembleScript.ts";
  /** The SECOND mirror, on identical terms (plan 20-17). `render/burnCapsScript.ts` mirrors
   *  `render/burn_caps.sh` — the caption burn — and everything above applies to it word for word:
   *  it is a shell script executed in a VM holding tenant media, so making it a mutable registry
   *  row would be remote code execution. Two exemptions, both the same shape, both anti-vacuity
   *  checked below. A THIRD should be resisted: the pattern is "a harvested ffmpeg pass", and a
   *  file that is not that does not belong here. */
  const BURN_MIRROR = "/render/burnCapsScript.ts";

  test("the assembler-mirror exemption is REAL and still guarded elsewhere", () => {
    // Anti-vacuity. A skip keyed on a path becomes a silent hole the moment that path moves, and
    // it is only defensible while the two guards that make it safe are still in place.
    const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
    expect(existsSync(at(`.${ASSEMBLER_MIRROR}`))).toBe(true); // the exempted file
    expect(existsSync(at("./render/assemble_final.sh"))).toBe(true); // its canonical source
    expect(existsSync(at("./render/assembleScript.test.ts"))).toBe(true); // the byte-identity drift test
    // …and the same three for the caption burn's mirror.
    expect(existsSync(at(`.${BURN_MIRROR}`))).toBe(true);
    expect(existsSync(at("./render/burn_caps.sh"))).toBe(true);
    expect(existsSync(at("./render/burnCapsScript.test.ts"))).toBe(true);
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
        if (full.endsWith(ASSEMBLER_MIRROR) || full.endsWith(BURN_MIRROR)) continue; // the TWO exemptions — see above
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

// Phase 18 (ACTN-04). Not a style preference — gating `content-drafter` DEADLOCKS it at v1.
// `run-eval-golden.mjs`'s SKILL_NAMES is DERIVED from GATED_SKILLS, so gating makes the row
// pinnable, but no golden fixture reaches `createDocument`: the first body edit would mint a
// candidate no eval run can certify. Same deadlock recorded for `business-blueprint` (17.1-02).
// A future "tidy up the gate list" edit must fail HERE rather than in production.
describe("content-drafter gating (18-03)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(CONTENT_DRAFTER_SKILL)).toBe(false);
  });
});

// ── 21-02: tenant-authored candidates (SKILL-01) ───────────────────────────────────────────────
//
// The behaviour half of 21-01's schema. 21-01's own summary says it plainly: `composeUserSkillBody`
// had no caller, so its 3/3 green proved the contract's SHAPE and nothing about tenant behaviour.
// Everything below is that behaviour — candidate-only status, authenticated provenance, the first
// customization's rollback baseline, bounded version allocation, two-tenant isolation, and a
// refs-only audit payload.
//
// Every zero/absence assertion here sits beside a positive row witness, because a "B sees nothing"
// test passes just as well when the fixture never wrote anything at all.
describe("publishUserCandidate — tenant candidate authoring (21-02)", () => {
  // High-entropy needles: an adaptation that leaks across a tenant boundary or into an audit
  // payload has to be findable by an exact string, not by eyeballing a body.
  const NEEDLE_A = "ZQ7ALPHA4f2b9c1e";
  const NEEDLE_B = "ZQ7BRAVO8a3d5f70";
  const AUTHORED_A = `Quote in AUD and never discount below 20%. ${NEEDLE_A}`;
  const AUTHORED_B = `Bundle onboarding into every retainer. ${NEEDLE_B}`;
  const GLOBAL_BODY = "GLOBAL OFFER ARCHITECT BODY v7";

  const harness = async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    // The global active base at v7, not v1 — so `basedOnVersion` proving 7 cannot be an accident
    // of "everything in this fixture is version 1".
    const globalId = await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: OFFER_ARCHITECT_SKILL,
        version: 7,
        body: GLOBAL_BODY,
        status: "active",
        createdAt: 0,
      }),
    );
    // GOVN-01 idiom: REAL `users` rows, because `requireScope` derives tenantId from the userId
    // segment of the subject. A fabricated subject string is not evidence of an identity.
    const userA = await t.run((ctx) => ctx.db.insert("users", {}));
    const userB = await t.run((ctx) => ctx.db.insert("users", {}));
    return {
      t,
      globalId,
      userA,
      userB,
      asA: t.withIdentity({ subject: `${userA}|session_a` }),
      asB: t.withIdentity({ subject: `${userB}|session_b` }),
    };
  };

  const tenantRows = (t: TestConvex<typeof schema>, tenantId: string) =>
    t.run((ctx) =>
      ctx.db
        .query("tenantSkills")
        .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", tenantId))
        .collect(),
    );
  const allTenantRows = (t: TestConvex<typeof schema>) =>
    t.run((ctx) => ctx.db.query("tenantSkills").collect());
  const auditRows = (t: TestConvex<typeof schema>) =>
    t.run((ctx) => ctx.db.query("audit").collect());
  const publishAudits = async (t: TestConvex<typeof schema>) =>
    (await auditRows(t)).filter((r) => r.eventType === "skill.user_candidate_published");

  test("first publication: ONE server baseline + ONE user candidate, and NOTHING goes live", async () => {
    const { t, globalId, userA, asA } = await harness();

    const res = await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_A,
    });
    expect(res.inserted).toBe(true);
    expect(res.version).toBe(2);
    expect(res.status).toBe("candidate");

    const rows = await tenantRows(t, String(userA));
    expect(rows).toHaveLength(2);
    const baseline = rows.find((r) => r.version === 1)!;
    const candidate = rows.find((r) => r.version === 2)!;

    // The BASELINE is the first customization's evidence-exempt rollback target (research pitfall
    // 8): server-authored, no adaptation of its own, archived, and eligible.
    expect(baseline.author).toBe("system");
    expect(baseline.authoredBody).toBe("");
    expect(baseline.status).toBe("archived");
    expect(baseline.rollbackEligible).toBe(true);
    expect(baseline.body).toBe(GLOBAL_BODY); // a byte copy of what was effective
    expect(baseline.authorUserId).toBeUndefined();

    // The CANDIDATE: authored addition, authenticated provenance, NOT rollback-eligible (it was
    // never active), and never `active` — activation is 21-04's owner gate.
    expect(candidate.author).toBe("user");
    expect(candidate.authorUserId).toBe(userA);
    expect(candidate.status).toBe("candidate");
    expect(candidate.rollbackEligible).toBe(false);
    expect(candidate.authoredBody).toBe(AUTHORED_A);
    expect(candidate.body).toBe(composeUserSkillBody(GLOBAL_BODY, AUTHORED_A));
    expect(candidate.evidence).toBeUndefined();
    // Lineage: EXACTLY ONE of the two base-id fields, keyed off the scope.
    expect(candidate.basedOnScope).toBe("global");
    expect(candidate.basedOnName).toBe(OFFER_ARCHITECT_SKILL);
    expect(candidate.basedOnVersion).toBe(7);
    expect(candidate.basedOnGlobalSkillId).toBe(globalId);
    expect(candidate.basedOnTenantSkillId).toBeUndefined();
    expect(baseline.basedOnGlobalSkillId).toBe(globalId);
    expect(baseline.basedOnTenantSkillId).toBeUndefined();

    // CANDIDATE-ONLY (mutation 2): no tenant row is active, and the GLOBAL active row is the
    // untouched v7 the loader still serves. The positive witness for these zeros is the two rows
    // asserted above.
    expect(rows.filter((r) => r.status === "active")).toHaveLength(0);
    const stillLive = await t.run((ctx) => loadSkill(ctx, OFFER_ARCHITECT_SKILL));
    expect(stillLive.version).toBe(7);
    expect(stillLive.body).toBe(GLOBAL_BODY);
    expect(stillLive.body).not.toContain(NEEDLE_A);
  });

  test("a later publication bases on the tenant ACTIVE row and does NOT append the prior draft", async () => {
    const { t, userA, asA } = await harness();
    await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_A,
    });
    // 21-04 owns the real activation; here the flip is a direct patch so THIS test is about
    // base RESOLUTION, not about activation authority.
    const v2 = (await tenantRows(t, String(userA))).find((r) => r.version === 2)!;
    await t.run((ctx) => ctx.db.patch(v2._id, { status: "active" }));

    const res = await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_B,
    });
    expect(res).toMatchObject({ inserted: true, version: 3, status: "candidate" });

    const v3 = (await tenantRows(t, String(userA))).find((r) => r.version === 3)!;
    expect(v3.basedOnScope).toBe("tenant");
    expect(v3.basedOnTenantSkillId).toBe(v2._id);
    expect(v3.basedOnGlobalSkillId).toBeUndefined();
    expect(v3.basedOnVersion).toBe(2);
    expect(v3.authoredBody).toBe(AUTHORED_B); // the adaptation is REPLACED, not accumulated
    expect(v3.body).toContain(NEEDLE_B);
    // NON-RECURSION (research pitfall 5): composing against the tenant's active body would carry
    // A's older adaptation forward forever. Exactly one marker, and the old needle is gone.
    expect(v3.body.split(USER_SKILL_ADAPTATION_SECTION)).toHaveLength(2);
    expect(v3.body).not.toContain(NEEDLE_A);
    // …and the row it was based on is untouched (immutable-per-version).
    expect((await t.run((ctx) => ctx.db.get(v2._id)))?.authoredBody).toBe(AUTHORED_A);
  });

  test("a byte-identical republication mints NOTHING and writes no second audit event", async () => {
    const { t, userA, asA } = await harness();
    const first = await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_A,
    });
    expect(first.inserted).toBe(true); // positive witness for the zeros below
    expect(await publishAudits(t)).toHaveLength(1);

    // Same bytes, same base — and a leading/trailing-whitespace variant, because the stored
    // `authoredBody` is the TRIMMED text and idempotence must compare like with like.
    const again = await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: `\n  ${AUTHORED_A}  \n`,
    });
    expect(again.inserted).toBe(false);
    expect(again.version).toBe(2);
    expect(again.tenantSkillId).toBe(first.tenantSkillId);

    expect(await tenantRows(t, String(userA))).toHaveLength(2); // no v3 churn
    expect(await publishAudits(t)).toHaveLength(1); // no duplicate audit event
  });

  test("provenance + authority come from the authenticated context, never from arguments", async () => {
    const { t, userA, userB, asA } = await harness();

    // The validator is the boundary (mutation 3): a caller cannot even NAME these fields.
    for (const spoof of [
      { tenantId: String(userB) },
      { authorUserId: userB },
      { author: "system" },
      { status: "active" },
      { version: 99 },
      { rollbackEligible: true },
      { evidence: "{}" },
      { basedOnVersion: 1 },
      { body: "REPLACEMENT" },
    ]) {
      await expect(
        asA.mutation(api.skills.publishUserCandidate, {
          name: OFFER_ARCHITECT_SKILL,
          authoredBody: AUTHORED_A,
          ...spoof,
        } as never),
        `publishUserCandidate accepted ${Object.keys(spoof)[0]} from the caller`,
      ).rejects.toThrow();
    }
    expect(await allTenantRows(t)).toHaveLength(0);

    // Positive witness: the same call WITHOUT a spoofed field writes A's row under A's identity.
    await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_A,
    });
    const candidate = (await tenantRows(t, String(userA))).find((r) => r.author === "user")!;
    expect(candidate.authorUserId).toBe(userA);
    expect(candidate.authorUserId).not.toBe(userB);
    expect(candidate.tenantId).toBe(String(userA));

    // And an unauthenticated caller never reaches the handler.
    await expect(
      t.mutation(api.skills.publishUserCandidate, {
        name: OFFER_ARCHITECT_SKILL,
        authoredBody: AUTHORED_A,
      }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("refuses an unknown / non-authorable name and a blank or over-cap body BEFORE any write", async () => {
    const { t, asA } = await harness();
    const publish = (name: string, authoredBody: string) =>
      asA.mutation(api.skills.publishUserCandidate, { name, authoredBody });

    await expect(publish("no-such-skill", AUTHORED_A)).rejects.toThrow(/NOT_USER_AUTHORABLE/);
    // `cockpit-agent` IS eval-gated — authorability is deliberately NARROWER than GATED_SKILLS.
    expect(isGatedSkill(COCKPIT_AGENT_SKILL)).toBe(true);
    await expect(publish(COCKPIT_AGENT_SKILL, AUTHORED_A)).rejects.toThrow(/NOT_USER_AUTHORABLE/);
    await expect(publish(OFFER_ARCHITECT_SKILL, "   \n  ")).rejects.toThrow(
      /USER_SKILL_ADAPTATION_REQUIRED/,
    );
    // The cap is BYTES: 1001 three-byte characters is 3003 bytes of a 4000-byte allowance, so the
    // over-cap case has to be built in bytes or it silently tests nothing.
    const overCap = "あ".repeat(Math.ceil(USER_SKILL_ADAPTATION_MAX_BYTES / 3) + 1);
    expect(new TextEncoder().encode(overCap).length).toBeGreaterThan(
      USER_SKILL_ADAPTATION_MAX_BYTES,
    );
    await expect(publish(OFFER_ARCHITECT_SKILL, overCap)).rejects.toThrow(
      /USER_SKILL_ADAPTATION_TOO_LARGE/,
    );
    // A refusal writes NOTHING — no row, no baseline, no audit event.
    expect(await allTenantRows(t)).toHaveLength(0);
    expect(await auditRows(t)).toHaveLength(0);

    // Positive witness: the at-cap boundary is ACCEPTED, so the zeros above are the refusals and
    // not a broken fixture.
    const atCap = "あ".repeat(Math.floor(USER_SKILL_ADAPTATION_MAX_BYTES / 3));
    await publish(OFFER_ARCHITECT_SKILL, atCap);
    expect(await allTenantRows(t)).toHaveLength(2);
  });

  test("two tenants: identical name and version, zero crossover in rows or in myUserSkills", async () => {
    const { t, userA, userB, asA, asB } = await harness();
    await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_A,
    });
    await asB.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_B,
    });

    // Both landed at v2 of the SAME name — the collision the overlay exists to make safe, and
    // exactly why 21-03's eval evidence must bind a candidate id rather than name@version.
    const aRows = await tenantRows(t, String(userA));
    const bRows = await tenantRows(t, String(userB));
    expect(aRows).toHaveLength(2);
    expect(bRows).toHaveLength(2);
    const aCand = aRows.find((r) => r.author === "user")!;
    const bCand = bRows.find((r) => r.author === "user")!;
    expect(aCand.version).toBe(2);
    expect(bCand.version).toBe(2);
    expect(aCand._id).not.toBe(bCand._id);
    expect(aCand.body).toContain(NEEDLE_A);
    expect(aCand.body).not.toContain(NEEDLE_B);
    expect(bCand.body).toContain(NEEDLE_B);
    expect(bCand.body).not.toContain(NEEDLE_A);

    // The tenant read (mutation 1): A sees exactly A's one adaptation, and B's needle is nowhere
    // in the payload — with A's own row as the positive witness on the same object.
    const mine = await asA.query(api.skills.myUserSkills, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      name: OFFER_ARCHITECT_SKILL,
      label: USER_AUTHORABLE_SKILL_METADATA[OFFER_ARCHITECT_SKILL].label,
      authoredBody: AUTHORED_A,
      version: 2,
      status: "candidate",
      baseScope: "global",
      baseVersion: 7,
      gatePassed: false,
    });
    const serialized = JSON.stringify(mine);
    expect(serialized).toContain(NEEDLE_A);
    expect(serialized).not.toContain(NEEDLE_B);
    // The DISCLOSURE boundary: the projection carries no base/composed body and no raw evidence,
    // so an ordinary user never receives the global prompt (research pitfall 4).
    expect(serialized).not.toContain(GLOBAL_BODY);
    expect(serialized).not.toContain(USER_SKILL_ADAPTATION_SECTION);
    expect(Object.keys(mine[0]!).sort()).toEqual([
      "authoredBody",
      "baseScope",
      "baseVersion",
      "createdAt",
      "gatePassed",
      "label",
      "name",
      "status",
      "version",
    ]);
    // …and the system baseline is not a user adaptation, so it is not listed.
    expect(mine.every((s) => s.authoredBody !== "")).toBe(true);
    // B's view is the mirror image, which is what makes A's single row meaningful.
    const theirs = await asB.query(api.skills.myUserSkills, {});
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.authoredBody).toBe(AUTHORED_B);
  });

  test("after 200 tenant-local versions, publication allocates exactly 201 from ONE indexed read", async () => {
    const { t, userA, asA } = await harness();
    // A deliberately long tenant history. `.collect()`-based allocation still returns 201 here,
    // which is why the SOURCE contract below is the real guard on the cost.
    await t.run(async (ctx) => {
      for (let version = 1; version <= 200; version++) {
        await ctx.db.insert("tenantSkills", {
          tenantId: String(userA),
          name: OFFER_ARCHITECT_SKILL,
          version,
          body: `history v${version}`,
          authoredBody: `history adaptation v${version}`,
          status: version === 200 ? "active" : "archived",
          author: "user",
          authorUserId: userA,
          basedOnScope: "global",
          basedOnName: OFFER_ARCHITECT_SKILL,
          basedOnVersion: 7,
          rollbackEligible: version !== 200,
          createdAt: version,
        });
      }
    });

    const res = await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_A,
    });
    expect(res).toMatchObject({ inserted: true, version: 201, status: "candidate" });
    // No baseline is minted on a tenant that already has history — the baseline is a FIRST-
    // customization artifact, so 201 rows, not 202.
    expect(await tenantRows(t, String(userA))).toHaveLength(201);
    const v201 = (await tenantRows(t, String(userA))).find((r) => r.version === 201)!;
    expect(v201.basedOnScope).toBe("tenant"); // v200 was the tenant's active row
    expect(v201.basedOnVersion).toBe(200);
  });

  test("the tenant allocation reads ONE descending indexed row — never a history .collect()", () => {
    const src = readFileSync(fileURLToPath(new URL("./skills.ts", import.meta.url)), "utf8");
    const from = src.indexOf("export const publishUserCandidate");
    const to = src.indexOf("export const myUserSkills");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const region = src.slice(from, to);
    expect(region.length).toBeGreaterThan(800); // non-vacuity: the real publisher was found

    // POSITIVE: the bounded read the many-version case above depends on.
    expect(region).toContain("by_tenant_name_version");
    expect(region).toContain('.order("desc")');
    expect(region).toContain(".take(1)");
    // NEGATIVE: a tenant's authoring history is open-ended (research pitfall 12). Named mutation
    // that turns this red: replace the descending take(1) with `.collect()`.
    expect(region).not.toContain(".collect(");
  });

  test("the publish audit row is refs-only: an exact key set, and neither body anywhere in audit", async () => {
    const { t, userA, globalId, asA } = await harness();
    const res = await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_A,
    });

    const events = await publishAudits(t);
    expect(events).toHaveLength(1); // the positive witness for the scan below
    const row = events[0]!;
    expect(row.tenantId).toBe(String(userA));
    expect(row.actor).toBe("user");
    const payload = row.payload as Record<string, unknown>;
    // KEY-SET EQUALITY (mutation 12a). Adding `authoredBody` or `body` here fails on purpose.
    expect(Object.keys(payload).sort()).toEqual([
      "author",
      "authoredBytes",
      "baseScope",
      "baseSkillId",
      "baseVersion",
      "bodyHash",
      "skillName",
      "tenantSkillId",
      "version",
    ]);
    expect(payload).toMatchObject({
      skillName: OFFER_ARCHITECT_SKILL,
      tenantSkillId: res.tenantSkillId,
      version: 2,
      baseScope: "global",
      baseSkillId: globalId,
      baseVersion: 7,
      author: "user",
      authoredBytes: new TextEncoder().encode(AUTHORED_A).length,
    });
    expect(String(payload.bodyHash)).toMatch(/^[0-9a-f]{64}$/);

    // The needle scan over EVERY audit row and EVERY dead letter — CLAUDE.md §4. The candidate
    // text is content-plane data and must never reach either plane.
    const everything = JSON.stringify([
      await auditRows(t),
      await t.run((ctx) => ctx.db.query("deadLetters").collect()),
    ]);
    expect(everything).not.toContain(NEEDLE_A);
    expect(everything).not.toContain(GLOBAL_BODY);
    expect(everything).not.toContain(USER_SKILL_ADAPTATION_SECTION);
    // Non-vacuity: the scan really did read the row asserted above.
    expect(everything).toContain(String(payload.bodyHash));
  });
});

// ── 21-02 Task 2: the effective loader (tenant overlay first, global active as fallback) ────────
describe("getEffectiveSkill — tenant overlay resolution (21-02)", () => {
  const TENANT = "tenant_eff_a";
  const OTHER = "tenant_eff_b";
  const NEEDLE = "ZQ7EFFECTIVE1122ab";

  const insertTenantRow = (
    t: TestConvex<typeof schema>,
    tenantId: string,
    fields: { version: number; body: string; status: "active" | "candidate" | "archived" },
  ) =>
    t.run((ctx) =>
      ctx.db.insert("tenantSkills", {
        tenantId,
        name: LEAD_ENGINE_SKILL,
        authoredBody: "adaptation",
        author: "user",
        basedOnScope: "global",
        basedOnName: LEAD_ENGINE_SKILL,
        basedOnVersion: 1,
        rollbackEligible: false,
        createdAt: fields.version,
        ...fields,
      }),
    );

  const seedGlobal = (t: TestConvex<typeof schema>) =>
    t.run((ctx) =>
      ctx.db.insert("skills", {
        name: LEAD_ENGINE_SKILL,
        version: 3,
        body: "GLOBAL LEAD ENGINE v3",
        status: "active",
        createdAt: 0,
      }),
    );

  test("a tenant ACTIVE row wins; every other tenant still gets the global active row", async () => {
    const t = convexTest(schema, modules);
    const globalId = await seedGlobal(t);
    const overlayId = await insertTenantRow(t, TENANT, {
      version: 2,
      body: `OVERLAY ${NEEDLE}`,
      status: "active",
    });

    expect(
      await t.query(internal.skills.getEffectiveSkill, {
        tenantId: TENANT,
        name: LEAD_ENGINE_SKILL,
      }),
    ).toEqual({ scope: "tenant", skillId: overlayId, version: 2, body: `OVERLAY ${NEEDLE}` });

    // Mutation 7 (remove the loader's tenant predicate) turns THIS assertion red.
    const foreign = await t.query(internal.skills.getEffectiveSkill, {
      tenantId: OTHER,
      name: LEAD_ENGINE_SKILL,
    });
    expect(foreign).toEqual({
      scope: "global",
      skillId: globalId,
      version: 3,
      body: "GLOBAL LEAD ENGINE v3",
    });
    expect(foreign.body).not.toContain(NEEDLE);
  });

  test("a CANDIDATE overlay never resolves — publishing changes nothing at runtime", async () => {
    const t = convexTest(schema, modules);
    const globalId = await seedGlobal(t);
    await insertTenantRow(t, TENANT, {
      version: 2,
      body: `CANDIDATE ${NEEDLE}`,
      status: "candidate",
    });
    await insertTenantRow(t, TENANT, { version: 1, body: "ARCHIVED BASELINE", status: "archived" });

    const eff = await t.query(internal.skills.getEffectiveSkill, {
      tenantId: TENANT,
      name: LEAD_ENGINE_SKILL,
    });
    expect(eff).toEqual({
      scope: "global",
      skillId: globalId,
      version: 3,
      body: "GLOBAL LEAD ENGINE v3",
    });
    expect(eff.body).not.toContain(NEEDLE);
  });

  test("no overlay and no global row → still fails CLOSED with NO_ACTIVE_SKILL", async () => {
    const t = convexTest(schema, modules);
    // Mutation 8 (remove the global fallback) turns the FIRST half red; this half proves the
    // fallback did not swallow the fail-closed contract.
    await expect(
      t.query(internal.skills.getEffectiveSkill, { tenantId: TENANT, name: LEAD_ENGINE_SKILL }),
    ).rejects.toThrow(/NO_ACTIVE_SKILL/);
    await seedGlobal(t);
    expect(
      (
        await t.query(internal.skills.getEffectiveSkill, {
          tenantId: TENANT,
          name: LEAD_ENGINE_SKILL,
        })
      ).version,
    ).toBe(3);
  });
});

// ── 21-03 (SKILL-01): EXACT tenant candidate identity ────────────────────────────────────────
//
// The question this whole block answers: 21-02 left two tenants each owning `offer-architect@2`
// (its own two-tenant test builds that collision deliberately). `<name>@<version>` therefore cannot
// say WHICH body a paid eval run certified. These tests are about the id being load-bearing —
// not about a field existing.
describe("exact tenant candidate reads + evidence (21-03)", () => {
  const NEEDLE_A = "ZQ7EXACTA9c4e17b3";
  const NEEDLE_B = "ZQ7EXACTB2f8d05a6";
  const AUTHORED_A = `Always quote in AUD. ${NEEDLE_A}`;
  const AUTHORED_B = `Always bundle onboarding. ${NEEDLE_B}`;
  const GLOBAL_BODY = "GLOBAL OFFER ARCHITECT BODY v7 — the code-owned core";

  /** Two real tenants who each PUBLISH through the shipped mutation, so the collision is produced
   *  by the product path rather than hand-inserted into existence. */
  const collision = async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    const globalId = await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: OFFER_ARCHITECT_SKILL,
        version: 7,
        body: GLOBAL_BODY,
        status: "active",
        createdAt: 0,
      }),
    );
    const userA = await t.run((ctx) => ctx.db.insert("users", {}));
    const userB = await t.run((ctx) => ctx.db.insert("users", {}));
    const asA = t.withIdentity({ subject: `${userA}|session_a` });
    const asB = t.withIdentity({ subject: `${userB}|session_b` });
    const a = await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_A,
    });
    const b = await asB.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: AUTHORED_B,
    });
    // The collision, asserted rather than assumed: same name, same version, two different rows.
    expect(a.version).toBe(b.version);
    expect(String(a.tenantSkillId)).not.toBe(String(b.tenantSkillId));
    return {
      t,
      globalId,
      asA,
      asB,
      idA: a.tenantSkillId as Id<"tenantSkills">,
      idB: b.tenantSkillId as Id<"tenantSkills">,
      tenantA: String(userA),
      tenantB: String(userB),
      version: a.version,
    };
  };

  const targetOf = (
    id: Id<"tenantSkills">,
    tenantId: string,
    version: number,
  ): EvalEvidenceTenantTarget => ({
    candidateId: String(id),
    registryTenantId: tenantId,
    name: OFFER_ARCHITECT_SKILL,
    version,
  });

  const passing = (target: EvalEvidenceTenantTarget) =>
    JSON.stringify({
      runner: "eval:golden",
      runId: "run-exact-1",
      pass: true,
      casesPassed: 36,
      casesTotal: 36,
      retriedCases: [],
      costUsd: 0.42,
      model: "openai/gpt-4o-mini",
      skillVersions: {},
      tenantTarget: target,
      ts: 1_700_000_000_000,
    });

  const rowOf = (t: TestConvex<typeof schema>, id: Id<"tenantSkills">) =>
    t.run((ctx) => ctx.db.get(id));

  test("getTenantSkillVersion reads ONE exact row whatever its status; absence is a non-oracle throw", async () => {
    const { t, idA, idB, tenantA, tenantB, version } = await collision();

    const a = await t.query(internal.skills.getTenantSkillVersion, { candidateId: idA });
    expect(a).toMatchObject({
      skillId: idA,
      name: OFFER_ARCHITECT_SKILL,
      tenantId: tenantA,
      version,
      status: "candidate",
      author: "user",
    });
    expect(a.body).toContain(NEEDLE_A);
    // …and the SAME name at the SAME version in the other tenant is a different body. This is the
    // whole reason the read takes an id: `(name, version)` cannot separate these two.
    const b = await t.query(internal.skills.getTenantSkillVersion, { candidateId: idB });
    expect(b.tenantId).toBe(tenantB);
    expect(b.version).toBe(version);
    expect(b.body).toContain(NEEDLE_B);
    expect(b.body).not.toContain(NEEDLE_A);

    // An `active` row is still readable — the read is diagnostic, the refusal is the runner's.
    await t.run((ctx) => ctx.db.patch(idA, { status: "active" }));
    const active = await t.query(internal.skills.getTenantSkillVersion, { candidateId: idA });
    expect(active.status).toBe("active");

    // Absence: the error names NOTHING. A message carrying the id/tenant/name would make this read
    // an existence oracle for rows the caller does not own.
    await t.run((ctx) => ctx.db.delete(idB));
    await expect(
      t.query(internal.skills.getTenantSkillVersion, { candidateId: idB }),
    ).rejects.toThrow(/NO_SUCH_TENANT_CANDIDATE/);
    const err = await t
      .query(internal.skills.getTenantSkillVersion, { candidateId: idB })
      .catch((e: Error) => e.message);
    expect(String(err)).not.toContain(String(idB));
    expect(String(err)).not.toContain(tenantB);
    expect(String(err)).not.toContain(OFFER_ARCHITECT_SKILL);
  });

  test("evidence lands on the EXACT row: the colliding same-name same-version row stays uncertified", async () => {
    const { t, idA, idB, tenantA, tenantB, version } = await collision();
    const targetA = targetOf(idA, tenantA, version);
    const targetB = targetOf(idB, tenantB, version);

    // Nothing is certified before the write — the positive witness for the zeros below is the
    // `true` further down, not an empty fixture.
    expect(hasPassingTenantEvidence((await rowOf(t, idA))?.evidence, targetA)).toBe(false);

    // Certify the SECOND-published row. Direction matters: a name/version write resolves to
    // whichever colliding row it finds first, which here is A — so writing for B is what makes the
    // wrong-row failure observable rather than accidentally correct.
    const wrote = await t.mutation(internal.skills.recordTenantEvalEvidence, {
      candidateId: idB,
      evidence: passing(targetB),
    });

    // MUTATION 4 (candidate-id selection → name/version selection) turns THESE red.
    expect(hasPassingTenantEvidence((await rowOf(t, idB))?.evidence, targetB)).toBe(true);
    expect((await rowOf(t, idA))?.evidence).toBeUndefined();
    expect(hasPassingTenantEvidence((await rowOf(t, idA))?.evidence, targetA)).toBe(false);
    expect(wrote).toEqual(targetB);

    // And the other direction, so neither row is privileged by insertion order.
    await t.mutation(internal.skills.recordTenantEvalEvidence, {
      candidateId: idA,
      evidence: passing(targetA),
    });
    expect(hasPassingTenantEvidence((await rowOf(t, idA))?.evidence, targetA)).toBe(true);
    // …and the two rows carry DIFFERENT evidence: one write did not overwrite the other.
    expect((await rowOf(t, idA))?.evidence).not.toBe((await rowOf(t, idB))?.evidence);
  });

  test("A's passing evidence COPIED onto B's colliding row still cannot certify B", async () => {
    const { t, idA, idB, tenantA, tenantB, version } = await collision();
    const targetA = targetOf(idA, tenantA, version);
    const targetB = targetOf(idB, tenantB, version);
    const evidence = passing(targetA);

    // The forgery: byte-identical passing evidence, carrying A's candidate id, written onto B. It
    // agrees with B on name AND version — every field `hasPassingEvidence` looks at.
    await t.run((ctx) => ctx.db.patch(idB, { evidence }));

    // The GLOBAL predicate is deliberately shown to be no help here: it never looks at the id.
    expect(hasPassingEvidence(evidence, OFFER_ARCHITECT_SKILL, version)).toBe(false);
    expect(hasPassingTenantEvidence(evidence, targetB)).toBe(false);
    // …and the ROW ID alone is load-bearing. This forgery agrees with B on tenant, name AND
    // version and disagrees only on which row ran — the exact shape a name/version-keyed gate
    // cannot see. MUTATION 6 (drop the candidateId comparison) turns THIS red.
    const forged = passing({ ...targetB, candidateId: targetA.candidateId });
    expect(hasPassingTenantEvidence(forged, targetB)).toBe(false);
    // Non-vacuity: the same JSON with B's own id DOES certify B, so the refusal above is the id.
    expect(hasPassingTenantEvidence(passing(targetB), targetB)).toBe(true);
    // …and the same bytes on A's own row DO certify it, so the refusal above is about identity,
    // not about the evidence being malformed.
    expect(hasPassingTenantEvidence(evidence, targetA)).toBe(true);

    // Each remaining identity field is load-bearing on its own.
    expect(hasPassingTenantEvidence(evidence, { ...targetA, version: version + 1 })).toBe(false);
    expect(hasPassingTenantEvidence(evidence, { ...targetA, registryTenantId: tenantB })).toBe(
      false,
    );
    expect(hasPassingTenantEvidence(evidence, { ...targetA, name: LEAD_ENGINE_SKILL })).toBe(false);
    // Failed, unparseable and absent all fail CLOSED.
    expect(
      hasPassingTenantEvidence(JSON.stringify({ pass: false, tenantTarget: targetA }), targetA),
    ).toBe(false);
    expect(hasPassingTenantEvidence("{not json", targetA)).toBe(false);
    expect(hasPassingTenantEvidence(undefined, targetA)).toBe(false);
    // Evidence with NO tenant target (a pre-21-03 global row) cannot certify a tenant candidate.
    expect(
      hasPassingTenantEvidence(
        JSON.stringify({ pass: true, skillVersions: { [OFFER_ARCHITECT_SKILL]: version } }),
        targetA,
      ),
    ).toBe(false);
  });

  test("recordTenantEvalEvidence patches evidence and NOTHING else", async () => {
    const { t, idA, tenantA, version } = await collision();
    // `?? {}` rather than `!`: a null row would otherwise blow up as a TypeError instead of as the
    // equality assertion below, which reads like an infrastructure crash, not a broken invariant.
    const beforeRow = await rowOf(t, idA);
    expect(beforeRow?.status).toBe("candidate"); // the field an activation would have moved
    const { evidence: _dropped, ...beforeRest } = beforeRow ?? {};

    await t.mutation(internal.skills.recordTenantEvalEvidence, {
      candidateId: idA,
      evidence: passing(targetOf(idA, tenantA, version)),
    });

    const { evidence: written, ...afterRest } = (await rowOf(t, idA)) ?? {};
    // EVERY non-evidence field, compared by equality — body, authoredBody, status, author,
    // authorUserId, version, name, tenantId, lineage, rollbackEligible, createdAt, _id, _creationTime.
    expect(afterRest).toEqual(beforeRest);
    expect(written).toBeDefined();
  });

  test("inspectTenantSkill is refs-only: no body, no adaptation, no global prompt", async () => {
    const { t, globalId, idA, idB, tenantA, tenantB, version } = await collision();
    await t.mutation(internal.skills.recordTenantEvalEvidence, {
      candidateId: idA,
      evidence: passing(targetOf(idA, tenantA, version)),
    });

    const snap = await t.query(internal.skills.inspectTenantSkill, {
      candidateId: idA,
      foreignTenantId: tenantB,
    });

    expect(snap.candidate).toMatchObject({
      id: String(idA),
      tenantId: tenantA,
      name: OFFER_ARCHITECT_SKILL,
      version,
      author: "user",
      status: "candidate",
      rollbackEligible: false,
      evidenceState: "passing",
      gatePassed: true,
    });
    expect(snap.candidate.lineage).toMatchObject({
      basedOnScope: "global",
      basedOnName: OFFER_ARCHITECT_SKILL,
      basedOnVersion: 7,
      basedOnGlobalSkillId: String(globalId),
      basedOnTenantSkillId: null,
    });
    expect(snap.candidate.evidenceTarget).toEqual(targetOf(idA, tenantA, version));
    expect(snap.candidate.evidenceSummary).toEqual({
      runId: "run-exact-1",
      caseCount: 36,
      retryCount: 0,
      costUsd: 0.42,
      model: "openai/gpt-4o-mini",
    });

    // The HASH is the candidate's own body — a real value, not a placeholder.
    const candidateBody = (await rowOf(t, idA))?.body ?? "";
    expect(snap.candidate.bodyHash).toBe(await contentHash(candidateBody));
    expect(snap.candidate.bodyHash).not.toBe(await contentHash(GLOBAL_BODY));

    // The initial rollback baseline is the tenant's frozen copy of the PRE-ACTIVATION global core,
    // so its hash equals the global hash exactly (research pitfall 8's evidence-exempt target).
    expect(snap.rollbackBaseline).toMatchObject({
      scope: "tenant",
      tenantId: tenantA,
      author: "system",
      status: "archived",
      rollbackEligible: true,
      version: 1,
    });
    expect(snap.rollbackBaseline?.bodyHash).toBe(await contentHash(GLOBAL_BODY));
    expect(snap.globalCurrent).toMatchObject({ scope: "global", id: String(globalId), version: 7 });
    expect(snap.globalCurrent.bodyHash).toBe(await contentHash(GLOBAL_BODY));
    // Nothing is active for this tenant (21-04 owns activation), so effective IS the global row.
    expect(snap.currentEffective).toMatchObject({ scope: "global", id: String(globalId) });
    expect(snap.currentEffective.bodyHash).not.toBe(snap.candidate.bodyHash);

    // The FOREIGN tenant's snapshot: a different tenant's effective row, never this candidate.
    expect(snap.foreignCurrent).toMatchObject({ tenantId: tenantB, candidateIdVisible: false });
    expect(snap.foreignCurrent?.effective.id).not.toBe(String(idA));
    expect(snap.foreignCurrent?.effective.id).not.toBe(String(idB));
    expect(snap.foreignCurrent?.effective.bodyHash).not.toBe(snap.candidate.bodyHash);

    // THE disclosure assertion: serialize the WHOLE snapshot and scan it. No composed body, no
    // authored adaptation, no global prompt, no section marker — from either tenant.
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain(NEEDLE_A);
    expect(serialized).not.toContain(NEEDLE_B);
    expect(serialized).not.toContain(GLOBAL_BODY);
    expect(serialized).not.toContain(USER_SKILL_ADAPTATION_SECTION);
    expect(serialized).not.toContain(AUTHORED_A);
    // Non-vacuity: the scan really did read the payload it is asserting about.
    expect(serialized).toContain(snap.candidate.bodyHash);
    expect(serialized).toContain(String(idA));

    // An `internalQuery` cannot write, but state the outcome anyway: inspecting changed nothing.
    expect(await rowOf(t, idA)).toEqual(await rowOf(t, idA));
    expect((await rowOf(t, idA))?.status).toBe("candidate");
  });

  test("inspect: a tenant-based candidate's baseline comes from LINEAGE, and evidence state is honest", async () => {
    const { t, idA, tenantA, asA } = await collision();
    // Make A's first candidate the tenant's ACTIVE row (21-04 owns the real transition; this is a
    // direct patch so the test is about lineage resolution, not activation authority), then publish
    // a SECOND adaptation on top of it.
    await t.run((ctx) => ctx.db.patch(idA, { status: "active" }));
    const second = await asA.mutation(api.skills.publishUserCandidate, {
      name: OFFER_ARCHITECT_SKILL,
      authoredBody: "Third revision of the offer rules.",
    });
    const idA3 = second.tenantSkillId as Id<"tenantSkills">;

    const snap = await t.query(internal.skills.inspectTenantSkill, { candidateId: idA3 });
    // Lineage points at the row it SUPERSEDES (21-02: the lineage base is the tenant effective row,
    // NOT the composition core) …
    expect(snap.candidate.lineage).toMatchObject({
      basedOnScope: "tenant",
      basedOnTenantSkillId: String(idA),
      basedOnVersion: 2,
      basedOnGlobalSkillId: null,
    });
    // …and the rollback baseline is still the v1 system row, reached by walking that lineage past
    // the non-eligible v2 — never "the newest archived row".
    expect(snap.rollbackBaseline).toMatchObject({ version: 1, author: "system" });
    expect(snap.rollbackBaseline?.bodyHash).toBe(await contentHash(GLOBAL_BODY));
    // A's v2 is now what the tenant runs, so `currentEffective` is the TENANT row.
    expect(snap.currentEffective).toMatchObject({ scope: "tenant", id: String(idA), version: 2 });

    // Evidence state, all three values, on the same row.
    expect(snap.candidate.evidenceState).toBe("absent");
    expect(snap.candidate.gatePassed).toBe(false);
    await t.run((ctx) => ctx.db.patch(idA3, { evidence: "{not json" }));
    const broken = await t.query(internal.skills.inspectTenantSkill, { candidateId: idA3 });
    // Unparseable is `failing`, not `absent`: "there is a pin and it does not hold" is a different
    // operator situation from "there is none", and collapsing them hides a stale pin.
    expect(broken.candidate.evidenceState).toBe("failing");
    expect(broken.candidate.evidenceTarget).toBeNull();
    await t.mutation(internal.skills.recordTenantEvalEvidence, {
      candidateId: idA3,
      evidence: passing(targetOf(idA3, tenantA, 3)),
    });
    const green = await t.query(internal.skills.inspectTenantSkill, { candidateId: idA3 });
    expect(green.candidate.evidenceState).toBe("passing");
    expect(green.candidate.gatePassed).toBe(true);
  });

  test("myUserSkills.gatePassed reflects EXACT tenant evidence (and not the global predicate)", async () => {
    const { t, idA, asA, tenantA, version } = await collision();
    expect((await asA.query(api.skills.myUserSkills, {}))[0]?.gatePassed).toBe(false);

    await t.mutation(internal.skills.recordTenantEvalEvidence, {
      candidateId: idA,
      evidence: passing(targetOf(idA, tenantA, version)),
    });
    // Before the 21-03 fix this stayed FALSE forever: a tenant-only run's `skillVersions` is `{}`,
    // so the global predicate could never see a pin, and the panel's "Evaluation passed" state was
    // unreachable in production.
    expect((await asA.query(api.skills.myUserSkills, {}))[0]?.gatePassed).toBe(true);
    // …and evidence naming a DIFFERENT row on this row does not flip it.
    await t.run((ctx) =>
      ctx.db.patch(idA, {
        evidence: passing({ ...targetOf(idA, tenantA, version), candidateId: "not-this-row" }),
      }),
    );
    expect((await asA.query(api.skills.myUserSkills, {}))[0]?.gatePassed).toBe(false);
  });
});
