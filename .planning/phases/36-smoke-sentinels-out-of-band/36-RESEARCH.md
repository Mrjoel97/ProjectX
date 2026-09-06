# Phase 36 (proposed) — SMOKE sentinels out of band (G24): research

**Source:** rev 5 audit G24 (`.planning/design/system-audit-2026-09-03-merged.md` §4, Track C step 10,
first half): "in-band fixture sentinels — `SMOKE::` selectors in production paths matched against
content a stranger can supply. Move selection out of band (env or test-only tenant)." Prior record:
`.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md` (2026-08-28) and the memory
note of the same day. Verified against the tree at `2e18522` (production, 2026-09-06).

## The rule, and the one predicate that already exists

An offline fixture must be selected by a fact about the DEPLOYMENT that only its operator can set —
never by a string in a payload. The repo already has half of that: `lib/models.ts`
`offlineSeamAvailable()` = `PIKAR_OFFLINE_FIXTURES === "1"` AND neither model key set. Four seams use
it (`vaultDigest`, `voiceDoc`, `knowledgeLlm`, `vaultGround`). It is the right shape and it is
**unusable for the rest**, because the rest are driven by a landed browser suite (15 specs) and four
smoke scripts against the KEYED dev deployment, where the credential conjunct makes it false by
construction. The debt note says so and asks the future plan to justify a weaker predicate. This
document does.

## Census — every `SMOKE::` gate on a production path (2026-09-06)

Channel classes: **T** = third-party content (an ingested Drive file, an email, a shared folder);
**M** = a tool argument the MODEL composes inside the agent loop, whose context carries retrieved
content (where prompt injection lives); **U** = the tenant's own typed text or upload, position 0,
same request. `tenantId` = whether the site already has the tenant in scope (all sites are actions,
so `process.env` is readable).

| # | Site | Gate | Class | tenantId | Drivers |
|---|---|---|---|---|---|
| 1 | `vaultLlm.ts:135` `extractGraph` | `safeText.startsWith("SMOKE::graph::")` → attacker WRITES the entity graph | T | arg | `vault.spec`, `vault-redesign.spec`, `smoke:vault`, `vaultDigest` fixture (must start with it) |
| 2 | `vaultLlm.ts:265` `identifyDoc` | bare `SMOKE::` at 0, then `SMOKE::classify::` ANYWHERE → attacker-chosen docType + identity line | T | arg | same chain |
| 3 | `vaultRag.ts:390` `embedDoc` | bare `SMOKE::` → `ready` row, fake `ragEntryId`, no vector | T | arg | same chain |
| 4 | `vaultExtract.ts:389` `extractDoc` | bytes decode to `SMOKE::extract::` | T (Drive import bytes are third-party; chains into #1) | doc | `vault.spec`, `intake.spec` |
| 5 | `vaultTranscribe.ts:~60` `transcribeDoc` | bytes decode to `SMOKE::transcribe::` | T (same) | doc | `vault.spec`, `intake.spec` |
| 6 | `gmail.ts:370` `search` | `name.startsWith("SMOKE::")` → two fabricated header records as mailbox evidence | **M** | arg | `cockpit-resolve.spec`, `SMOKE::agent::resolve=` |
| 7 | `llm.ts:3752` `listDriveFolders` tool | `parentId.startsWith("SMOKE::")` | M | ctx | `cockpit-*.spec` agent grammar |
| 8 | `llm.ts:3790` `findInDrive` tool | `query.startsWith("SMOKE::")` | M | ctx | same |
| 9 | `vault.ts:729` `vaultSearch` | `query.startsWith("SMOKE::")` bypasses retrieval, ids from the string | U (search box) | ctx | `vault-redesign.spec` |
| 10 | `gmail.ts:263` `send`, `graph.ts:59` `send` | `req.subject.startsWith("SMOKE::fail")` → forced terminal send failure | M-ish (subject is model-drafted) — self-DoS only | row | `smoke:fanout` |
| 11 | `llm.ts:958/1057/1157/2096/6078/6139/6239/6622` `parseSmoke` | `^SMOKE::route=` on the cockpit safeText (route, draft, document, attachment date, voice brief) | U | arg | every `cockpit-*.spec`, `smoke:pipeline`, `smoke:guardrails` |
| 12 | `llm.ts:5702` `parseAgentSmoke`, `:5837` timeout | `^SMOKE::agent::` on the cockpit text → one governed tool call, no model | U | arg | 11 specs |
| 13 | `llm.ts:2286` resolveContacts | STRIPS the prefix for ranking (benign; feeds #6) | — | — | — |
| 14 | `onboarding.ts:186/:413` | `SMOKE::profile::` / `SMOKE::onboard::` at 0 | U | ctx | onboarding tests only |
| 15 | `intake.ts:69/:111` | `SMOKE::transcribe::` / `SMOKE::extract::` over the tenant's upload | U | arg | `intake.spec` |
| 16 | `blueprint.ts:304` | keyed on code-owned `fields` | clean | — | — |
| 17 | `knowledgeLlm`, `vaultGround`, `vaultDigest`, `voiceDoc` | already `offlineSeamAvailable() && …` | closed | — | `knowledge-search.spec` (offline mode only) |

Also: `evaluations.ts` — the `query` arg rides to `vaultGround` (closed). `run-eval-golden.mjs` and the
pack eval runner REJECT sentinel turns in fixtures (verified, `:724`), so the eval plane needs nothing.

**What is attacker-reachable today, on a fully keyed production deployment:** #1–#5 (a `.txt` or `.md`
shared into Drive and imported, or an attachment), #6–#8 (an injected document steering the agent into a
`SMOKE::` argument). #9–#15 are self-inflicted only, but they are the SAME mechanism and the rule is the
rule; leaving them in-band means the next author copies them (that is how #1–#5 were written).

## Why one plan, not per-site fixes (re-verified)

- The offline vault chain is sentinel-to-sentinel: `vaultDigest`'s fixture text must begin
  `SMOKE::graph::` so the digest's own ingest stays free through #3 and #1. Convert #1 or #3 alone and
  every offline digest test starts paying.
- `apps/web/e2e/vault.spec.ts`, `vault-redesign.spec.ts`, `intake.spec.ts` and the eleven `cockpit-*`
  specs type these sentinels into the UI against the keyed dev deployment. Four `pnpm smoke:*` scripts
  do the same for tenant `"smoke"`.
- The backend unit suite (~25 files, 300+ sentinel mentions) drives the same grammars under
  `vitest.config.mts` `env: { PIKAR_OFFLINE_FIXTURES: "1" }`, which already makes
  `offlineSeamAvailable()` true there. Five test files plant a fake model key; those collide with the
  credential conjunct (the 29-FIN-06 precedent) and must mock the route instead.

## The design (recommended)

**A second operator fact: WHICH TENANTS may receive fixtures.** `PIKAR_FIXTURE_TENANT_IDS` — a
comma-separated allowlist of tenant ids, registered in `ENV_MANIFEST` at `tier: "fixture"` so the
readiness screen names it, exactly like `PIKAR_OFFLINE_FIXTURES`. One predicate in `lib/models.ts`:

```ts
/** May THIS tenant's sentinel-prefixed content select an offline fixture? */
export const fixtureSeamFor = (tenantId: string): boolean =>
  offlineSeamAvailable() || isFixtureTenant(process.env.PIKAR_FIXTURE_TENANT_IDS, tenantId);
```

Every gate in the census becomes `text.startsWith(PREFIX) && fixtureSeamFor(tenantId)` — the string
only SELECTS which fixture, the operator fact is the AUTHORITY (the shape the debt note asked for).

**Why this is acceptable on a keyed deployment (the question the debt note left open):** the allowlist
is a statement about WHO, set only through `convex env set` by the deployment operator. No document, no
email, no folder name and no model-composed argument can add a tenant id to it. On dev it names the e2e
user and `"smoke"`; on production it is unset, so every gate is unreachable regardless of content.
Misconfiguration direction: an operator listing a REAL tenant on prod would let that one tenant's
sentinel-prefixed content take fixtures — visible on `/admin` under `fixturesActive` (existing UI), and
bounded to the listed tenant. Compared with `PIKAR_OFFLINE_FIXTURES`, which if honoured alone would
fabricate for EVERY tenant, this is the narrower belt.

**What stays exactly as it is:** the sentinel grammars (`route=`, `agent::`, `graph::`, `extract::`,
`transcribe::`, `classify::`, `profile::`, `onboard::`, `fail`), every fixture body, every browser
spec's typed strings, the smoke scripts' payloads, the unit suite's consent. The change is ONE conjunct
per gate plus one env var on the dev deployment.

**Alternatives considered and not recommended:**
1. A dedicated keyless e2e deployment with `PIKAR_OFFLINE_FIXTURES=1`, so `offlineSeamAvailable()` is
   the only predicate. Cleanest rule; costs a second Convex deployment, its own seeded user, invites and
   data, and the smoke scripts' "real embedding on dev" proofs (`smoke:vault`) would lose their home.
2. A mock model provider behind `lib/models.ts` and deletion of every sentinel. The right end state,
   but it moves every E2E assertion from "the real spine ran a fixture" to "a mock answered", and it is
   weeks, not days. Track C step 10's other half (the tool registry) is the natural time for it.

## Scope and size

- **Code:** ~20 gates in 14 files (`vaultLlm`, `vaultRag`, `vaultExtract`, `vaultTranscribe`, `vault`,
  `gmail`, `graph`, `llm` ×3 regions, `onboarding`, `intake`, `lib/models`, `lib/env`); one env-manifest
  row; `fixtureSeamFor` + a table test in `models.test.ts`; per-site "WITHOUT the operator fact the real
  path is taken" tests (the `vaultGround.test.ts` pattern), including a Drive-import bytes test for #4 and
  a model-composed-argument test for #6; the five fake-key unit files switched to route mocks.
- **Docs:** `29-SMOKE-SEAM-DEBT.md` closed with a pointer; playbooks vault, cockpit, intake, onboarding,
  voice, agent-runtime, production-beta; ADR-035 (the WHO-allowlist rule and why it may coexist with
  keys).
- **Re-drive:** all 15 sentinel-driven browser specs and the four smoke scripts against dev, AFTER the
  owner sets `PIKAR_FIXTURE_TENANT_IDS` there. This is the step that proved the last conversion.
- **Owner steps:** `npx convex env set PIKAR_FIXTURE_TENANT_IDS "<e2e user id>,smoke"` on DEV (the e2e
  user id is the JWT subject before `|`; `media-canvas.spec.ts` shows how to read it, or a one-line
  `users` lookup by email); confirm prod does NOT carry it (the readiness screen will say).
- **Estimate:** two days of code and tests, plus the re-drive session.

## Decisions (owner)

1. **Mechanism:** the tenant allowlist env (recommended), a separate keyless e2e deployment, or the mock
   provider (defer G24 to the tool-registry phase).
2. **Scope:** gate ONLY the attacker-reachable classes T and M (#1–#8, 10), or gate every sentinel site
   under the one rule (recommended — same diff shape, and it stops the next copy).
3. **Production posture:** report only (the readiness screen names any fixture-tier var, today's rule),
   or also make `ops:envCheck` FAIL production readiness when any fixture-tier var is set there.
4. **Definition of done:** code + unit suites only, or code + the full browser/smoke re-drive on dev
   (recommended; needs your env set on dev first and the local stack up).
