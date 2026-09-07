# ADR-038: A fan-out narrows to what the rail can fund — it never runs a worker on an envelope it was not given

- **Status**: **Accepted** — 2026-09-07. Phase 42 plan 03 (the governed fan-out), merged-audit gap
  **G6**.
- **Supersedes**: **ADR-037 Decision 6**, in the two clauses quoted verbatim below. Every other
  clause of that decision stands unchanged and is restated here so an implementer never has to hold
  two documents open at once.
- **Does NOT supersede**: the rest of ADR-037 — the parent/child discriminator (Decision 1), the
  newest-root read (Decision 2), the lifetime/concurrency split (Decision 3), one approval per
  fan-out (Decision 4), the review thread's roots (Decision 5), the approvals plane's move to
  `planId` (Decision 7), or the deliberate loss of `.unique()`'s throw (Decision 8). **ADR-008**
  also stands: the model supplies neither the cap nor the vocabulary, and this ADR adds a third
  thing it does not supply — the worker count that actually runs.
- **Evidence**: `.planning/phases/42-durable-runs-and-governed-fan-out/42-RESEARCH.md`; the
  nine-agent measure/design/refute pass of 2026-09-07, whose money-and-governance adversary found
  the defect corrected here; `dispatch.ts:474-481` and `guardrails.ts:453-463`, both opened at
  `0dfe186`. The owner's decision of 2026-09-07 is recorded in §Decision 1.

## Context

ADR-037 Decision 6 set the rule for a fan-out's budget: *"A fan-out's budget is the root envelope
divided by the worker count, at the fan-out site."* That rule is right. Two sentences supporting it
are wrong, and they are wrong in the direction that spends money.

**The first wrong sentence.** ADR-037 Decision 6 says:

> **A floor of 0 is correct and stays.** On a nearly drained rail every child is refused
> `budget_exhausted` at `dispatch.ts:481` (`0 >= 0`). That is the intended fail-closed outcome and
> is not to be repaired with `Math.max(1, …)`.

`governedDispatch` does not do that. Measured at `dispatch.ts:474-481`:

```ts
const envelopeCents =
  args.envelopeCents > 0
    ? args.envelopeCents
    : Math.floor(
        (await ctx.runQuery(internal.guardrails.remainingDailyCents, { tenantId })) *
          ENVELOPE_FRACTION,
      );
if (args.spentCents >= envelopeCents) return refuse("budget_exhausted", BUDGET_EXHAUSTED_REPLY);
```

A child handed `envelopeCents: 0` never reaches the `0 >= 0` comparison the ADR describes. `0 > 0`
is false, so it takes the **derive** branch and is granted the FULL `ENVELOPE_FRACTION` share of the
live rail — the same envelope a root would get. The refusal the ADR promised is the exact opposite
of what happens.

**The second wrong sentence** is the arithmetic that decides how often the first one matters.
ADR-037 reasons about the single point `rootEnvelope === 0`. But `share = Math.floor(rootEnvelope / n)`
is `0` for **every** `rootEnvelope < n`, which is an interval, not a point. With five workers and a
rail down to 19¢, `rootEnvelope = Math.floor(19 × 0.25) = 4`, `share = Math.floor(4 / 5) = 0`, and
all five children each re-derive 4¢ — five times the envelope the fan-out was supposed to divide,
on precisely the drained rail where the ceiling exists to bite.

ADR-037's own Decision 6 already names this trap one bullet earlier, and is correct there:

> **Every child is scheduled with `envelopeCents: Math.floor(root / N)` and `spentCents: 0`, never
> `envelopeCents: 0`.** A child passing `0` silently re-derives the full 25 % rail
> (`ENVELOPE_FRACTION`, `dispatch.ts:67`) and the division is gone with no test failing, because
> `dispatch.ts:475` cannot tell "no envelope yet" from "a divided envelope of zero".

So ADR-037 states the hazard accurately and then, three bullets later, mandates the input that
causes it. Both sentences cannot hold. This ADR keeps the hazard analysis and replaces the mandate.

**Why this could not be settled inside `governedDispatch`.** The obvious repair — make `0` mean
"refused" rather than "derive" — would change the meaning of the ROOT signal. All three current root
sites pass `envelopeCents: 0` deliberately to mean *"I am the root; derive my envelope from the
live rail"* (`evaluations.ts`, and the two cockpit tools in `llm.ts`). Reinterpreting `0` would
refuse every root dispatch in the product. `governedDispatch` stays byte-identical, exactly as
ADR-037 Decision 6 requires; the fix belongs at the mint site, which is the only place that knows
both the rail and the worker count.

## Options

| Option | Rejected because |
|---|---|
| **`Math.max(1, share)`** | It funds `n` workers at 1¢ each out of an envelope of 4¢ — the division stops being a division. ADR-037 forbids it by name, and that prohibition is the one part of the bullet that survives contact with the code. |
| **Refuse the whole fan-out when `share === 0`** | Fail-closed and simple, and it was the adversary's recommendation. Rejected by the owner: a rail that can fund two workers should buy two answers, not none. It also makes the drained-rail experience a dead end rather than a smaller one, on the surface where a user is most likely to be mid-task. |
| **Fall back to a single specialist on the full root envelope** | Silently changes what the user asked for from "ask five specialists" to "ask one", with no way to tell which one was chosen or why. It also re-introduces the model's route ordering as a load-bearing choice with no ceiling attached. |
| **Let each child derive its own envelope from the live rail (i.e. keep passing `0`)** | This is today's accidental behaviour and the defect being fixed. `n` concurrent children each drawing 25 % of the rail is `n × 25 %` of a shared budget with no fan-out-level ceiling at all. |
| **Add a per-fan-out spend column and reconcile after the fact** | `vaultFolders.spentCents` is the standing warning: declared required, written `0` at four sites, incremented nowhere and read by nobody, and it shipped green because every reader saw a well-formed `0`. ADR-037 already rules that no accounting field is added without a reader in the same commit. Division at the mint needs no column. |

## Decision

1. **A fan-out NARROWS to what the rail can fund. The worker count is capped by the envelope, not
   the other way round.** This is the owner's decision of 2026-09-07, taken against the
   fail-closed alternative. At the mint site, in this order:

   ```
   rootEnvelope = floor(remainingDailyCents(tenantId) × ENVELOPE_FRACTION)
   routes       = dedupe(model's routes) filtered to resolvable, non-media routes
   n            = min(routes.length, MAX_FAN_OUT, rootEnvelope)
   share        = floor(rootEnvelope / n)
   ```

   `n ≤ rootEnvelope` is what makes `share ≥ 1` a theorem rather than a hope: for integers with
   `1 ≤ n ≤ rootEnvelope`, `floor(rootEnvelope / n) ≥ 1`. **No child is ever scheduled with
   `envelopeCents: 0`**, which is what ADR-037's surviving bullet demands, and `Math.max(1, …)`
   never appears, which is what it forbids.

2. **Which routes survive the narrowing is CODE-OWNED and it is the model's own ordering, truncated
   from the front.** `routes.slice(0, n)` after dedupe and validation. The model chooses what to
   ask and in what order; it does not choose how many of them the rail can afford, and it is never
   consulted a second time. The dedupe is not cosmetic: `SPECIALIST_ROUTES` is a closed six-member
   set, so `["research","research","research","research","research"]` would otherwise buy five
   identical paid turns on one question, and the cycle guard cannot catch it — `wouldCycle` is
   evaluated per child with an empty ancestry, so it never fires between siblings.

3. **`rootEnvelope === 0` refuses the whole fan-out at the mint, before any row is inserted.** With
   no budget, `n` is 0 and there is nothing to narrow to. Nothing is minted, no workflow starts, and
   the tool returns one code-owned sentence. This is the one case where the rejected fail-closed
   option is also the only correct one, and it is consistent with what a single dispatch already
   does on a dead rail: `governedDispatch` refuses `budget_exhausted` at `dispatch.ts:481`.

4. **The narrowing is TOLD TO THE USER, in the tool's own returned sentence, whenever `n` is less
   than what was asked for.** A fan-out that quietly answers three of five questions is a fan-out
   that reads as complete and is not. The sentence names the number that ran; it never names the
   rail, the envelope, a cent figure, or the reason code — the daily-budget vocabulary is not user
   vocabulary, and `BUDGET_EXHAUSTED_REPLY` is the precedent for what a governed money stop is
   allowed to say.

5. **Everything else in ADR-037 Decision 6 stands, restated here so it is not lost in a diff
   between two documents:**
   - `governedDispatch` is **not edited**. Its carry-through ternary and its refusal stay
     byte-identical; any diff touching them re-opens the per-hop-allowance hole the branch closes.
   - The division happens **exactly once, at the mint site, before any child is scheduled**. `n` is
     the length of the child array actually inserted — read once, never model-supplied, never
     re-derived downstream.
   - Every child carries `spentCents: 0`.
   - `spentCents` **does not aggregate across siblings**. It is a per-branch call-arg accumulator;
     the divided envelope is the whole sibling-isolation mechanism, and a shared counter would need
     DB state and would contradict ADR-008.
   - Per-child attribution rides `recordSpend`'s existing optional `planId`. A child reusing a
     parent's correlation string silently inherits the parent's `planId`, because `recordMovement`
     de-dupes on `(tenantId, correlationId, phase)` and returns the stored id while ignoring the
     replayed args.
   - **No running-total column unless code patches it, and a reader ships in the same commit.**

## Consequences

- **The fan-out's ceiling is now a function of the rail, so it is not a fixed number and must not be
  documented as one.** `MAX_FAN_OUT` bounds it from above; the rail bounds it from below. On a fresh
  day both are in play; on a drained one only the rail is. A test that pins "five workers" without
  seeding the rail is pinning the wrong thing.
- **A narrowed fan-out is a COMPLETE answer to a smaller question, not a partial answer to the
  original one.** Each surviving child still gets a real envelope and still lands a real memo, and
  the parent still becomes exactly one approval card. Nothing is left half-run, and no child is
  refused `budget_exhausted` as a matter of course — which is what made the superseded rule
  unacceptable as a user experience as well as wrong as arithmetic.
- **`ENVELOPE_FRACTION` moves out of `dispatch.ts` into `lib/dispatchShared.ts`** so the mint site
  and `governedDispatch` derive the root envelope from ONE constant. Two copies of the fraction is
  how a divided envelope and the envelope it was divided from stop being the same number.
- **This ADR does not give the fan-out a spend REPORT.** After it ships, "what did this fan-out
  cost" is answerable only by summing `spendEvents` by `planId` across the children, and only if the
  optional `planId` is actually threaded. That is named as an open item, not claimed as done.
- **The narrowing sentence is driver-plane text, not a skill.** It is a code-owned string in the
  tool's return value, like the four governed refusal replies — CLAUDE.md §5 does not reach it, and
  it must never quote a reason code to the user.
- **What would supersede this**: a per-tenant or per-fan-out budget the user can raise deliberately
  (today the rail is a fixed deployment constant, so "fewer workers" is the only lever); a fan-out
  depth greater than 1, which would make "divide at the fan-out site" a per-level rule and reopen
  the arithmetic; or a measured finding that users prefer a refusal to a narrowed answer, which
  would restore the rejected fail-closed option and make Decision 4's sentence unnecessary.
