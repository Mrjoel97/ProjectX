---
title: Moat strategy & validated-problem discipline (product-strategy record)
status: adopted (guides roadmap prioritization from private beta onward)
decided: 2026-07-12
decision: Two structural moats are deliberately cultivated — the per-tenant learning
  moat (knowledge vault + feedback/SkillOpt loop) and the compliance/trust moat
  (audit spine + restricted-scope posture). Post-beta, no new phase enters the
  roadmap without validated evidence.
---

# Moat Strategy & Validated-Problem Discipline

A moat is a *structural* reason competitors can't take customers even after seeing
what we built. Features are not moats — features can be copied in weeks. What cannot
be copied is what accumulates per-tenant in our data plane and what costs real time
and money to certify. This record names Pikar's moat candidates so roadmap
prioritization protects them, and fixes the rule that keeps us building for
validated problems instead of guessed ones.

## Moat candidates already latent in the architecture

### 1. Per-tenant learning moat (strongest candidate)

**Mechanism:** knowledge vault + feedback capture → SkillOpt prompt-optimization
loop (Phase 8). After months of use, a customer's Pikar instance knows their
business — contacts, tone, recurring workflows, past briefs. A competitor can clone
the UI; they cannot clone a tenant's accumulated context.

**Doubles as a switching cost:** leaving Pikar means abandoning a trained
chief-of-staff and starting over with an amnesiac.

**Roadmap implication:** features that write durable, compounding value into the
vault beat features that produce a one-off output. The LLM call layer is the most
commoditized part of the stack — anyone can call the same models. The moat lives in
the Convex tables, not the prompts or the UI.

### 2. Compliance / trust moat

**Mechanism:** the governance spine (full audit trail, PII redaction, per-plan
approval, cost guardrails) plus the restricted-scope posture:

- The annual CASA assessment for `gmail.modify` is a cost **every copycat must also
  pay** — plus months of verification lag — before they can touch a user's inbox.
  A constraint for us is a barrier to entry for them.
- Choosing `gmail.modify` over full `https://mail.google.com/` scope makes
  **"Pikar cannot delete your email" a provably true published guarantee** — a
  trust asset, not just a scope decision.
- For a product that reads inboxes and sends email autonomously, **trust is the
  purchase decision**. Governance-first is genuine differentiation against cavalier
  AI-agent competitors.

### 3. Network effects — none in v1, one named shelf

A solopreneur chief-of-staff is single-player; that's fine. The future
**custom skills registry for third-party teams** (currently out of scope) is where
a network effect could live: shared/marketplace skills improving with community
use. Do not build it early; just don't design the skills registry in a way that
forecloses it.

## Validated-problem discipline

`PROJECT.md` keeps a **Validated** requirements section that is honest and empty
until beta. The rule that fills it:

> **Post-beta gate:** a feature idea may not move from idea to roadmap phase until
> it has attached evidence, cited in its Validated line.

Evidence hierarchy, strongest first:

1. **Behavioral** — beta users actually did/attempted the thing. The telemetry
   pipeline (per-request tokens, decision counts, review outcomes) and the
   **dead-letter queue are validation instruments**: DLQ entries for unsupported
   request types are a ranked list of validated unmet demand; plan rejections show
   where the product misunderstands users.
2. **Verbal-specific** — a user described a concrete recent instance of the problem
   ("last Tuesday I spent 2 hours on X"). Mom Test rule: ask about past behavior,
   never "would you use this?".
3. **Verbal-general** — "yeah, that'd be nice." Not validation. Noise.

## Timing — what matters when

| Phase | The only moat that matters |
|---|---|
| Now → private beta | **Shipping speed.** A moat on an unlaunched product is worth zero. Protect the 4-week timeline; add no validation process yet. |
| Beta → PMF | **Speed of learning.** Telemetry + DLQ + user conversations rank the roadmap; the Validated gate turns on. |
| Post-PMF | **Deepen the two structural moats:** compounding vault (switching cost + learning effect) and compliance spine (regulatory barrier + brand). Both strengthen with time. |

## How this record is used

- During roadmap/phase planning: prefer work that compounds the vault or the trust
  guarantee over one-off outputs; check new-phase proposals against the Validated
  gate once beta users exist.
- Never trade away the provable guarantees (scope choice, audit completeness,
  fail-closed PII) for convenience — they are moat assets, not overhead.

## Companion records

- `.planning/design/iso9001-qms-layer.md` — ISO 9001:2015 principles embedded as a
  QMS layer via the skills registry; deepens the compliance/trust moat. Includes
  the "never claim certified" boundary and phased sequencing.
