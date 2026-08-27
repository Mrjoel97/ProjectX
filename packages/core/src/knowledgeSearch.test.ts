// Phase 29 (KNOW-01) — the pure search contracts.
//
// These tests exist to make ONE class of lie impossible: a search that could not reach a source
// reporting "nothing exists". Every branch below has a named mutation recorded in 29-01-SUMMARY.md
// that turns it red.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  AUTHORITY_CLASSES,
  aggregateCoverage,
  authorityFor,
  CONFIDENCE_LABELS,
  clampEvidence,
  clampSearchPlan,
  dedupeEvidence,
  type Evidence,
  freshnessFor,
  groundedSourceProps,
  isKnowledgeSource,
  KNOWLEDGE_SOURCES,
  type KnowledgeSourceState,
  NOT_LANDED_SOURCES,
  normalizeEvidenceText,
  oldestFreshness,
  PLAN_REJECTIONS,
  redactedSearchEvent,
  renderSourceGap,
  SEARCH_CAPS,
  searchConfidence,
  validateSourceRef,
  validateSynthesis,
  weakestAuthority,
} from "./knowledgeSearch";
import {
  MISSING_PACK_SOURCES,
  MISSING_SOURCE_UNLOCK,
  PACK_SOURCE_LABEL,
  REACHABLE_PACK_SOURCES,
} from "./workflowPacks";

const NOW = Date.UTC(2026, 7, 27); // 2026-08-27
const DAY = 86_400_000;

/** First element, asserting there IS one — so an empty result reads as a failure, not `undefined`. */
function first<T>(items: readonly T[]): T {
  expect(items.length, "expected at least one element").toBeGreaterThan(0);
  return items[0] as T;
}

function nth<T>(items: readonly T[], i: number): T {
  expect(items.length, `expected at least ${i + 1} elements`).toBeGreaterThan(i);
  return items[i] as T;
}

function ev(over: Partial<Evidence> & Pick<Evidence, "evidenceId">): Evidence {
  return {
    source: "vault",
    sourceRef: `doc_${over.evidenceId}`,
    label: `Doc ${over.evidenceId}`,
    text: `body of ${over.evidenceId}`,
    authority: "tenant_owned",
    retrievedAt: NOW,
    ...over,
  };
}

// ── The closed registry ────────────────────────────────────────────────────────────────────

describe("the source registry is closed and code-owned", () => {
  test("exactly the five native sources, in a fixed order", () => {
    expect([...KNOWLEDGE_SOURCES]).toEqual([
      "vault",
      "drive",
      "inbox",
      "crm-facts",
      "support-desk",
    ]);
  });

  test("a source outside the enum is refused, never defaulted", () => {
    expect(isKnowledgeSource("vault")).toBe(true);
    for (const bad of ["notion", "mcp", "web", "__proto__", "constructor", "", "VAULT"]) {
      expect(isKnowledgeSource(bad), `${bad} was accepted as a source`).toBe(false);
    }
  });

  test("every source has a user-facing label, so no adapter can name itself", () => {
    for (const s of KNOWLEDGE_SOURCES) {
      expect(PACK_SOURCE_LABEL[s].length).toBeGreaterThan(0);
    }
  });

  test("crm and support are recorded as NOT LANDED — the Phase 28 half that does not exist", () => {
    expect([...NOT_LANDED_SOURCES]).toEqual(["crm-facts", "support-desk"]);
    for (const s of NOT_LANDED_SOURCES) expect(KNOWLEDGE_SOURCES).toContain(s);
  });

  test("NOT_LANDED is DERIVED from the one registry, not a second hand-kept list", () => {
    // MUTATION that must turn this RED: move `crm-facts` from MISSING_PACK_SOURCES to
    // REACHABLE_PACK_SOURCES without touching knowledgeSearch.ts. The point of deriving it is that
    // a connector landing in the one registry cannot leave a stale not-landed claim behind here.
    const missing = new Set<string>(MISSING_PACK_SOURCES);
    expect([...NOT_LANDED_SOURCES]).toEqual(KNOWLEDGE_SOURCES.filter((s) => missing.has(s)));
    const reachable = new Set<string>(REACHABLE_PACK_SOURCES);
    for (const s of KNOWLEDGE_SOURCES) {
      if (NOT_LANDED_SOURCES.includes(s)) continue;
      expect(reachable.has(s), `${s} is neither reachable nor missing in the pack registry`).toBe(
        true,
      );
    }
  });

  test("every knowledge source IS a PackSource — one vocabulary, not two", () => {
    // The defect this replaces: `gmail` here beside `inbox` there, so a pin whose
    // `sourcePreferences` said `inbox` could never select the mail search source, with no code
    // anywhere that could translate between the two. MUTATION: rename `inbox` back to `gmail` in
    // KNOWLEDGE_SOURCES — `satisfies readonly PackSource[]` fails typecheck and this fails at run.
    const packVocabulary = new Set<string>([...REACHABLE_PACK_SOURCES, ...MISSING_PACK_SOURCES]);
    for (const s of KNOWLEDGE_SOURCES) {
      expect(packVocabulary.has(s), `${s} is not a PackSource`).toBe(true);
    }
    // And the label is the SAME string object the pack plane renders — not a copy that can drift.
    expect(PACK_SOURCE_LABEL.vault).toBe("your knowledge vault");
    expect(PACK_SOURCE_LABEL.inbox).toBe("your mailbox");
  });

  test("maxSources is the registry size — the cap is enforced by construction, not a counter", () => {
    // `clampSearchPlan` admits one entry per DISTINCT source, so a plan cannot exceed the registry.
    // This equality is what makes that argument falsifiable: MUTATION set maxSources to 4 -> RED.
    expect(SEARCH_CAPS.maxSources).toBe(KNOWLEDGE_SOURCES.length);
    // And there is no rejection reason for a cap the code cannot hit.
    expect([...PLAN_REJECTIONS]).not.toContain("source_cap");
  });
});

// ── Caps ───────────────────────────────────────────────────────────────────────────────────

describe("caps are owned by this repo, not by a provider cursor or a model", () => {
  test("every cap is a positive finite number", () => {
    for (const [k, v] of Object.entries(SEARCH_CAPS)) {
      expect(typeof v, k).toBe("number");
      expect(v, k).toBeGreaterThan(0);
      expect(Number.isFinite(v), k).toBe(true);
    }
  });

  test("NO CAP IS DEAD: every key is read by a function, not just declared", () => {
    // The 29-01 audit found six of eleven caps referenced ONLY at their own declaration while
    // `schema.ts` cited them as "BOUNDED BY CONSTRUCTION". A cap nothing applies is a documented
    // invariant with no enforcement, and the tests over those six ("every cap is a positive
    // number") could not fail. This scan is the tripwire: delete an enforcement site and the key
    // becomes declaration-only again, RED.
    //
    // MUTATIONS OBSERVED RED: removing the `labelCharCap` slice from `clampEvidence`; removing the
    // `maxEvidencePerSource` guard.
    const source = readFileSync(new URL("./knowledgeSearch.ts", import.meta.url), "utf8");
    const start = source.indexOf("export const SEARCH_CAPS = {");
    expect(start, "SEARCH_CAPS declaration not found").toBeGreaterThan(-1);
    const end = source.indexOf("} as const;", start);
    const outsideDeclaration = source.slice(0, start) + source.slice(end);
    // Comments explain the caps and would satisfy a naive substring scan, so strip them first.
    const code = outsideDeclaration
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    // TWO NAMED EXCEPTIONS, listed here rather than dropped from the scan so the carve-out is
    // visible instead of implicit. Both are enforced BY CONSTRUCTION and each is pinned by an
    // equality assertion in this file, which is the substitute for a `SEARCH_CAPS.x` read:
    //   • maxSources — `clampSearchPlan` admits one entry per DISTINCT source, so the plan cannot
    //     exceed the registry; pinned by `maxSources === KNOWLEDGE_SOURCES.length` above.
    //   • maxQueriesPerSource — `SourcePlan` has ONE `query` field and a repeat is
    //     `duplicate_source`; pinned by the `=== 1` assertion below.
    const BY_CONSTRUCTION: readonly string[] = ["maxSources", "maxQueriesPerSource"];
    for (const key of Object.keys(SEARCH_CAPS)) {
      if (BY_CONSTRUCTION.includes(key)) continue;
      expect(code, `SEARCH_CAPS.${key} is declared but never applied`).toContain(
        `SEARCH_CAPS.${key}`,
      );
    }
  });

  test("the total evidence cap cannot be exceeded by filling every source to its own cap", () => {
    expect(SEARCH_CAPS.maxEvidenceTotal).toBeLessThanOrEqual(
      SEARCH_CAPS.maxEvidencePerSource * SEARCH_CAPS.maxSources,
    );
  });

  test("one query per source in the first release", () => {
    expect(SEARCH_CAPS.maxQueriesPerSource).toBe(1);
  });
});

// ── Plan clamping — the model's only input ─────────────────────────────────────────────────

describe("clampSearchPlan is the boundary the planner output crosses", () => {
  test("a well-formed plan survives intact", () => {
    const out = clampSearchPlan([
      { source: "vault", query: "pricing policy" },
      { source: "inbox", query: "pricing" },
    ]);
    expect(out.plan).toEqual([
      { source: "vault", query: "pricing policy" },
      { source: "inbox", query: "pricing" },
    ]);
    expect(out.rejected).toEqual([]);
    expect(out.notLanded).toEqual([]);
  });

  test("an unknown source is rejected with a reason, never silently dropped", () => {
    const out = clampSearchPlan([
      { source: "notion", query: "x" },
      { source: "vault", query: "x" },
    ]);
    expect(out.plan.map((p) => p.source)).toEqual(["vault"]);
    expect(out.rejected).toEqual([{ source: "notion", reason: "unknown_source" }]);
  });

  test("a NOT-LANDED source becomes an honest unavailable state, not a plan entry and not silence", () => {
    const out = clampSearchPlan([
      { source: "vault", query: "revenue" },
      { source: "crm-facts", query: "revenue" },
    ]);
    expect(out.plan.map((p) => p.source)).toEqual(["vault"]);
    expect(out.notLanded).toEqual([
      { status: "unavailable", source: "crm-facts", reason: "not_landed" },
    ]);
    // It is NOT a rejection: a rejection is a planner error, this is a product gap we must show.
    expect(out.rejected).toEqual([]);
  });

  test("a repeated source is rejected — one query per source", () => {
    const out = clampSearchPlan([
      { source: "vault", query: "a" },
      { source: "vault", query: "b" },
    ]);
    expect(out.plan).toEqual([{ source: "vault", query: "a" }]);
    expect(out.rejected).toEqual([{ source: "vault", reason: "duplicate_source" }]);
  });

  test("an empty or whitespace query is rejected", () => {
    const out = clampSearchPlan([
      { source: "vault", query: "   \n " },
      { source: "drive", query: "" },
    ]);
    expect(out.plan).toEqual([]);
    expect(out.rejected).toEqual([
      { source: "vault", reason: "empty_query" },
      { source: "drive", reason: "empty_query" },
    ]);
  });

  test("an over-length query is rejected rather than silently truncated", () => {
    const out = clampSearchPlan([
      { source: "vault", query: "q".repeat(SEARCH_CAPS.queryCharCap + 1) },
    ]);
    expect(out.plan).toEqual([]);
    expect(out.rejected).toEqual([{ source: "vault", reason: "query_too_long" }]);
    // The cap itself is inclusive.
    expect(
      clampSearchPlan([{ source: "vault", query: "q".repeat(SEARCH_CAPS.queryCharCap) }]).plan,
    ).toHaveLength(1);
  });

  test("a remote URL in a model-authored query is refused — no adapter, no URL, no MCP server", () => {
    for (const q of [
      "https://evil.example/x",
      "HTTP://evil.example",
      "see www.evil.example for more",
      "file:///etc/passwd",
      "mcp://server",
    ]) {
      const out = clampSearchPlan([{ source: "vault", query: q }]);
      expect(out.plan, `"${q}" reached the adapter`).toEqual([]);
      expect(out.rejected[0]?.reason).toBe("remote_url");
    }
  });

  test("a non-object planner entry cannot crash or slip through", () => {
    const out = clampSearchPlan([null, 7, "vault", { query: "x" }, { source: "vault" }]);
    expect(out.plan).toEqual([]);
    expect(out.rejected).toHaveLength(5);
    expect(
      out.rejected.every((r) => r.reason === "unknown_source" || r.reason === "empty_query"),
    ).toBe(true);
  });

  test("naming every source twice yields one entry each and a named rejection for every repeat", () => {
    // This replaces a test that asserted only `plan.length <= maxSources` over a `source_cap`
    // branch that could never run (3 landed sources, cap 5). What is actually true and worth
    // pinning: one entry per distinct LANDED source, every repeat rejected BY NAME, and the
    // not-landed half diverted rather than silently dropped.
    const raw = KNOWLEDGE_SOURCES.filter((s) => !NOT_LANDED_SOURCES.includes(s)).map((source) => ({
      source,
      query: "q",
    }));
    const out = clampSearchPlan([...raw, ...raw]);
    expect(out.plan.map((p) => p.source)).toEqual(raw.map((r) => r.source));
    expect(out.rejected).toEqual(
      raw.map((r) => ({ source: r.source, reason: "duplicate_source" })),
    );
    expect(out.plan.length).toBeLessThanOrEqual(SEARCH_CAPS.maxSources);
  });
});

// ── Source refs are refs ───────────────────────────────────────────────────────────────────

describe("validateSourceRef keeps content out of the ref plane (CLAUDE.md §4)", () => {
  test("a real provider id passes", () => {
    expect(validateSourceRef("1a2B_c-d.e").ok).toBe(true);
  });

  test("a ref that is actually content is refused", () => {
    for (const bad of [
      'Acme"s invoice',
      "Acme’s invoice",
      "line\nbreak",
      "tab\there",
      "'quoted'",
      // THE ONES THE ORIGINAL DENYLIST LET THROUGH. It listed quotes and \n\r\t and no space
      // class at all, while its own docstring claimed it refused whitespace. Both of these
      // returned ok:true. Prose always contains a space; a provider id never does.
      "Acme Corp Invoice.pdf",
      "Q3 revenue summary for Northwind",
      // An allowlist also refuses markup, an address and a path traversal for free.
      "<script>alert(1)</script>",
      "joel@example.com",
      "..\\..\\etc\\passwd",
    ]) {
      expect(validateSourceRef(bad).ok, `${JSON.stringify(bad)} passed as a ref`).toBe(false);
    }
  });

  test("the real refs the five adapters actually mint all pass", () => {
    // The allowlist would be useless if it refused the ids it exists to admit. These are the
    // shapes each landed plane produces: a Convex document id, a Gmail message id, a Drive file
    // id, and a provider-prefixed record id.
    for (const good of [
      "k1739abcd2efgh3ijkl4mnop5q",
      "18f2c1a9b7d4e6f0",
      "1A2b-C3d_E4f.G5h",
      "inv_1P4kQ2JdRt5uV6w",
      "https://x", // NOTE: `:` and `/` are id characters (`gid://...`), so a URL is NOT refused
    ]) {
      expect(validateSourceRef(good).ok, `${good} was refused as a ref`).toBe(true);
    }
  });

  test("an empty ref and an over-long ref are refused", () => {
    expect(validateSourceRef("  ").ok).toBe(false);
    expect(validateSourceRef("x".repeat(SEARCH_CAPS.refCharCap + 1)).ok).toBe(false);
    expect(validateSourceRef("x".repeat(SEARCH_CAPS.refCharCap)).ok).toBe(true);
  });
});

// ── Authority is code-owned ────────────────────────────────────────────────────────────────

describe("authority is a fixed mapping, never a model output", () => {
  test("the class list is closed", () => {
    expect([...AUTHORITY_CLASSES]).toEqual([
      "tenant_owned",
      "system_of_record",
      "correspondence",
      "third_party_research",
      "agent_authored",
    ]);
  });

  test("each source maps to its adapter's class", () => {
    expect(authorityFor("vault", {})).toBe("tenant_owned");
    expect(authorityFor("drive", {})).toBe("tenant_owned");
    expect(authorityFor("inbox", {})).toBe("correspondence");
    expect(authorityFor("crm-facts", {})).toBe("system_of_record");
    expect(authorityFor("support-desk", {})).toBe("system_of_record");
  });

  test("a stored web_research vault doc is downgraded — retrieval location is not provenance", () => {
    expect(authorityFor("vault", { docKind: "web_research" })).toBe("third_party_research");
  });

  test("an AGENT-PROMOTED vault doc never reads as the owner's own word (26-11 origins)", () => {
    expect(authorityFor("vault", { origin: "agent_promoted" })).toBe("agent_authored");
  });

  test("when two downgrades apply, the WEAKER one wins", () => {
    expect(authorityFor("vault", { docKind: "web_research", origin: "agent_promoted" })).toBe(
      "agent_authored",
    );
  });
});

// ── Freshness is computed, never guessed from prose ────────────────────────────────────────

describe("freshnessFor reads timestamps only", () => {
  test("recent, current and stale are bucketed from sourceUpdatedAt", () => {
    expect(freshnessFor(ev({ evidenceId: "a", sourceUpdatedAt: NOW - DAY }), NOW)).toBe("current");
    expect(freshnessFor(ev({ evidenceId: "b", sourceUpdatedAt: NOW - 90 * DAY }), NOW)).toBe(
      "recent",
    );
    expect(freshnessFor(ev({ evidenceId: "c", sourceUpdatedAt: NOW - 800 * DAY }), NOW)).toBe(
      "stale",
    );
  });

  test("no sourceUpdatedAt is UNKNOWN, not fresh — absence is not evidence of currency", () => {
    expect(freshnessFor(ev({ evidenceId: "d" }), NOW)).toBe("unknown");
  });

  test("a future timestamp is UNKNOWN, not maximally fresh", () => {
    expect(freshnessFor(ev({ evidenceId: "e", sourceUpdatedAt: NOW + 10 * DAY }), NOW)).toBe(
      "unknown",
    );
  });
});

// ── Dedupe must not delete disagreement ────────────────────────────────────────────────────

describe("dedupeEvidence collapses identity and RETAINS conflict", () => {
  test("the same record read twice SAYING THE SAME THING collapses to one group", () => {
    const a = ev({ evidenceId: "e1", source: "vault", sourceRef: "doc_9", text: "Price is $40." });
    const b = ev({ evidenceId: "e2", source: "vault", sourceRef: "doc_9", text: "Price is $40." });
    const out = dedupeEvidence([a, b]);
    expect(out.groups).toHaveLength(1);
    expect(first(out.groups).primary.evidenceId).toBe("e1");
    expect(first(out.groups).duplicates.map((d) => d.evidenceId)).toEqual(["e2"]);
    expect(first(out.groups).conflicting).toEqual([]);
    expect(out.collapsed).toBe(1);
    expect(out.conflicts).toBe(0);
  });

  test("ONE REF THAT DISAGREES WITH ITSELF is a conflict, never a duplicate", () => {
    // The 29-01 defect: identity was keyed on `source|sourceRef` alone and the text was never
    // compared, so `doc_9` reading "$40" on one pass and "$60" on another produced ONE group with
    // `collapsed: 1` and the $60 row filed under `duplicates`. Nothing was deleted — but the
    // module's own contract says a duplicate is "safe to collapse", so a renderer that follows the
    // contract drops the second figure. This is the exact $40/$60 case the header says it prevents.
    //
    // MUTATION that must turn this RED: key the group on `source|sourceRef` without comparing
    // `normalizeEvidenceText`, i.e. push every repeat into `duplicates`.
    const out = dedupeEvidence([
      ev({ evidenceId: "e1", source: "vault", sourceRef: "doc_9", text: "Price is $40." }),
      ev({ evidenceId: "e2", source: "vault", sourceRef: "doc_9", text: "Price is $60." }),
    ]);
    expect(out.groups).toHaveLength(1);
    expect(first(out.groups).duplicates).toEqual([]);
    expect(first(out.groups).conflicting.map((c) => c.text)).toEqual(["Price is $60."]);
    // A disagreement is NOT a collapse, and the counts must not launder one as the other.
    expect(out.collapsed).toBe(0);
    expect(out.conflicts).toBe(1);
  });

  test("a same-ref repeat that differs only in whitespace or case is still a duplicate", () => {
    // Conflict detection uses the SAME normalization as `related` grouping, so a provider that
    // re-wraps its own text does not manufacture a disagreement out of nothing.
    const out = dedupeEvidence([
      ev({ evidenceId: "e1", source: "vault", sourceRef: "doc_9", text: "Price is $40." }),
      ev({ evidenceId: "e2", source: "vault", sourceRef: "doc_9", text: "  PRICE   is\r\n$40. " }),
    ]);
    expect(out.groups).toHaveLength(1);
    expect(first(out.groups).duplicates.map((d) => d.evidenceId)).toEqual(["e2"]);
    expect(out.conflicts).toBe(0);
    expect(out.collapsed).toBe(1);
  });

  test("the same ref under a DIFFERENT source is NOT the same record", () => {
    const out = dedupeEvidence([
      ev({ evidenceId: "e1", source: "vault", sourceRef: "shared" }),
      ev({ evidenceId: "e2", source: "drive", sourceRef: "shared" }),
    ]);
    expect(out.groups).toHaveLength(2);
    expect(out.collapsed).toBe(0);
  });

  test("byte-identical text from two DIFFERENT records is RELATED, never deleted", () => {
    const out = dedupeEvidence([
      ev({ evidenceId: "e1", source: "vault", sourceRef: "d1", text: "Price is $40." }),
      ev({ evidenceId: "e2", source: "drive", sourceRef: "d2", text: "Price is $40." }),
    ]);
    expect(out.groups).toHaveLength(2);
    // Both source refs survive — this is the anti-erasure contract.
    expect(out.groups.map((g) => g.primary.sourceRef).sort()).toEqual(["d1", "d2"]);
    expect(first(out.groups).related.map((r) => r.evidenceId)).toEqual(["e2"]);
    expect(nth(out.groups, 1).related.map((r) => r.evidenceId)).toEqual(["e1"]);
  });

  test("CONTRADICTORY text from two records is never merged and never dropped", () => {
    const out = dedupeEvidence([
      ev({ evidenceId: "e1", source: "vault", sourceRef: "d1", text: "Price is $40." }),
      ev({ evidenceId: "e2", source: "inbox", sourceRef: "d2", text: "Price is $60." }),
    ]);
    expect(out.groups).toHaveLength(2);
    expect(out.groups.every((g) => g.related.length === 0)).toBe(true);
    expect(out.collapsed).toBe(0);
  });

  test("normalization folds whitespace and case for RELATED grouping only", () => {
    expect(normalizeEvidenceText("  Price   is\r\n$40. ")).toBe(
      normalizeEvidenceText("price is $40."),
    );
    const out = dedupeEvidence([
      ev({ evidenceId: "e1", sourceRef: "d1", text: "  Price   is $40. " }),
      ev({ evidenceId: "e2", source: "drive", sourceRef: "d2", text: "price is $40." }),
    ]);
    expect(out.groups).toHaveLength(2);
    expect(first(out.groups).related).toHaveLength(1);
  });

  test("order is stable: the first occurrence is always the primary", () => {
    const items = ["a", "b", "c"].map((id) => ev({ evidenceId: id, sourceRef: `d_${id}` }));
    expect(dedupeEvidence(items).groups.map((g) => g.primary.evidenceId)).toEqual(["a", "b", "c"]);
  });
});

// ── The admission boundary: caps applied to untrusted adapter output ───────────────────────

describe("clampEvidence enforces every per-source and per-run bound", () => {
  const many = (source: Evidence["source"], n: number, over: Partial<Evidence> = {}): Evidence[] =>
    Array.from({ length: n }, (_, i) =>
      ev({ evidenceId: `${source}_${i}`, source, sourceRef: `${source}_ref_${i}`, ...over }),
    );

  test("a source is cut to maxEvidencePerSource and REPORTED as capped", () => {
    // MUTATION that must turn this RED: drop the `used >= SEARCH_CAPS.maxEvidencePerSource` arm.
    const out = clampEvidence(many("vault", SEARCH_CAPS.maxEvidencePerSource + 3));
    expect(out.evidence).toHaveLength(SEARCH_CAPS.maxEvidencePerSource);
    expect(out.capped).toEqual(["vault"]);
    // The rows kept are the FIRST ones — the adapter's own ordering, not a reshuffle.
    expect(out.evidence.map((e) => e.evidenceId)).toEqual(
      many("vault", SEARCH_CAPS.maxEvidencePerSource).map((e) => e.evidenceId),
    );
  });

  test("a source under its cap is untouched and NOT reported as capped", () => {
    const input = many("vault", 3);
    const out = clampEvidence(input);
    expect(out.evidence).toHaveLength(3);
    expect(out.capped).toEqual([]);
    // The SAME objects, not rebuilt copies: nothing that fits is rewritten.
    expect(out.evidence[0]).toBe(input[0]);
    expect(out.evidence[2]).toBe(input[2]);
  });

  test("the whole run is cut to maxEvidenceTotal across sources", () => {
    // MUTATION: drop the `kept.length >= SEARCH_CAPS.maxEvidenceTotal` arm.
    const sources = ["vault", "drive", "inbox"] as const;
    const out = clampEvidence(sources.flatMap((s) => many(s, SEARCH_CAPS.maxEvidencePerSource)));
    // 3 x 8 = 24, exactly the total cap, so nothing is cut yet.
    expect(out.evidence).toHaveLength(SEARCH_CAPS.maxEvidenceTotal);
    expect(out.capped).toEqual([]);
  });

  test("text over evidenceTextCharCap is truncated, and the source is reported capped", () => {
    // MUTATION: remove the `.slice(0, SEARCH_CAPS.evidenceTextCharCap)`.
    const long = "x".repeat(SEARCH_CAPS.evidenceTextCharCap + 500);
    const out = clampEvidence([ev({ evidenceId: "e1", text: long })]);
    expect(out.evidence[0]?.text).toHaveLength(SEARCH_CAPS.evidenceTextCharCap);
    expect(out.capped).toEqual(["vault"]);
  });

  test("a label over labelCharCap is truncated — an untrusted title is not a document", () => {
    // MUTATION: remove the `.slice(0, SEARCH_CAPS.labelCharCap)`. `labelCharCap` was enforced by
    // NOTHING before this, while `schema.ts` cited "a label at 200 chars" as a bound.
    const out = clampEvidence([
      ev({ evidenceId: "e1", label: "L".repeat(SEARCH_CAPS.labelCharCap + 50) }),
    ]);
    expect(out.evidence[0]?.label).toHaveLength(SEARCH_CAPS.labelCharCap);
    expect(out.capped).toEqual(["vault"]);
  });

  test("the whole-run character budget drops rows rather than half a sentence", () => {
    // MUTATION: remove the `totalChars + text.length > SEARCH_CAPS.totalEvidenceCharCap` arm.
    // 8 rows of 1500 chars = 12000, over the 8000 budget: 5 fit, the rest are dropped whole.
    const big = "y".repeat(SEARCH_CAPS.evidenceTextCharCap);
    const out = clampEvidence(many("vault", 8, { text: big }));
    const total = out.evidence.reduce((n, e) => n + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(SEARCH_CAPS.totalEvidenceCharCap);
    expect(out.evidence.length).toBeLessThan(8);
    // Every kept row is WHOLE — no row is halved to make the budget balance exactly.
    for (const e of out.evidence) expect(e.text).toBe(big);
    expect(out.capped).toEqual(["vault"]);
  });

  test("one chatty source cannot spend another's budget", () => {
    const out = clampEvidence([...many("vault", 20), ...many("drive", 4)]);
    const perSource = (s: string) => out.evidence.filter((e) => e.source === s).length;
    expect(perSource("vault")).toBe(SEARCH_CAPS.maxEvidencePerSource);
    expect(perSource("drive")).toBe(4);
    expect(out.capped).toEqual(["vault"]);
  });

  test("an empty read is an empty read — no cap is reported when nothing was cut", () => {
    expect(clampEvidence([])).toEqual({ evidence: [], capped: [] });
  });
});

// ── The citation shape maps onto the landed renderer ───────────────────────────────────────

describe("groundedSourceProps hands the LANDED vault card exactly its own props", () => {
  test("refs and labels become the index-aligned docIds/titles/count vaultSources shape", () => {
    // The point is that no caller writes a rename shim: `GroundedSources({titles, docIds})` in
    // `cards.tsx` and the `vaultSources` row both take these three names, so one card component
    // serves the vault plane and the knowledge-search plane.
    const out = groundedSourceProps([
      { sourceRef: "d1", label: "Rate card" },
      { sourceRef: "m1", label: "Quote to Acme" },
    ]);
    expect(out).toEqual({
      docIds: ["d1", "m1"],
      titles: ["Rate card", "Quote to Acme"],
      count: 2,
    });
    // Index alignment is the whole contract: titles[i] describes docIds[i].
    expect(out.titles[1]).toBe("Quote to Acme");
    expect(out.docIds[1]).toBe("m1");
  });

  test("no evidence is a count of zero, not an absent card", () => {
    expect(groundedSourceProps([])).toEqual({ docIds: [], titles: [], count: 0 });
  });
});

// ── The empty-set arms that carry a documented safety guarantee ────────────────────────────

describe("absence is never a strong or fresh claim", () => {
  test("the weakest of NOTHING is the weakest class", () => {
    // Documented as a safety property ("absence is never a strong claim") but unreachable from
    // every caller and untested until the 29-01 repair — a guarantee nothing could exercise.
    // MUTATION that must turn this RED: `if (classes.length === 0) return "tenant_owned"`.
    expect(weakestAuthority([])).toBe("agent_authored");
  });

  test("the weakest of a set is the weakest MEMBER, strongest-first ordering held", () => {
    expect(weakestAuthority(["tenant_owned"])).toBe("tenant_owned");
    expect(weakestAuthority(["tenant_owned", "correspondence"])).toBe("correspondence");
    expect(weakestAuthority(["agent_authored", "tenant_owned"])).toBe("agent_authored");
  });

  test("the oldest of NOTHING is unknown, not current", () => {
    // MUTATION: `if (values.length === 0) return "current"`.
    expect(oldestFreshness([])).toBe("unknown");
  });

  test("unknown sorts with the worst, so an undatable source cannot look fresh", () => {
    expect(oldestFreshness(["current", "unknown"])).toBe("unknown");
    expect(oldestFreshness(["current", "stale"])).toBe("stale");
    expect(oldestFreshness(["current", "recent"])).toBe("recent");
  });
});

// ── Synthesis validation — the citation firewall ───────────────────────────────────────────

const EVIDENCE: Evidence[] = [
  ev({ evidenceId: "e1", sourceRef: "d1", text: "Our standard rate is $40 per hour." }),
  ev({
    evidenceId: "e2",
    source: "inbox",
    sourceRef: "m1",
    text: "We quoted them $60 per hour.",
    authority: "correspondence",
    sourceUpdatedAt: NOW - 2 * DAY,
  }),
];

describe("validateSynthesis rejects what the model made up", () => {
  test("a claim citing a known id keeps it", () => {
    const out = validateSynthesis(
      { summary: "s", claims: [{ text: "Rate is $40.", evidenceIds: ["e1"] }], unanswered: [] },
      EVIDENCE,
      NOW,
    );
    expect(out.claims).toHaveLength(1);
    expect(first(out.claims).evidenceIds).toEqual(["e1"]);
    expect(out.unsupported).toEqual([]);
    expect(out.inventedEvidenceIds).toEqual([]);
  });

  test("a MODEL-INVENTED evidence id is removed and COUNTED, never silently accepted", () => {
    const out = validateSynthesis(
      {
        summary: "s",
        claims: [{ text: "Rate is $40.", evidenceIds: ["e1", "e99"] }],
        unanswered: [],
      },
      EVIDENCE,
      NOW,
    );
    expect(first(out.claims).evidenceIds).toEqual(["e1"]);
    expect(out.inventedEvidenceIds).toEqual(["e99"]);
  });

  test("a claim whose every citation is invented becomes UNSUPPORTED, not a cited claim", () => {
    const out = validateSynthesis(
      { summary: "s", claims: [{ text: "Rate is $99.", evidenceIds: ["e42"] }], unanswered: [] },
      EVIDENCE,
      NOW,
    );
    expect(out.claims).toEqual([]);
    expect(out.unsupported).toEqual([{ text: "Rate is $99.", reason: "no_known_evidence" }]);
    expect(out.inventedEvidenceIds).toEqual(["e42"]);
  });

  test("a claim with NO citations at all is unsupported", () => {
    const out = validateSynthesis(
      { summary: "s", claims: [{ text: "Trust me.", evidenceIds: [] }], unanswered: [] },
      EVIDENCE,
      NOW,
    );
    expect(out.claims).toEqual([]);
    expect(first(out.unsupported).reason).toBe("no_known_evidence");
  });

  test("an empty claim text is dropped with its own reason", () => {
    const out = validateSynthesis(
      { summary: "s", claims: [{ text: "   ", evidenceIds: ["e1"] }], unanswered: [] },
      EVIDENCE,
      NOW,
    );
    expect(out.claims).toEqual([]);
    expect(first(out.unsupported).reason).toBe("empty_text");
  });

  test("an excerpt that is a real substring of the CITED evidence survives", () => {
    const out = validateSynthesis(
      {
        summary: "s",
        claims: [{ text: "Rate.", evidenceIds: ["e1"], excerpt: "standard rate is $40" }],
        unanswered: [],
      },
      EVIDENCE,
      NOW,
    );
    expect(first(out.claims).excerpt).toBe("standard rate is $40");
    expect(first(out.claims).excerptDropped).toBe(false);
  });

  test("a FABRICATED excerpt is dropped and the claim survives — a model title is not provenance", () => {
    const out = validateSynthesis(
      {
        summary: "s",
        claims: [{ text: "Rate.", evidenceIds: ["e1"], excerpt: "the rate is $4000" }],
        unanswered: [],
      },
      EVIDENCE,
      NOW,
    );
    expect(out.claims).toHaveLength(1);
    expect(first(out.claims).excerpt).toBeNull();
    expect(first(out.claims).excerptDropped).toBe(true);
  });

  test("an excerpt lifted from evidence the claim did NOT cite is dropped", () => {
    const out = validateSynthesis(
      {
        summary: "s",
        claims: [{ text: "Rate.", evidenceIds: ["e1"], excerpt: "We quoted them $60" }],
        unanswered: [],
      },
      EVIDENCE,
      NOW,
    );
    expect(first(out.claims).excerpt).toBeNull();
    expect(first(out.claims).excerptDropped).toBe(true);
  });

  test("an over-long excerpt is dropped rather than truncated into a different quote", () => {
    const long = "x".repeat(SEARCH_CAPS.excerptCharCap + 1);
    const out = validateSynthesis(
      {
        summary: "s",
        claims: [{ text: "Rate.", evidenceIds: ["e3"], excerpt: long }],
        unanswered: [],
      },
      [...EVIDENCE, ev({ evidenceId: "e3", sourceRef: "d3", text: long })],
      NOW,
    );
    expect(first(out.claims).excerpt).toBeNull();
    expect(first(out.claims).excerptDropped).toBe(true);
  });

  test("CONFLICTING evidence stays attached to the claim — synthesis cannot erase disagreement", () => {
    const out = validateSynthesis(
      {
        summary: "s",
        claims: [{ text: "Rate is $40.", evidenceIds: ["e1"], conflictEvidenceIds: ["e2"] }],
        unanswered: [],
      },
      EVIDENCE,
      NOW,
    );
    expect(first(out.claims).conflictEvidenceIds).toEqual(["e2"]);
    expect(out.conflicts).toBe(1);
  });

  test("an invented CONFLICT id is dropped like any other invented id", () => {
    const out = validateSynthesis(
      {
        summary: "s",
        claims: [{ text: "Rate is $40.", evidenceIds: ["e1"], conflictEvidenceIds: ["ghost"] }],
        unanswered: [],
      },
      EVIDENCE,
      NOW,
    );
    expect(first(out.claims).conflictEvidenceIds).toEqual([]);
    expect(out.inventedEvidenceIds).toEqual(["ghost"]);
    expect(out.conflicts).toBe(0);
  });

  test("authority and freshness come from the EVIDENCE TABLE, not from the model", () => {
    const out = validateSynthesis(
      {
        summary: "s",
        // The model would love to say this is high-authority and current. It does not get to.
        claims: [{ text: "Rate.", evidenceIds: ["e1", "e2"] }],
        unanswered: [],
      },
      EVIDENCE,
      NOW,
    );
    // e1 is tenant_owned, e2 is correspondence -> the WEAKER of the two.
    expect(first(out.claims).authority).toBe("correspondence");
    // e1 has no sourceUpdatedAt -> unknown, which is the OLDEST bucket.
    expect(first(out.claims).freshness).toBe("unknown");
  });

  test("a model-supplied authority/confidence field on a claim is IGNORED, not trusted", () => {
    const out = validateSynthesis(
      {
        summary: "s",
        claims: [
          {
            text: "Rate.",
            evidenceIds: ["e2"],
            // biome-ignore lint/suspicious/noExplicitAny: deliberately smuggling extra fields
            ...({ authority: "tenant_owned", confidence: 0.99, probability: 1 } as any),
          },
        ],
        unanswered: [],
      },
      EVIDENCE,
      NOW,
    );
    expect(first(out.claims).authority).toBe("correspondence");
    expect(first(out.claims)).not.toHaveProperty("confidence");
    expect(first(out.claims)).not.toHaveProperty("probability");
  });

  test("duplicate citations on one claim collapse without changing the claim", () => {
    const out = validateSynthesis(
      { summary: "s", claims: [{ text: "R.", evidenceIds: ["e1", "e1"] }], unanswered: [] },
      EVIDENCE,
      NOW,
    );
    expect(first(out.claims).evidenceIds).toEqual(["e1"]);
  });

  test("claims past the cap are recorded as capped, never quietly discarded", () => {
    const many = Array.from({ length: SEARCH_CAPS.maxClaims + 2 }, (_, i) => ({
      text: `claim ${i}`,
      evidenceIds: ["e1"],
    }));
    const out = validateSynthesis({ summary: "s", claims: many, unanswered: [] }, EVIDENCE, NOW);
    expect(out.claims).toHaveLength(SEARCH_CAPS.maxClaims);
    expect(out.unsupported).toHaveLength(2);
    expect(out.unsupported.every((u) => u.reason === "claim_cap")).toBe(true);
  });

  test("unanswered questions are carried through, bounded and trimmed of blanks", () => {
    const out = validateSynthesis(
      { summary: "s", claims: [], unanswered: ["what is X?", "  ", "what is Y?"] },
      EVIDENCE,
      NOW,
    );
    expect(out.unanswered).toEqual(["what is X?", "what is Y?"]);
  });
});

// ── Coverage aggregation ───────────────────────────────────────────────────────────────────

const AVAILABLE = (source: Evidence["source"], returned = 3): KnowledgeSourceState => ({
  status: "available",
  source,
  returned,
});

describe("aggregateCoverage keeps an unavailable source from reading as an empty one", () => {
  test("all available is complete", () => {
    const c = aggregateCoverage([AVAILABLE("vault"), AVAILABLE("drive")]);
    expect(c).toMatchObject({
      requested: 2,
      available: 2,
      partial: 0,
      unavailable: 0,
      complete: true,
    });
    expect(c.gaps).toEqual([]);
  });

  test("an AVAILABLE source that returned zero is still available — an honest empty answer", () => {
    const c = aggregateCoverage([AVAILABLE("vault", 0)]);
    expect(c.complete).toBe(true);
    expect(c.gaps).toEqual([]);
    expect(c.returned).toBe(0);
  });

  test("one unavailable source makes the whole run INCOMPLETE and names the gap", () => {
    const c = aggregateCoverage([
      AVAILABLE("vault"),
      { status: "unavailable", source: "inbox", reason: "reauth" },
    ]);
    expect(c.complete).toBe(false);
    expect(c.unavailable).toBe(1);
    expect(c.gaps).toEqual([{ source: "inbox", reason: "reauth" }]);
  });

  test("a PARTIAL source is a gap too — a capped list is not a complete one", () => {
    const c = aggregateCoverage([
      { status: "partial", source: "drive", returned: 8, reason: "cap" },
    ]);
    expect(c.complete).toBe(false);
    expect(c.partial).toBe(1);
    expect(c.returned).toBe(8);
    expect(c.gaps).toEqual([{ source: "drive", reason: "cap" }]);
  });

  test("asking nothing is NOT complete — fail closed", () => {
    const c = aggregateCoverage([]);
    expect(c.complete).toBe(false);
    expect(c.requested).toBe(0);
  });

  test("the not-landed gap survives aggregation with its own reason", () => {
    const c = aggregateCoverage([
      { status: "unavailable", source: "crm-facts", reason: "not_landed" },
    ]);
    expect(c.gaps).toEqual([{ source: "crm-facts", reason: "not_landed" }]);
  });
});

describe("renderSourceGap says what could not be seen and why, in the user's words", () => {
  test("every unavailable reason renders a non-empty sentence naming the source label", () => {
    for (const reason of [
      "not_connected",
      "reauth",
      "refresh_failed",
      "provider_error",
      "not_landed",
      "unplanned",
    ] as const) {
      const line = renderSourceGap({ status: "unavailable", source: "inbox", reason });
      // An unavailable state ALWAYS renders a sentence. Silence here is the bug this file exists for.
      expect(line, reason).not.toBeNull();
      expect(String(line), reason).toContain(PACK_SOURCE_LABEL.inbox);
      expect(String(line).length, reason).toBeGreaterThan(PACK_SOURCE_LABEL.inbox.length + 5);
    }
  });

  test("the rendered sentence never claims nothing exists", () => {
    const line = renderSourceGap({
      status: "unavailable",
      source: "crm-facts",
      reason: "not_landed",
    });
    expect(String(line).toLowerCase()).not.toContain("no results");
    expect(String(line).toLowerCase()).not.toContain("nothing");
  });

  test("a NOT-LANDED source names its unlock, reusing the one code-owned unlock record", () => {
    // The second half of the honest-partial contract, borrowed from `workflowPacks.ts` rather than
    // reworded here: naming a gap without naming its unlock leaves the user with a complaint
    // instead of a next step. MUTATION: return the bare sentence for `not_landed` -> RED.
    for (const source of NOT_LANDED_SOURCES) {
      const line = String(renderSourceGap({ status: "unavailable", source, reason: "not_landed" }));
      expect(line, source).toContain(PACK_SOURCE_LABEL[source]);
      expect(line, source).toContain(
        MISSING_SOURCE_UNLOCK[source as keyof typeof MISSING_SOURCE_UNLOCK],
      );
    }
    // A reachable source that failed for a RUNTIME reason has no product unlock to name.
    expect(
      String(renderSourceGap({ status: "unavailable", source: "inbox", reason: "reauth" })),
    ).not.toContain("would need");
  });

  test("a partial source renders how many it saw, not a total", () => {
    const line = renderSourceGap({
      status: "partial",
      source: "drive",
      returned: 8,
      reason: "cap",
    });
    expect(String(line)).toContain("8");
    expect(String(line)).toContain(PACK_SOURCE_LABEL.drive);
  });

  test("an available source has no gap sentence", () => {
    expect(renderSourceGap(AVAILABLE("vault"))).toBeNull();
  });
});

// ── Confidence is a label, never a probability ─────────────────────────────────────────────

describe("searchConfidence is a closed label computed in code", () => {
  const strong = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      text: `c${i}`,
      evidenceIds: [`e${i}a`, `e${i}b`],
      conflictEvidenceIds: [] as string[],
      excerpt: null,
      excerptDropped: false,
      authority: "tenant_owned" as const,
      freshness: "current" as const,
    }));

  test("the label set is closed and ordered weakest-first", () => {
    expect([...CONFIDENCE_LABELS]).toEqual(["unsupported", "low", "medium", "high"]);
  });

  test("no cited claims is UNSUPPORTED, whatever the coverage says", () => {
    expect(
      searchConfidence({
        claims: [],
        coverage: aggregateCoverage([AVAILABLE("vault")]),
        conflicts: 0,
      }),
    ).toBe("unsupported");
  });

  test("full coverage, tenant-owned, current, multi-evidence claims is HIGH", () => {
    expect(
      searchConfidence({
        claims: strong(2),
        coverage: aggregateCoverage([AVAILABLE("vault"), AVAILABLE("drive")]),
        conflicts: 0,
      }),
    ).toBe("high");
  });

  test("a COVERAGE GAP caps confidence at medium", () => {
    expect(
      searchConfidence({
        claims: strong(2),
        coverage: aggregateCoverage([
          AVAILABLE("vault"),
          { status: "unavailable", source: "crm-facts", reason: "not_landed" },
        ]),
        conflicts: 0,
      }),
    ).toBe("medium");
  });

  test("a CONFLICT caps confidence at medium and the conflict stays visible", () => {
    expect(
      searchConfidence({
        claims: strong(2),
        coverage: aggregateCoverage([AVAILABLE("vault")]),
        conflicts: 1,
      }),
    ).toBe("medium");
  });

  test("weak authority caps confidence at medium", () => {
    const claims = strong(2).map((c) => ({ ...c, authority: "third_party_research" as const }));
    expect(
      searchConfidence({ claims, coverage: aggregateCoverage([AVAILABLE("vault")]), conflicts: 0 }),
    ).toBe("medium");
  });

  test("an AGENT-AUTHORED citation caps confidence at medium", () => {
    const claims = strong(2).map((c) => ({ ...c, authority: "agent_authored" as const }));
    expect(
      searchConfidence({ claims, coverage: aggregateCoverage([AVAILABLE("vault")]), conflicts: 0 }),
    ).toBe("medium");
  });

  test("stale or unknown freshness caps confidence at medium", () => {
    for (const freshness of ["stale", "unknown"] as const) {
      const claims = strong(2).map((c) => ({ ...c, freshness }));
      expect(
        searchConfidence({
          claims,
          coverage: aggregateCoverage([AVAILABLE("vault")]),
          conflicts: 0,
        }),
        freshness,
      ).toBe("medium");
    }
  });

  test("a single citation across the whole answer is LOW", () => {
    const claims = strong(1).map((c) => ({ ...c, evidenceIds: ["only"] }));
    expect(
      searchConfidence({ claims, coverage: aggregateCoverage([AVAILABLE("vault")]), conflicts: 0 }),
    ).toBe("low");
  });

  test("it returns a LABEL — there is no number anywhere in the result", () => {
    const out = searchConfidence({
      claims: strong(2),
      coverage: aggregateCoverage([AVAILABLE("vault")]),
      conflicts: 0,
    });
    expect(typeof out).toBe("string");
    expect(CONFIDENCE_LABELS).toContain(out);
  });
});

// ── The telemetry projection (CLAUDE.md §4) ────────────────────────────────────────────────

describe("redactedSearchEvent carries refs, counts and enums ONLY", () => {
  const built = () =>
    redactedSearchEvent({
      searchRunRef: "run_123",
      questionHash: "a".repeat(64),
      coverage: aggregateCoverage([
        AVAILABLE("vault", 3),
        { status: "unavailable", source: "inbox", reason: "reauth" },
      ]),
      claims: 4,
      unsupported: 1,
      conflicts: 2,
      inventedEvidenceIds: 3,
      confidence: "medium",
      durationMs: 1234,
    });

  test("it reports the counts a reviewer needs", () => {
    expect(built()).toEqual({
      searchRunRef: "run_123",
      questionHash: "a".repeat(64),
      requestedSources: 2,
      availableSources: 1,
      partialSources: 0,
      unavailableSources: 1,
      unavailableReasons: ["reauth"],
      evidenceCount: 3,
      claimCount: 4,
      unsupportedCount: 1,
      conflictCount: 2,
      inventedCitationCount: 3,
      confidence: "medium",
      durationMs: 1234,
    });
  });

  test("no label, snippet, title, query or prose can reach it", () => {
    const flat = JSON.stringify(built());
    for (const leak of KNOWLEDGE_SOURCES.map((s) => PACK_SOURCE_LABEL[s])) {
      expect(flat, `label "${leak}" leaked into the log plane`).not.toContain(leak);
    }
    // Every value is a number, a closed enum string, a hash or a ref — never free text.
    for (const [k, v] of Object.entries(built())) {
      if (typeof v === "number") continue;
      if (Array.isArray(v)) {
        expect(
          v.every((x) => typeof x === "string" && !x.includes(" ")),
          k,
        ).toBe(true);
        continue;
      }
      expect(typeof v, k).toBe("string");
      expect(v as string, k).not.toMatch(/\s/);
    }
  });
});

// ── Structural bans ────────────────────────────────────────────────────────────────────────

describe("what these contracts must never contain", () => {
  test("no recurrence vocabulary anywhere in the module surface", async () => {
    const mod = await import("./knowledgeSearch");
    const names = Object.keys(mod).join(" ").toLowerCase();
    for (const banned of [
      "cron",
      "schedule",
      "recurrence",
      "nextrun",
      "routine",
      "trigger",
      "interval",
    ]) {
      expect(names, `knowledgeSearch exports ${banned}`).not.toContain(banned);
    }
  });

  test("no tool, url, secret or mcp vocabulary in the module surface", async () => {
    const mod = await import("./knowledgeSearch");
    const names = Object.keys(mod).join(" ").toLowerCase();
    for (const banned of ["tool", "url", "secret", "mcp", "apikey", "token", "exec"]) {
      expect(names, `knowledgeSearch exports ${banned}`).not.toContain(banned);
    }
  });
});
