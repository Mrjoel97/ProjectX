# ADR-015: Marketing becomes a pre-beta milestone — the social anti-feature is superseded, the admission rule is explicitly overridden, and the legal entity is named as the hard gate

- **Status**: Accepted (2026-08-07 — owner decision)
- **Supersedes**: the anti-feature line at `.planning/research/FEATURES.md:179` ("Auto-publishing
  generated media to social"); items 7 and 8 of `.planning/design/growth-surfaces-canvas-funnels-connections.md` §4
  (the rejected funnel phase and the rejected `funnelEvents` table); the "Social posting" and
  "Funnel form + lead capture" entries of that document's §6.
- **Does NOT supersede**: ADR-004 (§2 below), ADR-007, or the refs-only audit contract (CLAUDE.md §4).
  Deferred capabilities #2 (campaign approval) and #3 (standing pre-authorized rules) remain deferred.

## Context

On 2026-07-31 the owner asked for funnels with per-stage metrics and a configurations page covering
social, email, CRM and external databases. Those were adversarially reviewed and most of the scope
was refused — recorded in `.planning/design/growth-surfaces-canvas-funnels-connections.md`, whose §4
is explicit that the items should not be re-proposed "without new evidence."

On 2026-08-07, reviewing the unbuilt Phase 26 product pages, the owner specified that the Content
page should instead be where a user **manages their marketing channels** with the Executive Agent's
assistance: social accounts, content and marketing funnels, per-post engagement, leads captured, and
lead-to-sale conversion. Asked directly how to handle the conflict with the 2026-07-31 refusal, the
owner chose to **override and pull Marketing in pre-beta**, and reported the legal entity as **not
started**.

Three facts make this decision non-obvious, and all three survive it:

1. **`.planning/research/FEATURES.md:179` records auto-publishing to social as an anti-feature.**
   Its stated alternative is "Generate + store; user downloads/routes manually in v2."
2. **`PROJECT.md:49` records `Validated: (None yet)`**, and `PROJECT.md:51-53` forbids a feature
   moving from idea to roadmap phase without an evidence-backed Validated line.
3. **The legal entity gates the social APIs from outside this repo.** Meta Business Verification and
   LinkedIn's Marketing Developer Platform both require a verified legal business before issuing API
   access. `growth-surfaces...md` §5.8 already records the same prerequisite blocking Google OAuth
   verification, custom domains, CASA and billing, and calls it "the highest-leverage non-code task
   in the project."

## Decision

### 1. Marketing is a pre-beta milestone, and the override is recorded as an override

The anti-feature line at `FEATURES.md:179` is superseded by this ADR. Social publishing is admitted
as in-scope product work.

`PROJECT.md`'s admission rule is **explicitly overridden for this milestone only** — this is an owner
override taken with the rule in view, not a routine roadmap edit and not a silent drift. The rule
itself is not repealed and continues to govern every other idea. There is no Validated line behind
Marketing; there is an owner decision, and this ADR is it.

### 2. What this ADR does NOT authorize

Superseding the publishing anti-feature does **not** loosen the approval model. ADR-004 §56-58 fixes
the shape of approve-once-for-many and standing pre-authorized rules, and both remain deferred. A
social post is an outbound action and therefore stages into the existing plan gate exactly as an
email does: **the agent proposes, the human approves once, the executor acts.** Scheduling a post to
a future instant reuses the shipped deferred-send machinery (Phase 3.5), which is a single approved
plan carrying a future timestamp — not an unattended standing authority.

The trap named in `growth-surfaces...md` §6 is hereby re-stated rather than resolved: *the moment a
funnel or a channel exists, approve-once-for-many looks obvious and cheap. It is neither.*

### 3. The milestone splits on the legal entity, not on priority

Because the entity is not started, the milestone is sequenced in two tranches. This is not a
staging preference — tranche B cannot be built at any priority until the gate clears.

**Tranche A — buildable now, no legal entity required:**

- The **person store** (Phase 19: contacts, leads, `origin`, `consentAt`/`consentSource`,
  `unsubscribedAt`), with the suppression guard in the SEND path per `growth-surfaces...md` §5.1.
  Already pulled forward by the same 2026-08-07 session.
- **Funnel v0, link-only** — the shape §3.3 already approved and this ADR now un-defers: one
  `httpAction`, unguessable token, three integer counters (visits / claims / downloads), `?s=`
  source attribution, 302 to `ctx.storage.getUrl(...)`. It remains the product's first
  unauthenticated read and carries that review weight.
- **Lead-to-sale conversion**, composed from Phase 28's revenue rails. Each provider keeps its own
  Phase 28 suitability gate; none is assumed eligible by this ADR.
- The **Marketing surface itself**, rendering honest not-connected states for every channel that
  tranche B will later fill. An unconnected channel shows as unconnected — never as zero.

**Tranche B — structurally blocked until the legal entity exists:**

- Social account connection for Meta/Instagram, LinkedIn, TikTok, X and YouTube.
- Per-post engagement metrics (the same APIs).
- Publishing and scheduling to any social channel (the same APIs, plus §1 of this ADR).

### 4. The event-plane refusal is relaxed narrowly, not repealed

`growth-surfaces...md` §4 item 8 refused a `funnelEvents` table because the system deliberately has
no content-plane event plane. Per-post engagement metrics need time series that three integer
columns cannot express, so that refusal is superseded **only for channel metrics**, and only under
these constraints:

- Metrics rows hold **provider-issued ids, counts and timestamps only** — never post text, never
  recipient identity, never message bodies. CLAUDE.md §4's refs-and-counts contract governs this
  table exactly as it governs audit.
- The table arrives **with tranche B**, not before. Until a channel is connected there is nothing to
  record, and an empty analytics table is the "fabricated zero" failure that BRAND §5 forbids.
- `agentSteps` and `audit` are unchanged. This is a new content-plane table, not a widening of
  either governance plane.

### 5. The legal entity goes on the roadmap as a tracked external dependency

It is currently unscheduled and blocks, simultaneously: Google OAuth verification, custom domains
(Phase 25 SC#6), CASA, billing, and all of tranche B. It is recorded as a first-class blocker with
its dependents listed against it, so its cost is visible rather than rediscovered per-phase.

## Consequences

- **Phase 25 slips.** Pulling a milestone in front of the beta delays the beta; the owner took this
  decision with that stated. Phase 25's own dependency list is unchanged.
- **Content narrows to an artifact shelf** (documents, reels, memos). Sent mail moves to Reports;
  research briefs move to the Knowledge Vault. Marketing takes the channel/funnel/metrics scope that
  the 2026-08-04 mockup had put on Content.
- **A "content calendar" is not a distinct surface until tranche B lands.** Email is the only
  outbound channel today and scheduled email already has a home in Approvals' "Scheduled — approved,
  not yet fired." Building a second scheduling surface over one channel would duplicate it.
- **The first unauthenticated read enters the product** with funnel v0. `apps/web/middleware.ts:10`
  is a five-route allowlist and its matcher skips any path containing a dot; §1.2 of
  `growth-surfaces...md` is the reason funnel v0 lives on the Convex `httpAction` plane where the
  exposure is explicit, and that constraint is carried into this milestone unchanged.
- **Tranche B has no date.** It is gated on a non-code task that has not started. Any plan that
  schedules it before the entity exists is wrong on its face.
- **The 2026-07-31 review is not discredited.** Its reasoning was sound on the evidence then
  available; this ADR changes the decision, not the analysis. §4's other nine refusals stand.
