# ADR-021: The `userProvided` / `fieldProvenance` split — a stored figure's owner is not its writer

- **Status**: Accepted
- **Recorded**: 2026-08-15, at the close of plan `2026-08-15-scorecard-field-provenance`
- **Relates to**: `docs/superpowers/specs/2026-08-15-document-driven-blueprint-updates-design.md` §3.4
  (the design that named this as required groundwork), `docs/playbooks/business-evaluation.md`,
  `docs/playbooks/dashboard-pages.md`, `docs/playbooks/cockpit.md`
- **Build history**: `.superpowers/sdd/2026-08-15-scorecard-field-provenance/` (6-task plan)

## Context

The Growth-OS Scorecard (`evaluations.scorecard`, `packages/backend/convex/evaluations.ts`) is the
one place a tenant's business figures live when they are not one of the five `financeInputs`-store
`CASH_INPUTS` fields — `cac`, `thirtyDayCashPerCustomer`, `grossProfitPerPurchase`,
`purchasesPerLifetime`, `customerCount`, `referralPct` among them. Until this plan, the store had
exactly one provenance signal: `evaluations.userProvided`, an array of dot-paths, plus
`userProvidedAt`, a parallel dot-path → epoch-ms map. `applyScorecardAnswer`, the single writer,
added a path to `userProvided` unconditionally on every write and took no actor parameter at all —
it could not have taken one, because nothing downstream distinguished "the owner typed this" from
"an agent derived this and wrote it here."

That one array was made to answer two different questions:

1. **Whose fact is this?** — did the number come from the owner's own knowledge of their business.
2. **Who performed the write?** — which actor (a human on the finance page, or the cockpit agent
   proposing a figure it read out of a document or heard in chat) actually called the writer.

Those questions have different answers whenever an agent writes a figure the owner never personally
confirmed — a P&L uploaded to the vault, a number relayed in conversation and only implicitly
agreed to. `userProvided` could not represent that case; it had no false value to fall back to, so
membership always meant "yes" to both questions, and an agent write joining it made the array assert
something untrue.

The consumer that turns this into a real defect is `runEvaluation`. It rebuilds its per-finding
citation map from `userProvided` membership and stamps every member `{source: "user-provided",
confidence: "high"}` — the highest trust tier the engine has, reserved for the owner's own
testimony. A figure an agent read out of a document or relayed from chat, once written through
`applyScorecardAnswer`, would launder into that citation map indistinguishably from a figure the
owner typed themselves. The Business Evaluation Engine would then present the agent's own
arithmetic, or an unverified relay, back to the owner as a fact the owner is on record as having
stated — the exact kind of attribution the engine exists to get right.

This was not a hypothetical gap: it was the named blocking defect for the
document-driven-blueprint-updates feature (see the linked spec §1). Six of the eleven `CASH_INPUTS`
fields live on the scorecard, and `applyFinanceClaims` refused every one of them unconditionally
(`agent_cannot_update_figure`) specifically because writing an agent-derived figure through the
unprovenanced store was provenance laundering. The feature that reads a P&L and fills the scorecard
could not ship until the store itself learned who wrote what.

## Decision

**`userProvided` keeps its literal meaning and is never widened to cover a write an agent
performed.** A new column, `evaluations.fieldProvenance` — a dot-path → `{actor: "user" | "agent",
origin: "stated" | "observed", source: string, at: number}` map — records **every** answer the
scorecard receives, agent or user, and becomes the authority consumers read for "who wrote this
value, and when was it true."

Concretely:

1. `applyScorecardAnswer` gained a **required** sixth `provenance: FieldProvenance` argument (no
   default), so every call site is a compile error until it declares who is answering. There is no
   path left where a write can happen without a provenance stamp.
2. `userProvided` / `userProvidedAt` are gated on `provenance.actor === "user"` — an agent write does
   not add to either. `userProvidedAt` is stamped from `provenance.at` (when the figure was true),
   never `Date.now()` (when the write happened), preserving the field's own staleness clock.
3. `fieldProvenance` is written unconditionally, on every answer, regardless of actor.
4. Readers (`cash.ts`'s `inputStatesFor`, the Finance-page adapter) **prefer `fieldProvenance` and
   fall back to the `userProvided`/`userProvidedAt` proxy only for a row with no `fieldProvenance`
   entry for that path** — not only rows written before this column existed; see the correction
   note below.
5. **An agent write drops a stale `userProvided` membership marker, it does not merely decline to
   add one.** Found during this plan's own review: the owner types a figure on the finance page
   (legitimately joins `userProvided`), and a later *approved* agent claim overwrites the *value* —
   without this rule the stale membership marker would keep citing the new agent-supplied number
   with the old figure's authority. Refusing the overwrite was rejected (the approval already
   happened; the applier runs post-approval on the human's own consent), so the write path itself
   filters the path out of `userProvided` and deletes its `userProvidedAt` entry whenever
   `provenance.actor !== "user"`.
6. With the store now provenance-aware, both agent-write refusals that existed purely because it was
   not are deleted outright: `writeFigureRow`'s `if (claim.actor === "agent") throw` guard on a
   scorecard-store field, and `applyFinanceClaims`'s unconditional `agent_cannot_update_figure`
   return for one. An agent claim on `cac` (or its five scorecard-store siblings) now applies, lands
   `fieldProvenance[path].actor === "agent"`, and is kept out of `userProvided`.

This also closes a second, independently-discovered laundering door: the cockpit's
`recordScorecardAnswer` tool used to add every chat-relayed figure to `userProvided` too, on the
theory that the user said it in conversation. It now stamps `actor: "agent"` unconditionally — a
model relays what it heard, it does not verify it — so a chat-given figure stops being cited as
user-provided testimony until a future phase teaches the citation map itself to read
`fieldProvenance` (a deliberate, owner-accepted product change, not a bug).

## Alternatives rejected

| Option | Why rejected |
| --- | --- |
| **Widen `userProvided` to also carry agent writes**, distinguishing by a second flag elsewhere | Keeps the two questions ("whose fact" / "who wrote it") entangled in one array instead of separating them; every future reader of `userProvided` would need to re-learn that membership no longer means what its name says. The whole defect is that one list cannot honestly answer two questions — adding a second signal beside it without renaming the first just relocates the trap. |
| **Mirror scorecard figures into the provenance-carrying `financeInputs` table** | `financeInputs` already carries `origin`/`actor`/`basis` per row (added for the five non-scorecard `CASH_INPUTS` fields). Mirroring a scorecard figure there would give one number two homes that can drift — the scorecard's `diagnose()`/`leverageRank()` pipeline reads the Scorecard shape directly, so a mirrored copy in `financeInputs` would need its own sync discipline with the original, and a bug in either direction is silent until the two disagree. `fieldProvenance` gives the existing single home its missing column instead of building a second home next to it. |
| **Refuse an agent overwrite of a user-typed figure, rather than dropping the stale marker** | The overwrite in question is *already human-approved* by the time it reaches `applyFinanceClaims` — refusing it would mean an approved plan silently fails to do what the human agreed to. The dishonesty is in the leftover membership marker, not in permitting the write; fixing the marker preserves the approval's effect and closes the laundering path. |

## Standing rule future work must not undo

**`userProvided` is never widened to include a write an agent performed, under any future feature.**
Anything that needs to represent "who wrote this, and was it the user" reads or extends
`fieldProvenance`, never `userProvided`. A consumer that needs the owner's own testimony — at the
trust level `runEvaluation`'s citation map assumes — reads `userProvided` membership and nothing
else; a consumer that needs to know the fact's real origin, including an honest "an agent wrote
this," reads `fieldProvenance` and falls back to the legacy proxy for any row that lacks an entry —
not only rows that predate this column; see the correction note below.

ADRs in this repository are immutable once accepted (`docs/README.md`): this decision is not edited
in place if it is later revisited — a reversal is a new ADR that supersedes this one, with this
file's Status line updated to point at it.

## Consequences

- **The Business Evaluation Engine's citation map is honest again.** A document-derived or
  chat-relayed figure can be *used* (the math runs, gaps close, `runEvaluation` cites the record)
  without being *credited to the owner* as testimony they did not give.
- **A chat-given figure is no longer cited as user-provided at high confidence**, until a later phase
  gives `runEvaluation`'s citation map a `fieldProvenance`-aware branch. This is a real,
  product-visible behaviour change the owner accepted going into this plan (see the plan's
  known-behaviour-change note); no test failure announces it, because the evaluation still runs — it
  simply cites less.
- **The scorecard's agent-write refusal is gone at the store layer, but a separate, deliberate hold
  remains at the cockpit chat tool** (`llm.ts`'s `stageFinanceWrite`, `~llm.ts:2890`): the model still
  cannot *propose* a scorecard-field claim in conversation, pending its own A/B review against the
  `cockpit-agent` eval fixtures. This is a product decision about what the model may suggest, not a
  gap in what the store can now honestly record — see `docs/playbooks/cockpit.md`.
- **Every pre-existing `evaluations` row is still valid.** `fieldProvenance` is optional; a legacy
  row simply has none, and every reader that consults it falls back to the `userProvided` /
  `userProvidedAt` proxy for any row lacking an entry (see the correction note below — not only
  legacy rows). No migration, no backfill.

## Correction — 2026-08-15 (whole-branch review Finding 3)

This ADR, as originally recorded a few hours earlier the same day, described the
`userProvided`/`userProvidedAt` fallback (Decision item 4, the Standing rule paragraph, and the last
Consequences bullet) as applying "only for rows written before this column existed, and nothing
else." That is factually wrong: `runEvaluation`'s `fillVault` (`packages/backend/convex/evaluations.ts`)
is a second scorecard writer that fills a null slot from grounded vault text via `setPath` and records
no `fieldProvenance` entry, so a row written **after** this plan can still take the fallback. The
three passages above are corrected to say so. This correction changes only that factual description
of the fallback's reach — the Decision itself (`userProvided` never widened, `fieldProvenance` is the
authority, the fallback exists) and the Standing rule (`userProvided` is never widened to include a
write an agent performed) are unchanged, per the controller's ruling that this ADR's immutability
protects the recorded decision, not a factual error about what the code does.
