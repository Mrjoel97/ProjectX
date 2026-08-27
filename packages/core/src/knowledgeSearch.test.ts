// Phase 29 (KNOW-01) — the pure search contracts.
//
// These tests exist to make ONE class of lie impossible: a search that could not reach a source
// reporting "nothing exists". Every branch below has a named mutation recorded in 29-01-SUMMARY.md
// that turns it red.
import { describe, expect, test } from "vitest";
import {
  AUTHORITY_CLASSES,
  aggregateCoverage,
  authorityFor,
  CONFIDENCE_LABELS,
  clampSearchPlan,
  dedupeEvidence,
  type Evidence,
  freshnessFor,
  isKnowledgeSource,
  KNOWLEDGE_SOURCE_LABEL,
  KNOWLEDGE_SOURCES,
  type KnowledgeSourceState,
  NOT_LANDED_SOURCES,
  normalizeEvidenceText,
  redactedSearchEvent,
  renderSourceGap,
  SEARCH_CAPS,
  searchConfidence,
  validateSourceRef,
  validateSynthesis,
} from "./knowledgeSearch";

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
    expect([...KNOWLEDGE_SOURCES]).toEqual(["vault", "drive", "gmail", "crm", "support"]);
  });

  test("a source outside the enum is refused, never defaulted", () => {
    expect(isKnowledgeSource("vault")).toBe(true);
    for (const bad of ["notion", "mcp", "web", "__proto__", "constructor", "", "VAULT"]) {
      expect(isKnowledgeSource(bad), `${bad} was accepted as a source`).toBe(false);
    }
  });

  test("every source has a user-facing label, so no adapter can name itself", () => {
    for (const s of KNOWLEDGE_SOURCES) {
      expect(KNOWLEDGE_SOURCE_LABEL[s].length).toBeGreaterThan(0);
    }
  });

  test("crm and support are recorded as NOT LANDED — the Phase 28 half that does not exist", () => {
    expect([...NOT_LANDED_SOURCES]).toEqual(["crm", "support"]);
    for (const s of NOT_LANDED_SOURCES) expect(KNOWLEDGE_SOURCES).toContain(s);
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
      { source: "gmail", query: "pricing" },
    ]);
    expect(out.plan).toEqual([
      { source: "vault", query: "pricing policy" },
      { source: "gmail", query: "pricing" },
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
      { source: "crm", query: "revenue" },
    ]);
    expect(out.plan.map((p) => p.source)).toEqual(["vault"]);
    expect(out.notLanded).toEqual([{ status: "unavailable", source: "crm", reason: "not_landed" }]);
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

  test("the source cap holds even if the planner names more sources than exist", () => {
    const raw = KNOWLEDGE_SOURCES.filter((s) => !NOT_LANDED_SOURCES.includes(s as never)).map(
      (source) => ({ source, query: "q" }),
    );
    const out = clampSearchPlan([...raw, ...raw]);
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
    ]) {
      expect(validateSourceRef(bad).ok, `${JSON.stringify(bad)} passed as a ref`).toBe(false);
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
    expect(authorityFor("gmail", {})).toBe("correspondence");
    expect(authorityFor("crm", {})).toBe("system_of_record");
    expect(authorityFor("support", {})).toBe("system_of_record");
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
  test("the same record read twice collapses to one group", () => {
    const a = ev({ evidenceId: "e1", source: "vault", sourceRef: "doc_9" });
    const b = ev({ evidenceId: "e2", source: "vault", sourceRef: "doc_9" });
    const out = dedupeEvidence([a, b]);
    expect(out.groups).toHaveLength(1);
    expect(first(out.groups).primary.evidenceId).toBe("e1");
    expect(first(out.groups).duplicates.map((d) => d.evidenceId)).toEqual(["e2"]);
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
      ev({ evidenceId: "e2", source: "gmail", sourceRef: "d2", text: "Price is $60." }),
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

// ── Synthesis validation — the citation firewall ───────────────────────────────────────────

const EVIDENCE: Evidence[] = [
  ev({ evidenceId: "e1", sourceRef: "d1", text: "Our standard rate is $40 per hour." }),
  ev({
    evidenceId: "e2",
    source: "gmail",
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
      { status: "unavailable", source: "gmail", reason: "reauth" },
    ]);
    expect(c.complete).toBe(false);
    expect(c.unavailable).toBe(1);
    expect(c.gaps).toEqual([{ source: "gmail", reason: "reauth" }]);
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
    const c = aggregateCoverage([{ status: "unavailable", source: "crm", reason: "not_landed" }]);
    expect(c.gaps).toEqual([{ source: "crm", reason: "not_landed" }]);
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
      const line = renderSourceGap({ status: "unavailable", source: "gmail", reason });
      // An unavailable state ALWAYS renders a sentence. Silence here is the bug this file exists for.
      expect(line, reason).not.toBeNull();
      expect(String(line), reason).toContain(KNOWLEDGE_SOURCE_LABEL.gmail);
      expect(String(line).length, reason).toBeGreaterThan(KNOWLEDGE_SOURCE_LABEL.gmail.length + 5);
    }
  });

  test("the rendered sentence never claims nothing exists", () => {
    const line = renderSourceGap({ status: "unavailable", source: "crm", reason: "not_landed" });
    expect(String(line).toLowerCase()).not.toContain("no results");
    expect(String(line).toLowerCase()).not.toContain("nothing");
  });

  test("a partial source renders how many it saw, not a total", () => {
    const line = renderSourceGap({
      status: "partial",
      source: "drive",
      returned: 8,
      reason: "cap",
    });
    expect(String(line)).toContain("8");
    expect(String(line)).toContain(KNOWLEDGE_SOURCE_LABEL.drive);
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
          { status: "unavailable", source: "crm", reason: "not_landed" },
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
        { status: "unavailable", source: "gmail", reason: "reauth" },
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
    for (const leak of Object.values(KNOWLEDGE_SOURCE_LABEL)) {
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
