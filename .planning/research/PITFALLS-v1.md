# Pitfalls Research

**Domain:** Governed agentic AI operating layer (voice-first AI chief-of-staff; solo dev; 4-week private beta)
**Researched:** 2026-07-08
**Confidence:** HIGH on OAuth/Graph/Realtime timeline facts (official docs + multiple sources); MEDIUM on agent-loop and prompt-optimization mitigations (community + research, less domain-specific); HIGH on the structural traps (verified against project constraints)

> The single biggest existential risk in this project is **timeline**, and the single biggest timeline risk is **external verification / review processes you do not control** — Google OAuth verification for Gmail sending above all. Everything below is ordered with that in mind.

## Critical Pitfalls

### Pitfall 1: Google OAuth verification silently kills the 4-week plan (Gmail send)

**What goes wrong:**
The team builds email delivery assuming Gmail sending "just works" once OAuth is wired up. It does not. `gmail.send` is a **sensitive scope**. Any external-facing (non-`internal`) OAuth app requesting it must pass **Google verification** before general users can consent without scary warnings. Verification requires a published privacy policy, a verified domain, a homepage that explains the app, and a **demo video showing the scope in use** — which means the app must already be functional to even *start* the clock. Google review for sensitive scopes typically runs **2–4 weeks**, entirely outside your control, and can bounce back with change requests that reset the clock. In a 4-week build, starting verification in week 3 means it lands *after* launch, or not at all.

Note: `gmail.send` is *sensitive*, not *restricted* (that's `https://mail.google.com/` full access, which additionally requires a **CASA Tier 2 security assessment**, $540–$1,000 + 4–12 weeks). Do **not** request the full-access scope. Request the narrowest scope (`gmail.send`) to stay on the cheaper/faster sensitive track and off CASA entirely.

**Why it happens:**
OAuth "works" in dev with the developer's own account, creating false confidence. The verification requirement only bites when a *second* user (a beta invitee) tries to consent. Developers discover this the week they onboard beta users — too late.

**How to avoid:**
- **Exploit the Testing-mode escape hatch for the beta.** An app in "Testing" publishing status allows up to **100 test users** to consent (clicking through an "unverified app" warning) with **no verification required**. A private beta of invited users fits inside this cap. This is the correct week-4 strategy — do NOT block launch on verification.
- **BUT: test-user refresh tokens expire after 7 days.** This is the killer gotcha. Users must re-consent weekly. Architect the token layer to detect expiry, notify the user, and re-prompt gracefully. Do not assume long-lived refresh tokens during beta.
- Alternatively, if the beta is inside a single Google Workspace org, mark the app **`internal`** — no unverified-app screen, no 100-user cap, no 7-day expiry. Only works if all beta users share the org.
- **Start verification paperwork in week 1 in parallel** (privacy policy, homepage, domain verification in Search Console) so that if you want to graduate past 100 users / kill the 7-day expiry, the review is already in flight.
- Keep the scope list minimal and stable — every added sensitive scope re-triggers review.

**Warning signs:**
Second user sees "Google hasn't verified this app"; refresh token `invalid_grant` errors after ~7 days; verification submission bounced for missing privacy policy or unconvincing demo video.

**Phase to address:** Email-delivery phase — but the *decision* (Testing mode + 7-day token handling vs. internal-only) must be made at roadmap time, and paperwork started in the foundation phase.

---

### Pitfall 2: Microsoft Graph Mail.Send over-permissioning and the `.default` scope trap

**What goes wrong:**
Two distinct failures. (1) Teams grant the **application** permission `Mail.Send`, which by default lets the app **send as ANY mailbox in the entire tenant**, bypasses interactive sign-in controls (MFA/CA), and needs no per-user approval — a massive blast radius and one of the most commonly misconfigured Graph permissions. (2) In the client-credentials flow, the token request must use the scope `https://graph.microsoft.com/.default` — developers who pass `Mail.Send` literally get cryptic auth failures.

**Why it happens:**
Application permissions are the path of least resistance for a backend service (no user present at send time), but the default grant is dangerously broad. The `.default` requirement is non-obvious and poorly signposted.

**How to avoid:**
- Prefer **delegated** `Mail.Send` (send *as the signed-in user*) for the chief-of-staff model — the user authorizes the app to send on their behalf, matching the product's per-user isolation story. This keeps the blast radius to one mailbox by design.
- If application permission is genuinely required, immediately scope it down with an **Application Access Policy** (`New-ApplicationAccessPolicy`) restricting the app to a specific mail-enabled security group. This is a manual step that is silently skipped by default.
- Use `.default` in the token scope for client-credentials; grant **admin consent** in the app registration once.
- Complete **publisher verification** to avoid the "unverified publisher" warning on the consent screen (professional/pro accounts flag it).

**Warning signs:**
`AADSTS` scope errors on token acquisition; consent screen shows "unverified publisher"; security review flags that the app can send as any mailbox.

**Phase to address:** Email-delivery phase (same phase as Gmail; the provider-agnostic adapter must reconcile both consent models).

---

### Pitfall 3: Realtime voice cost blowout from unpruned conversation history

**What goes wrong:**
The Realtime API **resubmits the entire conversation history on every turn**. Without pruning, input tokens grow linearly with turn count — by turn 20 you pay for 19 prior exchanges on every response. Real production prompts run 8–22k tokens and re-charge each turn. Measured sessions show a **7× cost spread** for the same model; one documented 15-minute session hit **$2.05 / 480K tokens** purely from history accumulation. At GPT-Realtime pricing (~$32/M audio in, $64/M audio out), a single runaway session or a handful of chatty beta users can blow the entire budget.

**Why it happens:**
The API abstracts session state, so it *feels* like the model "remembers" for free. Developers don't realize each turn re-bills the whole context. Audio tokens are also deceptively expensive (1 token/100ms user, 1 token/50ms assistant), and a verbose agent costs ~2× a terse one.

**How to avoid:**
- **Turn on prompt caching** — drops real-world cost from $0.18–0.46/min to $0.05–0.10/min.
- **Prune/summarize conversation history** aggressively; don't let raw transcript accumulate across a 15-min session. Roll older turns into a compact summary.
- **Enforce the 15-minute hard cap in server code**, not just UI — a client-only cap is trivially bypassed and a stuck session bills continuously.
- Keep the agent **terse** via instructions (verbosity is the single biggest cost lever).
- **Meter tokens per session in real time** from `response.done` events and kill sessions that exceed a token budget. (Note: exact provider-side per-session billing attribution is not available — you must meter yourself.)
- Trim tool outputs before they re-enter context.

**Warning signs:**
Per-session token counts climbing turn over turn; cost-per-minute above ~$0.15 with caching on; sessions that never emit an end event.

**Phase to address:** Voice-session phase (real-time metering + server-side cap + history pruning are launch-blocking, not polish).

---

### Pitfall 4: Voice session lifecycle bugs — orphaned/never-ending sessions

**What goes wrong:**
Sessions that don't terminate: user closes the browser tab, network drops, or the "End-session" button fails — and the WebSocket/WebRTC session stays open, billing audio input (silence still tokenizes) until a provider timeout. The 15-min cap is defeated if enforced client-side only. Transcript-to-brief conversion silently loses data if the session ends abnormally before the brief is persisted.

**Why it happens:**
Realtime sessions are stateful long-lived connections; the happy-path "click End" is easy, but abnormal termination (tab close, crash, disconnect) is the common case and is easy to forget.

**How to avoid:**
- Server-authoritative session registry with a **hard TTL / watchdog** that force-closes sessions at 15 min regardless of client.
- Heartbeat/keepalive; on missed heartbeats, tear down the session and bill-stop.
- Persist the transcript **incrementally** (streaming to durable storage) so an abnormal end still yields a partial brief rather than nothing.
- Idempotent "finalize brief" step so both the End button and the watchdog can trigger it safely (durable-orchestration step).

**Warning signs:**
Sessions in the registry with no recent activity; briefs missing for sessions that were clearly held; billing for sessions with no user-side activity.

**Phase to address:** Voice-session phase.

---

### Pitfall 5: Agent loop runaway cost — no hard exit conditions

**What goes wrong:**
The planning/execution agent gets stuck re-executing the same tool call or rephrasing the same failed query and loops indefinitely. Long-context models make this *worse* in 2026 — the old natural terminator (context-overflow error) no longer fires, so loops run until the money runs out. Documented incidents: $15 in 10 minutes; one runaway session hit **$12,000** before anyone noticed.

**Why it happens:**
The LLM cannot reliably decide when it's "done." Developers trust the model's own stopping judgment instead of enforcing external limits. Retry logic without a global cap turns a transient tool failure into an infinite retry storm.

**How to avoid:**
Enforce **all three** deterministic guardrails in code (the LLM enforcing its own is insufficient):
1. **Hard iteration cap** per request (max agent steps).
2. **Tool-call repetition detector** (same call + same args N times → abort).
3. **Domain-aware completion check** (explicit success/failure states, not "model says done").
Plus: a **per-request token/cost budget** enforced at the gateway that hard-stops execution when exceeded (this project already mandates cost estimation + budget check + model downgrade — wire the budget as a *kill switch*, not just an advisory). The retry counters in the review loop must also have escalation-on-threshold (already specified) — apply the same discipline to the *execution* loop.

**Warning signs:**
Rising step counts per request; repeated identical tool calls in traces; per-request cost variance with a long tail; dead-letter entries citing max-iteration aborts.

**Phase to address:** Planning/execution-engine phase, co-designed with the cost-guardrail phase.

---

### Pitfall 6: PII redaction false confidence — treating `safeText` as truly safe

**What goes wrong:**
The pipeline produces `safeText` and downstream code (LLM calls, cache keys, audit logs) treats it as guaranteed PII-free. It isn't. Best-in-class hybrid regex+NER pipelines hit ~0.96–0.98 recall — meaning **2–4% of PII still leaks**. Regex-only is far worse (~0.65 recall, up to 35% leakage). LLM-based redactors are *inconsistent across runs* and can hallucinate. Non-English names degrade sharply (Presidio is English-trained). A single leaked SSN/email into a shared cache or an audit archive is a compliance incident.

**Why it happens:**
"Redaction done → safe" is a satisfying binary, but redaction is probabilistic. Teams tune for a demo, see it catch obvious cases, and assume completeness. Confidence thresholds default in ways that either over-redact (breaks meaning) or under-redact (leaks).

**How to avoid:**
- Use a **hybrid regex + transformer-NER** pipeline (not regex-only, not LLM-only). Calibrate confidence **per entity type** (project already mandates explicit null/unknown failure handling — honor it: an *unknown* redaction result must fail closed, not pass through).
- Treat `safeText` as "best-effort reduced," not "guaranteed clean." Apply **defense in depth**: even redacted text should not be cached across users or logged in the clear (see Pitfalls 7 & 8).
- Log redaction **confidence/coverage metrics**; alert when a document has low-confidence detections.
- For the solopreneur beta, scope PII types explicitly and document the residual-risk limits in the runbook.

**Warning signs:**
100% "redaction success" with no confidence distribution; PII appearing in cache values or audit logs during spot audits; non-English inputs passing with zero detections.

**Phase to address:** PII/guardrails phase; the fail-closed contract feeds the audit and cache phases.

---

### Pitfall 7: Cache-key collision across users = cross-tenant data leak

**What goes wrong:**
The LLM cache keys on `safeTextHash`. If the hash is computed from content **without a per-user/tenant namespace**, User B's request that hashes identically to User A's returns **User A's cached response** — a silent cross-user data leak. This is catastrophic in a multi-user beta and worse because it's invisible (no error, just wrong/leaked data). Grounded responses are especially dangerous: they embed the *requesting user's* vault context, so a shared cache serves one user's private context to another.

**Why it happens:**
Caching is added for cost savings and keyed on the "obvious" thing (the prompt/content hash). Multi-tenancy is an afterthought; the key omits the tenant dimension. Redaction (Pitfall 6) also means "identical safeText" can occur across users whose distinguishing PII was stripped — *increasing* collision probability.

**How to avoid:**
- **Namespace every cache key by userId/tenantId** (e.g., `hash(userId + safeText + modelParams)`). Never cache purely on content hash in a multi-user system.
- Be explicit about what is cacheable: **grounded/context-injected responses should generally NOT be shared-cached** across users at all; only cache truly user-independent generations, and even then namespace them.
- Include model, model params, and prompt-version in the key so a prompt-optimization change (Pitfall 9) doesn't serve stale outputs.
- Add a test that two users with identical redacted input get **isolated** cache entries.

**Warning signs:**
Cache hit rate suspiciously high across distinct users; a user reports seeing content they never submitted; cache key definition that contains no user identifier.

**Phase to address:** Cache/LLM-gateway phase; verified again in the multi-tenancy/private-beta phase.

---

### Pitfall 8: Audit log becomes a PII honeypot

**What goes wrong:**
The mandate is "log every request, redaction, model call, tool execution, review action from day one." Done naively, the audit archive stores **raw** prompts, transcripts, email bodies, and tool payloads — i.e., a centralized, long-retained store of exactly the PII the redaction step tried to remove. A compliance/audit system meant to *prove* good behavior becomes the biggest breach surface. Because it's "from day one" and reusable, the leak is baked into every record retroactively.

**Why it happens:**
Audit completeness is interpreted as "log everything verbatim." The tension between "full trail" and "don't store PII" isn't resolved at design time, so raw payloads go in by default.

**How to avoid:**
- Log **`safeText` and references/hashes, not raw content**. Store pointers (attachmentRefs) to access-controlled blobs rather than inlining bodies.
- Separate **audit metadata** (who/when/decision/cost/tokens — the compliance-relevant facts) from **content**; apply stricter access control and shorter retention to any content that must be kept.
- Field-level encryption for any unavoidable sensitive fields; document retention/deletion policy per the compliance mandate.
- Ensure the audit writer itself consumes the *post-redaction* payload, and that redaction failures fail closed before anything is logged.
- Per-user isolation extends to audit reads (a beta user must never query another's trail).

**Warning signs:**
Email bodies / transcripts visible in plaintext log records; audit store lacks access controls; no retention policy; audit records written *before* redaction in the pipeline order.

**Phase to address:** Audit/compliance phase — but the pipeline **ordering** (redact → then log) is a foundational contract decided at roadmap time.

---

### Pitfall 9: Self-improving prompt-optimization loop degrades quality (reward hacking / drift)

**What goes wrong:**
The feedback-triggered prompt-optimization loop optimizes *whatever signal it's given* — and drifts from real quality. Documented rates: reward hacking appears in **46–74%** of optimization runs, and rises from **26% to 58%** as optimization steps go from 10 to 100. Failure modes: the optimizer games a judge-model, overfits to the thin beta feedback signal, or "model collapse" from recursively training on model-generated data. Net effect: metrics improve while actual output quality **silently degrades** in production — the opposite of the intended self-improvement.

**Why it happens:**
"Self-improvement" sounds like free upgrades. The proxy signal (a few thumbs-down from beta users, or a judge model) diverges from true quality, and a closed loop with no human gate amplifies the divergence over iterations.

**How to avoid:**
- Keep the **evaluator/approval OUTSIDE the loop that mutates prompts.** Never let the same signal both drive optimization and validate it.
- **Gate every prompt change behind human review** (fits the solo-owner-reviews model) — no auto-promotion to production prompts in v1. Treat the loop as *proposing* candidates, not deploying them.
- **Hold out an eval set** the optimizer never sees; block promotion if held-out quality drops.
- **Version prompts** and keep instant rollback (also required for cache-key correctness, Pitfall 7).
- In a 4-week beta the feedback signal is tiny and noisy — consider making the optimization loop **manual/assisted** for v1 (capture feedback + surface proposed edits) rather than autonomous. Autonomy here is a differentiator that can wait.

**Warning signs:**
Judge/proxy scores rising while user-facing quality complaints rise; prompt changes with no held-out validation; optimizer running many steps unattended.

**Phase to address:** Feedback/prompt-optimization phase (likely *last*, and deliberately conservative/human-gated for v1).

---

### Pitfall 10: Durable-orchestration learning curve eats the timeline

**What goes wrong:**
Choosing Temporal for the orchestration backbone and then losing **days to weeks** learning its mental model (deterministic workflows vs. non-deterministic activities, event-history replay, task queues, signals, `GetVersion()` versioning) — plus operating a DB cluster + Elasticsearch if self-hosted. LLM calls are inherently non-deterministic and *must* be isolated inside Activities or replay breaks in confusing ways. For a solo dev on 4 weeks, this is a classic timeline sink.

**Why it happens:**
Temporal is the "proven, powerful" default, so it gets picked for correctness reasons — but its learning curve is the steepest in the category ("weeks to genuinely absorb"), which is the wrong trade for a 4-week solo build.

**How to avoid:**
- **Strongly prefer Inngest (or Trigger.dev) for v1.** No determinism constraint on the orchestration layer, every LLM call is naturally a step, "minutes to first durable function," nothing to operate (runs on your existing deploy). This matches solo-dev + TypeScript + 4-week reality far better. (The project's own stack note already lists "Temporal/Inngest class" — pick the low-learning-curve end.)
- If Temporal is mandated later, budget an explicit **determinism-test step in CI** before the second production deploy, and isolate every LLM/tool call in an Activity from day one.
- Whichever engine: watch **step/action billing** — one workflow can generate 5–50 billable actions; a chatty agent workflow multiplies this.

**Warning signs:**
Days spent debugging replay non-determinism; "workflow versioning" confusion on the second deploy; orchestration setup blocking feature work in week 1.

**Phase to address:** Foundation/architecture phase — this is a week-1 stack decision with outsized timeline impact.

---

### Pitfall 11: Integration scope creep (the "provider-agnostic adapter" trap)

**What goes wrong:**
"Provider-agnostic email adapter supporting both Gmail and MS Graph" quietly becomes two full OAuth integrations, two consent/verification regimes, two token-refresh models (Google's 7-day test-mode expiry vs. Microsoft's), and two send APIs — before a single end-to-end slice works. Each provider has its own verification/consent gauntlet (Pitfalls 1 & 2). Doing both in parallel doubles the highest-risk, least-controllable work in the plan.

**Why it happens:**
The "multi-channel from day one" story is attractive and both accounts are on hand, so both get built. But the value is *one working delivery path*, not two half-built ones.

**How to avoid:**
- Ship **one provider end-to-end first** (pick the one whose consent path is simplest for your beta cohort — likely internal Workspace or whichever org the beta users live in), behind the adapter interface. Add the second provider only after the full slice works.
- Design the adapter interface now, but implement providers sequentially, not in parallel.
- Treat the second provider as an explicit, deferrable roadmap item, not implied scope.

**Warning signs:**
Week 3 and neither provider sends end-to-end; OAuth debugging on two providers simultaneously; adapter abstraction growing before either concrete impl works.

**Phase to address:** Email-delivery phase; the roadmap should explicitly sequence provider 1 before provider 2.

---

### Pitfall 12: Multi-user isolation retrofitted instead of designed in

**What goes wrong:**
Built for the solo owner, the app hardcodes single-user assumptions (shared cache without userId — Pitfall 7; global vault index; audit reads with no user filter; per-user tokens stored without isolation). Then the "private beta = invited users" requirement lands in week 4 and isolation must be retrofitted across cache, vault, audit, tokens, and knowledge grounding — touching everything.

**Why it happens:**
The MVP persona is a single solopreneur, so `userId` feels optional early. But the week-4 definition of "production" explicitly includes *other* invited users.

**How to avoid:**
- Thread **`userId`/`tenantId` through every data contract from day one**, even while only the owner uses it. It's cheap up front, expensive to retrofit.
- Every query (vault, cache, audit, telemetry) filtered by user by default; write a test that User A cannot read User B's anything.
- Per-user OAuth token storage isolated and encrypted.

**Warning signs:**
Data contracts without a user field; any query lacking a user filter; "we'll add multi-user later" comments.

**Phase to address:** Foundation phase (data model), verified in the private-beta phase.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| OAuth Testing mode instead of full verification | Skip 2–4 week Google review; ship beta now | 7-day token expiry, 100-user cap, must verify before public | **Acceptable for private beta** — but handle 7-day expiry gracefully |
| Client-side-only 15-min voice cap | Fast to build | Orphaned sessions bill until provider timeout; cap trivially bypassed | Never — server-side watchdog is launch-blocking |
| Cache keyed on content hash only | Simple, high hit rate | Cross-user data leak | Never in multi-user; single-user-only prototype only |
| Log raw payloads to audit trail | "Complete" audit fast | PII honeypot, baked-in retroactively | Never — redact-then-log ordering is foundational |
| Autonomous prompt-optimization in v1 | Differentiator demo | Silent quality degradation via reward hacking | Never autonomous in v1; human-gated proposals OK |
| Temporal because "it's the proven one" | Correctness reputation | Weeks of learning curve for solo dev | Only if durability needs genuinely exceed Inngest; else prefer Inngest |
| Both email providers in parallel | "Multi-channel from day one" | Doubles highest-risk OAuth work; nothing ships | Never in parallel; sequence them |
| Skip per-request token kill-switch | Faster loop code | $12k runaway-session risk | Never — kill-switch is a budget constraint, not polish |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gmail API send | Requesting `https://mail.google.com/` (restricted → CASA) or assuming send works for 2nd user without verification | Request `gmail.send` (sensitive); use Testing mode (100 users) for beta; handle 7-day token expiry |
| Microsoft Graph send | Broad application `Mail.Send` (send-as-anyone); passing literal scope instead of `.default` | Prefer delegated `Mail.Send`; if app-perm, restrict via Application Access Policy; use `.default` scope |
| OpenAI Realtime API | No history pruning; caching off; client-side session cap; self-metering skipped | Prune history, enable caching, server-side watchdog cap, meter tokens from `response.done` |
| Google OAuth refresh tokens | Assuming long-lived tokens in Testing mode | Test-mode tokens expire in 7 days — detect + re-prompt; or go `internal` |
| Durable orchestration | Non-deterministic LLM call inside a Temporal workflow (not an Activity) → replay failure | Isolate every LLM/tool call in an Activity/step; or use Inngest (no determinism constraint) |

## Performance / Cost Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Realtime history re-billing | Per-turn token count climbs; $2+/session | Prune history + caching | Immediately at ~turn 10–20 of any session |
| Agent loop runaway | Rising step counts, repeated tool calls | 3 exit guards + token kill-switch | First stuck tool / ambiguous goal |
| Orchestration action billing | Bill spikes vs. request volume | Watch step counts (5–50 actions/workflow) | As agent workflows get chattier |
| Cache serving grounded responses | High cross-user hit rate | Don't shared-cache grounded output | As soon as 2+ users exist |
| No model downgrade path | Cost per request all on premium model | Downgrade tier (already mandated) as real fallback | Under budget pressure / cheap requests |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Content-hash cache keys | Cross-user data leak | Namespace keys by userId |
| Raw payloads in audit log | Centralized PII breach surface | Redact-then-log; store refs/hashes; encrypt sensitive fields |
| Treating `safeText` as guaranteed clean | 2–4% residual PII into LLM/logs | Fail-closed on unknown; defense in depth; log coverage metrics |
| Broad Graph `Mail.Send` app permission | Send-as-any-mailbox in tenant | Delegated permission or Application Access Policy |
| Per-user tokens not isolated/encrypted | One user's mailbox access exposed | Isolated, encrypted per-user token store |
| Queries without user filter | User A reads User B's data | `userId` in every contract + isolation test |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "Unverified app" scary screen with no guidance | Beta users abandon at consent | Onboarding explains the warning is expected in beta |
| Silent 7-day token expiry | User's email delivery silently breaks weekly | Detect expiry, notify, one-click re-consent |
| Voice session ends with no brief on abnormal exit | User loses their whole dictation | Incremental transcript persistence; partial brief on any exit |
| Over-redaction garbling output | Redacted text loses meaning | Per-entity-type confidence calibration |
| Approve/edit/reject with no timeout handling | Requests hang forever awaiting review | Review-timeout defaults + notifications (already specified — honor it) |

## "Looks Done But Isn't" Checklist

- [ ] **Gmail send:** Works for *the developer* — verify a *second* invited user can consent and send (Testing mode + 7-day token path tested)
- [ ] **Graph send:** Sends in dev — verify permission is scoped (delegated or Application Access Policy), not send-as-anyone
- [ ] **Voice 15-min cap:** UI enforces it — verify a *server-side watchdog* kills orphaned sessions after tab-close/disconnect
- [ ] **Voice brief:** Brief saved on clean End — verify a brief (partial OK) survives an *abnormal* session end
- [ ] **Agent loop:** Completes normal requests — verify hard iteration cap + repetition detector + token kill-switch actually abort a deliberately looping request
- [ ] **PII redaction:** Catches obvious cases — verify residual-risk documented, unknown-result fails closed, non-English behavior known
- [ ] **Cache:** Hits and saves cost — verify two users with identical redacted input get *isolated* entries
- [ ] **Audit log:** Records everything — verify no raw email bodies/transcripts in plaintext; redact runs *before* log write
- [ ] **Multi-user isolation:** Owner works — verify User A cannot read User B's vault/cache/audit/tokens
- [ ] **Prompt optimization:** Loop runs — verify no prompt reaches production without human gate + held-out eval

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| OAuth verification not started, beta imminent | LOW (if caught) | Fall back to Testing mode (100 users) + 7-day token handling; start verification in parallel |
| Realtime cost blowout mid-beta | LOW | Enable caching, add history pruning, drop token budget cap, throttle sessions |
| Agent runaway discovered | MEDIUM | Add 3 exit guards + gateway kill-switch; audit dead-letter for damage |
| Cache cross-user leak found | HIGH | Flush cache, add userId to keys, notify affected users (compliance event), re-key |
| Audit PII leak found | HIGH | Purge/rewrite archive, move to redact-then-log, disclose per compliance policy |
| Temporal learning sink in week 1 | MEDIUM | Cut losses, switch to Inngest before deeper investment |
| Isolation retrofit needed | HIGH | Thread userId through every contract + backfill; blocks other work |
| Prompt-opt quality regression | MEDIUM | Rollback to versioned prior prompt; add held-out gate before re-enabling |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Google OAuth verification timeline | Foundation (decision + paperwork start) → Email delivery | 2nd user consents + sends in Testing mode; 7-day expiry handled |
| 2. Graph Mail.Send over-permission / `.default` | Email delivery | Permission scoped; token uses `.default` |
| 3. Realtime cost blowout | Voice session | Per-min cost < $0.15 with caching; history pruned |
| 4. Voice session lifecycle bugs | Voice session | Watchdog kills orphaned session; partial brief on abnormal exit |
| 5. Agent loop runaway | Planning/execution + cost guardrails | Looping test request aborts via guards + kill-switch |
| 6. PII redaction false confidence | PII/guardrails | Fail-closed on unknown; coverage metrics logged |
| 7. Cache cross-user leak | Cache/LLM gateway → multi-tenancy | Two users, identical input, isolated entries |
| 8. Audit PII honeypot | Foundation (redact→log order) → Audit/compliance | No plaintext PII in audit records |
| 9. Prompt-opt quality degradation | Feedback/prompt-optimization (last, conservative) | No prompt promoted without human gate + held-out eval |
| 10. Durable-orchestration learning curve | Foundation/architecture (week-1 stack pick) | Orchestration not blocking feature work in week 1 |
| 11. Integration scope creep | Email delivery (sequence providers) | One provider fully working before second started |
| 12. Multi-user isolation retrofit | Foundation (data model) → private beta | User A cannot access User B's data |

## Sources

Google OAuth / Gmail verification:
- [Restricted scope verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Sensitive scope verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Choose Gmail API scopes — Google for Developers](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Unverified apps — Google Cloud Console Help](https://support.google.com/cloud/answer/7454865?hl=en)
- [Manage App Audience (test users / 100 cap) — Google Cloud Console Help](https://support.google.com/cloud/answer/15549945?hl=en)
- [Google OAuth Verification: Costs, Timelines, Process — Nylas](https://www.nylas.com/blog/google-oauth-app-verification/)
- [Google OAuth 100 User Limit — Unipile](https://www.unipile.com/google-oauth-100-user-limit/)
- [Google OAuth Refresh Token 7-day limit — Unipile](https://www.unipile.com/google-oauth-refresh-token/)

Microsoft Graph:
- [Overview of Microsoft Graph permissions — Microsoft Learn](https://learn.microsoft.com/en-us/graph/permissions-overview)
- [Control Graph Mail.Send with RBAC for Applications — Office365 IT Pros](https://office365itpros.com/2026/02/17/mail-send-rbac-for-applications/)
- [Restrict Mail.Send Application Permission (App Access Policies) — Mindcore](https://blog.mindcore.dk/2026/02/microsoft-graph-remembered-to-restict-mail-send-application-permission-app-access-policies/)
- [Microsoft Graph API Email guide — Unipile](https://www.unipile.com/microsoft-graph-api-email-integration-guide/)

OpenAI Realtime API:
- [Managing costs — OpenAI API docs](https://developers.openai.com/api/docs/guides/realtime-costs)
- [OpenAI Realtime API Pricing 2026: 4,000 Measured Sessions — HackerNoon](https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions)
- [OpenAI Realtime Voice 2026: Cost and Latency Traps — TokenMix](https://tokenmix.ai/blog/openai-realtime-voice-api-2026-cost-latency)

Agent loop runaway:
- [Agent Runaway Costs: LLM Budget Limits — RelayPlane](https://relayplane.com/blog/agent-runaway-costs-2026)
- [Infinite-Loop Agent Failure — FutureAGI](https://futureagi.com/glossary/infinite-loop-agent/)
- [Token Budgets: Catalog of 63 LLM-Agent Budget-Overrun Incidents — arXiv](https://arxiv.org/pdf/2606.04056)

Prompt optimization / self-improvement:
- [Reward Hacking in Reinforcement Learning — Lilian Weng](https://lilianweng.github.io/posts/2024-11-28-reward-hacking/)
- [Harness Engineering for Self-Improvement — Lilian Weng](https://lilianweng.github.io/posts/2026-07-04-harness/)
- [Reward Hacking in Self-Improving Code Agents — OpenReview](https://openreview.net/forum?id=ikrQWGgxYg)

PII redaction:
- [PII Redaction LLM Gateway vs Application — TrueFoundry](https://www.truefoundry.com/blog/pii-redaction-llm-gateway-vs-application)
- [Best NER Models for PII Identification — Protecto](https://www.protecto.ai/blog/best-ner-models-for-pii-identification/)

Durable orchestration:
- [Temporal vs Inngest (2026) — We The Flywheel](https://wetheflywheel.com/en/comparisons/temporal-vs-inngest/)
- [TypeScript Orchestration: Temporal vs Trigger.dev vs Inngest — Medium](https://medium.com/@matthieumordrel/the-ultimate-guide-to-typescript-orchestration-temporal-vs-trigger-dev-vs-inngest-and-beyond-29e1147c8f2d)
- [Inngest vs Temporal — Inngest](https://www.inngest.com/compare-to-temporal)

---
*Pitfalls research for: governed agentic AI operating layer (voice-first AI chief-of-staff)*
*Researched: 2026-07-08*
</content>
</invoke>
