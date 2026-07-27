# 16-02 — SUMMARY

**Plan:** 16-02 (wave 2) — settle OQ-2 empirically, then write the research model + cost constants
**Completed:** 2026-07-27
**Requirements:** ACTN-03
**Real spend:** 3 OpenAI calls, **≈$0.03**

## OQ-2 is SETTLED

**Both `gpt-4o-mini` and `gpt-4.1-mini` accept `openai.tools.webSearch`.** The full verbatim probe
output is recorded in `docs/playbooks/agent-runtime.md` under
*"Phase 16 — hosted web-search probe (OQ-2)"*, dated, with the exact SDK versions.

- `RESEARCH_MODEL = "openai/gpt-4o-mini"` — first candidate, PASS, cheapest
- `RESEARCH_FALLBACK_MODEL = "openai/gpt-4.1-mini"` — **probed too, deliberately.**
  `isFallbackEligible` returns `false` for a non-retryable 4xx, so an unsupported-tool 400
  propagates loudly rather than degrading silently — the good failure mode **only if the fallback
  is not itself the unsupported one**.
- `gpt-4.1` was never reached (ladder stops at first PASS). **`gpt-4.1-nano` (the repo
  `CHEAP_MODEL`) was deliberately never probed** — it appears in neither OpenAI page — and a test
  now asserts the research fallback is not it.

## THE finding every later plan depends on

**The observed search tool call is `toolName: "web_search"`, `providerExecuted: true`.**

That is the **provider's** name, not our record key (`webResearch`). 16-05's cost counter and every
offline mock fixture in this phase must use `web_search`, or we ship tests that pass against a
fiction. This was the single most skippable item in the plan and is why the probe prints
`toolCalls:` at all.

## Three more findings that change later plans

1. **`providerExecuted: true` independently confirms 16-01's schema decision.** A provider-executed
   tool never fires `onToolExecutionStart`, so a hosted search emits no `agentSteps` row — exactly
   why there is deliberately **no `webResearch` literal** in the union. That was decided from SDK
   source; this is empirical confirmation.

2. **`steps: 1` — a whole search happens INSIDE one step** (server-side). Retires OQ-3.
   **Consequence for 16-05:** size `maxSteps` for how many times the MODEL must *choose* to search
   again, not for search itself — search does not consume the step budget.

3. **`inputTokens = 8174` on both runs, for a single search.** The retrieved context rides
   `inputTokens` and is large and roughly fixed. This is the number that makes envelope arithmetic
   real: a several-angle research run is materially more expensive than an ordinary turn,
   *independent* of the $0.01 per-call fee.

## An anomaly I chased down rather than recorded and moved past

The first probe returned **`sources: 0`**. Taken at face value that is alarming: 16-06 computes
`sourceCount = r.sources.length`, which drives the insufficient-evidence label — if `sources` never
populated, **every research run would ship labelled "insufficient evidence"**.

I ran a **control query** with a definitely-citable answer. It returned `sources: 1` with a
parseable URL. So the field populates correctly, and the original `sources: 0` was the model
searching, finding nothing citable for a deliberately-dated question, and saying so honestly.

**D11's zero-results contract therefore rests on a signal that genuinely discriminates**, not on an
SDK that never fills the array. Worth the extra ~$0.01 to know.

## Verification

- `node run-probe-websearch.mjs --self-check` → passes offline, **zero network, zero spend**
- Without a key and without the flag → exits 1 with the exact recovery line
- `@pikar/cost`: **27/27** · `tsc` exit 0
- Backend `tsc`: zero errors in production `convex/*.ts` (52-error test-file baseline unchanged)
- `node scripts/check-playbooks.mjs` → exit 0

**Pin-vs-probe adjacency gate** (the reason the verdict line carries `model=`): both
`RESEARCH_MODEL` and `RESEARCH_FALLBACK_MODEL` were mechanically checked against the recorded
`probe: PASS model=<id>` lines. Both **PROVEN**.

**Mutation-checks, both RED then restored GREEN:**

| # | Mutation | Result |
|---|---|---|
| 1 | fallback silently becomes the unprobed `gpt-4.1-nano` | **RED** |
| 2 | fallback `PRICING` row dropped (→ bills nothing, silently) | **RED** |

TDD was followed for Task 3: the tests were written first and observed RED for the right reason
(`undefined has no PRICING row`) before the constants existed.

## Deviations from the plan

1. **Two extra calls beyond the budgeted one (~$0.02 more).** One to resolve the `sources: 0`
   anomaly (above), one to prove the *fallback* also accepts the tool — the plan requires that
   property but the first-PASS-wins ladder cannot establish it, since it stops before reaching a
   second candidate. Both were necessary, not exploratory.
2. **The probe gained `--prompt=` and `--model=` flags** to make those two runs possible without
   editing the ladder. The self-check covers the ladder invariants unchanged.
3. `RESEARCH_MODEL` currently **equals** `DEFAULT_MODEL`. Kept as a separate constant on purpose,
   with a comment: it is a coincidence of today's lineup, not a synonym, and a later change to
   `DEFAULT_MODEL` must not silently move research onto an unprobed model.

## Carried forward

- **`gpt-4.1-mini` pricing (0.4 / 1.6 per MTok) is the published rate at probe time, not a measured
  one.** If billing ever disagrees, that row is the thing to re-verify.
- **16-05 must use `web_search` as the tool name** in its cost counter and every mock fixture.
