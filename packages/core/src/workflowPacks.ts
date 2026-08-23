// The curated knowledge-work pack registry (Phase 27, PACK-02/PACK-03). Pure TS, Convex-free
// (CLAUDE.md §1) — `convex/llm.ts` is the thin adapter that consumes the grant, and 27-07 binds it.
//
// THE THREE-WORD VOCABULARY. Every operation a pack body describes is `existing`, `missing`, or
// `forbidden`. There is no fourth state, and a downstream lane may not invent one:
//
//   existing   an agent-reachable runtime tool serves it TODAY, and this row names that tool.
//   missing    no agent-reachable read serves it. The pack RUNS, says plainly which source it
//              could not see, and names what would unlock it (owner decision A, 2026-08-23).
//   forbidden  the pack must never do it, and — for the five shared rows — structurally cannot.
//
// 27-04/05/06 author their bodies against this file. A body may only claim an `existing`
// operation; a body that claims a `missing` one is claiming a source the loop cannot read, and a
// body that claims a `forbidden` one is describing a capability the record does not contain.
//
// THE GRANT IS DERIVED, NEVER TYPED TWICE. `toolsForWorkflowPack` unions the `existing` rows' tool
// names. A tool no operation asks for cannot be granted at all, and a skill body — a DB row a
// candidate can change — can never add one (ADR-007: bodies describe behaviour, code owns
// capability). The runtime half of that is `llm.ts`, which filters the built tool record by exact
// name, so a tool the model asks for and was not granted is ABSENT, not refused.
//
// PACKS ARE LEAF AGENTS (owner decision B, 2026-08-23). `runAgentLoop` sets
// `grantDispatch: toolNames === undefined` and `grantSkillAuthoring: toolNames === undefined`, and
// a pack always supplies an array — so specialist dispatch, skill authoring and the paid image
// door are never BUILT for a pack, let alone withheld. A pack calls tools; it never calls another
// agent. Cross-workflow composition stays with the Executive Agent, which runs with no allow-list.
// Campaign Plan therefore PRODUCES A PLAN; it does not orchestrate the work in the plan.

/** The closed set of workflows the pilot ships. An id outside this set is refused, never defaulted. */
export const WORKFLOW_PACK_IDS = [
  "business-pulse",
  "campaign-plan",
  "customer-complaint",
  "sales-call-prep",
  "process-sop",
  "brand-review",
] as const satisfies readonly string[];
export type WorkflowPackId = (typeof WORKFLOW_PACK_IDS)[number];

/**
 * Input planes a pack CAN read today, each through a real tool in `buildCockpitTools`.
 * Runtime availability still varies per tenant (no Gmail grant, no Drive connection, an empty
 * vault) — that is what `packPreflight` resolves.
 */
export const REACHABLE_PACK_SOURCES = [
  "vault",
  "web",
  "inbox",
  "drive",
  "calendar",
  "finance-inputs",
] as const satisfies readonly string[];
export type ReachablePackSource = (typeof REACHABLE_PACK_SOURCES)[number];

/**
 * Input planes NO agent-reachable read serves — the honest-partial contract's subject matter.
 *
 * Owner decision A (2026-08-23, binding): do NOT add read tools to close these. Every new tool
 * inflates the eval corpus this phase already pays for, and the pack that says "I could not see
 * your revenue summary, here is what I could see, here is what would unlock it" IS the deliverable.
 * A pack that quietly omits the gap is the defect.
 */
export const MISSING_PACK_SOURCES = [
  // `reportsBusiness.ts` business / operations / sentMail are `tenantQuery` — UI reads, not tools.
  "phase26-summaries",
  // `content.ts` is `tenantQuery`-only by construction.
  "content-shelf",
  // The only contact-shaped tools are `resolveContacts` (labels, never addresses) and
  // `stageCrmWrite`. Neither is a CRM read.
  "crm-facts",
  // HubSpot / QuickBooks / Stripe / PayPal are Phase 28.
  "connector-financials",
  // There is no tenant brand store: `brandVoice` is a per-plan optional string (schema.ts:757).
  "tenant-brand-guidance",
  // No org-chart or role source exists, so an SOP step cannot be assigned to a real owner.
  "org-roles",
  // No task-system, Canva or publishing tool exists, so an SOP cannot be scheduled or published.
  "task-system",
] as const satisfies readonly string[];
export type MissingPackSource = (typeof MISSING_PACK_SOURCES)[number];

export type PackSource = ReachablePackSource | MissingPackSource;

/** What the user is told a source IS. Code-owned so six bodies cannot each name it differently. */
export const PACK_SOURCE_LABEL: Readonly<Record<PackSource, string>> = {
  vault: "your knowledge vault",
  web: "public web research",
  inbox: "your mailbox",
  drive: "your Google Drive",
  calendar: "your Pikar-managed calendar events",
  "finance-inputs": "the figures you have entered",
  "phase26-summaries": "your business and operations summaries",
  "content-shelf": "your saved content shelf",
  "crm-facts": "your contact and pipeline records",
  "connector-financials": "your connected sales and accounting systems",
  "tenant-brand-guidance": "your confirmed brand guidance",
  "org-roles": "who does what in your business",
  "task-system": "a task or publishing system",
};

/**
 * What would make a missing source readable. This is the second half of the honest-partial
 * contract: naming a gap without naming its unlock leaves the user with a complaint instead of a
 * next step. Typed over `MissingPackSource` so a new missing source cannot ship without one.
 */
export const MISSING_SOURCE_UNLOCK: Readonly<Record<MissingPackSource, string>> = {
  "phase26-summaries": "an agent-readable version of the Reports summaries",
  "content-shelf": "an agent-readable view of your content shelf",
  "crm-facts": "a contact and pipeline read your assistant can call",
  "connector-financials": "connecting your sales and accounting tools",
  "tenant-brand-guidance": "somewhere to store brand guidance you have confirmed",
  "org-roles": "a record of who owns which part of the work",
  "task-system": "a connected task or publishing system",
};

/**
 * PHRASES THAT COUNT AS NAMING A MISSING SOURCE (27-08). The honest-partial statement is the
 * primary deliverable of this pilot, and an eval that could not tell whether a reply made it would
 * be grading everything except the thing the phase is for.
 *
 * This is deliberately a small set of ALTERNATIVES per source, matched case-insensitively as
 * substrings, not one exact sentence: six bodies word the same gap differently on purpose ("Their
 * saved content" / "your saved content shelf"), and a scorer that demanded `PACK_SOURCE_LABEL`
 * verbatim would be grading obedience to one phrasing rather than whether the user was told.
 *
 * It is a heuristic, and it is the ONLY prose-shaped assertion in the pack eval gate — everything
 * else the runner scores is a trace fact or an event count. Loosen a phrase when a body legitimately
 * says it another way; never delete a source's entry, because an empty list would silently pass.
 */
export const MISSING_SOURCE_MENTIONS: Readonly<Record<MissingPackSource, readonly string[]>> = {
  "phase26-summaries": ["operations summaries", "business and operations", "reports summaries"],
  "content-shelf": ["content shelf", "saved content", "published content", "content you"],
  "crm-facts": ["contacts and pipeline", "crm", "contact record", "pipeline", "deal"],
  "connector-financials": [
    "sales and accounting",
    "accounting",
    "payment processor",
    "invoicing",
    "connected system",
    "no revenue",
  ],
  "tenant-brand-guidance": ["brand guidance", "brand guidelines", "confirmed brand", "brand rules"],
  "org-roles": ["who owns", "who does what", "unassigned", "real owner", "role"],
  "task-system": ["task system", "publishing", "schedule", "task or publishing"],
};

/** Why a pack must never perform an operation. A closed enum: a model cannot relabel a refusal. */
export type PackRefusal =
  | "specialist_dispatch"
  | "skill_authoring"
  | "paid_generation"
  | "external_send"
  | "external_write";

/**
 * What a pack hands back. Bound to the grant by `workflowPacks.test.ts`: `document` packs hold
 * `createDocument`, `draft_reply` holds `replyToMessage`, `briefing` holds neither — so a pack
 * cannot promise a durable artifact it has no tool to write.
 */
export type PackOutput = "briefing" | "document" | "draft_reply";

/**
 * One row of the operation matrix. A DISCRIMINATED UNION, not one shape with optional fields: an
 * optional field can never be mutation-checked by the compiler, so `missing` without a source or
 * `existing` without tools would type-check and ship. `reads: null` on an `existing` row is the
 * deliberate way to say "this operation produces, it does not read" — you must write it.
 */
export type PackOperation =
  | {
      readonly id: string;
      readonly state: "existing";
      readonly summary: string;
      readonly reads: ReachablePackSource | null;
      readonly tools: readonly string[];
    }
  | {
      readonly id: string;
      readonly state: "missing";
      readonly summary: string;
      readonly reads: MissingPackSource;
    }
  | {
      readonly id: string;
      readonly state: "forbidden";
      readonly summary: string;
      readonly refusal: PackRefusal;
    };

/** The forbidden arm of the union, named so the shared list can be typed to it exactly. */
export type ForbiddenPackOperation = Extract<PackOperation, { state: "forbidden" }>;

export type WorkflowPackSpec = {
  /**
   * The §5 registry row that carries this pack's body. Written out per spec rather than computed,
   * so the record stays a plain readable table — but it is NOT free-form: `workflowPacks.test.ts`
   * asserts every one equals `pack-<id>`, so a typo or a rename fails there rather than resolving
   * to a registry row that does not exist.
   */
  readonly skillName: string;
  readonly output: PackOutput;
  readonly operations: readonly PackOperation[];
};

/**
 * The five things NO pack may do, shared BY IDENTITY across all six specs. There is no per-pack
 * forbidden list to widen — a stronger property than "every pack's list happens to match".
 *
 * The first three are structural rather than instructed: `grantDispatch` and `grantSkillAuthoring`
 * are both `toolNames === undefined`, and `proposeImage` rides the same `grantDispatch` spread, so
 * an allow-listed agent never receives any of them. The last two are containment: every send and
 * every external mutation stays behind the one human Approve gate on the existing plan row.
 */
export const LEAF_FORBIDDEN_OPERATIONS: readonly ForbiddenPackOperation[] = [
  {
    id: "dispatch-specialist",
    state: "forbidden",
    summary: "Hand work to a research, media or growth specialist.",
    refusal: "specialist_dispatch",
  },
  {
    id: "author-skill",
    state: "forbidden",
    summary: "Write or revise a skill in the registry.",
    refusal: "skill_authoring",
  },
  {
    id: "generate-paid-media",
    state: "forbidden",
    summary: "Generate an image, clip, voiceover or attachment that spends money.",
    refusal: "paid_generation",
  },
  {
    id: "send-externally",
    state: "forbidden",
    summary: "Send, reply, forward or publish anything outside Pikar.",
    refusal: "external_send",
  },
  {
    id: "mutate-external-system",
    state: "forbidden",
    summary: "Change a contact, ledger, calendar or task record.",
    refusal: "external_write",
  },
];

/**
 * Tool names an allow-listed agent can NEVER hold, whatever the registry says. Kept as data so the
 * test can assert no pack names one — a grant for an unreachable tool is not a security hole, it is
 * a silent capability loss that looks like a working feature until the trace is read.
 */
export const PACK_UNREACHABLE_TOOLS: readonly string[] = [
  "authorSkillCandidate",
  "dispatchMedia",
  "dispatchResearch",
  "proposeImage",
];

/** Read the tenant's own corpus. Every pack has it: it is the one grounded, free, read-only plane. */
const groundInVault = {
  id: "ground-in-vault",
  state: "existing",
  summary: "Search the tenant's knowledge vault for their own reference material.",
  reads: "vault",
  tools: ["searchVault"],
} as const satisfies PackOperation;

/**
 * Web research, granted as a PAIR. `llm.ts` builds `webResearch` and `declareUnsupported` under one
 * flag and then filters the record by name, so listing the search tool alone drops the structured
 * refusal channel — leaving a pack that can only answer or confabulate about the outside world.
 */
const researchTheWeb = (summary: string) =>
  ({
    id: "research-the-web",
    state: "existing",
    summary,
    reads: "web",
    tools: ["webResearch", "declareUnsupported"],
  }) as const satisfies PackOperation;

const saveDocument = (id: string, summary: string) =>
  ({ id, state: "existing", summary, reads: null, tools: ["createDocument"] }) as const;

const missing = (id: string, reads: MissingPackSource, summary: string) =>
  ({ id, state: "missing", summary, reads }) as const;

export const WORKFLOW_PACKS: Readonly<Record<WorkflowPackId, WorkflowPackSpec>> = {
  // Answers in the thread; writes nothing. Its two nominal headline sources are MISSING and stay
  // that way, so the pulse is built on what the loop can actually see and NAMES what it could not.
  // Do not build a pulse claim on Command Center priority order either: HOME_PRIORITY_ORDER was
  // reordered on 2026-08-23 (85daa4b) and five files re-declare it as a literal without importing it.
  "business-pulse": {
    skillName: "pack-business-pulse",
    output: "briefing",
    operations: [
      groundInVault,
      {
        id: "read-finance-figures",
        state: "existing",
        summary: "Read the figures the user has entered and the metrics computed from them.",
        reads: "finance-inputs",
        tools: ["readFinance"],
      },
      missing(
        "read-business-summaries",
        "phase26-summaries",
        "Read the Reports business/operations/sent-mail summaries.",
      ),
      missing("read-content-shelf", "content-shelf", "Read what the tenant has published lately."),
      ...LEAF_FORBIDDEN_OPERATIONS,
    ],
  },

  // PRODUCES A PLAN. It does not orchestrate one — an allow-listed agent structurally cannot, and
  // connector-backed execution is Phase 28.
  "campaign-plan": {
    skillName: "pack-campaign-plan",
    output: "document",
    operations: [
      groundInVault,
      researchTheWeb("Research the market and channels the campaign will run in."),
      saveDocument("save-campaign-plan", "Save the campaign plan to the vault as a document."),
      missing("read-crm-audience", "crm-facts", "Read the audience or pipeline to target."),
      missing(
        "read-campaign-performance",
        "connector-financials",
        "Read live sales or ad performance to plan against.",
      ),
      missing("read-content-shelf", "content-shelf", "Reuse content the tenant already has."),
      ...LEAF_FORBIDDEN_OPERATIONS,
    ],
  },

  // Pasted text is the first-class input. Inbox context goes through the real seam; drafts only.
  "customer-complaint": {
    skillName: "pack-customer-complaint",
    output: "draft_reply",
    operations: [
      {
        id: "list-inbox-headers",
        state: "existing",
        summary: "Peek at senders and subject lines to find the message being complained about.",
        reads: "inbox",
        tools: ["listInbox"],
      },
      {
        id: "brief-inbox",
        state: "existing",
        summary: "Summarize the mailbox into a briefing; counts come back, never contents.",
        reads: "inbox",
        tools: ["briefInbox"],
      },
      groundInVault,
      {
        id: "draft-reply",
        state: "existing",
        // The message and the recipient are resolved SERVER-SIDE — the model never sees an address
        // or a message id, so an instruction planted in a complaint cannot redirect the reply.
        summary: "Draft a reply to the message the user points to. It is staged, never sent.",
        reads: null,
        tools: ["replyToMessage"],
      },
      {
        id: "stage-for-approval",
        state: "existing",
        // THE SECOND HALF OF THE DRAFT, and it is not optional. `replyToMessage` patches recipients,
        // subject, threading and body onto the plan row and never touches `status` — and
        // `proposePlan` is the ONLY tool on the email path that writes `status: "proposed"`, which
        // is the only state where the Approve control renders (`cards.tsx` gates `PlanCard` on it)
        // and the only state `executePlan` will act on. Without this row the drafted reply
        // terminates at `collecting`: visible as a read-only draft, approvable by nobody.
        //
        // THE ONE PACK THAT HOLDS IT — pinned by name in `workflowPacks.test.ts`. It STAGES; it does
        // not send. `executePlan`'s human Approve remains a compare-and-swap no agent can reach, so
        // the containment is unchanged: an instruction injected into a complaint can influence what
        // the human is shown, never what leaves the building.
        summary: "Stage the drafted reply for the user to review and Approve. It is not sent.",
        reads: null,
        tools: ["proposePlan"],
      },
      missing("read-complaint-history", "crm-facts", "Read this customer's prior contact history."),
      missing(
        "read-order-history",
        "connector-financials",
        "Read the order, refund or ticket behind the complaint.",
      ),
      ...LEAF_FORBIDDEN_OPERATIONS,
    ],
  },

  // Works from user / Vault / web context, plus the meetings Pikar itself manages.
  "sales-call-prep": {
    skillName: "pack-sales-call-prep",
    output: "document",
    operations: [
      groundInVault,
      researchTheWeb("Research the prospect and their market."),
      {
        id: "read-managed-calendar",
        state: "existing",
        summary: "List the Pikar-managed calendar events the call may relate to.",
        reads: "calendar",
        tools: ["listManagedCalendarEvents"],
      },
      saveDocument("save-prep-brief", "Save the call-prep brief to the vault as a document."),
      missing(
        "read-crm-account-facts",
        "crm-facts",
        "Read the account, deal or pipeline facts for this prospect.",
      ),
      ...LEAF_FORBIDDEN_OPERATIONS,
    ],
  },

  // Produces a durable document and says plainly what it could not wire up.
  "process-sop": {
    skillName: "pack-process-sop",
    output: "document",
    operations: [
      groundInVault,
      {
        id: "locate-source-material",
        state: "existing",
        summary: "Find the files and folders the process is described in.",
        reads: "drive",
        tools: ["findInDrive", "listDriveFolders"],
      },
      saveDocument("save-sop", "Save the SOP to the vault as a document."),
      missing("assign-step-owners", "org-roles", "Assign each step to a real person or role."),
      missing("publish-or-schedule", "task-system", "Publish or schedule the SOP as real work."),
      ...LEAF_FORBIDDEN_OPERATIONS,
    ],
  },

  // Ships the GENERIC review and states plainly that it reviewed against general principles,
  // because no tenant brand guidance exists yet — and names what would unlock the stronger review.
  "brand-review": {
    skillName: "pack-brand-review",
    output: "document",
    operations: [
      groundInVault,
      saveDocument("save-review", "Save the brand review to the vault as a document."),
      missing(
        "read-brand-guidance",
        "tenant-brand-guidance",
        "Review against the tenant's confirmed brand guidance.",
      ),
      missing("read-content-shelf", "content-shelf", "Review the tenant's published content."),
      ...LEAF_FORBIDDEN_OPERATIONS,
    ],
  },
};

export type ResolvedWorkflowPack =
  | { ok: true; packId: WorkflowPackId; spec: WorkflowPackSpec }
  | { ok: false; reason: "unknown_pack" };

/**
 * Fail-closed lookup, mirroring `resolveSpecialist`. There is deliberately NO default pack: an id
 * the system cannot validate is an id it must not run. Returns a discriminated result and never
 * throws — a governed stop returns, only bugs throw.
 *
 * `Object.hasOwn`, never `WORKFLOW_PACKS[id]`: a bare index resolves "__proto__" and "constructor"
 * to Object.prototype members, which are truthy, so a truthiness guard would "resolve" them.
 */
export function resolveWorkflowPack(packId: string): ResolvedWorkflowPack {
  if (!Object.hasOwn(WORKFLOW_PACKS, packId)) return { ok: false, reason: "unknown_pack" };
  const known = packId as WorkflowPackId;
  return { ok: true, packId: known, spec: WORKFLOW_PACKS[known] };
}

/**
 * THE grant — the exact `toolNames` allow-list `llm.ts` filters the built record with. DERIVED from
 * the `existing` operations, so the matrix and the capability cannot drift: a tool no operation
 * asks for cannot be granted, and a skill body cannot add one at all.
 *
 * Sorted and de-duplicated so the value is stable enough to assert on and to log.
 */
export function toolsForWorkflowPack(packId: WorkflowPackId): readonly string[] {
  return [
    ...new Set(
      WORKFLOW_PACKS[packId].operations.flatMap((op) => (op.state === "existing" ? op.tools : [])),
    ),
  ].sort();
}

/** How well a source answered for THIS tenant on THIS run. Absence is never "available". */
export type SourceState = "available" | "partial" | "unavailable";

/**
 * WHAT THE PROBE CAN ACTUALLY RETURN, per source (27-08). `probeSources` in
 * `convex/workflowPackBinding.ts` is the only writer of these states, and it does not resolve every
 * source across all three: `vault` and `web` need no tenant grant and are CONSTANTLY `available`
 * (an empty vault is the tool's own honest answer, not a preflight fact), an empty calendar is
 * `partial` rather than `unavailable`, and the finance spine is a row that either exists or does not.
 *
 * This exists because 27-04/05/06 authored the eval corpus against the three-word SourceState
 * vocabulary while 27-07 wrote the probe afterwards, and 21 of the 30 fixtures ended up asserting a
 * state no run could ever produce — a whole class of case that could only ever fail, or (worse) be
 * quietly skipped by a runner that noticed. A fixture may only expect a state that is in this list;
 * the pack eval runner refuses one that is not, and `workflowPacks.test.ts` scans `probeSources`
 * so this record cannot drift away from the function it describes.
 */
export const PACK_SOURCE_PROBE_STATES: Readonly<
  Record<ReachablePackSource, readonly SourceState[]>
> = {
  vault: ["available"],
  web: ["available"],
  inbox: ["available", "unavailable"],
  drive: ["available", "unavailable"],
  calendar: ["available", "partial"],
  "finance-inputs": ["available", "unavailable"],
};

export type PackPreflight = {
  readonly packId: WorkflowPackId;
  /** Every source the pack touches, in matrix order — reachable and missing alike. */
  readonly sources: readonly { readonly source: PackSource; readonly state: SourceState }[];
  /** Missing in the MATRIX. Announced before the run, so it can never be a surprise afterwards. */
  readonly missingKnown: readonly MissingPackSource[];
  /** Reachable in principle, absent for this tenant on this run. This is the surprise signal. */
  readonly missingRuntime: readonly ReachablePackSource[];
};

/**
 * Resolve, IN CODE and before the model call, which of a pack's sources actually answered. The
 * prompt receives the result; the model does not decide which sources exist.
 *
 * ponytail: no `promisedOutcome` field. Under owner decision A every pilot pack has at least one
 * matrix-missing source, so a "full vs partial" field would be the constant `"partial"` for all six
 * — a number that can only ever say one thing. Add it when a pack first has none: the rule is
 * `missingKnown.length === 0 && missingRuntime.length === 0`.
 */
export function packPreflight(
  packId: WorkflowPackId,
  runtime: Partial<Record<ReachablePackSource, SourceState>>,
): PackPreflight {
  const resolved = resolveWorkflowPack(packId);
  if (!resolved.ok) throw new Error(`unknown_pack: ${packId}`);

  const sources: { source: PackSource; state: SourceState }[] = [];
  const missingKnown: MissingPackSource[] = [];
  const missingRuntime: ReachablePackSource[] = [];

  for (const op of resolved.spec.operations) {
    if (op.state === "forbidden" || op.reads === null) continue;
    if (sources.some((s) => s.source === op.reads)) continue;

    if (op.state === "missing") {
      sources.push({ source: op.reads, state: "unavailable" });
      missingKnown.push(op.reads);
      continue;
    }
    // Fail closed: an unreported source is unavailable. Absence of a state is not evidence that a
    // source worked, and treating it as available is how a run silently claims coverage it lacks.
    const state = runtime[op.reads] ?? "unavailable";
    sources.push({ source: op.reads, state });
    if (state === "unavailable") missingRuntime.push(op.reads);
  }

  return { packId, sources, missingKnown, missingRuntime };
}

/** The §5 registry row name for a pack. Derived, never hand-typed — see `WORKFLOW_PACKS`. */
export const WORKFLOW_PACK_SKILL_NAMES: readonly string[] = WORKFLOW_PACK_IDS.map(
  (id) => `pack-${id}`,
);

/**
 * Whether this registry name is a workflow pack — the key to the pack activation choke point.
 *
 * DELIBERATELY NOT `isGatedSkill`, and the six names must NOT enter `GATED_SKILLS`:
 * `run-eval-golden.mjs` derives its `SKILL_NAMES` from that list and drives `runCockpitAgent` over
 * TEXT fixtures, so gating a name that runner cannot drive mints candidates no eval run could ever
 * certify — the `document-analyst` / `media-director` deadlock `packages/contracts/src/skill.ts`
 * documents by name. Packs get their own runner and their own, STRICTER gate.
 */
export function isWorkflowPackSkill(name: string): boolean {
  return WORKFLOW_PACK_SKILL_NAMES.includes(name);
}

/**
 * Evidence that an AUTHENTICATED browser drove this exact pack version at more than one viewport
 * (27-09). Refs, counts and flags only (CLAUDE.md §4) — no screenshot bytes, page text, tenant
 * identity or generated prose. It is the SECOND, independent half of the pack gate: eval evidence
 * says the body behaves, this says a real person could reach it in a real browser.
 */
export type PackBrowserEvidence = {
  runner: "playwright:pack";
  runId: string;
  pass: boolean;
  /** Exact skill versions the browser run pinned — the gate compares on these. */
  skillVersions: Record<string, number>;
  authenticated: true;
  /** Distinct viewports exercised. The UAT matrix is desktop AND narrow mobile, so >= 2. */
  viewports: number;
  casesPassed: number;
  casesTotal: number;
  deploymentRef: string;
  ts: number;
};

/**
 * Immutable upstream provenance for an adapted pack body (27-01/27-08). `bodySha256` pins the
 * canonical `.md` under `packages/contracts/skills/`, never the auto-derived `.ts` constant.
 */
export type PackProvenance = {
  sourceRepo: string;
  /** Exact upstream commit, 40 hex. A branch or tag is not provenance. */
  sourceCommit: string;
  sourcePaths: string[];
  /** SHA-256 of the canonical `.md` body bytes. */
  bodySha256: string;
  license: "Apache-2.0";
  modificationNotice: string;
  skillVersions: Record<string, number>;
  ts: number;
};

/**
 * Does this browser evidence prove a PASSING, authenticated, multi-viewport run of EXACTLY this
 * (name, version)? Fails closed on absent, unparseable, not-passing, unauthenticated, single
 * viewport, or a version pin naming any other version — the `hasPassingEvidence` contract, one
 * plane over.
 */
export function hasPassingPackBrowserEvidence(
  browserEvidence: string | undefined,
  name: string,
  version: number,
): boolean {
  if (browserEvidence === undefined) return false;
  try {
    const parsed = JSON.parse(browserEvidence) as Partial<PackBrowserEvidence>;
    return (
      parsed.pass === true &&
      parsed.authenticated === true &&
      typeof parsed.viewports === "number" &&
      parsed.viewports >= 2 &&
      parsed.skillVersions?.[name] === version
    );
  } catch {
    return false; // unparseable → fail closed
  }
}

/**
 * Is this provenance complete and pinned to EXACTLY this (name, version)?
 *
 * ponytail: the server checks SHAPE and the VERSION PIN, not that `bodySha256` is the hash of the
 * body it sits beside — a Convex mutation has no synchronous digest, and hashing the stored body
 * here would be the only place in the registry that did. The bytes-level check is
 * `scripts/verify-knowledge-work-provenance.mjs --check` (27-08), which reads the `.md` off disk.
 * Upgrade path if that ever needs to be server-side: compute the digest in the publishing ACTION
 * (where `crypto.subtle` is available) and pass it in as a checked argument.
 */
export function hasValidPackProvenance(
  provenance: string | undefined,
  name: string,
  version: number,
): boolean {
  if (provenance === undefined) return false;
  try {
    const p = JSON.parse(provenance) as Partial<PackProvenance>;
    return (
      p.license === "Apache-2.0" &&
      typeof p.sourceRepo === "string" &&
      p.sourceRepo.length > 0 &&
      typeof p.sourceCommit === "string" &&
      /^[0-9a-f]{40}$/.test(p.sourceCommit) &&
      Array.isArray(p.sourcePaths) &&
      p.sourcePaths.length > 0 &&
      typeof p.bodySha256 === "string" &&
      /^[0-9a-f]{64}$/.test(p.bodySha256) &&
      typeof p.modificationNotice === "string" &&
      p.modificationNotice.length > 0 &&
      p.skillVersions?.[name] === version
    );
  } catch {
    return false; // unparseable → fail closed
  }
}
