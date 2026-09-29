import {
  hasPassingWebRecipeEvidence,
  isWebRecipeSkill,
  WEB_RECIPE_EVAL_CASE_IDS,
  WEB_RECIPE_EVAL_FIXTURE_HASH,
  WEB_RECIPE_EVAL_RUNNER,
  WEB_RECIPE_EVAL_SUITE,
  WEB_RECIPE_UPSTREAM_PROVENANCE,
  type WebRecipeSkillName,
  webRecipeFamilyForSkill,
} from "@pikar/contracts/skill";
import {
  assertDesignProfileSources,
  canonicalWebDocument,
  canonicalWebRecipeDefinition,
  designKnowledgeBundle,
  hashWebRecipeDefinition,
  materializeWebRecipe,
  materializeWebRecipeWithProvenance,
  parseDesignKnowledgeBundle,
  parseWebRecipeDefinition,
  renderDesignedWebDocument,
  renderWebDocument,
  sha256Bytes,
  verifiedDesignKnowledgeBundle,
  WEB_RECIPE_FIXTURE_CASES_PER_FAMILY,
  WEB_RECIPE_FIXTURE_CORPUS,
  webRecipeFixtureContentHash,
  webRecipeFixturesFor,
} from "@pikar/core";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/** Inputs live in the core corpus; this adapter never writes them to registry evidence. */
export const WEB_RECIPE_CASE_IDS = Object.freeze(WEB_RECIPE_FIXTURE_CORPUS.map((item) => item.id));

export type WebRecipeCandidateRow = Pick<Doc<"skills">, "_id" | "name" | "version" | "body">;

type EvalRefs = {
  runner: typeof WEB_RECIPE_EVAL_RUNNER;
  runId: string;
  pass: true;
  casesPassed: number;
  casesTotal: number;
  retriedCases: readonly string[];
  costUsd: 0;
  model: "none";
  skillId: string;
  name: WebRecipeSkillName;
  version: number;
  bodyHash: string;
  definitionHash: string;
  skillVersions: Record<string, number>;
  suite: Pick<
    typeof WEB_RECIPE_EVAL_SUITE,
    "revision" | "casesHash" | "caseCount" | "corpusCaseCount"
  >;
  familyCoverage: readonly string[];
  filtered: false;
  skipped: 0;
  outcomes: Readonly<Record<string, number>>;
  ts: number;
};

function assertSourceCoverage(definition: ReturnType<typeof parseWebRecipeDefinition>): void {
  const bundle = parseDesignKnowledgeBundle(designKnowledgeBundle);
  const roles = new Set(bundle.records.map((record) => record.sourceRole));
  for (const source of WEB_RECIPE_UPSTREAM_PROVENANCE["web-recipe-business-site"]) {
    if (!roles.has(source.repository))
      throw new Error(`WEB_RECIPE_SOURCE_ROLE_MISSING:${source.repository}`);
    if (source.hashes.some((hash) => hash.length === 0))
      throw new Error(`WEB_RECIPE_SOURCE_HASH_MISSING:${source.repository}`);
  }
  if (bundle.bundleHash !== definition.bundleHash) throw new Error("WEB_RECIPE_BUNDLE_ID_MISMATCH");
}

function assertSourceInfluence(family: string): void {
  const id = family as "business-site" | "campaign-landing" | "storefront-catalogue";
  const positive = webRecipeFixturesFor(id).find((item) => item.kind === "positive");
  if (!positive?.input) throw new Error("WEB_RECIPE_SOURCE_FIXTURE_MISSING");
  const output = materializeWebRecipeWithProvenance(id, positive.input);
  const designed = renderDesignedWebDocument(output.document, output.designProfile);
  const plain = renderWebDocument(output.document);
  if (designed === plain) throw new Error("WEB_RECIPE_SOURCE_HAS_NO_RENDERED_INFLUENCE");
  assertDesignProfileSources(output.designProfile);
  const css = styleFrom(designed);
  // Each reviewed role reaches a concrete presentation decision: UI/UX pattern, type and form,
  // Nexscope palette, and Taste dials. A constant style tag cannot satisfy these values.
  assertStyle(
    css,
    /h1\{text-align:([^;]+);/,
    id === "campaign-landing" ? "center" : "left",
    "pattern",
  );
  assertStyle(css, /border-radius:(\d+)px\}/, "12", "style");
  assertStyle(css, /font:400 1rem\/1\.6 ([^;]+);/, "system-ui,sans-serif", "typography");
  assertStyle(css, /min-height:(\d+)px\}/, "44", "form");
  assertStyle(css, /--teal:([^;]+);/, "#0b4f4a", "palette");
  assertStyle(
    css,
    /--space:(\d+)px;/,
    String(12 + output.designProfile.dials.density * 2),
    "density",
  );
  assertStyle(
    css,
    /--measure:(\d+)ch/,
    String(72 - output.designProfile.dials.variance),
    "variance",
  );
  assertStyle(
    css,
    /transition:transform (\d+)ms ease/,
    String(output.designProfile.dials.motion <= 2 ? 0 : output.designProfile.dials.motion * 12),
    "motion",
  );
}

function styleFrom(html: string): string {
  const match = html.match(/<style>([\s\S]*?)<\/style>/g);
  if (match?.length !== 1) throw new Error("WEB_RECIPE_STYLE_OUTPUT_INVALID");
  return match[0];
}

function assertStyle(css: string, expression: RegExp, expected: string, role: string): void {
  if (css.match(expression)?.[1] !== expected)
    throw new Error(`WEB_RECIPE_SOURCE_ROLE_HAS_NO_INFLUENCE:${role}`);
}

function assertDesignDial(family: string): void {
  const id =
    family === "business-site"
      ? "business-site"
      : family === "campaign-landing"
        ? "campaign-landing"
        : "storefront-catalogue";
  const baseFixture = webRecipeFixturesFor(family as never).find(
    (item) => item.kind === "positive",
  );
  const dialFixture = webRecipeFixturesFor(family as never).find(
    (item) => item.kind === "design-dial",
  );
  if (!baseFixture?.input || !dialFixture?.input)
    throw new Error("WEB_RECIPE_DIAL_FIXTURE_MISSING");
  const base = materializeWebRecipeWithProvenance(id, baseFixture.input);
  const expected = (dialFixture.input as { design?: Record<string, number> }).design;
  if (!expected) throw new Error("WEB_RECIPE_DIAL_FIXTURE_MISSING");
  const original = baseFixture.input as Record<string, unknown>;
  const baseHtml = renderDesignedWebDocument(base.document, base.designProfile);
  const baseStyle = styleFrom(baseHtml);
  const readings = {
    variance: (css: string) => css.match(/--measure:(\d+)ch/)?.[1],
    motion: (css: string) => css.match(/transition:transform (\d+)ms ease/)?.[1],
    density: (css: string) => css.match(/--space:(\d+)px;/)?.[1],
  };
  for (const key of ["variance", "motion", "density"] as const) {
    const value = expected[key];
    if (value === undefined || value === base.designProfile.dials[key])
      throw new Error(`WEB_RECIPE_DIAL_FIXTURE_NOT_DISTINCT:${key}`);
    const dialled = materializeWebRecipeWithProvenance(id, {
      ...original,
      design: { [key]: value },
    });
    if (canonicalWebDocument(base.document) !== canonicalWebDocument(dialled.document))
      throw new Error(`WEB_RECIPE_DIAL_CHANGED_DOCUMENT_IDENTITY:${key}`);
    const dialStyle = styleFrom(renderDesignedWebDocument(dialled.document, dialled.designProfile));
    if (readings[key](baseStyle) === readings[key](dialStyle))
      throw new Error(`WEB_RECIPE_DIAL_DID_NOT_CHANGE_RENDERED_STYLE:${key}`);
    if (key === "variance") assertStyle(dialStyle, /--measure:(\d+)ch/, String(72 - value), key);
    if (key === "density") assertStyle(dialStyle, /--space:(\d+)px;/, String(12 + value * 2), key);
    if (key === "motion")
      assertStyle(dialStyle, /transition:transform (\d+)ms ease/, String(value * 12), key);
  }
  // The canonical document contains the route, form, consent, attribution and analytics nodes;
  // equality above therefore proves those identities stayed fixed while only the profile dialled.
}

function assertRepeat(family: string): void {
  const id =
    family === "business-site"
      ? "business-site"
      : family === "campaign-landing"
        ? "campaign-landing"
        : "storefront-catalogue";
  const positive = webRecipeFixturesFor(family as never).find((item) => item.kind === "positive");
  if (!positive?.input) throw new Error("WEB_RECIPE_REPEAT_FIXTURE_MISSING");
  const first = materializeWebRecipeWithProvenance(id, positive.input);
  const second = materializeWebRecipeWithProvenance(id, positive.input);
  if (
    canonicalWebDocument(first.document) !== canonicalWebDocument(second.document) ||
    JSON.stringify(first.designProfile) !== JSON.stringify(second.designProfile) ||
    first.inputHash !== second.inputHash
  )
    throw new Error("WEB_RECIPE_REPEAT_NOT_DETERMINISTIC");
}

function assertFormPreservation(
  kind: string,
  family: string,
  document: ReturnType<typeof materializeWebRecipe>,
): void {
  const id = family as "business-site" | "campaign-landing" | "storefront-catalogue";
  const positive = webRecipeFixturesFor(id).find((item) => item.kind === "positive");
  const partial = webRecipeFixturesFor(id).find((item) => item.kind === "partial");
  if (!positive?.input || !partial?.input) throw new Error("WEB_RECIPE_FORM_FIXTURE_MISSING");
  const expected = positive.input as Record<string, unknown>;
  const forms = document.pages.flatMap((page) => page.nodes.filter((node) => node.kind === "form"));
  const partialDocument = materializeWebRecipe(id, partial.input);
  const partialForms = partialDocument.pages.flatMap((page) =>
    page.nodes.filter((node) => node.kind === "form"),
  );
  if (partialForms.length !== 0) throw new Error("WEB_RECIPE_PARTIAL_FORM_UNEXPECTED");
  if (family === "storefront-catalogue") {
    if (forms.length !== 0) throw new Error("WEB_RECIPE_STOREFRONT_FORM_UNEXPECTED");
    return;
  }
  if (forms.length !== 1) throw new Error("WEB_RECIPE_FORM_MISSING");
  const form = forms[0]!;
  const consent = family === "business-site" ? expected.contactConsent : expected.formConsent;
  if (
    form.kind !== "form" ||
    form.consent !== consent ||
    !renderDesignedWebDocument(
      document,
      materializeWebRecipeWithProvenance(id, positive.input).designProfile,
    ).includes(String(consent))
  )
    throw new Error("WEB_RECIPE_CONSENT_CHANGED");
  if (family === "campaign-landing") {
    if (form.attribution?.source !== expected.attributionSource)
      throw new Error("WEB_RECIPE_ATTRIBUTION_CHANGED");
    const cta = document.pages.flatMap((page) => page.nodes).find((node) => node.kind === "cta");
    if (
      cta?.kind !== "cta" ||
      cta.analytics !== true ||
      cta.target.kind !== "local" ||
      cta.target.path !== expected.ctaPath
    )
      throw new Error("WEB_RECIPE_ANALYTICS_CHANGED");
  } else if (kind === "attribution" && form.attribution !== undefined) {
    throw new Error("WEB_RECIPE_ATTRIBUTION_UNEXPECTED");
  }
}

function assertIdentityMutation(
  kind: string,
  row: WebRecipeCandidateRow,
  definition: ReturnType<typeof parseWebRecipeDefinition>,
  family: string,
): void {
  if (kind === "source-removal") {
    const positive = webRecipeFixturesFor(family as never).find((item) => item.kind === "positive");
    if (!positive?.input) throw new Error("WEB_RECIPE_SOURCE_FIXTURE_MISSING");
    const output = materializeWebRecipeWithProvenance(definition.id, positive.input);
    parseDesignKnowledgeBundle(designKnowledgeBundle);
    renderDesignedWebDocument(output.document, output.designProfile);
    for (const role of ["ui-ux-pro-max", "taste-skill", "nexscope-ecommerce"] as const) {
      const roleIds = new Set(
        verifiedDesignKnowledgeBundle.records
          .filter((record) => record.sourceRole === role)
          .map((record) => record.id),
      );
      const changed = {
        ...designKnowledgeBundle,
        records: designKnowledgeBundle.records.filter((record) => !roleIds.has(record.id)),
      };
      let rejected = false;
      try {
        parseDesignKnowledgeBundle(changed);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("DESIGN_KNOWLEDGE_"))
          throw error;
        rejected = true;
      }
      if (!rejected) throw new Error(`WEB_RECIPE_SOURCE_REMOVAL_ACCEPTED:${role}`);
    }
    return;
  }
  const target = {
    skillId: String(row._id),
    name: row.name as WebRecipeSkillName,
    version: row.version,
    bodyHash: sha256Bytes(new TextEncoder().encode(row.body)),
    definitionHash: hashWebRecipeDefinition(definition),
  };
  const outcomes = Object.fromEntries(
    webRecipeFixturesFor(family as never).map((fixture) => [fixture.kind, 1]),
  );
  const valid = {
    runner: WEB_RECIPE_EVAL_RUNNER,
    runId: "identity-probe",
    pass: true,
    casesPassed: WEB_RECIPE_FIXTURE_CASES_PER_FAMILY,
    casesTotal: WEB_RECIPE_FIXTURE_CASES_PER_FAMILY,
    retriedCases: [],
    costUsd: 0,
    model: "none",
    skillId: target.skillId,
    name: target.name,
    version: target.version,
    bodyHash: target.bodyHash,
    definitionHash: target.definitionHash,
    skillVersions: { [target.name]: target.version },
    suite: {
      revision: WEB_RECIPE_EVAL_SUITE.revision,
      casesHash: WEB_RECIPE_EVAL_SUITE.casesHash,
      caseCount: WEB_RECIPE_EVAL_SUITE.caseCount,
      corpusCaseCount: WEB_RECIPE_EVAL_SUITE.corpusCaseCount,
    },
    familyCoverage: [family],
    filtered: false,
    skipped: 0,
    outcomes,
    ts: 1,
  };
  const mutated = structuredClone(valid) as typeof valid;
  if (!hasPassingWebRecipeEvidence(JSON.stringify(valid), target))
    throw new Error("WEB_RECIPE_IDENTITY_POSITIVE_CONTROL_FAILED");
  if (kind === "changed-version") mutated.version += 1;
  if (kind === "changed-body") mutated.bodyHash = `${mutated.bodyHash}-changed`;
  if (kind === "changed-bundle") {
    const changed = { ...definition, bundleHash: `${definition.bundleHash}-changed` };
    let rejected = false;
    try {
      parseWebRecipeDefinition(changed);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("WEB_RECIPE_DEFINITION_INVALID"))
        throw error;
      rejected = true;
    }
    if (!rejected) throw new Error("WEB_RECIPE_CHANGED_BUNDLE_ACCEPTED");
    parseDesignKnowledgeBundle(designKnowledgeBundle);
    const first = designKnowledgeBundle.records[0];
    if (!first) throw new Error("WEB_RECIPE_RAW_BUNDLE_EMPTY");
    for (const data of [
      { ...first.data, label: `${first.data.label}-mutated` },
      { ...first.data, unsupported: true },
    ]) {
      const rawChanged = {
        ...designKnowledgeBundle,
        records: [{ ...first, data }, ...designKnowledgeBundle.records.slice(1)],
      };
      rejected = false;
      try {
        parseDesignKnowledgeBundle(rawChanged);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("DESIGN_KNOWLEDGE_"))
          throw error;
        rejected = true;
      }
      if (!rejected) throw new Error("WEB_RECIPE_RAW_BUNDLE_TAMPER_ACCEPTED");
    }
    return;
  }
  if (hasPassingWebRecipeEvidence(JSON.stringify(mutated), target))
    throw new Error(`WEB_RECIPE_${kind.toUpperCase()}_ACCEPTED`);
}

/** Evaluate the exact bytes from one candidate row. Constants beside the row are never consulted. */
export function evaluateWebRecipeCandidate(
  row: WebRecipeCandidateRow,
  runId = "web-recipe-deterministic-local",
  now = Date.now(),
): EvalRefs {
  if (!isWebRecipeSkill(row.name)) throw new Error("WEB_RECIPE_NAME_INVALID");
  const definition = parseWebRecipeDefinition(JSON.parse(row.body));
  if (definition.registryName !== row.name || canonicalWebRecipeDefinition(definition) !== row.body)
    throw new Error("WEB_RECIPE_ROW_BODY_NOT_CANONICAL");
  const outcomes: Record<string, number> = {};
  let casesPassed = 0;
  const targetFamily = webRecipeFamilyForSkill(row.name);
  const familyCases = webRecipeFixturesFor(targetFamily as never);
  if (
    WEB_RECIPE_CASE_IDS.length !== WEB_RECIPE_EVAL_SUITE.corpusCaseCount ||
    WEB_RECIPE_CASE_IDS.join("\n") !== WEB_RECIPE_EVAL_CASE_IDS.join("\n") ||
    webRecipeFixtureContentHash() !== WEB_RECIPE_EVAL_FIXTURE_HASH
  )
    throw new Error("WEB_RECIPE_CASE_IDENTITY_MISMATCH");
  for (const current of familyCases) {
    const { kind, id } = current;
    if (kind === "source-coverage") assertSourceCoverage(definition);
    if (kind === "source-influence") {
      assertSourceCoverage(definition);
      assertSourceInfluence(targetFamily);
    }
    if (current.expected === "identity") {
      if (kind === "source-removal") assertSourceInfluence(targetFamily);
      assertIdentityMutation(kind, row, definition, targetFamily);
    }
    if (kind === "design-dial") assertDesignDial(targetFamily);
    if (kind === "repeat") assertRepeat(targetFamily);
    if (current.expected !== "identity") {
      const inputs = current.inputs ?? [current.input];
      for (const input of inputs) {
        const other = targetFamily === "business-site" ? "campaign-landing" : "business-site";
        if (current.expected === "reject") {
          let refused = false;
          try {
            materializeWebRecipe(kind === "cross-family" ? other : definition.id, input);
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !/^WEB_RECIPE_(?:INPUT|DOCUMENT)_INVALID:/.test(error.message)
            )
              throw error;
            refused = true;
          }
          if (!refused) throw new Error(`WEB_RECIPE_UNEXPECTED_ACCEPTANCE:${id}`);
        } else {
          const output = materializeWebRecipeWithProvenance(definition.id, input);
          renderDesignedWebDocument(output.document, output.designProfile);
          if (kind === "consent" || kind === "attribution")
            assertFormPreservation(kind, targetFamily, output.document);
        }
      }
    }
    outcomes[kind] = (outcomes[kind] ?? 0) + 1;
    casesPassed += 1;
  }
  if (casesPassed !== WEB_RECIPE_FIXTURE_CASES_PER_FAMILY)
    throw new Error("WEB_RECIPE_INCOMPLETE_SUITE");
  return {
    runner: WEB_RECIPE_EVAL_RUNNER,
    runId,
    pass: true,
    casesPassed,
    casesTotal: familyCases.length,
    retriedCases: [],
    costUsd: 0,
    model: "none",
    skillId: String(row._id),
    name: row.name,
    version: row.version,
    bodyHash: sha256Bytes(new TextEncoder().encode(row.body)),
    definitionHash: hashWebRecipeDefinition(definition),
    skillVersions: { [row.name]: row.version },
    suite: {
      revision: WEB_RECIPE_EVAL_SUITE.revision,
      casesHash: WEB_RECIPE_EVAL_SUITE.casesHash,
      caseCount: WEB_RECIPE_EVAL_SUITE.caseCount,
      corpusCaseCount: WEB_RECIPE_EVAL_SUITE.corpusCaseCount,
    },
    familyCoverage: [targetFamily],
    filtered: false,
    skipped: 0,
    outcomes,
    ts: now,
  };
}

export function webRecipeEvidencePasses(evidence: string, row: WebRecipeCandidateRow): boolean {
  const refs = evaluateWebRecipeCandidate(row, "self-check", 1);
  return hasPassingWebRecipeEvidence(evidence, {
    skillId: String(row._id),
    name: row.name as WebRecipeSkillName,
    version: row.version,
    bodyHash: refs.bodyHash,
    definitionHash: refs.definitionHash,
  });
}

/** Internal zero-cost issuer: loads and parses the exact stored row body before patching evidence. */
export const evaluateAndRecordWebRecipe = internalMutation({
  args: { name: v.string(), version: v.number(), runId: v.string() },
  handler: async (ctx, { name, version, runId }) => {
    const row = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();
    if (row === null) throw new Error("NO_SUCH_SKILL_VERSION");
    if (!isWebRecipeSkill(name)) throw new Error("WEB_RECIPE_NAME_INVALID");
    const evidence = evaluateWebRecipeCandidate(row, runId);
    await ctx.db.patch(row._id, { evidence: JSON.stringify(evidence) });
    return { name, version, skillId: String(row._id), cases: evidence.casesTotal, costUsd: 0 };
  },
});

export const webRecipeEvalCaseCount = WEB_RECIPE_FIXTURE_CORPUS.length;
