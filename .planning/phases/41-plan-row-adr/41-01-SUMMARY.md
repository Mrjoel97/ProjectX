---
phase: 41-plan-row-adr
plan: 01
status: complete
completed: 2026-09-07
commits: [see the phase-close commit — docs(41)]
requirements-completed: []
requirements-pending: []
---

# 41-01 — ADR-037: a root is an artifact, a child is a worker

**This phase decided; it did not build.** No code, no schema change, no test. The deliverable is
`docs/decisions/037-a-root-is-an-artifact-a-child-is-a-worker.md`, which G6 (durable runs + governed
fan-out) and G10 (batch content + the content queue) both consume. The merged audit sized it as "a
day of design" precisely so neither of those phases invents its own answer.

**Measured before (2026-09-06, tree `b82c345`).** One plan row per thread is a **read**, not a
constraint: `plans.byThread` is `.unique()` over an ordinary index, `insertPlan` inserts with no
existence check, and `.unique()` throws on the second match. Nine sites read the thread that way.
Seven live frontend subscriptions plus ~25 test/e2e consumers are typed against a single document.
Everything that *acts* on a plan is already `planId`-addressed — with one counterexample the first
synthesis missed.

**How it was researched.** Ten agents (eight parallel measurements, one synthesizer required to
re-verify its own load-bearing claims, one adversary whose only job was to refute), then a
seven-agent pass over the consequences of the owner's answers, then a final adversarial citation
audit of the draft ADR. **The adversarial passes earned their keep twice over.** The first refuted
seven claims and found six omissions — including `gapAction.test.ts:343-344`, a test whose comment
is the sharpest argument in the corpus *against* this ADR's direction, which the synthesis never
mentioned. The second returned **"not safe to accept as written"**: four materially wrong citations
(one pointing an implementer at `add_only`, a refusal that must survive), an internal contradiction
in the review decision, and a `.take(32)` "existing idiom" that **exists nowhere in this repo except
as prose in a comment** — the real one is `take(20)` at `smoke.ts:897`.

**The four owner answers (2026-09-06)**, recorded in `41-RESEARCH.md` §8: **all six kinds** may have
sibling roots (chosen against the research note's recommendation of the narrow version); **one
approval** per fan-out; the weekly review **may insert**; the envelope is **divided at the fan-out
site**.

**What the ADR decides.** `parentPlanId: v.optional(v.id("plans"))` plus `by_parent` — no parent is a
ROOT (its own artifact, its own approval), a parent is a FAN-OUT CHILD (no approval of its own). One
discriminator answers both structural questions; the field is optional, so no backfill.
`plans.byThread` becomes the **newest root** by bounded descending scan. Children land at `approved`
— the only status besides `collecting` that no approvals query pages — and only the parent flips to
`proposed`, which is what makes one fan-out one card. The weekly review inserts **roots**, not
children, because a staged gap must stay approvable. `governedDispatch` is not edited; the division
happens once at the mint site, and a child scheduled with `envelopeCents: 0` would silently
re-derive the full rail with no test failing.

**The decision the owner's WIDE answer forced, and the adversary found.** Under A1-wide a thread may
hold several *roots*, not merely a root plus children — so "the row with no parent" is ambiguous, and
"newest root" alone lets a staged reel move every subsequent tool write off a half-composed email and
strand it where no query reaches it. The resolution is a distinction the draft had collapsed:
**A1-wide removes ceilings that count artifacts over a thread's LIFETIME** (`image_already_started`
refuses on any terminal image job ever; "start a new chat") **and does not touch interlocks that
serialise CONCURRENT work** (`draft_in_progress`, `dispatch_in_flight`, `reel_in_flight`, the
UNDERWAY replies). Every one of those exists because staging *recycles* and would destroy unsent
work. Keeping them yields **at most one root per thread in `collecting`**, which makes "the newest
root" and "the draft the user is typing into" provably the same row — and collapses eight refusal
branches into one predicate while the reason codes survive as explanations. It is also the smaller
diff, which is the tell that it was the right cut.

**Paid deliberately, and written down.** `.unique()` is today both the invariant and the only
structural duplicate detector on this table; after this ADR a duplicate root shows the wrong thing
instead of throwing. Three things make that acceptable and ship together or not at all: the
one-open-root invariant, the Approvals plane moving off `threadId` (a card that mutates by `planId`
while displaying by `threadId` is a silent wrong-row approve on the money surface the moment the
throw goes), and a scan window that fails closed.

**Supersessions.** ADR-033 Decision 3 (the recyclable-`done`-memo rule — a workaround for the very
ceiling being removed) and the "same `plans` row" clause in its Decision 2; ADR-014's
one-image-per-conversation bullet. **ADR-008 is explicitly NOT superseded**: its premise changes
(`planId` no longer collides on a recycled row) but its decision stands, because `rootRequestId`
identifies a RUN while `planId` identifies an ARTIFACT and a child can be re-dispatched. Recorded as
a **correction of record**: ADR-014 justified its ceiling as "matching ADR-012's
one-reel-per-conversation ceiling", and ADR-012 contains no such ceiling and does not use the word
"conversation" once — so ADR-037 supersedes that bullet on its own terms rather than inheriting a
citation that was never true.

**Verified.** No code changed, so no suite applies. Every `file:line` in the ADR was opened at
`b82c345`; the citations the second adversary flagged were re-read by hand, and one it did not check
(`dispatch.ts:497` for `stepKey`) was found wrong on my own pass and corrected to `:492`. Both Stop
gates pass.

**Deliberately not done.** No schema field landed, not even inert — the ADR is the deliverable and
G6 owns the migration. No playbook rewritten to describe the future: `business-evaluation.md:532-535`,
`cockpit.md:5434` and the rest still describe the code as it stands, which is still one row per
thread, and they move when the code does. The fan-out's in-chat progress surface, the
`groundMediaBrief` per-root-or-per-child question, and the audit-projection allowlist entry are named
in the ADR's Consequences as G6's to answer, not silently assumed.
