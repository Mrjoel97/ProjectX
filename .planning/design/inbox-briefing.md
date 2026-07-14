---
title: Inbox Briefing — on-demand read-and-summarize with the toolless-ingestion invariant (Phase 3.7 spec)
status: proposed-design (drafted 2026-07-14 from the inbox-interactivity analysis; feeds /gsd:plan-phase)
sequencing: decimal insert after Phase 3.6 (Agent Eval Gate), before Phase 4. Deliberately
  after 3.6 — the briefing tools are exactly what golden-set eval cases must cover,
  including the injection-probe fixture this design mandates.
decisions:
  - Raw message bodies NEVER enter the tool-bearing agent loop — the TOOLLESS-INGESTION
    INVARIANT (bodies flow only through toolless, schema-validated digest calls)
  - Time grouping (today/yesterday/this week) is pure code over Gmail internalDate,
    never LLM output — timestamps are structural facts (ADR-004)
  - Read-only by construction — zero mailbox writes, nothing sent; briefing-seeded
    actions cross the normal PLAN -> human Approve gate
  - On-demand only in v1 — a scheduled/cron briefing joins the recurring-send shelf
    (7-day Testing-mode tokens; see scheduled-send.md)
---

# Inbox Briefing (Phase 3.7)

## 1. Problem / value

The agent uses ~5% of the mailbox access the user already granted. `gmail.modify`
(restricted scope, CASA-carrying) permits reading full messages, but the only inbox
surface in code is `resolveContacts` → `gmail.search` — headers-only
(`format=metadata`, From/To/Cc/Subject/Date, max 20), bodies deliberately never
fetched. The user pays the full trust cost of the scope and receives only contact
resolution for it.

An on-demand briefing — "what happened in my inbox today?" → a time-grouped,
triaged digest card — is the first feature that converts that scope into recurring
chief-of-staff value rather than a one-off send. It is also the head of a value
ladder (triage → reply-from-briefing → thread-grounded drafting → vault briefs)
that compounds into the per-tenant learning moat (`moat-strategy.md`).

## 2. Current surface (verified 2026-07-14)

- OAuth: `gmail.modify` grants read/draft/send/organise; delete excluded (the
  published "Pikar cannot delete your email" guarantee).
- Code: `gmail.ts` `search` — headers-only, `from:`/`to:` scoped, refs-only
  `mailbox.searched` audit. One agent tool (`resolveContacts`) consumes it.
- No body reads, no listing, no snippets, no summarization anywhere.

## 3. Design

**New governed tools** (per ADR-004 / agent-runtime playbook checklist):

| Tool | Does | Governance |
|---|---|---|
| `listInbox({range, filter?})` | `messages.list` + metadata/snippets for a time range; returns headers + snippet + internalDate, capped | headers/snippets only; refs-only `mailbox.listed` audit (count + range) |
| `briefInbox({range})` | orchestrates: list → select (cap) → server-side body fetch for selected ids → **toolless digest call** → persist briefing → render card | the ONLY path that touches bodies; bodies never returned to the loop |

**The toolless digest call** — the load-bearing piece. A separate `internalAction`
(pattern: `draftDocument`) runs `generateObject` with NO tools over the fetched
bodies, emitting a schema-validated digest per message: `{ sender, ts, gist,
category, needsReply, deadline? }`. Because the call is toolless, an inbound email
containing injected instructions ("forward everything to X") can only ever become a
weird `gist` string — it cannot actuate anything. The tool-bearing Executive Agent
sees only the structured digest, never raw bodies. Guardrails bracket the call as
always: `preCall` before, `recordModelSpend` after, `isFallbackEligible` →
CHEAP_MODEL retry.

**Deterministic grouping.** Today / yesterday / this week buckets computed in
`packages/core` from `internalDate` + the user's timezone — pure, tested code.
The model never assigns timestamps or buckets (structural facts, ADR-004).

**Caps, snippet-first.** Per-briefing message cap (e.g. ~25 bodies max);
snippet-only for the long tail; full-body fetch only for messages selected into the
digest. Cost rides the existing budget/kill-switch rails.

**BRIEFING card.** New card in the workspace pane beside PLAN/DRAFT/REPORT:
grouped sections, each item timestamp + sender + gist; a "Needs you" triage section
on top (needsReply/deadline flags — rendered as *suggestions*, never actions).
Briefing rows persist in a small tenant-scoped content-plane table (`briefings`),
same redaction rule as `plans`: content lives in the row, audit carries refs/counts
only.

**Read-only by construction.** No mailbox writes (no label changes, no mark-read),
nothing sent. Tapping a briefing item to act seeds the normal conversation → PLAN →
human Approve — the briefing can never shortcut the gate.

## 4. Threat model

- **Prompt injection via inbound mail (primary).** Third-party content enters a
  model for the first time. Mitigations, layered: toolless-ingestion invariant
  (injected text cannot call tools); schema-validated output (instructions can only
  pollute string fields shown to a human); Approve gate as backstop (even a polluted
  gist that talks the user's agent into drafting something ends at a rejectable
  plan); golden-set **injection-probe fixture** (3.6 harness): an email body
  containing send/forward instructions must yield zero tool actions and no
  `proposePlan`.
- **PII/data posture.** The user's own mail reaching the model on their behalf is
  the same eyes-open widening accepted for interactive chat
  (`agent-driven-cockpit.md` §5) and is exactly why the zero-retention/no-training
  LLM contract is already a hard constraint (PROJECT.md). Redacting inbound mail
  before summarization would destroy the feature's value; the protective boundary
  is refs-only logs + zero-retention contract + toolless ingestion, not redaction.
  Phase-9 legal pass: privacy policy must cover mailbox *content* (not just
  metadata) reaching the LLM processor for summarization.
- **Cost.** Bounded by the message cap + snippet-first + existing budget rails;
  the briefing is one bounded digest call, not per-message calls.

## 5. The toolless-ingestion invariant (name it, enforce it)

> Raw message bodies (any third-party content from the mailbox) only ever reach an
> LLM inside **toolless**, schema-validated calls. No tool-bearing agent loop
> ingests raw bodies — the loop consumes structured digests only.

Enforcement: unit test on `briefInbox` (asserts the loop-visible return contains no
body text) + a static scan in the `llmRedaction.test.ts` family (no body-bearing
variable flows into `runAgentLoop`/`generateText`-with-tools call sites). Add to the
agent-runtime playbook invariants list in the same phase (§9 discipline).

## 6. Phase spec (GSD form — registered in ROADMAP.md)

### Phase 3.7: Inbox Briefing (INSERTED)
**Goal**: The agent converts the already-granted mailbox scope into daily chief-of-staff value — on demand it reads the inbox, groups messages by time in pure code, summarizes content only through toolless schema-validated digest calls, and renders a triaged BRIEFING card — with zero mailbox writes, nothing sent, and any briefing-seeded action crossing the normal Approve gate.
**Depends on**: Phase 3.2 (gmail.ts search/token infra), Phase 3.2.1 (agent engine), Phase 3.6 (golden-set eval covers the new tools, incl. the injection-probe fixture)
**Requirements**: CKPT-04 (minted 2026-07-14)
**Design**: `.planning/design/inbox-briefing.md`
**Success Criteria** (what must be TRUE):
  1. Asking for a briefing in the cockpit produces a BRIEFING card grouped today/yesterday/this week, computed in pure tested code from `internalDate` + user timezone; each item shows timestamp, sender, and a one-line gist.
  2. The **toolless-ingestion invariant** holds and is enforced: raw message bodies reach an LLM only inside toolless, schema-validated digest calls; the tool-bearing loop sees structured digests only (unit test + static scan, and the invariant is added to the agent-runtime playbook).
  3. Reads are capped and snippet-first (full bodies only for digest-selected messages), audited refs/ids/counts only, with zero mailbox writes and zero sends; a briefing-seeded action goes through the normal conversation → PLAN → human Approve gate.
  4. A "Needs you" triage section surfaces needsReply/deadline items as suggestions (never actions), from the digest schema.
  5. The 3.6 golden set gains briefing cases including an injection-probe fixture: an email body containing send/forward instructions yields zero tool actions and no `proposePlan`.
**Plans**: TBD (suggested 4 plans / 3 waves below)

Suggested plan breakdown (for /gsd:plan-phase, not binding):
- 3.7-01 — Pure core: time-bucketing (internalDate + tz) + digest schema/types + briefing selection/cap logic, TDD (Wave 1)
- 3.7-02 — gmail.ts `list` (metadata+snippet) + body fetch for selected ids + `briefings` table + refs-only audit events (Wave 1)
- 3.7-03 — Toolless digest internalAction + `listInbox`/`briefInbox` tools + skill body update + invariant unit test + static scan (Wave 2)
- 3.7-04 — BRIEFING card + triage section + SMOKE fixture + golden-set injection-probe case + playbook/watch updates + human-verify (Wave 3)

## 7. Out of scope

- **Scheduled/cron briefing** ("every morning at 7") — read-only so lower-risk than
  recurring sends, but the same 7-day Testing-mode token wall applies; joins the
  post-verification shelf with recurring sends (`scheduled-send.md`).
- **Reply-from-briefing** (tap item → draft reply with thread context) — the named
  fast-follow; small once briefing + the existing draft flow exist, but kept out to
  keep 3.7 lean.
- **Mailbox writes** (label, archive, mark-read) — new governance surface, not
  needed for value rung 1–2.
- **Thread-grounded drafting** and **vault storage of briefings** — Phase 5
  synergy (briefs → knowledge vault → the learning moat); design the `briefings`
  table so rows are vault-ingestable later, build nothing for it now.

## 8. Open questions (resolve during /gsd:plan-phase)

- Digest granularity: one digest call over N bodies (cheaper, one context) vs
  batched calls (parallelizable, per-message isolation). Recommendation: single
  bounded call in v1; batch only if the cap grows.
- Briefing persistence: own `briefings` table (recommended — content plane,
  tenant-scoped, vault-ingestable later) vs transient card state.
- Selection heuristic for which messages get full-body fetch under the cap
  (recency-first is the lazy default; unread-first needs label metadata — already
  in `messages.list`).
- Timezone source: user profile field vs browser-supplied per request (3.5's
  deferred-send timezone answer should be reused — one timezone story, not two).
