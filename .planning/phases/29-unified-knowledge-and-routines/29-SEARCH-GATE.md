# 29-SEARCH-GATE — release evidence for unified knowledge search (KNOW-01)

**Owner of this file:** plan 29-09. **Consumed by:** plan 13's single final owner checkpoint.
**Status: THE BROWSER GATE HAS BEEN RUN AND IS GREEN (2026-08-29). All three modes executed;
every test in the file has passed in at least one configuration. See §4.**

29-09 itself could not run a browser gate: it needs a live Convex deployment, a seeded E2E user,
real credentials and (in one mode) real model spend, none of which were available to that agent.
**The orchestrator ran it on 2026-08-29** against a worktree-local copy of the local deployment.
§4 carries the real runner output. The history below (§7, §8) is kept as written.

WARNING: **until the 29-09 fix pass the spec would have died on its first line.** See §7. A spec
that parses is not a spec that runs, and this file previously reported `--list` in a way that read
as more than it was.

---

## 1. What WAS run, with real output

| # | Command (run from the repo root unless noted) | Result |
|---|---|---|
| 1 | `cd apps/web && pnpm vitest run KnowledgeSearchPanel` | **1 file / 33 tests passed** — SUPERSEDED by §7 (41 tests) |
| 2 | `cd apps/web && pnpm vitest run` | **37 files / 691 tests passed** (baseline 36 / 658; this plan adds exactly 1 file / 33 tests) |
| 3 | `cd apps/web && pnpm typecheck` | clean |
| 4 | `cd packages/backend && pnpm vitest run knowledgeSearch.test` | **1 file / 40 tests passed** (baseline 32; this plan adds 8) |
| 5 | `cd packages/backend && pnpm vitest run` | **113 files / 3147 tests: 3145 passed, 2 failed** — `convex/env.test.ts` (the KNOWN Phase-28 `ENV_MANIFEST` red, not this plan's; `git log -2 -- convex/lib/env.ts` names 29-FIN-W2 / 29-W2-CLEANUP) and `convex/media.test.ts` (the documented load flake — **re-run alone: 1 file / 255 tests passed**) |
| 6 | `cd packages/backend && pnpm typecheck` | clean |
| 7 | `cd packages/core && pnpm vitest run` | **45 files / 1457 tests passed** (unchanged from baseline — this plan changes no core source) |
| 8 | `cd apps/web && npx playwright test --list knowledge-search` | **7 tests discovered in 2 files.** The spec PARSES — that is ALL `--list` proves. It resolves no locator, which is why it missed the strict-mode bug in §7.2. Now 8 tests. |
| 9 | `pnpm --filter @pikar/web build` | **passed, after an environment repair — see §5.** `/dashboard/workspace` compiles. |
| 10 | `echo '{}' \| node scripts/check-playbooks.mjs check` | empty stdout (= pass) after `docs/playbooks/cockpit.md` and `docs/playbooks/knowledge-search-routines.md` were updated |

The plan's own two gate commands were NOT run as written and must not be:
`pnpm --filter @pikar/web test -- knowledge-search` — pnpm swallows the `--`, so the filter never
reaches vitest; and `node scripts/check-playbooks.mjs` run bare hangs forever on stdin and reports
failure by PRINTING `{"decision":"block",...}`, never through its exit code.

---

## 2. The browser gate an operator must run

### 2.1 Preconditions

1. A running local stack, started by hand and left running (the specs do NOT start servers —
   `playwright.config.ts` has no `webServer` block):
   - `cd packages/backend && npx convex dev` (NOT `--once`)
   - `cd apps/web && pnpm build && pnpm start -p 3111` — the Next **production** server. The dev
     server OOMs on the workspace page in this repo, so a dev run is not a usable harness.
2. A seeded, signable E2E user in that deployment, and its credentials in the environment:
   - `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`
   The `setup` project signs in once through the real `/signin` form and writes
   `apps/web/e2e/.auth/user.json`; the `chromium` project inherits it via `storageState`.
   `e2e/.auth/` does not exist in the repo — it is generated at run time.
3. **The E2E tenant must have NO Gmail connection.** The offline test asserts the exact sentence
   `your mailbox is not connected yet, so it was not searched.` If that tenant has connected Gmail,
   the mailbox is genuinely searched and the test fails loudly. That is deliberate: a looser
   assertion would pass in both worlds and prove neither.

### 2.2 Offline mode — deterministic, $0

`offlineSeamAvailable()` in `convex/lib/models.ts` is `PIKAR_OFFLINE_FIXTURES === "1"` **AND no
model key**. Both halves are required, so this mode needs a deployment with the operator's fixture
consent and no key:

```
npx convex env set PIKAR_OFFLINE_FIXTURES 1      # run from packages/backend
# and the deployment must hold NO model key (OPENAI_API_KEY / OPENROUTER_API_KEY unset)
```

Then, from `apps/web`:

```
PIKAR_E2E_KNOWLEDGE_MODE=offline npx playwright test e2e/knowledge-search.spec.ts
```

Cost: **$0.** The `SMOKE::knowledge-plan::` directive in the question drives
`knowledgeLlm.planKnowledgeSearch`'s fixture branch, and the runs it drives produce no evidence, so
`knowledgeSearch.search` never calls the synthesizer at all ("no evidence, no paid call").

⚠ **On a KEYED deployment these same `SMOKE::` strings are sent to a real model and billed.** The
mode is an explicit env choice for exactly that reason.

### 2.3 Live mode — a real question against a real model. COSTS MONEY.

```
PIKAR_E2E_KNOWLEDGE_MODE=live npx playwright test e2e/knowledge-search.spec.ts
```

Two paid calls per search (`knowledge:plan:<runId>` and `knowledge:synth:<runId>` in the spend
ledger). Both are governed by `guardrails.preCall`, so an exhausted budget comes back as a refusal
sentence in the panel rather than a spinner. Run this against a deployment whose vault holds at
least one document, or the honest outcome is a gap and the citation half of the gate proves nothing.

### 2.4 The two-identity block

Runs only when `E2E_USER_B_EMAIL` / `E2E_USER_B_PASSWORD` name a **second loggable account**.

**On this project's deployments they do not exist.** There is one loggable human account (the
owner, via Google); the e2e/uat tenants have no known password. The block is therefore SKIPPED, not
faked. The API-level isolation proof is
`packages/backend/convex/knowledgeSearch.test.ts` → *"two tenants asking the same question in the
same thread read different coverage"* and *"tenant B sees NOTHING of tenant A"*. Closing the browser
half needs a second tenant with a password — the invite path is the only $0 route to one.

### 2.5 Connected-provider evidence

The plan asks for "connected Drive/Gmail ... real consent/read/citation drill-in, recording a
provider as honestly unavailable rather than faking success." That is the LIVE mode above, run on a
tenant that has completed the Google connect flow. **No connector was invented, stubbed or mocked to
stand in for one.** The two Phase-28 sources are recorded honestly by the product itself:
`crm-facts` has an adapter but needs a connection; `support-desk` has no adapter at all and renders
`your connected support inbox is not available in Pikar yet, so it was not searched. It would need
connecting your support desk.`

---

## 3. What each run must produce for the gate to count

| Test | Evidence it produces |
|---|---|
| the control is labelled, keyboard-reachable and disabled until there is a question | the card opens from "Chat options" via the keyboard, the field has a real label, an empty/whitespace question cannot be submitted |
| a mailbox that is not connected is never rendered as an empty mailbox | **5** `knowledge-source-state` rows, the literal not-connected sentence, the literal "None of your sources could be searched…" sentence, and the absence of both the all-empty sentence and the string `no results` |
| the source Phase 28 never landed names its unlock | the literal not-landed + unlock sentence |
| an unsearchable source is a gap, and the card offers no way to act on it | the card's complete button set is exactly `["Close knowledge search", "Search"]` — a search reads, it never acts |
| an answer asked before the first chat message survives that message (added by the fix pass) | one `knowledge-answer` card before the cockpit send and the SAME one after it, still carrying its gap sentence — the panel's `ks_` handle is not abandoned when `threadId` arrives |
| a real answer carries per-source coverage and a closed confidence label (live) | 5 coverage rows; if any claim rendered, at least one citation row and a confidence line matching `^(High\|Medium\|Low\|Not supported)` |
| B's own searches are the only ones B can see | A's needle appears in A's panel and has **count 0** in B's |

---

## 4. Operator results — FILLED IN 2026-08-29. All three modes green.

| Date | Mode | Deployment | Command | Result (paste the runner's own summary line) |
|---|---|---|---|---|
| 2026-08-29 | offline | `local-joel_feruzi-pikar_ai_50c69-1` (worktree copy) | `npx playwright test e2e/knowledge-search.spec.ts --reporter=list,json` | **`2 skipped / 7 passed (29.6s)` · PW_EXIT=0** |
| 2026-08-29 | two identities | same | same, plus `E2E_USER_B_EMAIL` / `E2E_USER_B_PASSWORD` | **`1 skipped / 8 passed (31.1s)` · PW_EXIT=0** |
| 2026-08-29 | live | same, model keys restored | same, plus `PIKAR_E2E_KNOWLEDGE_MODE=live` | **`5 skipped / 3 passed (22.9s)` · PW_EXIT=0** |

### 4.1 The first run was RED, and that is the non-vacuity proof

The gate's first execution FAILED — four tests, all at `ask()`, waiting for a `knowledge-answer`
that never rendered. The backend log named the cause:

```
[CONVEX Q(skills:getActiveSkill)]              Uncaught Error: NO_ACTIVE_SKILL: knowledge-query-planner
[CONVEX A(knowledgeLlm:planKnowledgeSearch)]   ... at handler (convex/knowledgeLlm.ts:322)
[CONVEX A(knowledgeSearch:search)]             ... at handler (convex/knowledgeSearch.ts:421)
```

`KNOWLEDGE_QUERY_PLANNER_SKILL` and `KNOWLEDGE_SYNTHESIZER_SKILL` **are** both in `SEEDS`
(`skills.ts`, entries 30 and 31) — the code is correct. The rows simply did not exist in this
database, because `skills:seedSkills` is an `internalMutation` that an operator must run and this
deployment's data predates Phase 29. One `npx convex run skills:seedSkills '{}'` turned the same
spec green with no code change.

**This is what makes the green above meaningful.** The identical file was RED 25 minutes earlier;
the only thing between the two runs was seeding the registry. No mutation exercise was needed to
show the gate can fail — it did.

It is also a genuine operational finding: **KNOW-01 is inert on any deployment where `seedSkills`
has not been run since Phase 29 landed.** Every unit test passes regardless, because
`convex-test` seeds the registry inside the test. Plan 13's validation must include the seed step.

### 4.2 What the live run actually proves, and what it does not

The live row is a real model call, priced and recorded on the governed ledger:

| field | value |
|---|---|
| `kind` | `knowledge.plan` |
| `correlationId` | `knowledge:plan:ef4e56aa-eef9-4105-a074-f30debbd559d` |
| `model` | `or/openai/gpt-4o-mini` |
| `amountCents` | 1 |
| `phase` | `actual` |

**There is no `knowledge.synth` row, and that is the honest limit of this run.** The E2E tenant has
no connected sources, so the planner ran, found nothing readable, and the card took the
"no source could be searched" branch — which is exactly the behaviour §3 asks for, and which the
live assertion permits via `knowledge-empty`. It does mean the **synthesizer body has not been
exercised against a real model in a browser**. Closing that needs a tenant with a connected source
(§2.5), which remains the open item it already was.

### 4.2b THE SYNTHESIZER GAP IN §4.2 IS NOW CLOSED (2026-08-30, later the same day)

§4.2 above is a true record of THAT run and is left standing. It has since been closed — and not by
connecting a provider, but by putting a document into the vault through the REAL path:
`vault.vaultIngestText` (the mutation the vault Dropzone itself calls), which `vaultRag:embedDoc`
then embedded with `openai/text-embedding-3-small`.

A live search returned a cited claim from it:

> *"The standard plan is billed at 240 USD per seat per year, with a 15 percent discount for annual
> prepayment."*
> — `source: vault`, `sourceRef: mx779n1q0s630q8da64qcdzzjx8df97n`, `authority: tenant_owned`,
> `freshness: current`, `evidenceCount: 1`, `invalidCitationCount: 0`, `confidence: "low"`.

Ledger: `knowledge:synth:4dd6bdf6…`, kind `knowledge.synthesize`, `or/openai/gpt-4o-mini`,
`phase: "actual"`, 1¢. The claim is faithful to the ingested document and the citation resolves to
the row that was written. Citation binding, authority and freshness are now proven against a real
model on real retrieval, not only by unit tests and the offline fixture seam.

**AND IT FOUND SOMETHING WORTH MORE THAN THE GATE IT CLOSED.** The FIRST live question —
*"What have we agreed with customers about pricing and discounts?"* — returned `evidenceCount: 0`
and no synthesis, because the planner marked **`vault: unplanned`** and planned `crm-facts`, which
is not connected. The tenant's own pricing document was embedded and retrievable the whole time.
Only *"What do our saved documents and notes say about…"* planned the vault.

Nothing lied — every source correctly reported its own state — but **a user asking about their own
documents in ordinary words can be told nothing was found while the answer sits in their vault.**
The planner is a registry skill (`knowledge-query-planner`), so this is tunable through the skill
body and the eval gate rather than through code. Recorded for whoever owns that body next.

The browser could not be used for this run: `auth:store retrieveAccountWithCredentials` began timing
out at Convex's 1s mutation limit (8 consecutive times) while the backend was busy embedding, so
sign-in failed. The search was driven through `knowledgeSearch:search` with an `--identity` — the
same tenantAction the panel calls.

### 4.3 Preconditions that were true for these runs

- Offline rows: `PIKAR_OFFLINE_FIXTURES=1` **and both model keys unset on the deployment** —
  `offlineSeamAvailable()` requires both halves.
- Live row: both model keys restored, which makes `offlineSeamAvailable()` false. The two modes
  therefore cannot share a deployment env, exactly as the spec header states.
- The E2E tenant has **no Gmail connection**, which is what makes the "your mailbox is not
  connected yet" assertion the correct expectation rather than a weaker match.
- The second identity is `e2e-w6b@pikar.test`, provisioned through the real invite + signup seams
  and then **stripped of owner** via `owner:revokeOwner` so the isolation test runs as an ordinary
  tenant. `bootstrapOwner` is additive, so tenant A's owner grant was unaffected.

---

## 5. The build gate needed a one-line worktree repair, and nothing is committed for it

`pnpm --filter @pikar/web build` first failed **in this git worktree** with three `Module not found:
Can't resolve 'server-only'` errors, from `@convex-dev/auth/dist/nextjs/server/index.js` (via
`middleware.ts`) and Next's own `resolve-metadata.js` (via `app/layout.tsx`). None of the three names
a Phase-29 file.

Mechanism, read off the error itself: Next aliases the bare specifier `server-only` to its own
`next/dist/compiled/server-only/empty` (`Import map: aliased to module 'next' with subpath
'/dist/compiled/server-only/empty' inside of [project]/apps/web`). That target is a legitimately
shipped **0-byte** file. It is present in the main working tree — store-linked by pnpm — where the
app builds; CI builds; Phase 26 shipped to production from this app. `pnpm install
--frozen-lockfile` into this freshly created worktree left `index.js` and `package.json` in that
directory but did not materialise `empty.js`.

So this is an **install artifact of this worktree**. It is not a repo defect, not a missing
dependency, and not something CI or the main tree is exposed to.

Repair — `node_modules` only, git-ignored, nothing committed. Create it EMPTY, matching upstream:

```
: > "$(readlink -f apps/web/node_modules/next)/dist/compiled/server-only/empty.js"
```

The build then compiles (`Compiled successfully`, with `/dashboard/workspace` in the route table).
A hand-written `module.exports = {};` shim also works but does not match what upstream ships. If a
later `pnpm install` **in this worktree** drops the file again, run the same line again.

Two fixes that do NOT work — both were tried and reverted; do not propose them again:

- adding `server-only` to `apps/web/package.json`: the import resolves from inside
  `@convex-dev/auth`, and pnpm's strict layout only lets a package see its own declared deps;
- a `packageExtensions` entry adding `server-only` to `@convex-dev/auth`: it installs correctly into
  that package's `node_modules` and the build still fails, because Next's alias map redirects the
  specifier before resolution reaches it.

Nothing is to be committed for this: no dependency, no lockfile edit, no `pnpm-workspace.yaml`
change. An earlier revision of this section warned that "a fresh `pnpm install` will remove this
file again and the build will fail again the same way" and called it a store defect that blocks CI.
That was true of this worktree and false as a general claim; it is corrected here.

---

## 6. What is honestly NOT covered anywhere yet

- **The browser.** Nothing in §1 executed a browser. `apps/web`'s vitest is node-only, so the panel
  tests assert the string `renderToStaticMarkup` emits — not pixels, not focus order, not the live
  action call, not the Convex subscription re-render.
- **A model actually resisting the injection.** `knowledgeSearch.test.ts` mocks `generateObject`, so
  the injection tests prove the SHAPE (a claim survives only by citing minted evidence; the acting
  planes stay empty) and not model behaviour. A real adversarial model run is live spend and is not
  in this plan.
- **A tenant activating a customization.** Out of this plan's scope entirely, and per Wave 4's
  standing note `planTenantActivation` refuses every `pack-*` name, so a published pack
  customization is currently inert in production. The search panel makes no claim about it.

---

## 7. The 29-09 fix pass (2026-08-29) — what was re-run, and the DOA locator

### 7.1 Re-run, with real output

| # | Command | Result |
|---|---|---|
| 1 | `cd apps/web && pnpm vitest run KnowledgeSearchPanel` | **1 file / 41 tests passed** (was 33; this pass adds 8) |
| 2 | `cd apps/web && pnpm vitest run` | **36 files passed / 1 failed — 671 passed, 28 failed.** The red file is `app/(app)/dashboard/workflows/WorkflowPackCustomizer.test.ts`, which is **29-07's, in flight and UNCOMMITTED in this shared worktree** (`git status` shows that lane's `WorkflowPackCustomizer.tsx` and `workflowPackDiscovery.ts` modified). Not this plan's; not fixed by this plan. |
| 3 | `cd apps/web && pnpm typecheck` | **every error is in `dashboard/workflows/WorkflowPackCustomizer*` (29-07's in-flight files); zero errors in any file this plan owns**, verified by re-running with that path filtered out. |
| 4 | `cd packages/core && pnpm vitest run` | **45 files / 1457 tests passed** (unchanged — this pass only corrects comments in `knowledgeSearch.ts`) |
| 5 | `cd packages/core && pnpm typecheck` | clean |
| 6 | `pnpm --filter @pikar/web build` | **passed.** `/dashboard/workspace` compiles. (§5's one-line `empty.js` repair was already in place in this worktree's `node_modules`; nothing committed for it.) |
| 7 | `cd apps/web && npx playwright test --list knowledge-search` | **8 tests discovered in 2 files** — parse only, still zero executions |
| 8 | `echo '{}' \| node scripts/check-playbooks.mjs check` | **blocked, on two playbooks this agent does not own** — see §7.4. `docs/playbooks/cockpit.md` (this plan's) WAS updated. |

### 7.2 The spec was dead on arrival, and it is fixed

`panel.getByRole("button", { name: "Search" })` resolved to **TWO** elements. Playwright's `name`
option is a case-insensitive **substring** match by default, and the panel's close control is
`aria-label="Close knowledge search"` — which contains "search". Every test in the file reached that
locator (directly, or through the `ask()` helper), so the whole spec would have failed on its first
assertion with a strict-mode violation.

Proven against real chromium (a throwaway script, `setContent` with the panel's own two buttons
inside its own `section aria-label=...`, deleted afterwards):

```
loose  count = 2
exact  count = 1
LOOSE THROWS: Error: locator.isDisabled: Error: strict mode violation:
  getByRole('region', { name: 'Search everything you have connected' })
  .getByRole('button', { name: 'Search' }) resolved to 2 elements:
EXACT isDisabled = false
```

Fixed to `{ name: "Search", exact: true }` at both sites. The rest of the file was re-read selector
by selector against the rendered markup: `getByRole("button", {name: "Chat options"})` (the
`HeaderMenu` trigger's `aria-label`; the menu itself is `role="menu"`, so there is no second button
with that name), `getByRole("menuitem", {name: "Search your knowledge"})` (one of four menu items,
and the only one containing that phrase), `getByLabel("What do you want to know?")` (the card's one
`htmlFor`), `Close knowledge search`, and the sign-in trio, which is copied verbatim from the landed
`e2e/auth.setup.ts` — "Sign Out" in `(app)/layout.tsx` matches `{name: "Sign out"}` because the
default match is case-insensitive.

**AS OF THAT PASS the spec was still unrun** — fixing a locator is not evidence. It has since been
executed: see §4 (2026-08-29, green in all three modes). This paragraph is kept as the record of
what was true when §7 was written.

### 7.3 What the fix pass changed in the product

1. `answered` no longer reads the summary string. The card could print "The sources that were
   searched had nothing on this." directly above cited claims, because the synthesis JSON schema
   puts no minimum length on `summary`.
2. The citation source label, the conflicting-evidence source label and the stored-question heading
   are now asserted against the rendered markup. All three could previously be deleted with 33/33
   green.
3. The available/unavailable split is read from `@pikar/core`'s `aggregateCoverage` instead of a
   second copy in the panel.
4. `activeThread` is `ownThread ?? threadId ?? null`, so a search made before the first chat message
   stays readable after it. Covered by the e2e test in §3 — **executed and passing**, see §4.
5. Three comments in `packages/core/src/knowledgeSearch.ts` saying `renderSourceGap` and
   `groundedSourceProps` have no production caller were deleted — 29-09 created that caller.

### 7.4 Named follow-ups this agent did NOT make (ownership)

| File | Owner | What it needs |
|---|---|---|
| `docs/playbooks/knowledge-search-routines.md` | W3-TAIL / FIX-TAIL | A `Last verified` bump for the `packages/core/src/knowledgeSearch.ts` comment corrections in §7.3(5). The §9 hook blocks on it, and this agent must not cross the ownership line a second time. |
| `packages/backend/convex/knowledgeSearch.ts:499` | not 29-09 | Still says `renderSourceGap` "has NO caller yet — 29-09's panel is where it gets wired". The caller exists. Same false claim as the two deleted in core. |
| `docs/playbooks/workflow-packs.md` | 29-07 | The §9 hook also blocks on 29-07's in-flight `WorkflowPackCustomizer.tsx` / `workflowPackDiscovery.ts`. Not this plan's. |

`groundedSourceProps().nonVault` was left in place rather than deleted or newly rendered: the panel
already renders every non-vault citation as a `Citation` row carrying its own source label (the new
test *"a Drive citation names Drive, so two systems on one claim are told apart"* pins that), so
non-vault provenance is visible on the page. `nonVault` itself has no production reader, and
deleting it would break `packages/backend/convex/knowledgeSearch.test.ts`, which this agent does not
own. Its docstring now says that plainly instead of claiming a caller.

---

## 8. The 29-09 second fix pass (2026-08-29) — claims deleted, one new oracle

The first fix pass replaced two false claims with *narrower* claims that were also false. This pass
deletes rather than narrows.

### 8.1 What changed

| # | Site | Was | Is |
|---|---|---|---|
| 1 | `packages/core/src/knowledgeSearch.ts` `aggregateCoverage` docstring | cited `KnowledgeSearchPanel.test.ts` as "what fails if a second copy appears" | cites the same-file `knowledgeSearch.test.ts` describe that really does fail, and says outright that no test in `@pikar/core` can see whether another package re-derives the rule |
| 2 | `packages/core/src/knowledgeSearch.ts` `groundedSourceProps` docstring | "so a caller cannot end up with a silently shorter list" | states that both halves are returned and that this function does not decide what a caller renders — the absolute is gone, not narrowed |
| 3 | `KnowledgeSearchPanel.tsx` `activeThread` comment | "the rows stay in the DB … and nothing could ever query them back" | `listByThread` takes any thread string; what changes is that no path in the component asks for the cockpit thread once the panel minted its own |
| 4 | `KnowledgeSearchPanel.test.ts` header | "EVERY assertion below is over the STRING `renderToStaticMarkup` emits" | §§1-7 are; §8 is a source scan that proves spelling, stated in the header, in the section banner, and in every §8 test title (`scan:`) |
| 5 | `KnowledgeSearchPanel.test.ts` §2 | the blank-summary guard had no oracle | new test *"a blank summary renders no paragraph at all, not an empty one"* renders `""` and `"   "` and rejects `/<p[^>]*>\s*<\/p>/` |
| 6 | `KnowledgeSearchPanel.test.ts` §8 | banned two literal comparisons | also bans `.status` anywhere in the panel source, which is what a re-derivation has to read |
| 7 | §5 of this document | "a fresh `pnpm install` will remove this file again and the build will fail again the same way … it also blocks any CI that builds the web app" | a worktree install artifact with a one-line repair; the main tree and CI are unaffected |

### 8.2 Mutations run, and observed RED

| Mutation | Result |
|---|---|
| drop the `row.summary.trim().length > 0 &&` guard at `KnowledgeSearchPanel.tsx:210` | **RED**, 1 test — *a blank summary renders no paragraph at all, not an empty one* (`expected … not to match /<p[^>]*>\s*<\/p>/`). This is the mutation that was green before this pass. |
| replace `coverage.available + coverage.partial > 0` with the verifier's `row.sources.filter((s) => s.status === "available" \|\| s.status === "partial").length > 0` | **RED**, 1 test — the widened §8 scan. Reported as a SCAN hit, not behavioural coverage: it is a grep. Under the old two-comparison form this exact mutation was green. |
| `aggregateCoverage` stops distinguishing `unavailable` (count it as `available`, push no gap) | **RED**, 2 tests in *aggregateCoverage keeps an unavailable source from reading as an empty one* — the describe the corrected docstring now cites. |

All three reverted; `git diff --stat` on both files shows only the intended edits.

### 8.3 Still open

- `packages/backend/convex/knowledgeSearch.ts:498-499` still says `renderSourceGap` "has NO caller
  yet — 29-09's panel is where it gets wired". The caller is
  `KnowledgeSearchPanel.tsx:260`. Three verifiers have now reported it. **No Wave-4 agent owns that
  file**, and 29-09's ownership list excludes it, so it survives another round. The fix is to delete
  the clause "and it has NO caller yet — 29-09's panel is where it gets wired" from that sentence.
- ~~The browser gate. §4 is still empty.~~ **RUN 2026-08-29 and green in all three modes — see §4.**
  The one thing still unproven live is the SYNTHESIZER against a connected source (§4.2).
