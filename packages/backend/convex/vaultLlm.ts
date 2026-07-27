// The knowledge-vault graph extractor (VALT-02).
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

import { openai } from "@ai-sdk/openai";
import { GRAPH_EXTRACTOR_SKILL } from "@pikar/contracts/skill";
import { DEFAULT_MODEL, priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { capGraphText } from "@pikar/vault";
import { generateObject, jsonSchema, type LanguageModel } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";

// Per-call wall-clock ceiling (mirrors llm.ts). One retry budget: SDK maxRetries:1.
const CALL_TIMEOUT_MS = 45_000;

// Map a pricing/audit model id ("openai/gpt-4o-mini") to a direct-OpenAI LanguageModel (mirrors
// llm.ts resolveModel — the @ai-sdk/openai provider wants the bare name + reads OPENAI_API_KEY).
const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

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
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (ctx, { vaultDocId, tenantId }): Promise<ExtractedGraph> => {
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
    if (safeText.startsWith(SMOKE_GRAPH_PREFIX)) return smokeGraphFixture(safeText);

    // REDACT-THEN-CAP, never cap-then-redact: the scan above must see the WHOLE document, or PII
    // living in the tail escapes both the scan and its audit counts. The cap only bounds what is
    // SENT (VAULT_EXTRACT_CHAR_CAP lets 400k chars be stored) — see GRAPH_EXTRACT_CHAR_CAP for the
    // head-slice ceiling and its upgrade path.
    const { object, usage } = await generateObject({
      model: resolveModel(DEFAULT_MODEL),
      schema: graphSchema,
      system: skill.body,
      prompt: capGraphText(safeText),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      maxRetries: 1,
    });
    const priced = priceUsage(DEFAULT_MODEL, usage);
    return { nodes: object.nodes, edges: object.edges, costUsd: priced.ok ? priced.value : 0 };
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
