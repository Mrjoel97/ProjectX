// @vitest-environment node

import * as skillContract from "@pikar/contracts/skill";
import {
  WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
  WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
  WEB_RECIPE_BROWSER_ROUTE,
  WEB_RECIPE_BROWSER_RUNNER,
  WEB_RECIPE_REQUIRED_VIEWPORTS,
} from "@pikar/contracts/skill";
import * as core from "@pikar/core";
import {
  canonicalWebRecipeDefinition,
  hashWebRecipeDefinition,
  sha256Bytes,
  WEB_RECIPE_BUNDLE_HASH,
  WEB_RECIPE_DEFINITIONS,
} from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { evaluateWebRecipeCandidate, webRecipeEvalCaseCount } from "./webRecipeEvals";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

function browserEvidenceFor(
  row: { _id: string; name: string; version: number; body: string },
  runId = "web-recipe-browser-local",
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    runner: WEB_RECIPE_BROWSER_RUNNER,
    runId,
    pass: true,
    authenticated: true,
    actorClass: "owner",
    route: WEB_RECIPE_BROWSER_ROUTE,
    rendered: true,
    skillId: String(row._id),
    name: row.name,
    version: row.version,
    bodyHash: sha256Bytes(new TextEncoder().encode(row.body)),
    definitionHash: hashWebRecipeDefinition(JSON.parse(row.body)),
    bundleHash: WEB_RECIPE_BUNDLE_HASH,
    evidenceRevision: WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
    viewports: WEB_RECIPE_REQUIRED_VIEWPORTS,
    casesPassed: 20,
    casesTotal: 20,
    revision: 1,
    transcriptHash: "a".repeat(64),
    outcomeRefs: WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
    ts: 1,
    ...extra,
  });
}

describe("web recipe deterministic evaluator", () => {
  const probeRow = () => {
    const definition = WEB_RECIPE_DEFINITIONS[0]!;
    return {
      _id: "probe" as never,
      name: definition.registryName,
      version: 1,
      body: canonicalWebRecipeDefinition(definition),
    };
  };

  test("raw source-role removal cannot be certified if the bundle verifier is bypassed", () => {
    const original = core.parseDesignKnowledgeBundle;
    const spy = vi.spyOn(core, "parseDesignKnowledgeBundle").mockImplementation((input) => {
      if (
        input &&
        typeof input === "object" &&
        "records" in input &&
        Array.isArray(input.records) &&
        input.records.length < 8
      )
        return core.verifiedDesignKnowledgeBundle;
      return original(input);
    });
    try {
      expect(() => evaluateWebRecipeCandidate(probeRow(), "probe", 1)).toThrow(
        /WEB_RECIPE_SOURCE_REMOVAL_ACCEPTED/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("ignoring any Taste dial fails actual rendered-style qualification", () => {
    const original = core.renderDesignedWebDocument;
    const base = core.materializeWebRecipeWithProvenance("business-site", {
      brandName: "Acme Studio",
      headline: "A clear business site",
    });
    for (const key of ["variance", "motion", "density"] as const) {
      const spy = vi
        .spyOn(core, "renderDesignedWebDocument")
        .mockImplementation((document, profile, route) =>
          original(
            document,
            { ...profile, dials: { ...profile.dials, [key]: base.designProfile.dials[key] } },
            route,
          ),
        );
      try {
        expect(() => evaluateWebRecipeCandidate(probeRow(), "probe", 1)).toThrow(
          new RegExp(`WEB_RECIPE_DIAL_DID_NOT_CHANGE_RENDERED_STYLE:${key}`),
        );
      } finally {
        spy.mockRestore();
      }
    }
  });

  test("ignoring each compiled role's pattern, palette or form style fails", () => {
    const original = core.renderDesignedWebDocument;
    for (const [before, after, expected] of [
      ["h1{text-align:left", "h1{text-align:center", "pattern"],
      ["--teal:#0b4f4a", "--teal:#0e1419", "palette"],
      ["min-height:44px", "min-height:40px", "form"],
    ] as const) {
      const spy = vi
        .spyOn(core, "renderDesignedWebDocument")
        .mockImplementation((document, profile, route) =>
          original(document, profile, route).replace(before, after),
        );
      try {
        expect(() => evaluateWebRecipeCandidate(probeRow(), "probe", 1)).toThrow(
          new RegExp(`WEB_RECIPE_SOURCE_ROLE_HAS_NO_INFLUENCE:${expected}`),
        );
      } finally {
        spy.mockRestore();
      }
    }
  });

  test("an early rejected injection cannot hide a later accepted injection", () => {
    const definition = WEB_RECIPE_DEFINITIONS[0]!;
    const original = core.materializeWebRecipe;
    const row = {
      _id: "probe" as never,
      name: definition.registryName,
      version: 1,
      body: canonicalWebRecipeDefinition(definition),
    };
    const accepted = original(definition.id, {
      brandName: "Acme Studio",
      headline: "A clear business site",
    });
    const spy = vi.spyOn(core, "materializeWebRecipe").mockImplementation((id, input) => {
      if (JSON.stringify(input).includes("<img src=x>")) return accepted;
      return original(id, input);
    });
    try {
      expect(() => evaluateWebRecipeCandidate(row, "probe", 1)).toThrow(
        /WEB_RECIPE_UNEXPECTED_ACCEPTANCE:business-site.injection/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("a predicate accepting changed identity cannot become an expected refusal", () => {
    const definition = WEB_RECIPE_DEFINITIONS[0]!;
    const row = {
      _id: "probe" as never,
      name: definition.registryName,
      version: 1,
      body: canonicalWebRecipeDefinition(definition),
    };
    const spy = vi.spyOn(skillContract, "hasPassingWebRecipeEvidence").mockReturnValue(true);
    try {
      expect(() => evaluateWebRecipeCandidate(row, "probe", 1)).toThrow(
        /WEB_RECIPE_CHANGED-VERSION_ACCEPTED/,
      );
    } finally {
      spy.mockRestore();
    }
  });
  test("evaluates every exact candidate body at zero cost with complete family coverage", async () => {
    const t = convexTest(schema, modules);
    const published = await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    expect(published).toHaveLength(3);
    for (const definition of WEB_RECIPE_DEFINITIONS) {
      const row = await t.run((ctx) =>
        ctx.db
          .query("skills")
          .withIndex("by_name_version", (q) =>
            q.eq("name", definition.registryName).eq("version", 1),
          )
          .unique(),
      );
      if (!row) throw new Error("candidate row missing");
      const refs = evaluateWebRecipeCandidate(row, "run-1", 1);
      expect(refs.pass).toBe(true);
      expect(refs.costUsd).toBe(0);
      expect(refs.casesTotal).toBe(webRecipeEvalCaseCount / 3);
      expect(refs.familyCoverage).toEqual([definition.id]);
      expect(refs.skillId).toBe(String(row._id));
      expect(row.body).toBe(canonicalWebRecipeDefinition(definition));
      await t.mutation(internal.skills.recordWebRecipeEvalEvidence, {
        name: row.name,
        version: row.version,
        evidence: JSON.stringify(refs),
      });
    }
  });

  test("issuer reads the exact stored row body and writes refs only", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    const result = await t.mutation(internal.skills.evaluateWebRecipe, {
      name: "web-recipe-business-site",
      version: 1,
      runId: "run-exact-row",
    });
    expect(result).toMatchObject({ name: "web-recipe-business-site", version: 1, costUsd: 0 });
    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) =>
          q.eq("name", "web-recipe-business-site").eq("version", 1),
        )
        .unique(),
    );
    const evidence = JSON.parse(row?.evidence ?? "null") as Record<string, unknown>;
    expect(evidence).toMatchObject({
      runner: "eval:web-recipe-deterministic",
      costUsd: 0,
      casesTotal: 20,
    });
    expect(evidence).not.toHaveProperty("fixtures");
    expect(JSON.stringify(evidence)).not.toContain("Acme Studio");
  });

  test("mutation that substitutes a code-side body cannot certify the row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) =>
          q.eq("name", "web-recipe-business-site").eq("version", 1),
        )
        .unique();
      if (!row) throw new Error("candidate row missing");
      await ctx.db.patch(row._id, { body: `${row.body} ` });
    });
    await expect(
      t.mutation(internal.skills.evaluateWebRecipe, {
        name: "web-recipe-business-site",
        version: 1,
        runId: "run-substitution",
      }),
    ).rejects.toThrow(/CANONICAL|INVALID/);
  });

  test("browser evidence is exact-row and multi-viewport only", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) =>
          q.eq("name", "web-recipe-business-site").eq("version", 1),
        )
        .unique(),
    );
    if (!row) throw new Error("candidate row missing");
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const owner = t.withIdentity({ subject: `${ownerId}|session` });
    const run = await owner.mutation(api.skills.beginWebRecipeBrowserQualification, {
      candidateId: row._id,
    });
    let revision = run.revision;
    const previewRef = (api as unknown as { webRecipes: Record<string, unknown> }).webRecipes
      .previewWebRecipeCandidate;
    const preview = async (viewport: "desktop" | "mobile", values: Record<string, unknown>) => {
      const result = await (
        owner.mutation as unknown as (
          fn: unknown,
          args: unknown,
        ) => Promise<{ revision: number; kind: string }>
      )(previewRef, {
        candidateId: row._id,
        runId: run.runId,
        revision,
        viewport,
        values,
      });
      revision = result.revision;
      return result;
    };
    const partial = { brandName: "Phase 49", headline: "Partial" };
    const recovery = { ...partial, summary: "Recovered" };
    const edit = { ...recovery, headline: "Edited" };
    for (const viewport of WEB_RECIPE_REQUIRED_VIEWPORTS) {
      revision = (
        await owner.mutation(api.skills.advanceWebRecipeBrowserQualification, {
          candidateId: row._id,
          runId: run.runId,
          revision,
          viewport,
        })
      ).revision;
      expect((await preview(viewport, partial)).kind).toBe("rendered");
      expect(
        (await preview(viewport, { ...partial, brandName: "<script>refused</script>" })).kind,
      ).toBe("refusal");
      expect((await preview(viewport, recovery)).kind).toBe("rendered");
      expect((await preview(viewport, edit)).kind).toBe("rendered");
      expect((await preview(viewport, edit)).kind).toBe("rendered");
    }
    await expect(
      t.mutation(internal.skills.recordWebRecipeBrowserEvidence, {
        name: row.name,
        version: row.version,
        browserEvidence: browserEvidenceFor(row, run.runId),
      }),
    ).rejects.toThrow(/EVIDENCE_INVALID|TRANSCRIPT_INVALID/);
    const frozen = await owner.mutation(api.skills.finalizeWebRecipeBrowserQualification, {
      candidateId: row._id,
      runId: run.runId,
      revision,
    });
    const evidence = browserEvidenceFor(row, run.runId, {
      revision,
      transcriptHash: frozen.transcriptHash,
    });
    const parsed = JSON.parse(evidence) as Record<string, unknown>;
    expect(parsed).toMatchObject({ authenticated: true, viewports: ["desktop", "mobile"] });
    await t.mutation(internal.skills.recordWebRecipeBrowserEvidence, {
      name: "web-recipe-business-site",
      version: 1,
      browserEvidence: evidence,
    });
    const legacy = JSON.parse(evidence) as Record<string, unknown>;
    delete legacy.transcriptHash;
    await expect(
      t.mutation(internal.skills.recordWebRecipeBrowserEvidence, {
        name: row.name,
        version: row.version,
        browserEvidence: JSON.stringify(legacy),
      }),
    ).rejects.toThrow(/EVIDENCE_INVALID/);
    await expect(
      t.mutation(internal.skills.recordWebRecipeBrowserEvidence, {
        name: "web-recipe-business-site",
        version: 1,
        browserEvidence: evidence.replace('"version":1', '"version":2'),
      }),
    ).rejects.toThrow(/EVIDENCE_INVALID/);
    for (const [field, value] of [
      ["actorClass", "tenant"],
      ["route", "/dashboard/sites"],
      ["revision", 0],
      ["rawContent", "fixture bytes"],
    ] as const) {
      await expect(
        t.mutation(internal.skills.recordWebRecipeBrowserEvidence, {
          name: row.name,
          version: row.version,
          browserEvidence: browserEvidenceFor(row, `invalid-${field}`, { [field]: value }),
        }),
      ).rejects.toThrow(/EVIDENCE_INVALID/);
    }
  });

  test("closed evidence rejects payload-shaped and unknown keys without patching", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) =>
          q.eq("name", "web-recipe-business-site").eq("version", 1),
        )
        .unique(),
    );
    if (!row) throw new Error("candidate row missing");
    const refs = evaluateWebRecipeCandidate(row, "run-closed", 1);
    await expect(
      t.mutation(internal.skills.recordWebRecipeEvalEvidence, {
        name: row.name,
        version: row.version,
        evidence: JSON.stringify({
          ...refs,
          familyCoverage: ["business-site", "campaign-landing", "storefront-catalogue"],
        }),
      }),
    ).rejects.toThrow(/EVIDENCE_INVALID/);
    for (const field of ["fixtures", "rawContent", "prompt", "unknown"]) {
      await expect(
        t.mutation(internal.skills.recordWebRecipeEvalEvidence, {
          name: row.name,
          version: row.version,
          evidence: JSON.stringify({ ...refs, [field]: field === "fixtures" ? [] : "payload" }),
        }),
      ).rejects.toThrow(/EVIDENCE_INVALID/);
    }
    expect(await t.run((ctx) => ctx.db.get(row._id))).not.toHaveProperty("evidence");
    for (const field of ["fixtures", "rawContent", "prompt", "unknown"]) {
      await expect(
        t.mutation(internal.skills.recordWebRecipeBrowserEvidence, {
          name: row.name,
          version: row.version,
          browserEvidence: browserEvidenceFor(row, "closed", { [field]: "payload" }),
        }),
      ).rejects.toThrow(/EVIDENCE_INVALID/);
    }
    expect(await t.run((ctx) => ctx.db.get(row._id))).not.toHaveProperty("browserEvidence");
  });
});
