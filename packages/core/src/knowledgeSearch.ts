// Phase 29 (KNOW-01) — the pure contracts for unified native search.
//
// WHAT THIS FILE IS FOR: making it structurally impossible for a search that could not reach a
// source to report "nothing exists". Every honesty rule the phase depends on — source availability,
// authority, freshness, confidence, citation validity, conflict retention — is decided HERE, in
// code, before any adapter or model is involved.
//
// WHAT THE MODEL MAY SUPPLY: a source from `KNOWLEDGE_SOURCES`, one short query per source, claim
// text, evidence ids and an optional excerpt. NOTHING ELSE. It never supplies an adapter, a URL, an
// MCP server, a tool name, a tenant id, a result limit, an authority class, a freshness value or a
// confidence. Those are all computed below from the evidence table.
//
// STRUCTURALLY ABSENT, and enforced by `knowledgeSearch.test.ts`: recurrence vocabulary, tool
// fields, executable code, secrets, remote URLs and MCP config.
//
// ponytail: no hash function lives here. Dedupe groups on the NORMALIZED TEXT ITSELF, which is
// exact rather than probabilistic and costs one Map over a corpus already capped at
// `SEARCH_CAPS.totalEvidenceCharCap`. Upgrade path if that cap ever rises past a megabyte: key the
// Map on `convex/lib/hash.ts`'s existing SHA-256 `contentHash`, computed in the adapter and passed
// in — do not add a second hash implementation to this repo.
import { err, ok, type Result } from "./result";

// ── The closed native-source registry ──────────────────────────────────────────────────────

/**
 * The only sources that exist. Defined in code, never in a skill body or a tenant row — a source
 * the product did not build is not something a prompt can talk itself into.
 */
export const KNOWLEDGE_SOURCES = [
  "vault",
  "drive",
  "gmail",
  "crm",
  "support",
] as const satisfies readonly string[];
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

export function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return typeof value === "string" && (KNOWLEDGE_SOURCES as readonly string[]).includes(value);
}

/** What the user is told a source IS. Code-owned so five adapters cannot each name it differently. */
export const KNOWLEDGE_SOURCE_LABEL: Readonly<Record<KnowledgeSource, string>> = {
  vault: "your knowledge vault",
  drive: "your Google Drive",
  gmail: "your mailbox",
  crm: "your connected CRM",
  support: "your connected support inbox",
};

/**
 * Sources with NO landed adapter (29-DEPENDENCY-EVIDENCE §2: Phase 28 shipped contracts only —
 * zero connector tables, zero credential encryption, zero provider modules).
 *
 * Naming them here is deliberate and is the opposite of pretending they work: a planned `crm`
 * search becomes `unavailable/not_landed`, which renders as a visible gap. Deleting these two from
 * `KNOWLEDGE_SOURCES` instead would make the product silently answer business questions from
 * mail and files while never mentioning that the CRM was not consulted.
 */
export const NOT_LANDED_SOURCES = ["crm", "support"] as const satisfies readonly KnowledgeSource[];

function isNotLanded(source: KnowledgeSource): boolean {
  return (NOT_LANDED_SOURCES as readonly string[]).includes(source);
}

// ── Availability ───────────────────────────────────────────────────────────────────────────

/** Every way a source read can fail to happen. Closed, so a new failure needs a deliberate name. */
export const UNAVAILABLE_REASONS = [
  "not_connected",
  "reauth",
  "refresh_failed",
  "provider_error",
  "not_landed",
  /** The planner never named this source, so it was not searched. Not the same as empty. */
  "unplanned",
] as const satisfies readonly string[];
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** Why a source answered, but not fully. */
export const PARTIAL_REASONS = ["cap", "provider_error"] as const satisfies readonly string[];
export type PartialReason = (typeof PARTIAL_REASONS)[number];

/**
 * The three — and only three — ways a source read can end, mirroring `@pikar/revenue`'s
 * `Projection` (29-DEPENDENCY-EVIDENCE §2.4).
 *
 * `unavailable` CANNOT carry a count. That is the point: the type makes "reauth failed, so zero
 * results, so nothing exists" unspellable rather than merely discouraged.
 */
export type KnowledgeSourceState =
  | { readonly status: "available"; readonly source: KnowledgeSource; readonly returned: number }
  | {
      readonly status: "partial";
      readonly source: KnowledgeSource;
      readonly returned: number;
      readonly reason: PartialReason;
    }
  | {
      readonly status: "unavailable";
      readonly source: KnowledgeSource;
      readonly reason: UnavailableReason;
    };

// ── Caps ───────────────────────────────────────────────────────────────────────────────────

/** Bounds owned by THIS repo, never by a provider's pagination cursor or a model's ambition. */
export const SEARCH_CAPS = {
  /** At most one fan-out per registered source. */
  maxSources: 5,
  /** One query per source in the first release. Widening this is a planner change, not a tweak. */
  maxQueriesPerSource: 1,
  /** A decomposed query is a phrase, not a document. */
  queryCharCap: 200,
  maxEvidencePerSource: 8,
  maxEvidenceTotal: 24,
  /** Matches `vaultGround.ts` PER_DOC_CHAR_CAP so vault evidence needs no second truncation. */
  evidenceTextCharCap: 1_500,
  /** Matches `vaultGround.ts` TOTAL_CHAR_CAP — the synthesis-plane budget. */
  totalEvidenceCharCap: 8_000,
  /** A quoted passage, not a re-print of the document. */
  excerptCharCap: 300,
  maxClaims: 12,
  /** A content-plane label (doc title, file name). */
  labelCharCap: 200,
  /** Long enough for a real provider id, far short of a pasted record. */
  refCharCap: 128,
} as const;

// ── Source refs are refs (CLAUDE.md §4) ────────────────────────────────────────────────────

/** Straight AND curly quotes plus whitespace: a possessive ("Acme's invoice") is the real leak. */
const CONTENT_SHAPED = /["'‘’“”\n\r\t]/;

/**
 * A `sourceRef` must be an opaque provider/native id, never the thing it points at. Same shape as
 * `@pikar/revenue`'s `validateSourceRef`, deliberately re-stated rather than imported: coupling
 * `@pikar/core` to `@pikar/revenue` for a ten-line predicate would be an abstraction nobody asked
 * for, and the two domains' caps are free to diverge.
 */
export function validateSourceRef(refValue: string): Result<true, string> {
  if (typeof refValue !== "string" || refValue.trim() === "") return err("A ref cannot be empty.");
  if (refValue.length > SEARCH_CAPS.refCharCap) return err("A ref is too long to be an id.");
  if (CONTENT_SHAPED.test(refValue)) return err("A ref must be an id, not content.");
  return ok(true);
}

// ── Authority ──────────────────────────────────────────────────────────────────────────────

/**
 * Ordered STRONGEST to WEAKEST. `authorityFor` and every claim-level rollup take the weakest of
 * what was cited, so a strong source cannot launder a weak one.
 */
export const AUTHORITY_CLASSES = [
  /** The tenant's own documents and files. */
  "tenant_owned",
  /** A system that owns the fact (CRM, support desk). */
  "system_of_record",
  /** What somebody said in the mailbox. Not a record of anything. */
  "correspondence",
  /** A web page that happens to be stored in the vault. Retrieval location is not provenance. */
  "third_party_research",
  /**
   * The AGENT wrote it and the owner promoted it (26-11 `origins: "agent_promoted"`, ADR-025).
   * Weakest on purpose: a citation of the model's own earlier output must never read back as the
   * owner's own word. This is the provenance-laundering door, closed here rather than in the UI.
   */
  "agent_authored",
] as const satisfies readonly string[];
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

const AUTHORITY_RANK: Readonly<Record<AuthorityClass, number>> = {
  tenant_owned: 0,
  system_of_record: 1,
  correspondence: 2,
  third_party_research: 3,
  agent_authored: 4,
};

/** The weakest of a set. An empty set is the weakest class — absence is never a strong claim. */
export function weakestAuthority(classes: readonly AuthorityClass[]): AuthorityClass {
  let worst: AuthorityClass = "agent_authored";
  if (classes.length === 0) return worst;
  worst = "tenant_owned";
  for (const c of classes) if (AUTHORITY_RANK[c] > AUTHORITY_RANK[worst]) worst = c;
  return worst;
}

const SOURCE_AUTHORITY: Readonly<Record<KnowledgeSource, AuthorityClass>> = {
  vault: "tenant_owned",
  drive: "tenant_owned",
  gmail: "correspondence",
  crm: "system_of_record",
  support: "system_of_record",
};

/**
 * The fixed adapter mapping, plus the two vault downgrades. The model supplies none of this.
 *
 * `docKind` is `vaultDocuments.kind` and `origin` is `vaultDocuments.origin` — both server facts
 * already carried on the row and already surfaced by `vaultGroundHydrated`'s `origins` array.
 */
export function authorityFor(
  source: KnowledgeSource,
  meta: { readonly docKind?: string; readonly origin?: string },
): AuthorityClass {
  const candidates: AuthorityClass[] = [SOURCE_AUTHORITY[source]];
  if (source === "vault" && meta.docKind === "web_research")
    candidates.push("third_party_research");
  if (meta.origin === "agent_promoted") candidates.push("agent_authored");
  return weakestAuthority(candidates);
}

// ── Freshness ──────────────────────────────────────────────────────────────────────────────

export const FRESHNESS_LABELS = [
  "current",
  "recent",
  "stale",
  /** No usable source timestamp. NOT a synonym for fresh, and ranked with `stale`. */
  "unknown",
] as const satisfies readonly string[];
export type Freshness = (typeof FRESHNESS_LABELS)[number];

const CURRENT_WITHIN_MS = 30 * 86_400_000;
const RECENT_WITHIN_MS = 365 * 86_400_000;

/** Ordering for "the oldest thing this claim rests on". `unknown` sorts with the worst. */
const FRESHNESS_RANK: Readonly<Record<Freshness, number>> = {
  current: 0,
  recent: 1,
  stale: 2,
  unknown: 3,
};

export function oldestFreshness(values: readonly Freshness[]): Freshness {
  if (values.length === 0) return "unknown";
  let worst: Freshness = "current";
  for (const f of values) if (FRESHNESS_RANK[f] > FRESHNESS_RANK[worst]) worst = f;
  return worst;
}

/**
 * Age from the SOURCE-UPDATED timestamp only. A date parsed out of prose is a model guess wearing
 * a number's clothes, and this function deliberately cannot see prose.
 *
 * A future timestamp is `unknown`, not maximally fresh: provider clock skew and a bad import both
 * produce one, and treating it as current would make the freshest-looking evidence the least
 * trustworthy.
 */
export function freshnessFor(evidence: Evidence, now: number): Freshness {
  const updated = evidence.sourceUpdatedAt;
  if (typeof updated !== "number" || !Number.isFinite(updated)) return "unknown";
  const age = now - updated;
  if (age < 0) return "unknown";
  if (age <= CURRENT_WITHIN_MS) return "current";
  if (age <= RECENT_WITHIN_MS) return "recent";
  return "stale";
}

// ── Evidence ───────────────────────────────────────────────────────────────────────────────

export type Evidence = {
  /** Server-minted and LOCAL TO ONE RUN. The model cites these; it cannot mint one. */
  readonly evidenceId: string;
  readonly source: KnowledgeSource;
  /** Stable provider/native ref. Refs only — see `validateSourceRef`. */
  readonly sourceRef: string;
  /** CONTENT PLANE ONLY. A doc title / file name / subject. Never reaches an audit payload. */
  readonly label: string;
  /** SYNTHESIS PLANE ONLY. Bounded. Never reaches a tool-bearing loop or an audit payload. */
  readonly text: string;
  /** From `authorityFor`. Never from the model. */
  readonly authority: AuthorityClass;
  /** Provider modification time when the adapter has one. Absent is `unknown`, not fresh. */
  readonly sourceUpdatedAt?: number;
  readonly retrievedAt: number;
};

/**
 * The comparison form used for RELATED grouping. Folds line endings, collapses runs of whitespace
 * and lowercases — nothing else. It is not a summary, not a stem and not a fingerprint: two texts
 * that normalize equal really are the same characters.
 */
export function normalizeEvidenceText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim().toLowerCase();
}

export type EvidenceGroup = {
  readonly primary: Evidence;
  /** The SAME record (source + sourceRef) read more than once. Safe to collapse. */
  readonly duplicates: readonly Evidence[];
  /**
   * A DIFFERENT record whose text is identical. Cross-referenced, never merged and never deleted —
   * every source ref survives, because "two systems agree" and "one system was read twice" are
   * different facts and only the second is a duplicate.
   */
  readonly related: readonly Evidence[];
};

/**
 * Deterministic deduplication. Exact identity collapses; identical content across DIFFERENT records
 * is cross-linked; anything else is left alone.
 *
 * There is deliberately no semantic/fuzzy tier. Asking a model which near-matches are "the same"
 * is how a $40 rate and a $60 rate become one confident answer.
 */
export function dedupeEvidence(items: readonly Evidence[]): {
  readonly groups: readonly EvidenceGroup[];
  /** How many rows were absorbed as exact duplicates. Reported, never silently swallowed. */
  readonly collapsed: number;
} {
  const byIdentity = new Map<string, { primary: Evidence; duplicates: Evidence[] }>();
  const order: string[] = [];
  let collapsed = 0;

  for (const item of items) {
    const identity = `${item.source}|${item.sourceRef}`;
    const existing = byIdentity.get(identity);
    if (existing) {
      existing.duplicates.push(item);
      collapsed += 1;
      continue;
    }
    byIdentity.set(identity, { primary: item, duplicates: [] });
    order.push(identity);
  }

  const entries = order.map(
    (k) => byIdentity.get(k) as { primary: Evidence; duplicates: Evidence[] },
  );
  const normalized = entries.map((e) => normalizeEvidenceText(e.primary.text));

  const groups: EvidenceGroup[] = entries.map((entry, i) => ({
    primary: entry.primary,
    duplicates: entry.duplicates,
    related: entries
      .filter((_, j) => j !== i && normalized[j] === normalized[i])
      .map((e) => e.primary),
  }));

  return { groups, collapsed };
}

// ── The planner boundary ───────────────────────────────────────────────────────────────────

export type SourcePlan = { readonly source: KnowledgeSource; readonly query: string };

export const PLAN_REJECTIONS = [
  "unknown_source",
  "duplicate_source",
  "empty_query",
  "query_too_long",
  "remote_url",
  "source_cap",
] as const satisfies readonly string[];
export type PlanRejection = (typeof PLAN_REJECTIONS)[number];

/** Any scheme-qualified or bare-host address. The model has no business naming a remote endpoint. */
const REMOTE_ADDRESS = /(\b[a-z][a-z0-9+.-]*:\/\/)|(\bwww\.)/i;

/**
 * The one place planner output crosses into this system. Everything the model wrote is re-checked
 * here, in code, against the code-owned registry and caps.
 *
 * A NOT-LANDED source does not come back as a rejection: a rejection means the planner misbehaved,
 * while `crm` is a real product gap the user must be shown. It comes back as a ready-made
 * `unavailable/not_landed` state so the coordinator can render the gap without inventing one.
 */
export function clampSearchPlan(raw: readonly unknown[]): {
  readonly plan: readonly SourcePlan[];
  readonly rejected: readonly { readonly source: string; readonly reason: PlanRejection }[];
  readonly notLanded: readonly KnowledgeSourceState[];
} {
  const plan: SourcePlan[] = [];
  const rejected: { source: string; reason: PlanRejection }[] = [];
  const notLanded: KnowledgeSourceState[] = [];
  const seen = new Set<KnowledgeSource>();

  for (const entry of raw) {
    const candidate = (entry ?? {}) as { source?: unknown; query?: unknown };
    const source = candidate.source;
    if (!isKnowledgeSource(source)) {
      rejected.push({
        source: typeof source === "string" ? source : String(source),
        reason: "unknown_source",
      });
      continue;
    }
    if (seen.has(source)) {
      rejected.push({ source, reason: "duplicate_source" });
      continue;
    }
    if (isNotLanded(source)) {
      seen.add(source);
      notLanded.push({ status: "unavailable", source, reason: "not_landed" });
      continue;
    }
    const query = typeof candidate.query === "string" ? candidate.query.trim() : "";
    if (query === "") {
      rejected.push({ source, reason: "empty_query" });
      continue;
    }
    if (query.length > SEARCH_CAPS.queryCharCap) {
      rejected.push({ source, reason: "query_too_long" });
      continue;
    }
    if (REMOTE_ADDRESS.test(query)) {
      rejected.push({ source, reason: "remote_url" });
      continue;
    }
    if (plan.length >= SEARCH_CAPS.maxSources) {
      rejected.push({ source, reason: "source_cap" });
      continue;
    }
    seen.add(source);
    plan.push({ source, query });
  }

  return { plan, rejected, notLanded };
}

// ── Synthesis validation ───────────────────────────────────────────────────────────────────

export type SynthesisClaim = {
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly excerpt?: string;
  readonly conflictEvidenceIds?: readonly string[];
};

export type SearchSynthesis = {
  readonly summary: string;
  readonly claims: readonly SynthesisClaim[];
  readonly unanswered: readonly string[];
};

export const CLAIM_REJECTIONS = [
  "no_known_evidence",
  "empty_text",
  "claim_cap",
] as const satisfies readonly string[];
export type ClaimRejection = (typeof CLAIM_REJECTIONS)[number];

export type ValidatedClaim = {
  readonly text: string;
  /** Known ids only, deduplicated, in the order the model cited them. */
  readonly evidenceIds: readonly string[];
  /** Known ids only. Retained on purpose — this is the disagreement the answer must show. */
  readonly conflictEvidenceIds: readonly string[];
  /** `null` when absent OR when it failed substring verification. */
  readonly excerpt: string | null;
  readonly excerptDropped: boolean;
  /** Weakest authority among the cited evidence. From the table, never from the model. */
  readonly authority: AuthorityClass;
  /** Oldest freshness among the cited evidence. From timestamps, never from prose. */
  readonly freshness: Freshness;
};

/**
 * Everything a model wrote, re-checked against the evidence table it was given.
 *
 * The four rules, in order of how badly each has burned this repo before:
 *  1. An evidence id the run did not mint is REMOVED and COUNTED. A claim left with none becomes
 *     `unsupported` — never a cited claim, never silently deleted.
 *  2. An excerpt must be a literal substring of the evidence THIS CLAIM CITED. A quote lifted from
 *     a different document is a fabrication even though every character is real.
 *  3. An invalid excerpt drops the EXCERPT, not the claim (the Phase 14 rule).
 *  4. Authority and freshness are attached here, from the table. A model-supplied `authority`,
 *     `confidence` or `probability` field is not read, not copied and not returned.
 */
export function validateSynthesis(
  synthesis: SearchSynthesis,
  evidence: readonly Evidence[],
  now: number,
): {
  readonly claims: readonly ValidatedClaim[];
  readonly unsupported: readonly { readonly text: string; readonly reason: ClaimRejection }[];
  readonly unanswered: readonly string[];
  /** Ids the model produced that no adapter ever minted. The invented-citation signal. */
  readonly inventedEvidenceIds: readonly string[];
  readonly conflicts: number;
} {
  const table = new Map(evidence.map((e) => [e.evidenceId, e]));
  const claims: ValidatedClaim[] = [];
  const unsupported: { text: string; reason: ClaimRejection }[] = [];
  const invented: string[] = [];
  let conflicts = 0;

  const noteUnknown = (id: string) => {
    if (!invented.includes(id)) invented.push(id);
  };

  for (const raw of synthesis.claims) {
    const text = typeof raw.text === "string" ? raw.text.trim() : "";

    const cited: string[] = [];
    for (const id of raw.evidenceIds ?? []) {
      if (!table.has(id)) {
        noteUnknown(id);
        continue;
      }
      if (!cited.includes(id)) cited.push(id);
    }

    const conflicting: string[] = [];
    for (const id of raw.conflictEvidenceIds ?? []) {
      if (!table.has(id)) {
        noteUnknown(id);
        continue;
      }
      if (!conflicting.includes(id)) conflicting.push(id);
    }

    // Text is checked BEFORE citations so an empty claim reports the reason a human can act on.
    if (text === "") {
      unsupported.push({ text: raw.text ?? "", reason: "empty_text" });
      continue;
    }
    if (cited.length === 0) {
      unsupported.push({ text, reason: "no_known_evidence" });
      continue;
    }
    if (claims.length >= SEARCH_CAPS.maxClaims) {
      unsupported.push({ text, reason: "claim_cap" });
      continue;
    }

    const citedRows = cited.map((id) => table.get(id) as Evidence);

    let excerpt: string | null = null;
    let excerptDropped = false;
    if (typeof raw.excerpt === "string" && raw.excerpt.trim() !== "") {
      const candidate = raw.excerpt.trim();
      const haystack = citedRows.map((r) => normalizeEvidenceText(r.text));
      const needle = normalizeEvidenceText(candidate);
      const verified =
        candidate.length <= SEARCH_CAPS.excerptCharCap && haystack.some((h) => h.includes(needle));
      if (verified) excerpt = candidate;
      else excerptDropped = true;
    }

    conflicts += conflicting.length > 0 ? 1 : 0;

    claims.push({
      text,
      evidenceIds: cited,
      conflictEvidenceIds: conflicting,
      excerpt,
      excerptDropped,
      authority: weakestAuthority(citedRows.map((r) => r.authority)),
      freshness: oldestFreshness(citedRows.map((r) => freshnessFor(r, now))),
    });
  }

  const unanswered = (synthesis.unanswered ?? [])
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter((u) => u !== "");

  return { claims, unsupported, unanswered, inventedEvidenceIds: invented, conflicts };
}

// ── Coverage ───────────────────────────────────────────────────────────────────────────────

export type CoverageGap = {
  readonly source: KnowledgeSource;
  readonly reason: UnavailableReason | PartialReason;
};

export type SourceCoverage = {
  readonly requested: number;
  readonly available: number;
  readonly partial: number;
  readonly unavailable: number;
  /** Rows actually returned, across the sources that answered. */
  readonly returned: number;
  readonly states: readonly KnowledgeSourceState[];
  /** True ONLY when every requested source answered fully. Fails closed on an empty request. */
  readonly complete: boolean;
  /** Non-empty means the answer MUST carry a gap statement beside it. */
  readonly gaps: readonly CoverageGap[];
};

/**
 * Roll per-source states into the honest-coverage summary the answer is rendered beside.
 *
 * An `available` source that returned zero rows is COMPLETE and has no gap: "we looked and there is
 * nothing" is a true answer. An `unavailable` source with the same zero rows is a GAP. The whole
 * KNOW-01 honesty requirement is that distinction, so it is made once, here.
 */
export function aggregateCoverage(states: readonly KnowledgeSourceState[]): SourceCoverage {
  let available = 0;
  let partial = 0;
  let unavailable = 0;
  let returned = 0;
  const gaps: CoverageGap[] = [];

  for (const s of states) {
    if (s.status === "available") {
      available += 1;
      returned += s.returned;
      continue;
    }
    if (s.status === "partial") {
      partial += 1;
      returned += s.returned;
      gaps.push({ source: s.source, reason: s.reason });
      continue;
    }
    unavailable += 1;
    gaps.push({ source: s.source, reason: s.reason });
  }

  return {
    requested: states.length,
    available,
    partial,
    unavailable,
    returned,
    states,
    // Asking nothing is not completeness. Zero requested sources means the run never happened.
    complete: states.length > 0 && gaps.length === 0,
    gaps,
  };
}

const UNAVAILABLE_SENTENCE: Readonly<Record<UnavailableReason, string>> = {
  not_connected: "is not connected yet, so it was not searched",
  reauth: "needs to be reconnected, so it was not searched",
  refresh_failed: "could not be reached just now, so it was not searched",
  provider_error: "returned an error, so it was not searched",
  not_landed: "is not available in Pikar yet, so it was not searched",
  unplanned: "was not part of this search",
};

const PARTIAL_SENTENCE: Readonly<Record<PartialReason, string>> = {
  cap: "was searched, but only the first {n} results were read",
  provider_error: "was searched, but stopped after {n} results because of an error",
};

/**
 * The user-facing gap sentence. `null` for an available source, so the caller renders nothing.
 *
 * These strings deliberately never say "no results" or "nothing": the whole failure mode this
 * phase exists to prevent is an unreachable source reading as an empty business.
 */
export function renderSourceGap(state: KnowledgeSourceState): string | null {
  if (state.status === "available") return null;
  const label = KNOWLEDGE_SOURCE_LABEL[state.source];
  if (state.status === "unavailable") return `${label} ${UNAVAILABLE_SENTENCE[state.reason]}.`;
  return `${label} ${PARTIAL_SENTENCE[state.reason].replace("{n}", String(state.returned))}.`;
}

// ── Confidence ─────────────────────────────────────────────────────────────────────────────

/** A LABEL, weakest first. Never a probability — the model does not author a number here. */
export const CONFIDENCE_LABELS = [
  "unsupported",
  "low",
  "medium",
  "high",
] as const satisfies readonly string[];
export type SearchConfidence = (typeof CONFIDENCE_LABELS)[number];

/**
 * Confidence is arithmetic over facts the code already holds: how much cited evidence there is,
 * how weak its authority is, how old it is, whether every source answered, and whether anything
 * disagreed. Each rule is a separate cap so that removing any one of them is individually visible
 * in `knowledgeSearch.test.ts`.
 */
export function searchConfidence(input: {
  readonly claims: readonly Pick<ValidatedClaim, "evidenceIds" | "authority" | "freshness">[];
  readonly coverage: SourceCoverage;
  readonly conflicts: number;
}): SearchConfidence {
  const { claims, coverage, conflicts } = input;
  if (claims.length === 0) return "unsupported";

  const citations = new Set(claims.flatMap((c) => c.evidenceIds));
  let level = 3; // high

  // A gap in coverage means the answer is drawn from part of the business.
  if (coverage.gaps.length > 0) level = Math.min(level, 2);
  // Weak provenance: a web page, or the agent's own earlier words.
  if (
    AUTHORITY_RANK[weakestAuthority(claims.map((c) => c.authority))] >=
    AUTHORITY_RANK.third_party_research
  )
    level = Math.min(level, 2);
  // Old, or undatable.
  if (FRESHNESS_RANK[oldestFreshness(claims.map((c) => c.freshness))] >= FRESHNESS_RANK.stale)
    level = Math.min(level, 2);
  // Disagreement caps confidence AND stays visible — it is never resolved away.
  if (conflicts > 0) level = Math.min(level, 2);
  // One source of truth for the whole answer is a single point of failure, not a consensus.
  if (citations.size < 2) level = Math.min(level, 1);

  return level >= 3 ? "high" : level === 2 ? "medium" : "low";
}

// ── The log-plane projection (CLAUDE.md §4) ────────────────────────────────────────────────

/**
 * Refs, hashes, ids, counts and closed enums ONLY. No label, snippet, title, sender, subject, file
 * name, URL, query or prose — those live on the content plane beside the answer, where the user
 * reads them and the log never does.
 *
 * This is a pure projection rather than a writer so the ban is testable without a database.
 */
export function redactedSearchEvent(input: {
  readonly searchRunRef: string;
  readonly questionHash: string;
  readonly coverage: SourceCoverage;
  readonly claims: number;
  readonly unsupported: number;
  readonly conflicts: number;
  readonly inventedEvidenceIds: number;
  readonly confidence: SearchConfidence;
  readonly durationMs: number;
}) {
  const { coverage } = input;
  return {
    searchRunRef: input.searchRunRef,
    questionHash: input.questionHash,
    requestedSources: coverage.requested,
    availableSources: coverage.available,
    partialSources: coverage.partial,
    unavailableSources: coverage.unavailable,
    // Closed enum values, so a reason cannot smuggle a provider message out with it.
    unavailableReasons: coverage.states
      .filter(
        (s): s is Extract<KnowledgeSourceState, { status: "unavailable" }> =>
          s.status === "unavailable",
      )
      .map((s) => s.reason),
    evidenceCount: coverage.returned,
    claimCount: input.claims,
    unsupportedCount: input.unsupported,
    conflictCount: input.conflicts,
    inventedCitationCount: input.inventedEvidenceIds,
    confidence: input.confidence,
    durationMs: input.durationMs,
  } as const;
}
