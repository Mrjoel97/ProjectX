import { authTables } from "@convex-dev/auth/server";
import { CONTRACTS_PACKAGE_NAME } from "@pikar/contracts";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Compile-time proof the Convex bundler resolves source-export workspace packages.
void CONTRACTS_PACKAGE_NAME;

export default defineSchema({
  // Convex Auth identity tables (users, authSessions, authAccounts, ...).
  ...authTables,

  // GOVN-01: `users` overrides the spread above to add ONE optional bit. Convex has no
  // table-extend API — inlining the definition is the sanctioned way to widen an auth table
  // (labs.convex.dev/auth/setup/schema), so every field and BOTH index names below are a
  // verbatim mirror of `authTables.users` in the pinned @convex-dev/auth@0.0.94. CLAUDE.md §6
  // pins that version exact; re-diff this mirror against the package if it is ever bumped.
  //
  // `owner` is OPTIONAL and absence means false — that is what makes this a widening with no
  // migration and no backfill. Owner authority is this boolean and nothing else: never an
  // email, never registration order, never SKILLOPT_OWNER_TENANT. Granted only by the
  // idempotent `owner.bootstrapOwner` internal mutation against an exact users._id.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    owner: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

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

  // Tenant-owned OVERLAY over the deployment-global `skills` table above (Phase 21, SKILL-01).
  //
  // WHY A SEPARATE TABLE, and do not "tidy" it back: `skills` is deployment-global and its
  // `by_name_status` reads are `.unique()`. Adding tenant rows there makes every one of those
  // reads multi-row and breaks every agent on the deployment. Encoding the tenant into `name`
  // would make authorization depend on string parsing instead of an indexed key.
  //
  // IMMUTABLE AFTER INSERT: `name`, `version`, `body`, `authoredBody`, `author`, `authorUserId`
  // and the whole `basedOn*` lineage. Later code may patch ONLY `status`, `evidence`, and the
  // code-owned `rollbackEligible` transition when a row genuinely becomes active. A new
  // adaptation is a NEW row composed against the current effective base — never a patched body,
  // and never an older adaptation appended to a newer one.
  //
  // TWO ROW SHAPES, and only code can mint the first:
  //   server baseline — author "system", authoredBody "", status "archived", rollbackEligible true
  //   user candidate  — author "user", a real authorUserId, status "candidate", rollbackEligible false
  // The baseline is what gives a tenant's FIRST customization a real, evidence-exempt rollback
  // target; `rollbackEligible` is code-owned precisely so a user candidate cannot mint itself one.
  tenantSkills: defineTable({
    tenantId: v.string(),
    name: v.string(),
    version: v.number(),
    // The complete runtime body (base + composed adaptation). Never model- or client-supplied.
    body: v.string(),
    // The user's adaptation alone — what a reviewer reads, and "" on a system baseline.
    authoredBody: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("candidate"),
      v.literal("rolled_back"),
      v.literal("archived"),
    ),
    // Phase 23 may append "agent" here without granting it activation.
    author: v.union(v.literal("system"), v.literal("user")),
    // Required when author === "user"; derived from authenticated identity, never from args.
    authorUserId: v.optional(v.id("users")),
    basedOnScope: v.union(v.literal("global"), v.literal("tenant")),
    basedOnName: v.string(),
    basedOnVersion: v.number(),
    basedOnGlobalSkillId: v.optional(v.id("skills")),
    basedOnTenantSkillId: v.optional(v.id("tenantSkills")),
    rollbackEligible: v.boolean(),
    evidence: v.optional(v.string()),
    createdAt: v.number(),
  })
    // Effective-load and per-tenant status reads.
    .index("by_tenant_name_status", ["tenantId", "name", "status"])
    // Next-version allocation and the exact-version read: descending `.take(1)`, never `.collect()`.
    .index("by_tenant_name_version", ["tenantId", "name", "version"])
    // The tenant's own bounded authoring history.
    .index("by_tenant_createdAt", ["tenantId", "createdAt"])
    // The bounded owner review queue across tenants.
    .index("by_status_createdAt", ["status", "createdAt"]),

  // "Routine v0" (Phase 21, SKILL-01): saved cockpit prompt text, INERT AT REST.
  //
  // There is deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp,
  // execution-history table, canvas or DSL. The only execution path is a user clicking Run, which
  // starts an ORDINARY fresh cockpit turn through the existing governed send path — so plan,
  // guardrail, spend, approval and activity boundaries are unchanged. `title` is code-derived
  // (bounded trimmed first line); `textHash` makes save idempotent within one tenant.
  savedPrompts: defineTable({
    tenantId: v.string(),
    text: v.string(),
    title: v.string(),
    textHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_tenant_createdAt", ["tenantId", "createdAt"])
    .index("by_tenant_textHash", ["tenantId", "textHash"]),

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
    // Pulse layer (living-map §3.1): windowed status reads for the tenant-wide outcome counts.
    .index("by_tenant_status_createdAt", ["tenantId", "status", "createdAt"])
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
    // Phase-26 Approvals. Missing provenance on a legacy canceled row means a historical
    // scheduled cancellation; every new cancel writes the discriminator explicitly.
    cancelKind: v.optional(v.union(v.literal("scheduled_cancel"), v.literal("discarded"))),
    canceledAt: v.optional(v.number()),
    // Delivery terminals own these counters. `counterComplete` is the honesty bit: absent/false
    // keeps legacy reads on the bounded partial projection instead of inventing exact progress.
    recipientTotal: v.optional(v.number()),
    sentCount: v.optional(v.number()),
    failedCount: v.optional(v.number()),
    queuedCount: v.optional(v.number()),
    counterComplete: v.optional(v.boolean()),
    // 19-05 SC#5, made VISIBLE (phase-19 UAT step 9b). The suppressed addresses this approve
    // dropped before the fan-out. Written once by `executePlan` in the same patch as the counters
    // above, and only when non-empty — an ordinary send carries no key, so there is no migration
    // and no "withheld: []" to render. It lives on the ROW rather than in the approve component's
    // `useState` because a successful approve IS the `proposed → approved` transition and both
    // approve cards are gated on `proposed`: the component that would show the note has already
    // unmounted when the note exists. Addresses only (the same content plane as `recipients`) —
    // never audited (§4).
    withheldRecipients: v.optional(v.array(v.string())),
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
    // Phase-17 (ACTN-02) widened it to a closed UNION: "calendar_event" = an event staged by the
    // proposeCalendarEvent tool, executed on Approve by the `externalAction` arm. ABSENT still
    // means email, so this stays a no-migration, no-backfill change (the sendAt/attachments
    // precedent) — and it is still CLOSED, so the next widening is still a deliberate edit.
    // Phase-20 (20-07, MEDIA-01) widened it a THIRD time: "media" = a reel staged as a BLOCK DECK,
    // reserved and started on Approve by the same `externalAction` arm. Still optional, still
    // closed, still no migration.
    // Phase-19 (19-06, ACTN-05) widened it a FOURTH time: "crm_write" = a list of contact and
    // follow-up operations, applied on Approve by the `inline` arm (one transactional write on our
    // OWN tables — no fetch, so not `externalAction`). Still optional, still closed, still no
    // migration and no backfill: ABSENT still means email.
    // 2026-08-10 widened it a FIFTH time: "finance_write" = a list of staged figure claims, applied
    // on Approve by the same `inline` arm. invariant 11 — the ACTOR decides gating: the human
    // editing the same figure through `cash.saveInput` stays ungated and stages no plan at all.
    // 17-05 widened it a SIXTH time (the ACTN-02 gap closure): "calendar_manage" = an UPDATE or a
    // DELETE of an event Pikar already created, staged for the same human Approve gate and
    // executed by the same `externalAction` arm. A NEW member rather than a reuse of
    // "calendar_event": create has no concurrency problem, management does (etag / If-Match / 412),
    // and the two cards must promise different things. Still optional, still closed, still no
    // migration and no backfill — ABSENT still means email.
    kind: v.optional(
      v.union(
        v.literal("memo"),
        v.literal("calendar_event"),
        v.literal("media"),
        v.literal("crm_write"),
        v.literal("finance_write"),
        v.literal("calendar_manage"),
      ),
    ),
    /** 19-06 ACTN-05: the staged CRM operation list a `crm_write` plan applies on Approve.
     *  CONTENT PLANE — it carries names and note text and must NEVER reach `audit.payload`
     *  (CLAUDE.md §4), the `eventTitle`/`shots` rule verbatim. `v.any()` elements because the
     *  SHAPE is owned by `parseCrmOperations` (@pikar/core), which validates at BOTH the write
     *  boundary and the apply boundary; a hand-mirrored validator here would be a third copy of
     *  the same union to keep in step. `resetPlan` clears it explicitly. */
    crmOperations: v.optional(v.array(v.any())),
    // Staged figure claims, inert until Approve. Content plane — the applier re-validates every
    // claim rather than trusting the row, because a plan row can be revised between staging and
    // approval. `field` stays `v.string()` on purpose: the CLOSED field union lives in
    // `CASH_INPUTS` (@pikar/core), and mirroring it here would be a second copy to keep in step —
    // `applyFinanceClaims` narrows against the catalogue itself. NEVER audited (§4): `value` is a
    // tenant's revenue.
    financeClaims: v.optional(
      v.array(
        v.object({
          field: v.string(),
          value: v.number(),
          origin: v.union(v.literal("stated"), v.literal("observed")),
          actor: v.union(v.literal("user"), v.literal("agent")),
          basis: v.string(),
          observedAt: v.number(),
          confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
        }),
      ),
    ),
    // Phase-17 (ACTN-02) staged calendar event. CONTENT-PLANE ONLY, NEVER audited (§4).
    // `resetPlan` wipes all six — a staged event surviving a reset would re-stage onto the NEXT
    // plan. All optional → no migration (the sendAt precedent).
    eventTitle: v.optional(v.string()), // CONTENT. Never audited, never a model-supplied instant.
    eventStartMs: v.optional(v.number()), // ONE absolute epoch ms — the `sendAt` rule verbatim.
    eventDurationMs: v.optional(v.number()), // duration as ms, NOT an end wall-clock string.
    eventTz: v.optional(v.string()), // the TRUSTED client's IANA zone (§2-D). Never the model's.
    // The last TWO are written ONLY by cockpit.ts (the run id, inside the Approve transaction) and
    // calendarComplete.ts (the event id, in the retrier terminal), via direct ctx.db.patch. They
    // are deliberately NOT `patchPlan` args: nothing reachable from the model may write an event
    // ref or a run id. Do not add them to patchPlan speculatively.
    calendarEventId: v.optional(v.string()), // the Google event ref, set on success. A ref, not content.
    mediaRunId: v.optional(v.string()), // 20-07: the media submit run — see by_media_run below
    calendarRunId: v.optional(v.string()), // the action-retrier RunId — the ONLY correlation the
    // retrier's onComplete gets on a FAILED run (it carries {runId, result} and no context).
    // ── 17-05 (ACTN-02 gap closure) the calendar_manage PROPOSAL plane ───────────────────────
    // All optional → no migration, no backfill: a Phase-17 create row has none of them, and an
    // ABSENT `calendarProvider` MEANS GOOGLE (@pikar/core `parseCalendarProvider`), because the
    // shipped slice was Google-only. `resetPlan` wipes all five — the `eventTitle` rule verbatim.
    /** Which calendar the operation targets. Closed union; absent = google (legacy create rows). */
    calendarProvider: v.optional(v.union(v.literal("google"), v.literal("microsoft"))),
    /** update | delete. "Move"/"reschedule" are an update and "cancel"/"remove" a delete — the
     *  user words are mapped in @pikar/core, so this column stays two literals wide. */
    calendarOperation: v.optional(v.union(v.literal("update"), v.literal("delete"))),
    /** The REGISTRY row this operation manages. A ref to OUR OWN table, never a provider id:
     *  management is limited to Pikar-created, attendee-free events, and this is the link that
     *  makes that enforceable rather than aspirational. */
    calendarManagedEventId: v.optional(v.id("calendarEvents")),
    /** The provider etag the human approved AGAINST — the If-Match value 17-08 will send. It is
     *  deliberately NOT a `patchPlan` arg (see plans.ts): a model-supplied etag would let a stale
     *  plan overwrite a newer calendar edit, which is the exact data-loss path G2 exists to close. */
    calendarExpectedEtag: v.optional(v.string()),
    /** A BOUNDED failure CODE from @pikar/core's `CALENDAR_FAILURE_CODES` — never provider prose.
     *  A Google 400 or a Graph 412 body can echo the event summary straight back (§4), so the
     *  terminal writes a code here and the card renders copy keyed off it. Also not a patchPlan
     *  arg: nothing reachable from the model may claim an operation failed, or that it did not. */
    calendarFailureCode: v.optional(
      v.union(
        v.literal("conflict"),
        v.literal("not_found"),
        v.literal("reauth"),
        v.literal("attendees_present"),
        v.literal("needs_inspection"),
        v.literal("not_managed"),
        v.literal("provider_error"),
      ),
    ),
    // ── Phase-20 (MEDIA-01) media canvas: the BLOCK DECK and the RENDER PLANE ──────────────
    // All optional → no migration, no backfill (the sendAt/attachments precedent). CONTENT-PLANE
    // ONLY: the block prompts and the narration lines are user-facing creative text and are NEVER
    // audited (§4). `resetPlan` wipes every field below — a deck surviving a reset would re-stage
    // onto the NEXT plan (the `eventTitle` rule above), and a surviving render would show the
    // previous thread's reel under a brand-new proposal, which is worse: it is a lie the user can
    // watch. None of them are `patchPlan` args; see plans.ts for why that absence is the guarantee.
    /** The media deliverable discriminator. Missing means the original reel path for rows written
     *  before standalone images existed. `imagePrompt` is content-plane text: shown to the human,
     *  submitted only after their Generate click, and never copied to audit/telemetry rows. */
    mediaMode: v.optional(v.union(v.literal("reel"), v.literal("image"))),
    imagePrompt: v.optional(v.string()),
    /** koda's fixed 9-field art-direction block, parsed. */
    artDirection: v.optional(
      v.object({
        palette: v.array(v.string()),
        mood: v.string(),
        lighting: v.string(),
        composition: v.string(),
        environment: v.string(),
        texture: v.string(),
        typography: v.optional(v.string()),
        references: v.array(v.string()),
        avoid: v.string(),
      }),
    ),
    /** The narration script for the whole reel (D8 — voiceover has nothing to say without it). */
    script: v.optional(v.string()),
    /** D8: block length, UNIFORM across the deck, ∈ {5,10} (Wan 2.5 accepts nothing else). */
    clipSeconds: v.optional(v.number()),
    /** The deck, INLINE rather than a `mediaShots` table: `plans.by_thread` is `.unique()`, so
     *  there is exactly one plan row per thread, and the canvas editor's reorder / delete / edit
     *  is then ONE array patch instead of N row writes plus an ordering column. There is no
     *  `mediaAssets` table either — a job produces at most one asset and its storage id lives on
     *  the job row. `type` is a ShotType value; @pikar/core/storyboard owns the closed set. */
    shots: v.optional(
      v.array(
        v.object({
          index: v.number(),
          type: v.string(),
          seconds: v.number(),
          windowStartMs: v.number(),
          description: v.string(),
          overlay: v.optional(v.string()),
          prompt: v.string(),
          narration: v.string(), // the block's SPOKEN line. Content-plane. Never audited.
        }),
      ),
    ),
    // The RENDER PLANE — fields on the plan row, NOT a second table. A reel is one artifact per
    // PLAN (delta §6.3), so a `mediaRenders` table would hold at most one row per plan forever.
    renderStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("rendering"),
        v.literal("rendered"),
        v.literal("failed"),
      ),
    ),
    /** final.mp4. A reel is publishable ONLY when `sidecarStorageId` is also set and its sidecar
     *  has validated. The script's own words: "a final video without one was hand-assembled."
     *  Presence of a VALID sidecar IS the proof-of-governed-render — never treat this id alone as
     *  a publishable artifact. */
    renderStorageId: v.optional(v.id("_storage")),
    sidecarStorageId: v.optional(v.id("_storage")), // final.mp4.assembly.json
    sidecarHash: v.optional(v.string()),
    /** A reasonCode, NEVER ffmpeg's stderr — `drawtext`, `subtitles=` and the error paths all echo
     *  file names and can echo narration text straight into a stored field (§4). */
    renderReason: v.optional(v.string()),
    renderedAt: v.optional(v.number()),
    /** The sidecar's own facts, parsed ONCE at the render terminal and persisted (20-09). The
     *  canvas needs the duration and the gate list to say in words what was proven, and a query
     *  cannot read a blob — `ctx.storage` in a query is a `StorageReader` with `getUrl` and
     *  nothing else. Writing it here also means the sidecar is parsed once per render rather than
     *  once per canvas subscription tick. Set ONLY on the success arm, beside the two storage ids,
     *  so its presence carries the same guarantee they do. */
    renderSummary: v.optional(
      v.object({
        durationS: v.number(),
        blockCount: v.number(),
        gates: v.array(v.string()),
      }),
    ),
    // The CAPTION PLANE (plan 20-17), on the same row and for the same reason as the render plane.
    // Captions are a SECOND artifact derived from the first, so they get their own status rather
    // than overloading `renderStatus`: a failed burn must leave `renderStatus: "rendered"` standing,
    // because a reel without captions is a degraded deliverable and an unpublished reel is none.
    captionStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("transcribing"),
        v.literal("burning"),
        v.literal("captioned"),
        v.literal("failed"),
      ),
    ),
    /** A reasonCode, never ffmpeg's stderr — and the `subtitles=` pass echoes NARRATION into its
     *  error output, which makes this field the one most able to become a §4 violation. */
    captionReason: v.optional(v.string()),
    /** Where each clean voice take starts inside the ONE concatenated wav that was transcribed.
     *  Written at submit, read at burn: it is how a word at t=4.5s in the transcript is known to
     *  belong to take 1 rather than take 0, and it cannot be recomputed later without re-fetching
     *  and re-concatenating every take. Seconds, take order, always `blockCount` long. */
    captionOffsetsS: v.optional(v.array(v.number())),
    // Skill-version attribution (08 IMPR-02). Set at propose (Plan 02) from the active
    // skill that drafted this plan, then copied onto the per-recipient `requests` rows at
    // executePlan. Optional → no migration (the sendAt/attachments precedent).
    skillVersion: v.optional(v.number()),
    correlationId: v.optional(v.string()), // set on executePlan (not the per-recipient cids)
    workflowId: v.optional(v.string()), // set on executePlan
    createdAt: v.number(),
  })
    .index("by_thread", ["tenantId", "threadId"])
    // Pulse layer (living-map §3.1): windowed status reads for the tenant-wide outcome counts.
    .index("by_tenant_status_createdAt", ["tenantId", "status", "createdAt"])
    // Phase-17 (ACTN-02). The action-retrier's `onComplete` receives ONLY `{runId, result}` — no
    // context bag — so the run id is the sole correlation handle back to the plan that started it.
    // This index is what makes that resolvable; without it the terminal cannot find its own plan.
    .index("by_calendar_run", ["calendarRunId"])
    // Phase-20 (20-07). The SAME reason, for the media submit run: `onSubmitComplete` receives only
    // {runId, result}, so without this index the terminal cannot find the plan whose batch it is
    // failing. Deliberately a SECOND column rather than a reuse of `calendarRunId` — that one is
    // calendar-named and read by `calendarComplete`; overloading it would make a media retry
    // resolvable as a calendar plan.
    .index("by_media_run", ["mediaRunId"]),

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
  })
    .index("by_thread", ["tenantId", "threadId"])
    .index("by_tenant_createdAt", ["tenantId", "createdAt"]),

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
    // Phase-18 (ACTN-04): this table now carries TWO card kinds. ABSENT ⇒ a grounding SOURCE
    // row (every row that exists today, zero backfill); "created" ⇒ the Output card for
    // artifacts the agent authored this turn. Same refs+labels discipline: titles/snippet are
    // labels-to-UI and NEVER reach an audit payload (CLAUDE.md §4 — this module writes no
    // log-plane row).
    role: v.optional(v.literal("created")),
    snippet: v.optional(v.string()), // first ~240 chars of the artifact — the card's preview
    // The Output card's UPPERCASE type badge (DOCUMENT / POST) reads THIS. It cannot be derived
    // from anything else the card has: `byThread` returns a `vaultSources` row, and the only
    // short/long discriminator otherwise lives on `vaultDocuments.kind`, which this row never
    // reads. Carrying it here keeps plan 18-07 at ZERO new Convex queries.
    // ponytail: one form per row. If a single turn ever mixes forms, the row records the LAST
    // call's form and the badge follows it — upgrade path is a parallel `forms: string[]`
    // beside `titles`, not a second table.
    form: v.optional(v.union(v.literal("short"), v.literal("long"))),
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
      // Phase 14 (DOCV-01). The literal is HUMAN-READABLE on purpose and is not a free choice:
      // `evaluations.ts buildMemo` prints "Diagnosed on the **${row.framework}** framework" as
      // user-visible prose inside an approvable memo. "document-review" reads correctly there;
      // a slug like "docrev" does not. Deliberately absent from `FRAMEWORK_SKILL` in
      // evaluations.ts — an unmapped literal is what keeps `runEvaluation` from ever accepting
      // a doc-review row.
      v.literal("document-review"),
    ),
    // Cited observations — content-plane, never audited. `source` distinguishes a grounded vault
    // fact from a user-provided figure (honest provenance); a user-provided finding has no docId.
    findings: v.array(
      v.object({
        label: v.string(),
        section: v.string(), // framework quadrant/section (e.g. "identity", "financials")
        citationDocId: v.optional(v.string()), // absent for a user-provided finding
        citationTitle: v.string(),
        // The second half of 14-CONTEXT.md's LOCKED citation decision — document-level citation
        // ALWAYS, plus a quoted passage WHERE AVAILABLE. `optional` is load-bearing: an absent
        // excerpt is a valid, non-degraded state, never an error and never an empty string. The
        // value is capped (`EXCERPT_CHAR_CAP`) and substring-verified against the document text
        // before it is written (`shapeDocReview` in `@pikar/voice`, `reviewDocument` in
        // `voiceDoc.ts`) — never trusted raw from a model.
        // §4: an excerpt IS report content. It may live HERE (the product surface) and must NEVER
        // reach an `audit` / `deadLetters` / `telemetry` `payload:` or an `agentSteps` row — plan
        // 14-09 pins that with a mutation-verified static scan.
        citationExcerpt: v.optional(v.string()),
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
    // Dot-path → epoch-ms the user stated/confirmed it (cash-business-finance Task 3 fix).
    // `applyScorecardAnswer` is the ONE writer, stamping `Date.now()` on every answer, and
    // `runEvaluation`'s carry-forward copies this map UNCHANGED into every new row — the whole
    // point is that it survives the weekly re-evaluation that stamps a fresh `createdAt` on the
    // ROW. Without this, `createdAt` was read as a stand-in stated-time and a re-evaluation that
    // merely carries a field forward silently reported it "confirmed today", which suppresses the
    // 90-day confirm-or-update prompt for a number that may be months stale — the unsafe direction.
    // Optional ⇒ no migration; a legacy row with a value but no entry here has UNKNOWN age, which
    // `cash.ts` reads as needing confirmation, never as fresh.
    userProvidedAt: v.optional(v.record(v.string(), v.number())),
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
      // Phase-12 (BEVL-01) again: the "store" half of vault-first→ask→store. MISSING until
      // 2026-08-08, and it cost exactly what the two comments above predict — every scorecard tool
      // call threw `ArgumentValidationError` inside `agentSteps:record`, the SDK swallowed it, and
      // the trace silently lost a step in prod while the whole suite stayed green. That is the
      // THIRD time this closed union has been the trap, so the omission is now guarded
      // STRUCTURALLY: cockpitTools.test.ts scans every `<name>: tool(` key in buildCockpitTools and
      // fails if any lacks a literal here. Add the literal in the SAME commit as a new tool.
      v.literal("recordScorecardAnswer"),
      // `resetPlan` — the cancel-and-start-over tool. ALSO missing, and nobody knew: the guard test
      // found it the first time it ran, which is the argument for the guard existing at all. Every
      // "cancel and begin again" turn has been losing its trace step the same silent way.
      v.literal("resetPlan"),
      // Phase-15 (DISP-01): the sub-agent dispatch steps. N literals, NOT a `specialist: v.string()`
      // field — §4 on this path is enforced by the ABSENCE of anywhere to put text ("a
      // `count: v.number()` literally cannot hold a subject line", :435-439). Adding a text field
      // would re-open exactly the hole this union closed. Without these literals the dispatch step's
      // insert throws and the SDK SWALLOWS it → no trace in prod while every test passes.
      v.literal("dispatchOfferArchitect"),
      v.literal("dispatchMoneyModelDesigner"),
      v.literal("dispatchLeadEngine"),
      // Phase-16 (DISP-02): the research sub-agent's dispatch step.
      v.literal("dispatchResearch"),
      // ...and `webResearch`, whose ABSENCE used to be deliberate — THAT REASONING INVERTED on
      // 2026-08-07. It was a PROVIDER-EXECUTED hosted tool, and ai@7.0.20's `executeToolCall`
      // returns early at `if (!isExecutableTool(tool)) return undefined;` BEFORE firing
      // `onToolExecutionStart`, so it emitted no step row and a declared-but-never-written literal
      // would have read as a trace that exists. It is now a LOCAL Tavily-backed tool (llm.ts), so
      // `onToolExecutionStart` DOES fire and the insert DOES need this literal — the same swallow
      // trap as every literal above, which this codebase has already been bitten by at searchVault
      // and evaluateBusiness. Still no text field: §4 on this path stays enforced by the ABSENCE of
      // anywhere to put a query string or a retrieved URL.
      v.literal("webResearch"),
      // Phase-17 (ACTN-02): the in-loop availability READ and the plan-staging WRITE. Two literals,
      // no text field — §4 on this path stays enforced by the ABSENCE of anywhere to put an event
      // title or an attendee address. Without these literals the step insert throws and the AI SDK
      // SWALLOWS it → no trace row in prod while every offline test passes (Research Pitfall 4 —
      // this codebase has been bitten twice already, at searchVault and evaluateBusiness).
      v.literal("checkAvailability"),
      v.literal("proposeCalendarEvent"),
      // 17-05 (ACTN-02 gap closure): the two MANAGEMENT trace literals, RESERVED. No tool emits
      // them yet — Plan 17-09 adds `listManagedCalendarEvents` (read-only registry listing) and
      // `proposeCalendarChange` (inspect-then-stage). They are declared HERE, ahead of the tools,
      // because this closed union is the swallow trap this file has now been bitten by three
      // times: a missing literal makes `agentSteps:record` throw an ArgumentValidationError inside
      // an AI-SDK callback the SDK SILENTLY swallows, so prod loses the step while the whole suite
      // stays green. Their cards.tsx VERB entries land in the SAME commit — traceParity.test.ts
      // asserts the two sets equal BOTH ways, so either half alone is RED.
      //
      // A declared-but-never-written literal is the ONE failure mode this pre-declaration can have
      // (it is why `webResearch` was deliberately absent while it was provider-executed): it reads
      // as a trace that exists. Both of these WILL be written by local, executable tools, so
      // `onToolExecutionStart` will fire for both.
      v.literal("listManagedCalendarEvents"),
      v.literal("proposeCalendarChange"),
      // Phase-20.1 (VALT-15): read-only Drive discovery in the cockpit. These are local tools,
      // so both literals are required for their truthful start/done agent-step trace.
      v.literal("listDriveFolders"),
      v.literal("findInDrive"),
      // 22.1b (declareUnsupported): the research specialist's structured evidence-gap declaration.
      // A LOCAL executable tool, unlike `webResearch` above — so `onToolExecutionStart` DOES fire
      // and the insert DOES need this literal. Without it the insert throws inside a callback the
      // AI SDK SWALLOWS → no trace row in prod while every offline test passes (Research Pitfall 4;
      // this codebase has been bitten at searchVault and evaluateBusiness).
      v.literal("declareUnsupported"),
      // Phase-18 (ACTN-04): the in-loop artifact-creation tool. Same swallow trap as every
      // literal above — without it the step insert throws inside an AI-SDK callback and is
      // silently swallowed, so prod has no trace row while every offline test stays green.
      // ponytail: two live tools — resetPlan and recordScorecardAnswer (bare names DELIBERATELY,
      // never spelled in this file's own v.literal idiom: traceParity.test.ts regexes this whole
      // slice, comments included, so the idiomatic spelling would inject phantom literals) — are
      // still trace-less here. Deliberately NOT fixed by Phase 18; see 18-RESEARCH.md Pitfall 2.
      v.literal("createDocument"),
      // Phase-20 (MEDIA-01): the media specialist's dispatch step. ONE literal, no text field —
      // §4 on this path stays enforced by the ABSENCE of anywhere to put a block description, a
      // prompt or a narration line. Without it the step insert throws inside a callback the AI SDK
      // SWALLOWS → no trace row in prod while every offline test passes (Research Pitfall 4).
      v.literal("dispatchMedia"),
      // Standalone image proposals stage content only. The paid action remains a separate canvas
      // click, but the local tool still needs a trace literal because AI-SDK callback failures are
      // otherwise swallowed (the dispatchMedia rule immediately above).
      v.literal("proposeImage"),
      // Phase-19 (ACTN-05): the CRM staging tool. Same swallow trap as every literal above — a
      // missing literal makes `agentSteps:record` throw an ArgumentValidationError inside an
      // AI-SDK callback, which the SDK SILENTLY swallows, so prod loses the step while the whole
      // suite stays green. Landed in the SAME commit as its `cards.tsx` VERB entry, because
      // traceParity.test.ts asserts the two sets equal BOTH ways and either half alone is RED.
      v.literal("stageCrmWrite"),
      // Task 7 (live-finance-inputs): the on-demand derived-metrics read. Same swallow trap as
      // every literal above, and the same traceParity.test.ts requirement — its cards.tsx VERB
      // entry lands in the same commit.
      v.literal("readFinance"),
      // Task 8 (live-finance-inputs): the figure staging tool. Same swallow trap as every literal
      // above — a missing literal makes `agentSteps:record` throw an ArgumentValidationError
      // inside an AI-SDK callback the SDK SILENTLY swallows, so prod loses the step while the
      // whole suite stays green. Lands in the SAME commit as its cards.tsx VERB entry, because
      // traceParity.test.ts asserts the two sets equal BOTH ways and either half alone is RED.
      v.literal("stageFinanceWrite"),
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
    .index("by_tenant", ["tenantId"])
    // Pulse layer (living-map §3): per-specialist range read — 4 indexed queries (segments with a
    // specialist; media has a dispatch tool but no segment) instead of a
    // tenant-wide scan that grows with every cockpit turn.
    .index("by_tenant_tool_startedAt", ["tenantId", "tool", "startedAt"]),

  // The test seam that lets a briefing run with NO Gmail token: gmail.listInbox /
  // fetchInboxBodies check this table BEFORE freshAccessToken and serve these messages when a
  // row exists. Written ONLY by smoke.seedInboxFixture (an internalMutation) — real tenants
  // never have rows, so the live path is unreachable from a fixture and vice versa. Powers
  // both the offline Playwright E2E and the eval injection probe (whose tenant has no mailbox).
  // Phase-17 (ACTN-02) — the inboxFixtures analogue for calendar availability, and it carries the
  // same rationale verbatim: written ONLY by an internal mutation, so real tenants never have rows,
  // the live freeBusy path is unreachable from a fixture, and a fixture is unreachable from the
  // live path. Epoch ms, NOT RFC3339 strings — conversion happens at the adapter boundary ONLY
  // (17-02), so the seam cannot drift into a second date format.
  calendarFixtures: defineTable({
    tenantId: v.string(),
    busy: v.array(v.object({ startMs: v.number(), endMs: v.number() })),
  }).index("by_tenant", ["tenantId"]),

  // ── 17-05 (ACTN-02 gap closure, G2): the DURABLE managed-event registry ────────────────────
  //
  // WHY A TABLE AND NOT MORE `plans` COLUMNS. 17-RESEARCH's Open Question 4 recommended optional
  // plan fields, and for CREATE that was right — one row per plan, no lifecycle. Management
  // inverts it: `resetPlan` exists to wipe a plan's staged content, and an event that Pikar
  // really put on a real calendar MUST NOT disappear because the user typed "start over" in the
  // thread. The plan is the PROPOSAL plane and is reset-able; this is the FACT plane and is not.
  // It is also what bounds management: 17-09's listing reads THIS table, so an arbitrary mailbox
  // event is unreachable by construction rather than by a filter someone has to remember.
  //
  // §4: refs, ids, times and one boolean. `title` is the only content-plane field and it is here
  // because the card must show the human WHICH event is about to move — it is never audited.
  calendarEvents: defineTable({
    tenantId: v.string(),
    provider: v.union(v.literal("google"), v.literal("microsoft")),
    /** The provider's own event id — an opaque REF (the workflowId/storageId precedent). */
    externalEventId: v.string(),
    /** The provider ETag. OPTIONAL only for rows a later plan explicitly backfills from the
     *  pre-17-05 create path, and such a row is NOT manageable until provider inspection supplies
     *  one — @pikar/core `manageability` returns `needs_inspection` for exactly this case. A
     *  missing etag must never be read as "no concurrency check needed". */
    etag: v.optional(v.string()),
    title: v.string(),
    startMs: v.number(), // ONE absolute epoch ms — the plans.sendAt rule verbatim
    durationMs: v.number(), // duration as ms, NOT an end wall-clock string
    tz: v.string(), // the TRUSTED client's IANA zone (§2-D). Never the model's.
    /** The plan that created it. Provenance: which approved act put this on a real calendar. */
    sourcePlanId: v.id("plans"),
    /** Asserted at CREATE time, when we know the body we sent carried no `attendees`. A false
     *  row is refused by `manageability` before any provider call, because touching an
     *  attendee-bearing event can make the provider email people outside plan/audit/DLQ. */
    attendeeFree: v.boolean(),
    status: v.union(v.literal("active"), v.literal("deleted")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // The listing index (17-09): a tenant's live managed events, bounded, never a table scan.
    .index("by_tenant_status", ["tenantId", "status"])
    // The composite identity lookup. `tenantId` is the FIRST field and that is load-bearing:
    // two tenants can legitimately hold the same provider event id (a shared calendar, a
    // restored backup, a test fixture), so an index without it would let one tenant's update
    // resolve to another tenant's row. Convex index queries must eq the prefix in order, so the
    // tenant predicate cannot be forgotten at a call site — it is unwritable, not just wrong.
    .index("by_tenant_provider_external", ["tenantId", "provider", "externalEventId"]),

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

  // 17-05 (ACTN-02 gap closure, G1): the Microsoft Graph grant. THE SAME CROWN-JEWEL RULE as
  // `gmailTokens` above — read by internal functions ONLY, never returned to a client query,
  // never in the browser, never in an audit or dead-letter payload.
  //
  // A SECOND table rather than a `provider` column on `gmailTokens`: that row is the GOOGLE grant
  // and `freshAccessToken` is documented as "the ONE token-refresh root" over it. Adding a
  // discriminator would make every existing `by_tenant` `.unique()` read ambiguous, and the two
  // grants have genuinely different refresh endpoints, scope strings and expiry behaviour.
  // NOTHING WRITES THIS TABLE YET — Plan 17-06 owns the OAuth flow that fills it.
  microsoftCalendarTokens: defineTable({
    tenantId: v.string(),
    refreshToken: v.string(),
    accessToken: v.string(),
    expiresAt: v.number(),
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
    // Phase-20 (MEDIA-01): the media-only kill switch. OPTIONAL so a missing row still reads OFF
    // via the same default-on-read the main switch uses — zero seed, zero migration. Separate from
    // `killSwitch` on purpose: pausing paid generation must not also pause the email cockpit.
    // Plan 20-04 adds the DEFAULT_CONFIG entry and the setter.
    mediaKillSwitch: v.optional(v.boolean()),
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
    // Phase-16 (D7): the web-research freshness stamp, as a STORED, QUERYABLE field.
    // Deliberately NOT `createdAt`: a row's creation time stops being its retrieval time the
    // moment anything re-creates the row (a re-ingest, a backfill), and `schema.ts` is frozen
    // after this commit — the field is one optional line now, or a second freeze later.
    // Only `kind: "web_research"` docs write it; every other writer leaves it absent.
    // ponytail: no dedicated index — `by_tenant` + a `kind === "web_research"` filter is the
    // read. The `by_tenant_kind` index named as the upgrade path now exists (added for the
    // onboarding profile read); this field may move onto it if freshness ever needs ranking.
    retrievedAt: v.optional(v.number()),
    // Phase-26 Content provenance. Only authoritative write sites populate these; absence on
    // existing artifacts remains an explicit unknown and is never inferred by reverse scans.
    sourceThreadId: v.optional(v.string()),
    sourcePlanId: v.optional(v.id("plans")),
    // Phase-18 (ACTN-04). ABSENT ⇒ user-supplied (every row that exists today; ZERO backfill).
    // "agent" ⇒ agent-authored: excluded from vault retrieval (structurally — it is never
    // ingested) and from the blueprint drift signal. "agent_promoted" ⇒ the user promoted it to
    // reference material. BOTH literals are declared NOW so the DEFERRED promote control is a
    // patch + a button, never a schema change.
    // Why not infer from (source, kind): `source` is v.string() and vault.ts:126 casts a PUBLIC
    // arg to it unchecked; 4 of 11 insert sites already store out-of-union values; `kind` grows
    // every phase. Provenance needs its own discriminator.
    // Phase-15.3 (VALT-09): "folder_digest" ⇒ the synthesised folder-level digest.
    // ⚠ THIS LITERAL IS INERT. It excludes nothing and it includes nothing. There is ZERO `origin`
    // predicate anywhere in retrieval — the `origin: "agent"` exclusion above is the ABSENT
    // `startIngest` call (`vault.ts:627-634`), not a filter. A digest is groundable ONLY because
    // its insert calls `startIngest`; forget that call and the digest is silently ungroundable
    // while every test asserting `origin === "folder_digest"` still passes. THE OBSERVABLE CHECK
    // IS `ragEntryId != null`, never the literal. Do NOT add an origin-based filter anywhere.
    // The one consumer, `patchCreatedDoc`'s `doc.origin !== "agent"` guard (`vault.ts:723`),
    // already refuses non-"agent" and therefore correctly makes a digest un-revisable — that is
    // right as it stands; do not "fix" it.
    origin: v.optional(
      v.union(v.literal("agent"), v.literal("agent_promoted"), v.literal("folder_digest")),
    ),
    // Phase-15.3 (VALT-05, VALT-07, VALT-11). ABSENT ⇒ folder-less ⇒ EXACTLY today's behaviour:
    // zero backfill, zero migration, and every shipped read is unchanged for every existing row.
    // Cancel DELETES the `vaultFolders` row (see that table's decision 1), so this id can dangle —
    // an unresolvable folderId means "no folder", never "missing folder", at every read site.
    // ⚠ NEVER `.collect()` ON `by_tenant_folder`. Rows carry `text` up to 400k chars, so ~40
    // max-size rows exhaust the 16 MiB per-transaction read cap. Drill-in and the stale
    // set-difference use a bounded `.take()` and project `text` away — `ownedDocsMeta`
    // (`vault.ts:438`) is the shipped refs-only precedent.
    folderId: v.optional(v.id("vaultFolders")),
    // Phase-15.3 (VALT-12): the machine-derived document type. A `v.union` AND NOT `v.string()`
    // ON PURPOSE — `category` next door is `v.string()` and the table's own comment records that 4
    // of 11 insert sites already store out-of-union values. A `v.string()` docType inherits that
    // rot and reintroduces the string-matching defect class Phase 15.1 was built to eliminate.
    // Every future member costing a schema edit IS THE POINT, not a problem. Literals are kept
    // identical to `DOC_TYPES` in `@pikar/core`; the compile bridge that makes drift a typecheck
    // failure lives beside the classifier. `unclassified` is the explicit no-match member — a
    // document matching nothing is never forced to a nearest match. ABSENT ⇒ never classified
    // (every pre-15.3 row), which is distinct from `"unclassified"` ⇒ classified and unplaceable.
    docType: v.optional(
      v.union(
        v.literal("pnl"),
        v.literal("balance_sheet"),
        v.literal("cash_flow"),
        v.literal("invoice"),
        v.literal("contract"),
        v.literal("policy"),
        v.literal("deck"),
        v.literal("report"),
        v.literal("plan"),
        v.literal("correspondence"),
        v.literal("spreadsheet_other"),
        v.literal("unclassified"),
      ),
    ),
    // The human-readable identity line — "2025 P&L", not "a spreadsheet". Free text, displayed by
    // the grid and the preview; the closed `docType` above is what anything downstream filters on.
    identityLine: v.optional(v.string()),
    // ABSENT/false ⇒ machine-set. true ⇒ THE USER TYPED IT, and NO CODE PATH MAY EVER OVERWRITE
    // `docType`/`identityLine` on that row — the label feeds the digest and grounding, so a wrong
    // guess left standing is a permanent lie in the grounding corpus. There is deliberately no
    // `docTypeSource` union: one boolean is the whole decision, and a union invites a third state
    // nobody defined.
    identityUserSet: v.optional(v.boolean()),
    // Phase-15.3 (VALT-13): the Drive rail's re-import primary key + change detection. Only the
    // Drive import writes them; every other insert site leaves both absent.
    driveFileId: v.optional(v.string()),
    driveModifiedTime: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"]) // browse
    .index("by_tenant_contentHash", ["tenantId", "contentHash"]) // dedup
    // Phase-17.1 (BLPR-01) Stage-1 drift: the tenant's `ready` docs and NOTHING else. Without it
    // the read is a `by_tenant` scan over every status — on the table whose own comment above warns
    // a `.collect()` walks into the 16 MiB / 32k-doc read cap.
    // DECLARED DEVIATION from 17.1-CONTEXT, which names "One new index" (the graphNodes one). This
    // is a deliberate SECOND index because the drift read runs on the path `spineForTenant` uses.
    // Migration-free by the same rule as the first: Convex builds indexes automatically, and the
    // convex-migration-helper skill lists index changes under "When Not to Use".
    .index("by_tenant_status", ["tenantId", "status"])
    // HOT-PATH REQUIREMENT, same class as `blueprintDocId` above. `onboarding.status` runs on
    // EVERY authenticated page render (the app-shell onboarding gate), and its predicate is one
    // `kind`. On `by_tenant` that read `.collect()`s the tenant's whole vault INCLUDING every
    // `text` blob — which blew the 1s query budget once a tenant's vault grew past a handful of
    // documents. Narrowing to (tenantId, kind) turns it into a read of the profile docs alone.
    .index("by_tenant_kind", ["tenantId", "kind"])
    // Phase-15.3. Serves BOTH the drill-in listing and the digest's stale set-difference, which is
    // why there is no separate `by_tenant_folder_status` — completion is counted on the folder row
    // (§2.5), never by a status query. ⚠ Read it with a bounded `.take()` and project `text` away;
    // see the `folderId` comment above for why a `.collect()` here is a 16 MiB read-cap fault.
    .index("by_tenant_folder", ["tenantId", "folderId"])
    // Phase-15.3. The Drive re-import primary key: "have I already imported this Drive file for
    // this tenant?" — answered without scanning the partition.
    .index("by_tenant_driveFileId", ["tenantId", "driveFileId"])
    .index("by_tenant_origin_createdAt", ["tenantId", "origin", "createdAt"])
    .index("by_kind", ["kind"]), // BEVL-03 cron: enumerate onboarded tenants without reading every
  // document's `text` blob (this table holds book-sized uploads; a .collect() would walk into the
  // 16 MiB / 32k-doc read cap). The ONE deliberately cross-tenant index in the repo — read by a
  // single caller (the weekly review fan-out) and yielding tenant ids only, never content.

  // ── Phase-15.3 folder plane (VALT-05..VALT-14) ─────────────────────────────
  // A folder ingested as ONE thing: estimated and reserved whole, SEALED until every member is
  // terminal, then synthesised into a digest that is itself a vault document. A NEW TABLE needs no
  // migration (the convex-migration-helper skill lists "adding new tables with no existing data to
  // migrate" under "When Not to Use").
  //
  // FOUR DECISIONS a later reader will otherwise undo:
  //
  // 1. THERE IS NO `cancelled` STATUS, DELIBERATELY. Cancel DELETES the row (15.3-CONTEXT §B13).
  //    The seal is read THROUGH the folder row, so a folder merely *marked* cancelled would keep
  //    its members sealed forever — inverting the locked "cancelled documents become groundable
  //    immediately". Members keep a dangling `folderId` that resolves to nothing, so EVERY folder
  //    read must treat an unresolvable id as "no folder" (a lenient join). Deleting the row is
  //    also what keeps cancel migration-free: actively clearing `folderId` on 400 rows does not
  //    fit one mutation — a patch rewrites the whole document, `text` blob included.
  // 2. `memberCount` COUNTS ROWS ACTUALLY INSERTED, NEVER FILES SUBMITTED. Hash-dedup returns an
  //    existing row and starts NO workflow (15.3-RESEARCH §2.9), so a duplicate inside the folder
  //    produces no terminal event and a folder counting to "files picked" NEVER COMPLETES.
  // 3. `digestDocId` / `digestSourceDocIds` / `digestBuiltAt` are a field-for-field clone of
  //    `tenantProfiles.blueprintDocId` / `blueprintSourceDocIds` (below) so the 17.1 staleness
  //    reader — a bounded set-difference against the documents a synthesis was built from —
  //    transfers unchanged. Same names, same meaning; do not rename them to something
  //    folder-flavoured.
  // 4. `reservedAt` EXISTS FOR THE REFUND CLAMP. `@convex-dev/rate-limiter` clamps to capacity
  //    BEFORE it subtracts the count, so a refund issued after the 24h fixed window rolls credits
  //    a window that never paid — verified to yield 2900 against a capacity of 2500
  //    (15.3-RESEARCH §1.2). The refund is `max(0, min(unspent, capacity - currentValue))`, and
  //    this stamp is how the settle path knows which window it is refunding into.
  vaultFolders: defineTable({
    tenantId: v.string(),
    name: v.string(),
    source: v.union(v.literal("upload"), v.literal("drive")),
    status: v.union(
      v.literal("reserving"), // estimate taken, reservation not yet held
      v.literal("ingesting"), // reserved; members in flight; SEALED from retrieval
      v.literal("complete"), // every member terminal; unsealed
      v.literal("refused"), // over budget — NOTHING was ingested
    ),
    memberCount: v.number(), // rows ACTUALLY INSERTED, never files submitted (decision 2 above)
    terminalCount: v.number(),
    failedCount: v.number(),
    reservedCents: v.number(),
    spentCents: v.number(),
    reservedAt: v.optional(v.number()), // window-rollover guard for the refund clamp (decision 4)
    digestDocId: v.optional(v.id("vaultDocuments")),
    digestSourceDocIds: v.optional(v.array(v.string())),
    digestBuiltAt: v.optional(v.number()),
    // Phase-15.3 (VALT-13) — the Drive rail's THREE fields. All optional ⇒ every upload-rail folder
    // is byte-unchanged and there is zero backfill. Only `vaultDrive` writes them.
    //
    // `driveFolderId` is the re-import handle: "refresh from Drive" re-runs the import against the
    // SAME Drive folder, so the id has to survive the first import.
    //
    // The other two are THE FAN-IN, and they are why this rail needs state the upload rail does
    // not. On the upload rail the browser knows when it has sent the last file and calls
    // `reserveFolder` itself. Here the last file lands inside a SCHEDULED action with no identity
    // and no knowledge of its siblings, so "everyone has landed" has to be a counter:
    // `driveLandedCount` counts every file that reached a terminal landing outcome — inserted,
    // deduped OR failed to export — and the folder leaves `reserving` when it reaches
    // `driveExpectedCount`. Counting only insertions (i.e. reusing `memberCount`) would hang the
    // folder in `reserving` forever the first time one export 404s, holding a reservation that
    // nothing settles, because there is no folder-level watchdog.
    driveFolderId: v.optional(v.string()),
    driveExpectedCount: v.optional(v.number()),
    driveLandedCount: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

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
  })
    .index("by_tenant_normalized", ["tenantId", "normalizedName"]) // upsert/dedup
    // Phase-17.1 (BLPR-01): the blueprint's top-entities read —
    // `.withIndex("by_tenant_degree", q => q.eq("tenantId", tenantId)).order("desc").take(20)`.
    // ponytail: `degree` is bumped per edge insert with NO dedup (`vaultGraph.ts:75-78`), so this
    // ranks "most-repeated", not "most-central", and the index is rewritten on every edge insert.
    // Acceptable at beta scale; upgrade path is a dedup key on the bump.
    .index("by_tenant_degree", ["tenantId", "degree"]),

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
    // The ONE report under discussion (DOCV-01); optional so existing rows need no migration.
    // No index: the field is read through the existing `ctx.db.get(sessionId)`.
    docRef: v.optional(v.id("vaultDocuments")),
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
    .index("by_tenant_createdAt", ["tenantId", "createdAt"])
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
    // ── Phase-17.1 business blueprint (BLPR-01/02) ────────────────────────────
    // ALL optional ⇒ NO migration (convex-migration-helper: "Safe Changes → Adding Optional
    // Field"), and the table's own comment above already blesses optionality.
    // The DRAFT lives here and NOT in `vaultDocuments` on purpose: a draft vault row would be
    // retrievable, and unconfirmed inferences would surface in grounding BEFORE the user approves
    // them — D2's confirm gate leaking through the back door. Do not "simplify" this into one row.
    /** JSON: `{ blueprint: BusinessBlueprint, diff: BlueprintDiffRow[] }`. One optional string
     *  rather than a nested validator — the draft is read whole, parsed once, and replaced whole. */
    blueprintDraft: v.optional(v.string()),
    blueprintDraftAt: v.optional(v.number()),
    /** The `ready` doc ids the LIVE blueprint was synthesized from. Stage-1 drift is the set
     *  difference against the tenant's current ready docs — a pure comparison, no detector. */
    blueprintSourceDocIds: v.optional(v.array(v.string())),
    /** HOT-PATH REQUIREMENT, not a convenience. Without it the live-blueprint read is the
     *  `currentProfileDoc` clone (`onboarding.ts:521-533`), which `.collect()`s vaultDocuments
     *  INCLUDING every `text` blob. Fine on a profile save; unacceptable on a path that now runs
     *  on every grounding call and every cockpit turn. One indexed row + one `ctx.db.get`. */
    blueprintDocId: v.optional(v.id("vaultDocuments")),
    blueprintConfirmedAt: v.optional(v.number()),
    // ── Phase-19 CAN-SPAM postal address (PIPE-01 SC#6) ───────────────────────
    // ALL optional ⇒ NO migration (convex-migration-helper: "Safe Changes → Adding Optional
    // Field"), and the table's own comment above already blesses optionality.
    /** A SINGLE free-text block, deliberately NOT a structured object: CAN-SPAM requires "a valid
     *  physical postal address", not a parsed one, and a structured object invites a country/state
     *  enum this phase does not need. Completeness is enforced at the WRITE boundary (this table's
     *  own rule) and at SEND (`renderFooter` throws on a blank address — fail closed). Optional
     *  here on purpose: Phase 11 deliberately admits idea-stage users, so this must never become a
     *  required onboarding field; `/dashboard/profile` is the enrichment surface. */
    postalAddress: v.optional(v.string()),
  }).index("by_tenant", ["tenantId"]),

  // Living-map slice 3 (§5.1). The intention plane: what the business is driving toward and by
  // when. Deliberately NOT blueprint fields — the 11-field set is closed (D3), and a goal is a
  // claim with a lifecycle, not a fact about the business.
  goals: defineTable({
    tenantId: v.string(),
    segmentId: v.string(), // a BLUEPRINT_SEGMENTS id, validated at write
    text: v.string(), // user content — content plane ONLY, never audited (CLAUDE.md §4)
    targetDate: v.optional(v.number()),
    // One level only, enforced at write: a parent may not itself have a parent.
    parentId: v.optional(v.id("goals")),
    status: v.union(v.literal("active"), v.literal("achieved"), v.literal("dropped")),
    createdAt: v.number(),
    // Stamped on every transition. `statusChangedAt - createdAt` on an achieved goal IS the cycle
    // time — no history table until something needs more than the last transition.
    statusChangedAt: v.number(),
  }).index("by_tenant_status", ["tenantId", "status"]),

  // ── Phase-26 connected dashboard accounting foundation ────────────────────
  // Append-only reporting facts. Enforcement remains in the rate limiter; these rows retain
  // refs, code-owned identifiers and integer cents only — never prompts, provider prose or URLs.
  spendEvents: defineTable({
    tenantId: v.string(),
    rail: v.union(v.literal("reasoning"), v.literal("media"), v.literal("ingest")),
    phase: v.union(
      v.literal("estimated"),
      v.literal("reserved"),
      v.literal("actual"),
      v.literal("refunded"),
      v.literal("adjustment"),
    ),
    amountCents: v.number(),
    correlationId: v.string(),
    planId: v.optional(v.id("plans")),
    requestId: v.optional(v.id("requests")),
    folderId: v.optional(v.id("vaultFolders")),
    mediaJobId: v.optional(v.id("mediaJobs")),
    model: v.optional(v.string()),
    kind: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_tenant_createdAt", ["tenantId", "createdAt"])
    .index("by_tenant_rail_createdAt", ["tenantId", "rail", "createdAt"])
    .index("by_correlation", ["correlationId"]),

  // One durable start per tenant, created before the first paid movement. A missing row means
  // coverage has not begun; it never means historical spend was zero.
  spendCoverage: defineTable({
    tenantId: v.string(),
    coverageStartedAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

  // ── Phase-20 media plane (MEDIA-01) ────────────────────────────────────────
  // ONE table for the job AND the asset it produces: a job yields at most one asset, so a second
  // `mediaAssets` table would be a 1:1 join forever. A new table needs no migration.
  //
  // THERE IS NO URL FIELD ON THIS TABLE, DELIBERATELY. The webhook downloads fal's bytes and
  // stores them via `ctx.storage`; the signed fal URL is never persisted anywhere. A signed URL in
  // a row is both a content leak and a live credential.
  //
  // `promptHash`, NOT the prompt. Prompt and narration text are content-plane and live on
  // `plans.shots` — this table carries refs, hashes, ids and counts only (§4).
  //
  // DELIBERATE DEVIATION from research §5.2: no stored `callbackHash` and no `by_callback` index.
  // The webhook path segment is `${jobId}.${hmacHex(jobId, FAL_WEBHOOK_SECRET)}`; plan 20-06
  // resolves the row with `ctx.db.normalizeId("mediaJobs", raw)` and RE-DERIVES the HMAC — exactly
  // what `gmailAuth.verifyState` already does for the OAuth `state`, in an httpAction, in
  // production today. Storing the digest buys nothing and costs a field plus an index.
  // `normalizeId` returning null for a malformed or foreign-table id is the fail-closed shape.
  mediaJobs: defineTable({
    tenantId: v.string(),
    planId: v.id("plans"),
    batchId: v.string(), // server-minted crypto.randomUUID(); groups ONE reservation
    blockIndex: v.number(), // index into plans.shots; -1 for a job that belongs to the whole deck (stt)
    provider: v.literal("fal"), // closed literal — a second provider is a deliberate schema edit
    // FOUR kinds, closed. A fifth member is a deliberate schema edit, the `provider` precedent.
    kind: v.union(v.literal("video"), v.literal("image"), v.literal("tts"), v.literal("stt")),
    model: v.string(), // MUST be a key of the @pikar/cost/media price table (fail-closed at estimate)
    // Exactly what was SUBMITTED — never a provider default. fal's Wan 2.5 defaults to 1080p, so a
    // spec that omits its resolution is an estimate 3x below the invoice.
    spec: v.union(
      v.object({ kind: v.literal("video"), resolution: v.string(), seconds: v.number() }),
      v.object({ kind: v.literal("image"), width: v.number(), height: v.number() }),
      v.object({
        kind: v.literal("tts"),
        characters: v.number(),
        voice: v.string(),
        sampleRateHertz: v.number(),
      }),
      v.object({ kind: v.literal("stt"), audioMinutes: v.number() }),
    ),
    promptHash: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("submitted"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    falRequestId: v.optional(v.string()),
    /** D12(a) — FRACTIONAL USD, never floored cents. The batch's reservation is the only thing
     *  expressed in cents and it is floored ONCE, in `chooseMediaBatch`. Storing floored cents per
     *  line re-creates the 5x over-reservation this field exists to prevent: six voice lines of
     *  $0.002 are 2 cents together and 6 cents apart. */
    estUsd: v.number(),
    actualCents: v.optional(v.number()),
    /** FOUR values, and `none_reported` means the provider reported NOTHING — it is NOT "clean".
     *  Every Wan 2.5 video and every TTS take lands here; neither publishes a per-output
     *  moderation field. Never render it as a pass. */
    verdict: v.optional(
      v.union(
        v.literal("provider_blocked"),
        v.literal("checker_flagged"),
        v.literal("checker_clear"),
        v.literal("none_reported"),
      ),
    ),
    assetStorageId: v.optional(v.id("_storage")),
    assetHash: v.optional(v.string()), // contentHash(bytes) — lib/hash.ts
    mimeType: v.optional(v.string()),
    bytes: v.optional(v.number()),
    failureReason: v.optional(v.string()), // a CODE only (the calendar.ts reasonCode idiom) — never provider prose
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_plan", ["tenantId", "planId"])
    .index("by_batch", ["tenantId", "batchId"])
    .index("by_tenant_createdAt", ["tenantId", "createdAt"]),

  // ── Phase-19 contacts, follow-ups & suppression (ACTN-05 / PIPE-01) ────────
  // THREE tables. As a set: there is NO `opportunities` table, NO stage enum and NO `amountCents`
  // anywhere below — PIPE-01 and Phase 19 SC#8. Real money arrives with Phase 28's
  // connector-backed Cash surface, from observed provider data rather than typed guesses.
  // Retrofitting stages onto a committed schema is the expensive order; do not pre-empt it.

  // The ONE person store. A row exists ONLY because a human deliberately made it — typed it, or
  // approved a staged add. Gmail header resolution NEVER writes here, which is what preserves the
  // "no contacts cache at rest" invariant (`plans.candidates`, above): nothing accretes as a side
  // effect of reading the mailbox. See `docs/playbooks/contacts-crm.md`.
  // New table ⇒ NO migration (prior-phase discipline, the `tenantProfiles` comment above).
  contacts: defineTable({
    tenantId: v.string(),
    /** Identity. ALREADY normalized by the write boundary (`normalizeAddress` from @pikar/core —
     *  trim + lowercase). One row per address; a person with two addresses is two contacts.
     *  The send-path guard keys `suppressions` on the SAME function, so the guard and the contact
     *  row agree by construction rather than by convention. */
    email: v.string(),
    name: v.optional(v.string()), // no name-only contacts; the table falls back to the address
    /** Content plane, the `consentWording` rule below (CLAUDE.md §4): these MUST NEVER reach
     *  `audit.payload`, which carries refs/ids/counts only. THREE fields and no more — no custom
     *  fields, no tags, no arbitrary key-value (19.1 CONTEXT, LOCKED). Optional ⇒ NO migration. */
    company: v.optional(v.string()),
    phone: v.optional(v.string()),
    title: v.optional(v.string()),
    /** The PROVENANCE OF THE DATA, not who triggered the write. `mailbox-resolved` = the address
     *  came out of Gmail headers and a human pressed save; `user-entered` = typed from scratch;
     *  `inbound` = a Phase 31 lead form (not written in this phase). */
    // `imported` = a row that came out of a CSV the user uploaded (19.1). WIDENING a union is
    // backward-compatible for every row at rest, so this needs NO migration; NARROWING it later
    // WOULD need one, because rows carrying the dropped literal would fail validation on read.
    origin: v.union(
      v.literal("mailbox-resolved"),
      v.literal("user-entered"),
      v.literal("inbound"),
      v.literal("imported"),
    ),
    /** Consent stays EMPTY when no consent event occurred — the Pipeline cell then reads "none on
     *  record", the truth. NOTHING is defaulted to consented. */
    consentAt: v.optional(v.number()),
    // `imported-attested` is deliberately DISTINCT from `asserted-by-user`: one attestation over
    // 500 rows is weaker evidence than consent recorded for one person, and the schema must not
    // flatten that difference. Widening ⇒ NO migration; narrowing later would need one.
    consentSource: v.optional(
      v.union(
        v.literal("asserted-by-user"),
        v.literal("inbound-form"),
        v.literal("imported-attested"),
      ),
    ),
    /** Content plane. CLAUDE.md §4 — this text MUST NEVER reach `audit.payload`, which carries
     *  refs/ids/counts only. `consentWording` is the exact wording shown; `consentContext` is the
     *  user's free-text capture context ("they signed up at the trade show"). */
    consentWording: v.optional(v.string()),
    consentContext: v.optional(v.string()),
    /** DISPLAY MIRROR ONLY. The send-path guard reads `suppressions` and NEVER this field or this
     *  table — that is what makes a contacts bug unable to un-suppress anyone, and contact
     *  deletion a non-event for the guard (SC#5). */
    unsubscribedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant_email", ["tenantId", "email"])
    .index("by_tenant_createdAt", ["tenantId", "createdAt"]),

  // What is owed, and when. Bound to a contact OPTIONALLY — free-standing follow-ups are allowed
  // ("chase the supplier quote"), but the AGENT must always name a contact; contactless follow-ups
  // are a USER-only capability. That is the structural brake against the CRM quietly becoming a
  // general task generator. New table ⇒ NO migration (prior-phase discipline).
  followUps: defineTable({
    tenantId: v.string(),
    contactId: v.optional(v.id("contacts")),
    note: v.string(), // user/agent content — content plane ONLY, never audited (CLAUDE.md §4)
    /** REQUIRED. No date, no follow-up: "Follow-ups due" is a headline tile and an undated
     *  follow-up could never appear in it. Moving this date IS the snooze, which is why there is
     *  no snooze state — the date stays the single source of truth for "due". */
    dueAt: v.number(),
    /** `canceled` is distinct from `done` because "I decided not to" and "I did it" are different
     *  facts. Three states, closed. */
    status: v.union(v.literal("open"), v.literal("done"), v.literal("canceled")),
    completedAt: v.optional(v.number()),
    /** Provenance ref so "why is this here" stays answerable. An id — refs-only, audit-safe by
     *  construction. Optional ⇒ no migration. */
    sourcePlanId: v.optional(v.id("plans")),
    createdAt: v.number(),
  })
    .index("by_tenant_status_dueAt", ["tenantId", "status", "dueAt"])
    .index("by_tenant_contact", ["tenantId", "contactId"]),

  // The send-path trust boundary, kept ADDRESS-KEYED and separate from `contacts` on purpose:
  // suppression OUTLIVES the contact, so deleting a contact can never restore the ability to email
  // someone who asked you to stop. Un-suppressing is behind an explicit confirm plus a refs-only
  // audit row, never a plain toggle. New table ⇒ NO migration (prior-phase discipline).
  suppressions: defineTable({
    tenantId: v.string(),
    address: v.string(), // normalized by `normalizeAddress` at the write boundary
    suppressedAt: v.number(),
    source: v.union(v.literal("unsubscribe-link"), v.literal("user-marked")),
  })
    // The ONE index the send guard reads — per-address, so a 5-recipient fan-out drops exactly the
    // suppressed address and still sends to the other four.
    .index("by_tenant_address", ["tenantId", "address"]),

  // The FINANCE-OPS inputs, and only those (design §5). The Hormozi inputs stay on the scorecard —
  // duplicating CAC into a second table is what produced two separate selector bugs on 2026-08-09.
  //
  // One row per (tenant, field), read with `.unique()` so a duplicate is LOUD rather than silently
  // shadowed (the tenantProfiles precedent). `statedAt` is per FIELD, not per row-set: cash on hand
  // goes stale far faster than payables, and one shared timestamp would make the 90-day
  // confirm-or-update prompt fire on the wrong number.
  //
  // Values are USD DOLLARS as a plain number, matching `scorecard.financials.cac`. The Pikar-spend
  // plane's integer cents never appear here.
  financeInputs: defineTable({
    tenantId: v.string(),
    field: v.union(
      v.literal("cashOnHand"),
      v.literal("monthlyOperatingCost"),
      v.literal("mrr"),
      v.literal("receivables"),
      v.literal("payables"),
    ),
    valueUsd: v.number(),
    // WHEN THE FIGURE WAS TRUE, not when the row was written — `FigureClaim.observedAt` lands here.
    // A P&L dated six weeks ago is already six weeks into its 90-day staleness clock. Keeps its name
    // rather than being renamed to `observedAt`: a rename needs a migration for no behavioural gain.
    statedAt: v.number(),
    // Provenance, added 2026-08-10. All optional: existing rows carry none, and a row without
    // provenance IS a user statement — which is exactly what every pre-existing row is. No
    // backfill, no migration.
    origin: v.optional(v.union(v.literal("stated"), v.literal("observed"))),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
    basis: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_field", ["tenantId", "field"]),
});
