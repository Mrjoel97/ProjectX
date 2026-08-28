// The audit VIEWER contract (RPRT-01): what an `audit` row is allowed to become in a browser.
//
// WHY THIS EXISTS AT ALL — the mockup was wrong. `docs/design/mockups/pending-pages.html` states
// the governance table is "safe by construction, not by filtering" because audit rows carry refs
// and counts only. That is a claim about the SCHEMA, and the schema does not make it:
// `audit.log` declares `payload: v.any()` and then assigns it to an `AuditPayload` — an interface,
// erased at runtime, assigned out of `any` with no check. ~96 write sites feed that field, and one
// of them already violates the contract: `piiCounts: Record<string, number>` is a NESTED OBJECT in
// production rows today (intake.ts:253, pipeline.ts:196, vaultExtract.ts:497). `AuditPayload` says
// nested objects are "not representable"; they are representable, they are simply not TYPED.
//
// So the viewer is safe by FILTERING, and this module is the filter. Two independent gates, and
// the second is the one that survives a future write site nobody reviewed:
//
//   1. KEY — a per-event allowlist. A key not named for that exact event never appears. An event
//      not in the table at all yields a shell (timestamp, actor, correlation) and no payload
//      detail whatsoever. This fails CLOSED: a new event added in a later phase shows less than it
//      could until someone adds a row here, which is the direction a privacy boundary should fail.
//   2. SHAPE — every surviving value must still be a bounded, whitespace-free, markup-free
//      primitive or an array of them. An allowlisted key whose value is prose is dropped AND
//      counted, because an allowlisted key is a promise about a shape and a broken promise is a
//      signal, not a silent pass.
//
// The raw payload is NEVER stringified as a fallback. There is no `else` branch that reaches for
// JSON.stringify — that single line is how every one of these boundaries has historically leaked.

/** Longest string a ref may carry. Over this it is DROPPED, never truncated — half a body is a body. */
export const MAX_REF_STRING_LENGTH = 128;

/** Longest string array a ref may carry. */
export const MAX_REF_ARRAY_LENGTH = 50;

/** What survives the projection: bounded scalars and bounded string arrays. Nothing nested. */
export type AuditViewerValue = string | number | boolean | readonly string[];

/** The closed actor set. A raw user/tenant id NEVER reaches the browser as itself. */
export type AuditViewerActor = "you" | "system" | "agent" | "owner";

export type AuditViewerRow = {
  /** Epoch ms, straight off the row. */
  readonly ts: number;
  /** The event literal when it is a safe token, else "unknown". */
  readonly eventType: string;
  /** The event namespace, from the derived closed set; "other" for anything unrecognised. */
  readonly category: string;
  readonly actor: AuditViewerActor;
  /** The correlation id when it is a safe token, else "" — never echoed raw. */
  readonly correlationRef: string;
  /** Allowlisted, shape-checked payload entries. Empty for an unknown event. */
  readonly refs: Readonly<Record<string, AuditViewerValue>>;
  /** False when the event has no allowlist row: render this as a shell. */
  readonly known: boolean;
  /**
   * How many ALLOWLISTED keys carried a value this projection refused. Not "keys we hid" —
   * a non-allowlisted key is the contract working and is silent. A non-zero count here means a
   * write site is putting something in a key we promised was a ref, which is worth a signal.
   */
  readonly unsafeDrops: number;
};

/** The lineage refs `dispatch.lineageRefs()` spreads into every sub-agent/media/research row. */
const LINEAGE = [
  "rootRequestId",
  "parentAgentId",
  "specialist",
  "depth",
  "ancestryDepth",
  "planId",
] as const;

/** The token counts `dispatch.deckTokenCounts()` spreads into the storyboard refusal rows. */
const DECK_SHAPE = [
  "bodyChars",
  "sceneDeckTokens",
  "blockDeckTokens",
  "variationTokens",
  "targetDurationTokens",
] as const;

/**
 * Event -> the payload keys that event is allowed to show. Read off the 96 production write sites,
 * not off the schema (the schema has no opinion — see the header).
 *
 * THREE KEYS ARE DELIBERATELY ABSENT and the reasons are the interesting part of this table:
 *
 *  - `piiCounts` (request.redacted / intake.extracted / vault.extracted) — a nested object. The
 *    SHAPE gate would drop it anyway, but leaving it out of the KEY gate keeps `unsafeDrops` at
 *    zero for a shape we know about and have accepted, so a non-zero count stays a real signal
 *    rather than background noise. ponytail: the count of redactions is genuinely useful
 *    governance information; the upgrade path is flattening it to a `piiTotal` number at the
 *    write site, not teaching this projection to walk objects.
 *  - `userId` / `ownerUserId` (owner.granted, owner.revoked, the skill activations) — a raw
 *    identity, which is precisely what the actor normalizer exists to keep off the screen. The
 *    grant is the governance fact; the subject's id is not, and it would walk around the front
 *    door.
 *  - the `deleted_<table>` counts on tenant.deleted — their key names come from `deletableTables()`
 *    at runtime, so they cannot be enumerated here honestly. ponytail: the erasure row still shows
 *    its hash, its auth-credential count and both providers' outcomes; the upgrade path if the
 *    per-table breakdown is ever wanted on screen is a nested `deletedByTable` count object
 *    flattened to a total at the write site.
 */
export const AUDIT_VIEWER_EVENTS: Readonly<Record<string, readonly string[]>> = {
  "blueprint.confirmed": [
    "docId",
    "sourceDocCount",
    "fieldCount",
    "additionsApplied",
    "contradictionsAccepted",
  ],
  "briefing.created": ["briefingId", "range", "listedCount", "digestedCount"],
  "calendar.availability.listed": ["provider", "range", "busyCount", "truncated"],
  "calendar.event.created": ["planId", "eventId"],
  "calendar.event.updated": ["planId", "managedEventId", "provider", "operation"],
  "calendar.event.deleted": ["planId", "managedEventId", "provider", "operation"],
  "contact.unsuppressed": ["contactId", "addressHash"],
  "deadletter.written": ["workflowId", "requestId", "kind", "status"],
  "document.created": ["topicHash", "form", "vaultDocId", "hasPdf"],
  "evaluation.answered": ["field", "valueHash"],
  "evaluation.ran": [
    "framework",
    "verdict",
    "findingCount",
    "gapCount",
    "groundedDocCount",
    "userProvidedCount",
  ],
  "finance.claims_applied": ["count", "skipped", "fields", "actors", "confidences"],
  "finance.control.changed": ["control", "from", "to"],
  "folder.digest_refused": ["folderId", "reason", "memberCount"],
  "gmail.sent": ["requestId", "messageId"],
  "goal.added": ["goalId", "segmentId", "hasTargetDate", "nested"],
  "goal.status_changed": ["goalId", "from", "to", "cycleDays"],
  "google.disconnected": ["revoked", "status"],
  "graph.sent": ["requestId", "provider"],
  "guardrail.blocked": ["requestId", "reason"],
  "intake.extracted": ["artifactId", "kind", "charCount"],
  "intake.extraction_failed": ["artifactId", "kind", "reason"],
  // Phase 29 (KNOW-01) — the ONE governance event a unified knowledge search writes, and every key
  // here is a ref, a hash, a count, a boolean or a closed enum. What is deliberately ABSENT is the
  // interesting half: the question (only `questionHash`), the summary, any claim text, label,
  // excerpt, sourceRef, subject, sender or file name — and the planner's REJECTED SOURCE NAMES,
  // which are model-authored strings, so only `rejectedPlanCount` crosses.
  // `unavailableReasons` is an array of closed `UnavailableReason` values, ≤ 5 members
  // (`KNOWLEDGE_SOURCES.length`), all `[a-z_]` — well inside `MAX_REF_ARRAY_LENGTH` and `SAFE_REF`.
  "knowledge.searched": [
    "searchRunRef",
    "questionHash",
    "requestedSources",
    "availableSources",
    "partialSources",
    "unavailableSources",
    "unavailableReasons",
    "evidenceCount",
    "claimCount",
    "unsupportedCount",
    "conflictCount",
    "inventedCitationCount",
    "confidence",
    "durationMs",
    "collapsedCount",
    "dedupeConflictCount",
    "rejectedPlanCount",
    "adapterCrashCount",
    "plannerFallback",
    "planRunRef",
    "synthRunRef",
    "plannerSkillVersion",
  ],
  "llm.cache_hit": ["requestId", "safeTextHash", "model", "stage"],
  "llm.called": ["model", "skillVersion", "stage"],
  "llm.fallback": ["fromModel", "toModel", "errorName", "stage"],
  "mailbox.listed": ["range", "resultCount"],
  "mailbox.searched": ["queryHash", "resultCount"],
  "media.captioned": ["batchId", "planId", "renderMs"],
  "media.claim_confirmed": ["planId", "sceneIndex"],
  "media.deck_persisted": [
    ...LINEAGE,
    "blocks",
    "targetDurationSeconds",
    "clipSeconds",
    "narrationChars",
    "hasArtDirection",
    "variations",
    "citedScenes",
    "unverifiedScenes",
  ],
  "media.deck_refused": [...LINEAGE, ...DECK_SHAPE, "reason", "variation"],
  /** The grounding pass could not run. VISIBLE deliberately: it is the difference between a
   *  reel grounded in live research and one grounded only in the vault, and the reel ships
   *  either way — so without this row a silently ungrounded proposal looks identical to a
   *  researched one. Refs and a reason CODE only (§4). */
  "media.grounding_failed": [...LINEAGE, "reason"],
  "media.image_saved": ["planId", "jobId", "docId"],
  "media.landed": [
    "jobId",
    "batchId",
    "planId",
    "providerRequestId",
    "kind",
    "model",
    "promptHash",
    "estCents",
  ],
  "media.reel_saved": ["planId", "docId", "citations"],
  "media.render_retried": ["batchId", "planId", "reasonCode"],
  "media.render_retry_manual": ["planId", "batchId"],
  "media.rendered": ["batchId", "planId", "sceneCount", "renderMs", "sidecarHash", "gatesPassed"],
  "media.variation_salvaged": [...LINEAGE, "kept", "lost", "reason"],
  "microsoft.disconnected": ["deleted", "revokedAtProvider"],
  "onboarding.profile_committed": ["vaultDocId", "fieldCount", "tierSource"],
  "onboarding.profile_updated": ["vaultDocId", "fieldCount", "tierSource", "reembed"],
  "owner.granted": ["owner"],
  "owner.revoked": ["owner"],
  "plan.canceled": ["planId"],
  "plan.discarded": ["planId", "kind"],
  "plan.rescheduled": ["planId"],
  // 26-16 board pack. Refs, ids, counts, the resolved window and the outcome — never a title, never
  // a recipient, never a figure from the pack itself. `timeZone` is an IANA name and `timeZoneSource`
  // is `browser-fallback`; both pass SAFE_REF because `/` and `-` are in its charset.
  "report.pack_generated": [
    "vaultDocId",
    "packHash",
    "sinceMs",
    "untilMs",
    "timeZone",
    "timeZoneSource",
    "result",
    "bytes",
    "partialSections",
    "sentCount",
    "reviewCount",
    "deadLetterCount",
    "feedbackCount",
    "auditRowCount",
  ],
  "request.redacted": ["requestId", "safeTextHash"],
  "request.rejected": ["reason", "retryAfterMs", "goalHash", "attachmentCount"],
  "research.persist_failed": [...LINEAGE, "reason"],
  "research.persist_skipped": [...LINEAGE, "reason", "webSearchCalls"],
  "research.persisted": [
    "queryHash",
    "sourceCount",
    "webSearchCalls",
    "evidenceVerdict",
    "declaredUnsupported",
    "retrievedAt",
    "vaultDocId",
    "incomplete",
  ],
  "review.escalated": ["requestId"],
  "review.expired": ["requestId"],
  "review.rejected": ["requestId"],
  "skill.agent_candidate_published": [
    "skillName",
    "tenantSkillId",
    "version",
    "baseScope",
    "baseSkillId",
    "baseVersion",
    "author",
    "authorAgentId",
    "sourceThreadId",
    "sourceTurnId",
    "bodyHash",
    "authoredBytes",
  ],
  "skill.user_candidate_published": [
    "skillName",
    "tenantSkillId",
    "version",
    "baseScope",
    "baseSkillId",
    "baseVersion",
    "author",
    "bodyHash",
    "authoredBytes",
  ],
  "skill.agent_candidate_activated": [
    "skillName",
    "tenantSkillId",
    "version",
    "author",
    "fromTenantSkillId",
    "fromVersion",
    "evalRunId",
  ],
  "skill.user_candidate_activated": [
    "skillName",
    "tenantSkillId",
    "version",
    "author",
    "fromTenantSkillId",
    "fromVersion",
    "evalRunId",
  ],
  "skill.user_skill_rolled_back": [
    "skillName",
    "tenantSkillId",
    "version",
    "author",
    "fromTenantSkillId",
    "fromVersion",
    "evalRunId",
  ],
  "skill.optimized": [
    "skillName",
    "fromVersion",
    "toVersion",
    "runId",
    "negativeRate",
    "sampleCount",
  ],
  "subagent.completed": [
    ...LINEAGE,
    "skillId",
    "skillName",
    "skillVersion",
    "skillBodyHash",
    "costUsd",
    "spentCents",
    "envelopeCents",
    "incomplete",
  ],
  "subagent.dispatched": [...LINEAGE, "envelopeCents", "spentCents"],
  "subagent.refused": [...LINEAGE, "reason"],
  "tenant.deleted": [
    "tenantIdHash",
    "deleted_authCredentials",
    "googleLocalRowDeleted",
    "googleRevokedAtProvider",
    "googleFailure",
    "microsoftLocalRowDeleted",
    "microsoftRevokedAtProvider",
    "microsoftFailure",
  ],
  "tenant.tier_changed": ["from", "to", "tierSource", "factsChanged"],
  "vault.drive.import": [
    "folderId",
    "fileCount",
    "exportedCount",
    "skippedCount",
    "unchangedCount",
    "removedCount",
    "truncated",
  ],
  "vault.drive.unreadable": ["folderId", "code"],
  "vault.extracted": ["vaultDocId", "kind", "path", "charCount", "durationSeconds", "truncated"],
  "vault.extraction_failed": ["vaultDocId", "kind", "reason"],
  "vault.promoted": ["vaultDocId", "sourceThreadId", "sourcePlanId", "result"],
  "vault.searched": ["queryHash", "resultCount"],
  "voice.session_ended": [
    "sessionId",
    "outcome",
    "inAudioTok",
    "outAudioTok",
    "textInTok",
    "textOutTok",
  ],
  "voice.session_started": ["sessionId"],
  "voicedoc.reviewed": ["sessionId", "findingCount", "gapCount", "verdict"],
  "voicedoc.searched": ["sessionId", "queryHash", "resultCount"],
};

/**
 * The event namespaces, DERIVED from the table above rather than hand-typed beside it.
 *
 * 26-14 shipped a defect that was exactly a hand-typed copy of a closed set drifting from the set
 * it copied (`DECISION_KEYS` listed an "edit" nothing writes). A second literal list here would be
 * the same defect wearing this module's name.
 */
const namespaceOf = (eventType: string): string => eventType.split(".")[0] ?? eventType;

export const AUDIT_VIEWER_CATEGORIES: readonly string[] = [
  ...new Set(Object.keys(AUDIT_VIEWER_EVENTS).map(namespaceOf)),
].sort();

const CATEGORY_SET = new Set(AUDIT_VIEWER_CATEGORIES);

/**
 * A ref token: printable ASCII, no whitespace, no markup, no `@`, bounded.
 *
 * The charset is the whole argument. Every value the 96 write sites put in an allowlisted key is
 * an id, a hash, a closed enum, a model name or a count — none of them contain a space, and prose
 * always does. Excluding `@` refuses an address even inside a key we trust; excluding `<>"'` and
 * parentheses refuses markup. A legitimate value that trips this is DROPPED and COUNTED, which is
 * how we would find out.
 */
const SAFE_REF = new RegExp(`^[A-Za-z0-9._:/+=|~-]{1,${MAX_REF_STRING_LENGTH}}$`);

/** An event/namespace token — dotted lowercase, bounded. Keeps an interpolated name off the screen. */
const SAFE_EVENT = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){0,3}$/;

const safeString = (v: string): boolean => v.length <= MAX_REF_STRING_LENGTH && SAFE_REF.test(v);

/** One payload value -> a viewer value, or null meaning "refuse". Never falls back to a string. */
function sanitizeValue(value: unknown): AuditViewerValue | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return safeString(value) ? value : null;
  if (Array.isArray(value)) {
    if (value.length > MAX_REF_ARRAY_LENGTH) return null;
    // One bad member kills the array. A partially-kept list is a lie about what was there.
    return value.every((m) => typeof m === "string" && safeString(m))
      ? (value as readonly string[])
      : null;
  }
  return null; // objects, nested arrays, functions, bigint, symbol — no exceptions, no stringify.
}

const ACTORS: Readonly<Record<string, AuditViewerActor>> = {
  user: "you",
  system: "system",
  render: "system",
  test: "system",
  agent: "agent",
  owner: "owner",
  operator: "owner",
};

/**
 * Actor -> a label. Anything unrecognised becomes "you", and that is not a guess: 8 write sites
 * pass `ctx.tenantId` as the actor, these rows are read tenant-scoped, and a tenant is one person.
 * The load-bearing property is that the raw string never leaves — when a tenant becomes more than
 * one person, this returns "you" for a colleague and the fix is a lookup, not a leak.
 */
const normalizeActor = (actor: string): AuditViewerActor => ACTORS[actor] ?? "you";

/**
 * Project one raw audit row into the shape a browser may see.
 *
 * Total: every input produces a row. There is no throw and no "unavailable" — an audit viewer that
 * silently omits the rows it could not parse is a governance record with holes in it.
 */
export function projectAuditRow(rawRow: {
  ts: number;
  eventType: string;
  actor: string;
  correlationId: string;
  payload: unknown;
}): AuditViewerRow {
  // `Object.hasOwn`, not a bare index: `AUDIT_VIEWER_EVENTS["constructor"]` walks the prototype and
  // hands back a Function, which the loop below would then try to iterate. An eventType is a string
  // off a row, so "is this key in the table" has to mean OWN key.
  const allowed = Object.hasOwn(AUDIT_VIEWER_EVENTS, rawRow.eventType)
    ? AUDIT_VIEWER_EVENTS[rawRow.eventType]
    : undefined;
  const known = allowed !== undefined;
  const eventType =
    typeof rawRow.eventType === "string" && SAFE_EVENT.test(rawRow.eventType)
      ? rawRow.eventType
      : "unknown";
  const namespace = namespaceOf(eventType);

  const refs: Record<string, AuditViewerValue> = {};
  let unsafeDrops = 0;
  const payload = rawRow.payload;
  if (allowed && payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    for (const key of allowed) {
      const value = (payload as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue; // absent is absent, and is not a fault
      const safe = sanitizeValue(value);
      if (safe === null) unsafeDrops++;
      else refs[key] = safe;
    }
  }

  return {
    ts: rawRow.ts,
    eventType,
    category: CATEGORY_SET.has(namespace) ? namespace : "other",
    actor: normalizeActor(rawRow.actor),
    correlationRef:
      typeof rawRow.correlationId === "string" && safeString(rawRow.correlationId)
        ? rawRow.correlationId
        : "",
    refs,
    known,
    unsafeDrops,
  };
}
