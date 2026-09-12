// The knowledge-vault graph extractor (VALT-02) and document classifier (VALT-12).
//
// DEFAULT-runtime (V8) module — NO `"use node"` directive (Pitfall 3): llm.ts is the ONE node
// module, and a second re-triggers the TS `internal`-graph circular-inference cliff (02-06).
// `generateObject` runs fine in V8 (the AI SDK uses fetch). To stay clear of the inference cliff
// the handlers carry explicit `Promise<...>` return types (the 02-06/§96 mitigation), NEVER a
// node switch.
//
// REDACT-THEN-EXTRACT (§4): the doc text is scanned (pii.scanText, FAIL-CLOSED) BEFORE the model
// call. The returned payload carries typed entity names + relationship labels ONLY — never raw
// document text; raw text lives only in `vaultDocuments.text` + rag chunks.
//
// The extractor prompt loads from the skill registry (`graph-extractor`, §5) — never hardcoded,
// fails closed when unseeded. A `SMOKE::graph::` sentinel returns a deterministic fixture with
// NO model call (the offline convex-test / smoke path — Pitfall 4).
//
// `classifyDoc` (15.3-08) is the same shape one rung cheaper, with ONE deliberate asymmetry: it
// swallows its own failures instead of throwing. See its handler for why.

import { DOCUMENT_CLASSIFIER_SKILL, GRAPH_EXTRACTOR_SKILL } from "@pikar/contracts/skill";
import { DOC_TYPES, type DocType, isDocType } from "@pikar/core";
import { DEFAULT_MODEL, priceUsage } from "@pikar/cost";
import { EVAL_MAX_OUTPUT_TOKENS } from "@pikar/cost/evalBudget";
import { scanText } from "@pikar/pii";
// The `/constants` SUBPATH, not the barrel: the barrel re-exports the extractors, which pull xlsx
// and fflate into this module's graph for two head-slice helpers.
import { capClassifyText, capGraphText } from "@pikar/vault/constants";
import { generateObject, jsonSchema } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { evalBudgetModel } from "./lib/evalBudgetModel";
import { fixtureSeamFor, resolveModel } from "./lib/models";

// Per-call wall-clock ceiling (mirrors llm.ts). One retry budget: SDK maxRetries:1.
const CALL_TIMEOUT_MS = 45_000;

// Extractor output contract (RESEARCH Code Example): typed entities + relationships + call cost.
// `nodes[].name`/`edges` are surface forms/labels — NEVER raw document text (§4).
type GraphNode = { type: string; name: string };
type GraphEdge = { from: string; to: string; rel: string };
type ExtractedGraph = { nodes: GraphNode[]; edges: GraphEdge[]; costUsd: number };

// The structured-output schema handed to generateObject. Edge endpoints reference emitted node
// names (the graph-extractor skill's extract-only-never-invent contract).
const graphSchema = jsonSchema<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
  type: "object",
  additionalProperties: false,
  required: ["nodes", "edges"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "name"],
        properties: { type: { type: "string" }, name: { type: "string" } },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "rel"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          rel: { type: "string" },
        },
      },
    },
  },
});

// ── Offline SMOKE seam (Pitfall 4) ───────────────────────────────────────────
// A dev-deployment smoke / convex-test must drive the extractor deterministically and offline
// (no OPENAI_API_KEY on the local backend). The sentinel contains no PII, so it survives scanText
// verbatim. Grammar (compact, mirrors llm.ts parseSmoke):
//   SMOKE::graph::<From>|<To>|<rel>[::<From>|<To>|<rel>...]
// Each segment yields two `other`-typed nodes (From, To) + one edge; repeated names dedupe here
// but the cross-doc dedup that matters is the upsert layer's job (vaultGraph.upsertGraph).
// ponytail: content sentinel, not an env flag — keeps the seam per-request and out of shared
// deployment config. Remove once a mock-model vault smoke exists.
const SMOKE_GRAPH_PREFIX = "SMOKE::graph::";

function smokeGraphFixture(safeText: string): ExtractedGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const addNode = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    nodes.push({ type: "other", name });
  };
  for (const seg of safeText.slice(SMOKE_GRAPH_PREFIX.length).split("::")) {
    const [from, to, rel] = seg.split("|");
    if (!from || !to || !rel) continue;
    addNode(from);
    addNode(to);
    edges.push({ from, to, rel });
  }
  return { nodes, edges, costUsd: 0 };
}

/**
 * Turn a vault document's redacted text into typed entities + relationships.
 *
 * V8 `internalAction` (NOT import-banned — §2/Pitfall 6). Loads the `graph-extractor` prompt from
 * the registry (fails closed unseeded, §5), reads the doc text, redacts it (fail-closed, §4), and
 * either returns a deterministic SMOKE fixture (no model call) or runs `generateObject` against
 * DEFAULT_MODEL. The returned `{nodes, edges}` carry names/rels ONLY — no raw text (§4).
 */
export const extractGraph = internalAction({
  args: {
    vaultDocId: v.id("vaultDocuments"),
    tenantId: v.string(),
    evalBudgetId: v.optional(v.id("spendEvents")),
  },
  handler: async (ctx, { vaultDocId, tenantId, evalBudgetId }): Promise<ExtractedGraph> => {
    // Load the extractor prompt FIRST (no hardcoded prompt — §5); fails closed (throws
    // NO_ACTIVE_SKILL) when unseeded, so a hardcoded fallback can never sneak in.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: GRAPH_EXTRACTOR_SKILL },
    );

    // ponytail: minimal doc-text reader seam. Plan 04's ingest pipeline supplies the canonical
    // `internal.vault.getDoc`; until then extractGraph reads text via the local getDocText below.
    const text: string = await ctx.runQuery(internal.vaultLlm.getDocText, { vaultDocId, tenantId });

    // Redact BEFORE the model call (redact-then-extract, §4). Fail CLOSED on a scan error so raw
    // text can never reach the model or the returned payload.
    const scan = scanText(text);
    if (!scan.ok) throw new Error("vault: graph-extract scan failed");
    const safeText = scan.value.safeText;

    // Offline deterministic path (Pitfall 4): a SMOKE:: sentinel returns a fixed graph, NO model call.
    // Stays ABOVE the cap so the offline fixture path is unaffected by it.
    // 36-01 (ADR-035): the sentinel SELECTS the fixture; the operator fact decides WHETHER. A Drive
    // file a stranger shared in used to be able to write this tenant's graph by starting with it.
    if (!evalBudgetId && safeText.startsWith(SMOKE_GRAPH_PREFIX) && fixtureSeamFor(tenantId))
      return smokeGraphFixture(safeText);
    if (evalBudgetId && safeText.trim() === "") throw new Error("EVAL_SOURCE_MISSING");

    // REDACT-THEN-CAP, never cap-then-redact: the scan above must see the WHOLE document, or PII
    // living in the tail escapes both the scan and its audit counts. The cap only bounds what is
    // SENT (VAULT_EXTRACT_CHAR_CAP lets 400k chars be stored) — see GRAPH_EXTRACT_CHAR_CAP for the
    // head-slice ceiling and its upgrade path.
    let actualUsd = 0;
    const { object, usage } = await generateObject({
      model: evalBudgetId
        ? evalBudgetModel({
            ctx,
            tenantId,
            budgetId: evalBudgetId,
            model: resolveModel(DEFAULT_MODEL),
            modelId: DEFAULT_MODEL,
            mode: "golden",
            onCost: (cost) => {
              actualUsd += cost;
            },
          })
        : resolveModel(DEFAULT_MODEL),
      schema: graphSchema,
      system: skill.body,
      prompt: capGraphText(safeText),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      maxRetries: evalBudgetId ? 0 : 1,
      ...(evalBudgetId ? { maxOutputTokens: EVAL_MAX_OUTPUT_TOKENS } : {}),
    });
    const priced = priceUsage(DEFAULT_MODEL, usage);
    return {
      nodes: object.nodes,
      edges: object.edges,
      costUsd: evalBudgetId ? actualUsd : priced.ok ? priced.value : 0,
    };
  },
});

// ── The document classifier (VALT-12) ────────────────────────────────────────────────────────

/** The classifier's output. `docType` is the CLOSED union — a model string never reaches it
 *  unvalidated (see the coercion in the handler). `identityLine` is display prose ("2025 P&L"). */
type DocIdentity = { docType: DocType; identityLine: string; costUsd: number };

// Compile-time bind: the TABLE's `docType` literals and `@pikar/core`'s DOC_TYPES must agree. Both
// directions, so neither side can silently drift wider than the other — the `tenantProfile.ts:58-67`
// mechanism. `NonNullable<>` on both because the schema field is `v.optional(...)`: without it
// `undefined` joins the array type and the bind passes in one direction while failing in the other.
// This lives HERE rather than in `packages/core` because it needs the generated `Doc<>` type, and
// core must stay Convex-free (§1) — the plan's "beside the classify code".
type VaultDocRow = Doc<"vaultDocuments">;
const _docTypeToDoc: readonly NonNullable<VaultDocRow["docType"]>[] = DOC_TYPES;
const _docToDocType: readonly DocType[] = [] as NonNullable<VaultDocRow["docType"]>[];

/** The degraded answer. Returned whenever classification cannot be completed — an unseeded skill
 *  row, a scan failure, a model/network error, an empty document. It is a LABEL that says nothing,
 *  never a failure: `"unclassified"` is a real member of the union, and the grid falls back to the
 *  filename for it exactly as it does for a row that was never classified at all. */
const UNIDENTIFIED: DocIdentity = { docType: "unclassified", identityLine: "", costUsd: 0 };

// The structured-output schema. `docType` carries `enum: [...DOC_TYPES]` so the PROVIDER constrains
// the output rather than the prompt's prose alone — but the TS type is deliberately `string`, not
// `DocType`: the enum is a provider-side request, and this file's job is to not believe it.
const classifySchema = jsonSchema<{ docType: string; identityLine: string }>({
  type: "object",
  additionalProperties: false,
  required: ["docType", "identityLine"],
  properties: {
    docType: { type: "string", enum: [...DOC_TYPES] },
    identityLine: { type: "string" },
  },
});

// ── Offline SMOKE seam ───────────────────────────────────────────────────────
// Grammar: SMOKE::classify::<docType>|<identity line>
//
// ⚠ THE GATE IS THE BARE `SMOKE::`, NOT `SMOKE::classify::` — the `vaultRag.embedDoc` precedent,
// and it is load-bearing rather than tidy. Classification runs on EVERY document on EVERY ingest
// path, so every existing offline fixture (`SMOKE::graph::…`, and the folder digest's own text,
// which must start with `SMOKE::graph::` for the extractor) flows through here too. Gating on the
// classify prefix alone would drop all of them into a real `generateObject` call: green in
// convex-test with no API key, but real spend on the dev deployment, on exactly the path the seam
// exists to keep free. Any other `SMOKE::` document is simply UNIDENTIFIED, at zero cost.
const SMOKE_PREFIX = "SMOKE::";
const SMOKE_CLASSIFY_PREFIX = "SMOKE::classify::";

function smokeIdentityFixture(safeText: string): DocIdentity {
  // The DRIVEN segment is located ANYWHERE in the text (the `vaultDigest.ts:355` `.includes`
  // precedent), NOT at position 0 — and that is load-bearing, not tidy. `extractGraph`'s free path
  // is pinned to `SMOKE::graph::` at position 0, so a fixture that also had to start with
  // `SMOKE::classify::` could not exist: every offline document would silently read `unclassified`
  // and this whole grammar would be dead code on the only path that runs it (15.3-08 Task 6).
  const at = safeText.indexOf(SMOKE_CLASSIFY_PREFIX);
  if (at === -1) return UNIDENTIFIED;
  const line = safeText.slice(at + SMOKE_CLASSIFY_PREFIX.length).split("\n")[0] ?? "";
  const sep = line.indexOf("|");
  const type = sep === -1 ? line : line.slice(0, sep);
  return {
    // Coerced through the SAME guard as the model's answer — a fixture that names a type nobody
    // defined must not be the one path that writes an out-of-union value.
    docType: isDocType(type) ? type : "unclassified",
    identityLine: sep === -1 ? "" : line.slice(sep + 1).trim(),
    costUsd: 0,
  };
}

/**
 * Give one vault document a machine-derived type and a human-readable identity line.
 *
 * Same shape as `extractGraph` above — registry prompt first, tenant-scoped text read, fail-closed
 * redaction, offline sentinel above the cap — with ONE deliberate asymmetry:
 *
 * ⚠ **THIS ACTION NEVER THROWS.** Everywhere else `getActiveSkill` is fail-closed BY CONTRACT: an
 * unseeded registry must stop the work rather than let a hardcoded prompt sneak in. Here the same
 * throw would be a catastrophe of a different order. `step.runAction` retries three times and then
 * fails the run, and `onIngestComplete` marks a still-`processing` row `failed` — so one unseeded
 * skill row would fail EVERY ingest in the deployment, lose each document's embedding AND graph,
 * and (via `countTerminal`) inflate every folder's failure count in the manifest the digest
 * promises is honest. All of that for a COSMETIC LABEL. So the fallback here is a degraded LABEL,
 * never a degraded grounding corpus: any throw returns UNIDENTIFIED and ingest continues.
 *
 * ponytail: the failure is swallowed, not recorded — there is no `classificationFailed` flag and no
 * dead-letter, so an unseeded deployment looks identical to a vault of genuinely unplaceable
 * documents. Ceiling: silent. Upgrade path: the row is already re-classifiable, so the honest fix
 * is an ops query counting `unclassified` rows, not a new column.
 */
export const classifyDoc = internalAction({
  args: {
    vaultDocId: v.id("vaultDocuments"),
    tenantId: v.string(),
    evalBudgetId: v.optional(v.id("spendEvents")),
  },
  handler: async (ctx, { vaultDocId, tenantId, evalBudgetId }): Promise<DocIdentity> => {
    try {
      // Load the classifier prompt FIRST, and BEFORE the offline seam (the `vaultDigest.ts:282`
      // ordering): the SMOKE path has to exercise the registry too, or the seam hides an unseeded
      // backend. The throw is caught below — degrading the label, never the document.
      const skill: { body: string; version: number } = await ctx.runQuery(
        internal.skills.getActiveSkill,
        { name: DOCUMENT_CLASSIFIER_SKILL },
      );

      const text: string = await ctx.runQuery(internal.vaultLlm.getDocText, {
        vaultDocId,
        tenantId,
      });

      // Redact BEFORE the model call (redact-then-classify, §4), fail CLOSED on a scan error.
      const scan = scanText(text);
      if (!scan.ok) throw new Error("vault: classify scan failed");
      const safeText = scan.value.safeText;

      // Offline deterministic path, ABOVE the cap so the fixture is unaffected by it.
      if (!evalBudgetId && safeText.startsWith(SMOKE_PREFIX) && fixtureSeamFor(tenantId))
        return smokeIdentityFixture(safeText);

      // A doc with no text has nothing to identify. `getDocText` returns "" for a missing or
      // foreign row as well, so this also stops a tenant mismatch from buying an empty prompt.
      if (safeText.trim() === "") return UNIDENTIFIED;

      // REDACT-THEN-CAP, never cap-then-redact — the scan above saw the WHOLE document; the cap
      // bounds only what is SENT (DOC_CLASSIFY_CHAR_CAP, ~15× under the extractor's: identity
      // lives in the first page).
      let actualUsd = 0;
      const { object, usage } = await generateObject({
        model: evalBudgetId
          ? evalBudgetModel({
              ctx,
              tenantId,
              budgetId: evalBudgetId,
              model: resolveModel(DEFAULT_MODEL),
              modelId: DEFAULT_MODEL,
              mode: "golden",
              onCost: (cost) => {
                actualUsd += cost;
              },
            })
          : resolveModel(DEFAULT_MODEL),
        schema: classifySchema,
        system: skill.body,
        prompt: capClassifyText(safeText),
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: evalBudgetId ? 0 : 1,
        ...(evalBudgetId ? { maxOutputTokens: EVAL_MAX_OUTPUT_TOKENS } : {}),
      });
      const priced = priceUsage(DEFAULT_MODEL, usage);
      return {
        // THE TRUST BOUNDARY between a model string and a closed `v.union`. The provider-side enum
        // is a request, not a guarantee; an out-of-union value would throw "invalid argument" at
        // the patch INSIDE the workflow, i.e. it would fail the document — the exact outcome the
        // try/catch above exists to prevent. Anything unrecognised reads as unclassified.
        docType: isDocType(object.docType) ? object.docType : "unclassified",
        // AND THE SAME BOUNDARY APPLIES HERE, which is easy to miss because the SDK's inferred type
        // says `string`. `jsonSchema()` is called without a `validate` fn, so the SDK does NOT check
        // the model object at runtime — a missing or non-string `identityLine` sails through this
        // return, and its receiving `v.string()` in `applyClassification` then throws INSIDE
        // `step.runMutation`, which is OUTSIDE this try/catch. That failure exhausts the workflow's
        // retries and `onIngestComplete` marks the document `failed` — the exact "degrade the label,
        // never fail the document" rule this function exists to keep, broken by the one field
        // nobody coerced.
        identityLine: typeof object.identityLine === "string" ? object.identityLine : "",
        costUsd: evalBudgetId ? actualUsd : priced.ok ? priced.value : 0,
      };
    } catch (error) {
      // Ordinary classification may degrade cosmetically. Evaluation must preserve unknown
      // paid outcomes and stop the workflow, not report a free successful classification.
      if (evalBudgetId) throw error;
      return UNIDENTIFIED;
    }
  },
});

/**
 * Minimal tenant-scoped doc-text reader for the extractor seam. A mismatched tenant gets an empty
 * string — never another tenant's text (VALT-03 isolation). Superseded by `internal.vault.getDoc`
 * when Plan 04's ingest pipeline lands.
 */
export const getDocText = internalQuery({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (ctx, { vaultDocId, tenantId }): Promise<string> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== tenantId) return "";
    return doc.text ?? "";
  },
});
