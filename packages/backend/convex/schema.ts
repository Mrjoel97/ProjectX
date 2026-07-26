import { authTables } from "@convex-dev/auth/server";
import { CONTRACTS_PACKAGE_NAME } from "@pikar/contracts";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Compile-time proof the Convex bundler resolves source-export workspace packages.
void CONTRACTS_PACKAGE_NAME;

export default defineSchema({
  // Convex Auth identity tables (users, authSessions, authAccounts, ...).
  ...authTables,

  // Insert-only audit log. `payload` holds refs/hashes ONLY — never raw content
  // (redaction-safe). The audit module exposes no patch/replace/delete (see CLAUDE.md).
  audit: defineTable({
    tenantId: v.string(),
    correlationId: v.string(),
    eventType: v.string(),
    actor: v.string(),
    payload: v.any(),
    ts: v.number(),
  })
    .index("by_tenant_ts", ["tenantId", "ts"])
    .index("by_correlation", ["correlationId"])
    // OPSG-03 WORM export windows CROSS-tenant by ts (by_tenant_ts is per-tenant, useless
    // for the global export). Adding an index is not a write path — Convex backfills it
    // (no migration; OPSG-06 moot). Backs auditSince, which previously full-scanned.
    .index("by_ts", ["ts"]),

  // Dead-letter queue populated by workflow onComplete on failure. Redaction-safe payload.
  deadLetters: defineTable({
    tenantId: v.string(),
    correlationId: v.string(),
    workflowId: v.string(),
    payload: v.any(),
    error: v.string(),
    status: v.union(v.literal("new"), v.literal("replayed"), v.literal("resolved")),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_status", ["status"])
    // 02-06's newCount/listNew tenantQueries filter tenant AND status — a compound
    // index avoids an in-memory cross-filter.
    .index("by_tenant_status", ["tenantId", "status"]),

  // Versioned skill/prompt registry (no hardcoded agent prompts — load from here).
  skills: defineTable({
    name: v.string(),
    version: v.number(),
    body: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("candidate"),
      v.literal("rolled_back"),
      v.literal("archived"),
    ),
    evidence: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_name_status", ["name", "status"])
    .index("by_name_version", ["name", "version"]),

  // Scheduled awaitEvent-timeout bookkeeping (cancel the scheduled event on real decision).
  // by_correlation added for 02-04's sendDecision (currently full-scans; unbounded now).
  pendingTimeouts: defineTable({
    workflowId: v.string(),
    correlationId: v.string(),
    scheduledId: v.string(),
    // The gate's attempt suffix — the review wrapper reads it to fire the decision
    // at the authoritative gate (client-supplied attempt could skew after a regenerate
    // and silently lose the decision). Optional: pre-02-09 rows carry none (treated as 0).
    attempt: v.optional(v.number()),
  })
    .index("by_workflow", ["workflowId"])
    .index("by_correlation", ["correlationId"]),

  // Cursors for the WORM export cron (last audit ts exported to immutable storage).
  exportCursors: defineTable({
    name: v.string(),
    lastExportedTs: v.number(),
  }).index("by_name", ["name"]),

  // ── Phase-2 content + telemetry plane ──────────────────────────────────────
  // Every table is tenant-scoped and carries the index its reactive query needs.

  // Content plane: the user's goal, recipient, draft/edited body, reject reason.
  // Raw content lives HERE (CLAUDE.md §4) — never in audit/deadLetters payloads.
  requests: defineTable({
    tenantId: v.string(),
    correlationId: v.string(),
    goal: v.string(),
    recipient: v.string(),
    // The Executive Router's decision, persisted so the review gate can show it
    // read-only (AGNT-02 — the user sees the route before anything runs).
    route: v.optional(v.string()),
    draft: v.optional(v.string()),
    editedBody: v.optional(v.string()),
    rejectReason: v.optional(v.string()),
    // Guardrail redaction output (content plane, like goal/draft). Written by
    // guardrails.prepare (plan 03-03/04); optional — no backfill/migration.
    safeText: v.optional(v.string()), // redacted goal
    safeTextHash: v.optional(v.string()), // SHA-256 hex of safeText — the cache-key member
    lastInstruction: v.optional(v.string()), // scanned (redacted) latest regenerate instruction (03-04)
    // The 14 observable pipeline stages (kept in sync with pipeline.ts REQUEST_STATUS).
    // `escalated` is REVW-02's fail-closed terminal: a regenerate past MAX_REGENERATE is
    // handed to a human, never delivered.
    status: v.union(
      v.literal("submitted"),
      v.literal("routing"),
      v.literal("scanning"),
      v.literal("drafting"),
      v.literal("awaiting_review"),
      v.literal("approved"),
      v.literal("delivering"),
      v.literal("sent"),
      v.literal("rejected"),
      v.literal("blocked"),
      v.literal("expired"),
      v.literal("escalated"),
      v.literal("failed"),
      v.literal("awaiting_reauth"),
    ),
    attachmentRefs: v.array(v.id("attachments")),
    workflowId: v.optional(v.string()),
    // Groups fan-out recipient rows under one cockpit plan (DECISION #1). Optional
    // → no migration (Pitfall-7 optional-on-read, same as safeText). The REPORT
    // projection reads every recipient row for a plan via by_plan.
    planId: v.optional(v.id("plans")),
    // Reply threading (03.11 RPLY-01), copied from the plan at executePlan so the delivery spine
    // (getForDelivery → buildMime → send) threads the reply. `threadId` is the GMAIL thread id
    // (POST body) — requests has no agent-thread field, so no collision here (cf. plans.replyThreadId).
    // `inReplyTo`/`references` are the RFC Message-ID header values. All optional → no migration; a
    // non-reply send carries none.
    threadId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    // Skill-version attribution (08 IMPR-02). Copied from the plan at executePlan so a
    // feedback rating is attributable to the exact skill version that produced this response.
    // Optional → no migration (the threadId/inReplyTo copy precedent).
    skillVersion: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_correlation", ["correlationId"])
    // Deterministic hash→text recovery for the cached action (03-RESEARCH Pattern 3).
    .index("by_tenant_safeTextHash", ["tenantId", "safeTextHash"])
    // REPORT projection: all recipient rows grouped under one cockpit plan.
    .index("by_plan", ["planId"]),

  // Cockpit plan/draft content plane (CLAUDE.md §4: raw content lives HERE, never in audit/DLQ).
  // ONE row per guided conversation; the approve-gate object + idempotency CAS (DECISION #1).
  plans: defineTable({
    tenantId: v.string(),
    threadId: v.string(), // agent thread → renders PLAN/DRAFT/REPORT cards for this thread
    status: v.union(
      // PINNED lifecycle enum, shared by agent + delivery lanes:
      v.literal("collecting"), // slots still filling during the guided conversation
      v.literal("proposed"), // all slots filled + body drafted → PLAN card, awaiting Approve
      v.literal("approved"), // executePlan CAS passed (set immediately before workflow.start)
      v.literal("scheduled"), // 03.5: approved + a future sendAt; scheduler armed, nothing sent yet
      v.literal("delivering"), // fan-out workflow started (requests rows seeded)
      v.literal("done"), // fan-out complete
      v.literal("canceled"), // 03.5: terminal — a scheduled send halted before fire (audited)
    ),
    // Slot content (accumulated during the conversation; all optional until filled):
    recipients: v.optional(v.array(v.string())), // validated, deduped emails
    mode: v.optional(v.union(v.literal("individual"), v.literal("group"))),
    subject: v.optional(v.string()),
    bodyIntent: v.optional(v.string()), // the user's goal → drafter turns it into `body`
    body: v.optional(v.string()), // drafted wording (filled at "ready")
    // Generated outbound attachments (CKPT-02). Inline on the plan = pre-approval source of truth
    // for the PLAN card; executePlan materializes attachments-table rows at fan-out. All optional → no migration.
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          filename: v.string(),
          mimeType: v.string(),
          size: v.number(),
        }),
      ),
    ),
    attachmentError: v.optional(v.string()), // transient: render-failed / over-byte-cap → blocks propose (V7)
    // TRANSIENT name-resolution store (Plan 04/05 resolution card): raw fetched
    // candidate names/addresses/hints held on the content plane ONLY (CLAUDE.md §4 —
    // raw content lives in `plans`, NEVER in audit/DLQ), wiped on pick (clearCandidates).
    // The "no contacts cache at rest" invariant: only the chosen address persists in
    // `recipients`; candidates/pendingValid never survive the pick. All optional → no migration.
    candidates: v.optional(
      v.array(
        v.object({
          name: v.string(),
          matches: v.array(
            v.object({
              address: v.string(),
              displayName: v.optional(v.string()),
              lastSubject: v.optional(v.string()), // USER-only hint — never sent to the LLM
              lastDateMs: v.optional(v.number()),
              count: v.number(),
            }),
          ),
        }),
      ),
    ),
    pendingValid: v.optional(v.array(v.string())), // same-turn valid addrs awaiting the uniform confirm
    greetingName: v.optional(v.string()), // resolved display name → drafter greeting (survives to draft turn)
    // Picked display names by lowercased ADDRESS (UAT-F1, 03.10-07): the resolveRecipients fold
    // persists picks[].displayName so buildAgentContext renders a completed pick by NAME — the
    // model can distinguish a folded pick from an unresolved placeholder. Optional → no migration
    // (the candidates/attachments precedent). Content-plane ONLY, NEVER audited (§4); resetPlan wipes it.
    recipientNames: v.optional(v.record(v.string(), v.string())),
    // Per-recipient body overrides (CKPT-03). Keyed by lowercased ADDRESS → that recipient's
    // tailored body; a missing key = the shared `body`. Address-keyed (not index) survives
    // mid-conversation recipient edits; orphan keys filter harmlessly at seed. Optional → no
    // migration (mirrors attachments/candidates/greetingName). Content-plane ONLY, NEVER audited (§4).
    recipientBodies: v.optional(v.record(v.string(), v.string())),
    // Deferred send (03.5 SCHD-01). `sendAt` is the ONE source of truth — an absolute epoch ms
    // (nullable = immediate on Approve, today's default); never a wall-clock string or a tz pair
    // (the Tier-1-compatibility rule, scheduled-send.md). `scheduledFunctionId` is the scheduler
    // handle used to cancel before fire (mirrors review.ts pendingTimeouts.scheduledId). Both
    // optional → no migration (append-only, like recipientBodies/attachments). Content-plane only.
    sendAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    // Reply threading (03.11 RPLY-01). Set by the replyToMessage tool (Plan 04) when a plan is a
    // reply, copied to the per-recipient `requests` rows at executePlan (Plan 03). All optional →
    // no migration; a non-reply send simply carries none (append-only, like sendAt/attachments).
    // `replyThreadId` is the GMAIL thread id to thread the reply INTO — NOT `threadId` above, which
    // is the agent/convex thread that renders this plan's cards (a different id space). `inReplyTo`/
    // `references` are RFC 5322 Message-ID header values (angle-bracketed), never the Gmail id
    // (Pitfall 5). `replyToMessageId` is the refs-only anchor to the original message.
    replyToMessageId: v.optional(v.string()),
    replyThreadId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    // Cockpit review-gate counter/terminal (REVW-02, 07-04). `reviseCount` is the redraft
    // tally the gate compares against MAX_REGENERATE (@pikar/core classifyReviewDecision);
    // `escalated` is the fail-closed terminal flag set when the cap is breached. Both optional
    // → existing rows need no backfill (append-only discipline, like sendAt/attachments).
    reviseCount: v.optional(v.number()),
    escalated: v.optional(v.boolean()),
    // Plan-SHAPE discriminator (12-05, BEVL-02). ABSENT = the email plan every prior phase built
    // (no migration — the sendAt/attachments precedent); "memo" = a next-step memo staged by
    // evaluations.actOnGap: no recipients, and executePlan takes the PERSIST terminal (a
    // next_step_memo vault doc) instead of the gmail fan-out. Closed literal so a widening is a
    // deliberate schema edit, never a runtime surprise.
    kind: v.optional(v.literal("memo")),
    // Skill-version attribution (08 IMPR-02). Set at propose (Plan 02) from the active
    // skill that drafted this plan, then copied onto the per-recipient `requests` rows at
    // executePlan. Optional → no migration (the sendAt/attachments precedent).
    skillVersion: v.optional(v.number()),
    correlationId: v.optional(v.string()), // set on executePlan (not the per-recipient cids)
    workflowId: v.optional(v.string()), // set on executePlan
    createdAt: v.number(),
  }).index("by_thread", ["tenantId", "threadId"]),

  // ── Phase-3.7 inbox-briefing plane (CKPT-04) ───────────────────────────────
  // New tables only → no migration (prior-phase discipline).

  // The briefing content plane — the read-only sibling of `plans`. Holds the gists the
  // BRIEFING card renders, per cockpit thread. Raw mailbox content (sender/gist) lives HERE
  // and NEVER in an audit/DLQ payload (CLAUDE.md §4 — the audit carries counts + the range
  // literal only). `id`/`bucket`/`sender`/`subject`/`ts` are CODE-owned structural facts welded on by
  // @pikar/core's joinDigest — the model emits only the gist (ADR-004). Rows are append-only
  // per thread (a re-brief inserts; byThread reads the latest), and are vault-ingestable
  // later by construction (plain text, tenant-scoped) — nothing is built for that now.
  briefings: defineTable({
    tenantId: v.string(),
    threadId: v.string(), // renders the BRIEFING card for this thread, like plans
    range: v.string(), // the requested range literal (enum-ish; caller-supplied, never user prose)
    tz: v.string(), // the IANA zone the buckets were computed in (display honesty)
    items: v.array(
      v.object({
        id: v.string(), // Gmail message id — the row's stable identity (code-owned, never model-owned)
        bucket: v.union(v.literal("today"), v.literal("yesterday"), v.literal("thisWeek")),
        sender: v.string(),
        subject: v.string(), // the Subject header (code-owned, never model-owned); "" is legal
        ts: v.number(), // Gmail internalDate ms (code-owned, never model-owned)
        gist: v.string(),
        category: v.string(),
        needsReply: v.boolean(),
        deadline: v.optional(v.string()), // a model-extracted SUGGESTION string — rendered, never parsed into an action (SC-4)
        isUnread: v.optional(v.boolean()),
      }),
    ),
    listedCount: v.number(), // how many the list returned → "summarized N of M" cap honesty
    // The model's ONE cross-message clause (the lede) — qualitative story only, never a count/
    // sender/date (ADR-004). Optional → no migration; a pre-07 row simply has no synopsis and the
    // lede degrades to counts-only (@pikar/core composeLede handles the absent case).
    synopsis: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_thread", ["tenantId", "threadId"]),

  // ── Phase-10 vault-grounding content plane (VGND-01) ──────────────────────
  // The read-only sibling of `briefings`: holds the labels the SOURCE card renders for a
  // searchVault turn. Titles + doc ids + count ONLY — labels-to-UI, NEVER chunk text, NEVER an
  // audit row (the refs-only vault.searched audit is written by the ACTING module, llm.ts, so
  // titles held here can never reach a payload — CLAUDE.md §4). docIds are PreviewModal
  // click-through targets (Plan 03). Append-only per thread; byThread reads the latest.
  vaultSources: defineTable({
    tenantId: v.string(),
    threadId: v.string(), // renders the SOURCE card for this thread, like briefings
    docIds: v.array(v.id("vaultDocuments")), // stable refs — PreviewModal click-through target (Plan 03)
    titles: v.array(v.string()), // doc titles = labels-to-UI (§4: never reach the audit payload)
    count: v.number(), // grounded-in-N — the card masthead
    createdAt: v.number(),
  }).index("by_thread", ["tenantId", "threadId"]),

  // ── Phase-12 business-evaluation content plane (BEVL-01) ──────────────────
  //
  // The durable, append-only assessment trail. Each `runEvaluation` (evaluations.ts) writes ONE
  // row: the grounded + carried-forward Scorecard snapshot, the per-finding cited observations,
  // the leverage-ranked gaps (diagnose() prescriptions), and the honest not-enough-data sections.
  // CONTENT-PLANE (like `plans`/`vaultSources`): findings/gaps carry grounded labels + citations
  // and are NEVER audited — only counts/enums reach the refs-only `evaluation.ran` audit (§4).
  //
  // Storage DECISION (12-03): a dedicated TABLE, not a vaultDocuments doc-kind — a clean
  // latest-per-thread query (by_tenant_thread, order desc) + first-class SC #5 isolation index
  // (by_tenant) without parse-on-read; BEVL-03's recurring review consumes the structured trail.
  // Append-only new table = no migration (prior-phase discipline).
  //
  // `scorecard` is v.any() (the @pikar/core Scorecard shape — all-nullable); `userProvided` holds
  // the scorecard dot-path keys a user answered in-conversation so carry-forward + citation
  // labeling read it (a finding on a userProvided field is cited "user-provided", never fabricated).
  evaluations: defineTable({
    tenantId: v.string(),
    threadId: v.string(),
    framework: v.union(
      v.literal("swot"),
      v.literal("lean"),
      v.literal("bmc"),
      v.literal("growth-os"),
    ),
    // Cited observations — content-plane, never audited. `source` distinguishes a grounded vault
    // fact from a user-provided figure (honest provenance); a user-provided finding has no docId.
    findings: v.array(
      v.object({
        label: v.string(),
        section: v.string(), // framework quadrant/section (e.g. "identity", "financials")
        citationDocId: v.optional(v.string()), // absent for a user-provided finding
        citationTitle: v.string(),
        confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
        source: v.union(v.literal("vault"), v.literal("user-provided")),
      }),
    ),
    // Leverage-ranked prescriptions (diagnose() → the single highest-leverage constraint first).
    gaps: v.array(
      v.object({
        label: v.string(),
        leverageRank: v.number(), // gate order (Market<Offer<Money<Leads<Scale) — lower = fix first
        route: v.string(), // the target specialist skill (execution deferred to 15+)
        playbook: v.string(),
        citationDocId: v.optional(v.string()),
        // The prescription's own grounded prose (12-05): why this gate fails first and what proves
        // it fixed. Written straight from diagnose() — the memo body (actOnGap) reads them instead
        // of re-deriving. Optional → pre-12-05 rows simply carry none (append-only, no migration).
        reason: v.optional(v.string()),
        proofMetric: v.optional(v.string()),
      }),
    ),
    // Honest thin-data state: a section the vault couldn't ground AND no carried value — a nudge,
    // NOT a fabricated finding and NOT a real gap.
    notEnoughData: v.array(v.object({ section: v.string(), needs: v.string() })),
    scorecard: v.any(), // the parsed + carried-forward @pikar/core Scorecard snapshot
    userProvided: v.array(v.string()), // scorecard dot-path keys the user supplied in-conversation
    verdict: v.union(v.literal("gaps"), v.literal("healthy"), v.literal("insufficient")),
    // BEVL-03 "what changed" line. Written ONLY by a cron-driven run (runEvaluation withDelta) —
    // an on-demand row has none and the card simply hides the line. Optional → no migration.
    // Gap identity is `${route}/${playbook}`: there are only THREE routes in diagnose() and several
    // distinct prescriptions share each, so a route-only key reports real progress as "no change".
    delta: v.optional(
      v.object({
        newFindings: v.number(),
        gapsClosed: v.array(v.string()), // `${route}/${playbook}` keys present last run, gone now
        gapsOpened: v.array(v.string()), // keys present now, absent last run
      }),
    ),
    createdAt: v.number(),
  })
    // SC #5 isolation + "latest per tenant" ; by_tenant_thread = the card's latest-per-thread read.
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_thread", ["tenantId", "threadId"]),

  // ── Phase-3.9 agent activity trace (CKPT-05) ──────────────────────────────
  //
  // The step rows the agent loop writes and the browser subscribes to, so a 10-30s turn shows
  // its work instead of freezing. UI state, NOT an audit trail — agentSteps.ts writes no
  // log-plane row (the briefings.ts property); the agent's refs-only audit already exists.
  //
  // There is deliberately NO label/text/detail/result field. The human-readable verb is a
  // code-owned map in the UI keyed off `tool`. §4 is enforced by the ABSENCE of a place to put
  // text — the SDK's tool events carry `messages[]` and `toolOutput.output` (listInbox's return
  // contains SUBJECTS), and a `count: v.number()` literally cannot hold a subject line. Asserted
  // statically in llmRedaction.test.ts (Plan 02).
  agentSteps: defineTable({
    tenantId: v.string(),
    threadId: v.string(),
    turnId: v.string(), // server-minted per turn (crypto.randomUUID) — groups the trace
    stepKey: v.string(), // toolCall.toolCallId (SDK-owned) | "thinking" — the start↔end join
    tool: v.union(
      // CLOSED union of OUR tool names — a model cannot widen it. The model CHOOSES which tool to
      // call, but the name in the event is a key of our own `tools` record (`ai` throws
      // NoSuchToolError before execute on a hallucinated name), so this can never legitimately
      // fail — and it turns "the model can't inject a label" from an argument into a constraint.
      // Precedent: the PINNED status enum on `plans` (03.1-01).
      v.literal("thinking"),
      v.literal("resolveContacts"),
      v.literal("addRecipients"),
      v.literal("setRecipients"),
      v.literal("removeRecipient"),
      v.literal("setSubject"),
      v.literal("setMode"),
      v.literal("setSendTime"),
      v.literal("draftBody"),
      v.literal("proposePlan"),
      v.literal("generateAttachment"),
      v.literal("regenerateAttachment"),
      v.literal("removeAttachment"),
      v.literal("personalizeRecipient"),
      v.literal("listInbox"),
      v.literal("briefInbox"),
      v.literal("replyToMessage"),
      // Phase-10 (VGND-01): the read-only vault-grounding tool. Without this literal the SDK's
      // activity-step insert throws and is silently swallowed → no "Searching…" step in prod
      // while tests pass (Research Pitfall 4).
      v.literal("searchVault"),
      // Phase-12 (BEVL-01): the read-only business-evaluation tool. Without this literal the
      // engine's "Assessing…" step insert throws and is silently swallowed in prod while tests
      // pass (Pitfall 2 — the same closed-union trap as searchVault above).
      v.literal("evaluateBusiness"),
      // Phase-15 (DISP-01): the sub-agent dispatch steps. N literals, NOT a `specialist: v.string()`
      // field — §4 on this path is enforced by the ABSENCE of anywhere to put text ("a
      // `count: v.number()` literally cannot hold a subject line", :435-439). Adding a text field
      // would re-open exactly the hole this union closed. Without these literals the dispatch step's
      // insert throws and the SDK SWALLOWS it → no trace in prod while every test passes.
      v.literal("dispatchOfferArchitect"),
      v.literal("dispatchMoneyModelDesigner"),
      v.literal("dispatchLeadEngine"),
    ),
    phase: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    // ponytail: declared, UNWRITTEN in v1. Verb labels are the ask (ROADMAP 3.9, amended).
    // Upgrade path when counts are wanted: an explicit per-turn count recorder threaded into
    // buildCockpitTools, written by the <=3 tools that KNOW a count (briefInbox/listInbox/
    // resolveContacts) — never parsed out of a tool's return string (§4).
    count: v.optional(v.number()),
  })
    .index("by_turn", ["tenantId", "turnId"])
    // by_tenant is ["tenantId"] ALONE, and that is load-bearing. latestTurn finds the newest turn
    // via `.order("desc").first()`, which relies on _creationTime being the first sort dimension
    // AFTER the eq'd prefix. An index of ["tenantId", "threadId"] eq'd on tenantId only would sort
    // by threadId FIRST and return the alphabetically-largest thread's row, not the newest one —
    // caught by agentSteps.test.ts ("returns ONLY the newest turn's rows"). The briefings.byThread
    // "index order IS recency" property holds there because it eq's BOTH prefix fields; it does
    // NOT generalize to a partial prefix. There is no by_thread index because nothing reads by
    // thread: the UI subscribes to latestTurn (no threadId — the first-turn window) and filters
    // client-side on the returned threadId.
    .index("by_tenant", ["tenantId"]),

  // The test seam that lets a briefing run with NO Gmail token: gmail.listInbox /
  // fetchInboxBodies check this table BEFORE freshAccessToken and serve these messages when a
  // row exists. Written ONLY by smoke.seedInboxFixture (an internalMutation) — real tenants
  // never have rows, so the live path is unreachable from a fixture and vice versa. Powers
  // both the offline Playwright E2E and the eval injection probe (whose tenant has no mailbox).
  inboxFixtures: defineTable({
    tenantId: v.string(),
    offlineDigest: v.boolean(), // true = E2E (the digest short-circuits offline); false = eval (a LIVE digest runs, so the injection probe is real)
    messages: v.array(
      v.object({
        id: v.string(),
        from: v.string(),
        subject: v.string(),
        snippet: v.string(),
        internalDate: v.number(),
        isUnread: v.optional(v.boolean()),
        body: v.string(),
        // Reply-target anchors (03.11 RPLY-01). The reply path needs a GMAIL `threadId` to thread
        // into AND an RFC 5322 `messageId` (angle-bracketed Message-ID header) for In-Reply-To —
        // NOT the Gmail `id` above (Pitfall 5). Both optional → pre-3.11 fixtures load unchanged.
        threadId: v.optional(v.string()),
        messageId: v.optional(v.string()),
      }),
    ),
  }).index("by_tenant", ["tenantId"]),

  // File metadata only — the agent sees filename/mimeType/size, never contents.
  // `extracted` is filled by Phase 4 (INTK-02). requestId set after the request insert.
  attachments: defineTable({
    tenantId: v.string(),
    requestId: v.optional(v.id("requests")),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    extracted: v.optional(v.string()),
  }).index("by_request", ["requestId"]),

  // One row per request, written once at terminal state (OPSG-01). Bounded by
  // request count — queried directly, not via the aggregate.
  telemetry: defineTable({
    tenantId: v.string(),
    correlationId: v.string(),
    requestId: v.id("requests"),
    tokensIn: v.number(),
    tokensOut: v.number(),
    costUsd: v.number(),
    durationMs: v.number(),
    decisionCounts: v.any(),
    regenerateCount: v.number(),
    reviewOutcome: v.string(),
    createdAt: v.number(),
  })
    .index("by_correlation", ["correlationId"])
    // EVAL-02 read side: tenant-scoped, time-windowed signal reads (opsSignals.ts).
    // An index is not a write path; Convex backfills it automatically.
    .index("by_tenant_created", ["tenantId", "createdAt"]),

  // In-app notifications (INTK-04 seam; OPSG-05 grows channels onto these rows in Phase 7).
  notifications: defineTable({
    tenantId: v.string(),
    kind: v.string(),
    requestId: v.optional(v.id("requests")),
    message: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  }).index("by_tenant_read", ["tenantId", "read"]),

  // Gmail OAuth tokens — the crown jewels. Read by internal functions ONLY;
  // never returned to a client query, never in the browser, never in an audit payload.
  gmailTokens: defineTable({
    tenantId: v.string(),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scope: v.string(),
    updatedAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

  // ── Phase-3 guardrail plane ────────────────────────────────────────────────
  // GRDL-06 kill switch + per-request budget. SINGLE row, upserted by
  // guardrails.setKillSwitch; read with .first() (≤1 row — no index needed).
  // Default-on-read: a missing row means switch OFF (zero seed, no migration).
  guardrailConfig: defineTable({
    killSwitch: v.boolean(),
    budgetUsdPerRequest: v.number(),
    updatedAt: v.number(),
  }),

  // Demo table used by plan 02's cross-tenant negative test.
  demoItems: defineTable({
    tenantId: v.string(),
    label: v.string(),
  }).index("by_tenant", ["tenantId"]),

  // ── Phase-4 inbound intake plane (Lane B) ────────────────────────────
  // INBOUND ingestion — distinct from OUTBOUND plans.attachments (CKPT-02) and the
  // request-scoped `attachments` table. Thread-scoped: ingestion happens DURING the
  // cockpit conversation, before any request/plan exists. `extracted` holds REDACTED
  // safeText only (never raw); raw bytes live in _storage, referenced by storageId.
  intakeArtifacts: defineTable({
    tenantId: v.string(),
    threadId: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    kind: v.union(
      v.literal("image"),
      v.literal("pdf"),
      v.literal("audio"),
      v.literal("document"),
      v.literal("unknown"),
    ),
    status: v.union(
      v.literal("uploaded"),
      v.literal("extracting"),
      v.literal("extracted"),
      v.literal("failed"),
    ),
    extracted: v.optional(v.string()), // REDACTED safeText (content plane; §4 keeps it out of audit)
    createdAt: v.number(),
  }).index("by_thread", ["tenantId", "threadId"]),

  // ── Phase-5 knowledge-vault plane ──────────────────────────────────────────
  // Per-user Knowledge Vault + GraphRAG (VALT-01..04). New tables + optional
  // fields only → no migration (prior-phase discipline). Every table is
  // tenant-scoped and carries the index its adapter query needs.

  // A stored vault document. Raw content lives in `text` (the tenant-scoped
  // content plane, CLAUDE.md §4 — the user's OWN private data, NEVER an
  // audit/DLQ payload). `ragEntryId` links the embedded rag entry; the graph
  // extraction runs off the redacted text at ingest.
  vaultDocuments: defineTable({
    tenantId: v.string(),
    title: v.string(),
    kind: v.string(), // logical kind (e.g. brief, brain_dump, upload)
    category: v.string(), // one of the 6 vault categories (categoryFor)
    source: v.string(), // ingest source (upload / paste / seam)
    mimeType: v.string(),
    size: v.number(),
    contentHash: v.string(), // sha-256 hex → cross-doc dedup
    storageId: v.optional(v.id("_storage")), // stored bytes for downloadable uploads
    text: v.optional(v.string()), // raw extracted text (content plane, §4)
    ragEntryId: v.optional(v.string()), // the embedded rag entry id
    status: v.union(
      v.literal("processing"), // ingest workflow running (embed → extract)
      v.literal("ready"), // embedded + extracted, groundable
      v.literal("failed"), // ingest failed (see failureReason)
      v.literal("pending_extraction"), // stored, text not yet available (binary/OCR seam)
      v.literal("extracting"), // Phase-3.8: an extraction action is producing this doc's text
    ),
    failureReason: v.optional(v.string()),
    extractionTruncated: v.optional(v.boolean()), // Phase-3.8: the per-doc extract cap bit (honesty flag)
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"]) // browse
    .index("by_tenant_contentHash", ["tenantId", "contentHash"]) // dedup
    .index("by_kind", ["kind"]), // BEVL-03 cron: enumerate onboarded tenants without reading every
  // document's `text` blob (this table holds book-sized uploads; a .collect() would walk into the
  // 16 MiB / 32k-doc read cap). The ONE deliberately cross-tenant index in the repo — read by a
  // single caller (the weekly review fan-out) and yielding tenant ids only, never content.

  // A typed entity extracted from vault documents. Cross-doc dedup upserts to
  // ONE node on (tenantId, normalizedName) [type filtered in-handler] via
  // normalizeName, so the graph actually connects documents. `degree` supports
  // orphan GC on delete-cascade.
  graphNodes: defineTable({
    tenantId: v.string(),
    type: v.string(), // person / org / project / place / topic / other
    name: v.string(), // surface form
    normalizedName: v.string(), // normalizeName(name) → dedup key
    degree: v.number(),
  }).index("by_tenant_normalized", ["tenantId", "normalizedName"]), // upsert/dedup

  // A relationship between two graphNodes, attributed to its source document.
  // fromNode/toNode indexes drive hop-capped BFS traversal; by_tenant_source
  // drives the delete-cascade (remove edges whose sourceDocId = deleted doc).
  graphEdges: defineTable({
    tenantId: v.string(),
    fromNodeId: v.id("graphNodes"),
    toNodeId: v.id("graphNodes"),
    rel: v.string(),
    sourceDocId: v.id("vaultDocuments"),
  })
    .index("by_tenant_fromNode", ["tenantId", "fromNodeId"]) // BFS forward
    .index("by_tenant_toNode", ["tenantId", "toNodeId"]) // BFS reverse
    .index("by_tenant_source", ["tenantId", "sourceDocId"]), // delete-cascade

  // ── Phase-6 live-voice-session plane (VOIC-01..04) ─────────────────────────
  // One row per live WebRTC voice session. NEW table → no migration. Raw audio is
  // NEVER stored (discard-audio consent, CONTEXT); the durable transcript+brief live
  // in `vaultDocuments` (referenced by briefRef), and this row carries only session
  // control state + refs/counts (§4-clean — no transcript/PII here).
  voiceSessions: defineTable({
    tenantId: v.string(),
    // No "wrapping" status: the T-2min wrap-up is a client-side agent instruction, not
    // a server state. "active" only once callId is set (Pitfall 1); the watchdog ends
    // a dropped session as "ended_abnormal" (still briefs), a user/graceful close as "ended_clean".
    status: v.union(v.literal("active"), v.literal("ended_clean"), v.literal("ended_abnormal")),
    callId: v.optional(v.string()), // realtime provider call/session id — null until the WebRTC handshake relays it
    startedAt: v.number(),
    endsAt: v.number(), // wall-clock hard cap (capEndsAt from @pikar/voice) — the watchdog's fire time
    // The cancellable watchdog scheduler handle (same id-type plans.scheduledFunctionId uses):
    // cancel it on a clean end so it does not double-fire an abnormal brief.
    watchdogFnId: v.optional(v.id("_scheduled_functions")),
    // Cumulative realtime token counters (VOIC-02 metering) — audio + text, in + out.
    inAudioTok: v.number(),
    outAudioTok: v.number(),
    textInTok: v.number(),
    textOutTok: v.number(),
    language: v.optional(v.string()), // auto-detected spoken language → brief generated in it
    briefRef: v.optional(v.id("vaultDocuments")), // the stored brief once generated (VOIC-03)
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"]) // browse
    // getActiveSession's parallel-session guard reads the single active row for a tenant.
    .index("by_tenant_status", ["tenantId", "status"]),

  // ── Phase-8 self-improvement plane (IMPR-01/02) ────────────────────────────
  // New tables + optional fields only → no migration (prior-phase discipline).

  // User feedback on a delivered response (IMPR-01). Tenant-owned, keyed to the
  // originating request and — through request.skillVersion — to the exact skill version
  // that produced it, so a rating becomes a rollout score for SkillOpt later.
  feedback: defineTable({
    tenantId: v.string(),
    requestId: v.id("requests"),
    skillName: v.string(), // "cockpit-agent" — the gated skill that produced the response
    skillVersion: v.number(), // resolved from request.skillVersion at write
    rating: v.union(v.literal("up"), v.literal("down")),
    // ponytail: raw comment text is CONTENT-PLANE — it lives at rest on this tenant-owned row
    // (like requests.goal), and is PII-SCRUBBED at the export boundary (Plan 04) before it ever
    // leaves the system. It is NEVER written to an audit/DLQ payload (CLAUDE.md §4 spirit).
    comment: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant_request", ["tenantId", "requestId"]) // one editable row per (tenant, request)
    .index("by_skill", ["skillName", "skillVersion"]), // eligibility rolls the negative-rate over this

  // The optimizer kill switch + tunable thresholds (IMPR-02). SINGLE row, upserted by
  // optimizerConfig.setOptimizerConfig; read with .first() (≤1 row — no index needed).
  // Default-on-read: a missing/false row means the optimizer ships DORMANT (enabled=false,
  // zero seed, no migration — the guardrailConfig precedent).
  optimizerConfig: defineTable({
    enabled: v.boolean(), // DORMANT default via default-on-read (Plan default false)
    negativeRateThreshold: v.number(), // starting value: 0.30
    minSampleFloor: v.number(), // 20 — one bad rating can't trigger
    cooldownMs: v.number(), // 604800000 (7d)
    lastRunAt: v.optional(v.number()), // cooldown anchor, set by the CI job / dry-run
    updatedAt: v.number(),
  }),

  // ── Phase-15.1 tier control plane (design §4.1) ────────────────────────────
  //
  // The CONTROL PLANE for a tenant's business shape. The narrative profile stays a
  // `business_profile` vault doc (ONBD-02, content plane — it needs embedding and RAG retrieval);
  // this table is the RECORD for the tier and the markdown persona line becomes a PROJECTION of it
  // (§4.2). Before this table the tier lived ONLY as the string `- **Persona:** solopreneur` inside
  // a markdown blob, recovered by string-matching — unindexable, unauditable, and silently
  // reclassifying a tenant as a solopreneur on any malformed doc (design §1d).
  //
  // A new TABLE is the only option, not a choice: there is no `tenants` table to add a column to
  // (tenancy is a `tenantId: string` column on every row). ONE ROW PER TENANT, read through
  // by_tenant. New table ⇒ no migration (prior-phase discipline).
  tenantProfiles: defineTable({
    tenantId: v.string(),
    // Tier facts (@pikar/core `TierFacts`). ALL optional: a `legacy` backfill row has none by
    // definition and design §10 forbids forced re-onboarding, so the "narrow" half of
    // widen-migrate-narrow is deliberately NEVER taken. Completeness is enforced at the WRITE
    // boundary (`missingSlots`/`canComplete`), not by the schema — the schema must keep admitting
    // the incomplete legacy row it was created to hold.
    headcount: v.optional(v.number()),
    paidStaff: v.optional(v.number()),
    // Closed literal unions, mirroring @pikar/core REVENUE_STAGES / FUNDING_STATES (owner Q7). A
    // v.string() here would reintroduce the string-matching defect class this phase closes.
    revenueStage: v.optional(
      v.union(v.literal("pre-revenue"), v.literal("early-revenue"), v.literal("steady-revenue")),
    ),
    funding: v.optional(
      v.union(v.literal("bootstrapped"), v.literal("seeking"), v.literal("funded")),
    ),
    yearsOperating: v.optional(v.number()),
    // Derived (SC#2). `enterprise` is REPRESENTABLE here and NEVER returned by deriveTier (D6):
    // the derivation function's return type (`DerivedTier`, three members) is what makes D6 a type
    // error rather than a review note. The fourth literal exists for the operator grant (Q4).
    tier: v.union(
      v.literal("solopreneur"),
      v.literal("startup"),
      v.literal("sme"),
      v.literal("enterprise"),
    ),
    // REQUIRED, together with `tier` and `derivedAt`: a row cannot exist without a tier and a
    // provenance for it. That is what stops a half-written row from becoming a silent
    // "solopreneur" — the exact failure the markdown fallback used to produce.
    tierSource: v.union(
      v.literal("derived"),
      v.literal("confirmed"),
      v.literal("admin"),
      v.literal("legacy"),
    ),
    derivedAt: v.number(), // a rule retune is a visible re-derivation EVENT, not a silent reclass
    // Agent identity (D4). agentName is sanitized at the WRITE boundary (`sanitizeAgentName`) —
    // it rides into a model system prompt, so it is a trust boundary, not a cosmetic field.
    agentName: v.optional(v.string()),
    behaviorPreset: v.optional(
      v.union(v.literal("direct"), v.literal("coaching"), v.literal("concise")),
    ),
  }).index("by_tenant", ["tenantId"]),
});
