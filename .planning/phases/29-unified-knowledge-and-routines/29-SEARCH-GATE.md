# 29-SEARCH-GATE — release evidence for unified knowledge search (KNOW-01)

**Owner of this file:** plan 29-09. **Consumed by:** plan 13's single final owner checkpoint.
**Status: THE BROWSER GATE IS UNRUN. The plan's browser criterion is NOT met.**

29-09 could not run a browser gate: it needs a live Convex deployment, a seeded E2E user, real
credentials and (in one mode) real model spend. None of those were available to the agent, and it
was explicitly out of scope. `apps/web/e2e/knowledge-search.spec.ts` is written against the real
components and the real selectors, and Playwright discovers and parses all 8 of its tests — but
**not one of them has ever been executed against a running stack.** Nothing below should be read as
browser evidence until an operator pastes real output into §4.

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

## 4. Operator results — TO BE FILLED IN. EMPTY MEANS UNRUN.

| Date | Mode | Deployment | Command | Result (paste the runner's own summary line) |
|---|---|---|---|---|
| — | offline | — | — | **UNRUN** |
| — | live | — | — | **UNRUN** |
| — | two identities | — | — | **UNRUN — no second loggable account exists (§2.4)** |

Until at least the offline row is filled in with real runner output, KNOW-01 is proven in the
backend and in the rendered-markup layer only, and **not** in a browser.

---

## 5. The build gate needed an environment repair, and it is not committed

`pnpm --filter @pikar/web build` first failed with three `Module not found: Can't resolve
'server-only'` errors, from `@convex-dev/auth/dist/nextjs/server/index.js` (via `middleware.ts`) and
Next's own `resolve-metadata.js` (via `app/layout.tsx`). None of the three names any Phase-29 file.

Cause: Next aliases `server-only` to `next/dist/compiled/server-only/empty`, and `empty.js` is
absent from that directory in this worktree's install — it is listed in the shim's own
`package.json` `files` array, and the real `server-only@0.0.1` in the pnpm store is missing it too.

Repair applied (node_modules only, git-ignored, nothing committed):

```
printf 'module.exports = {};\n' > "$(readlink -f apps/web/node_modules/next)/dist/compiled/server-only/empty.js"
```

The build then passed. **A fresh `pnpm install` will remove this file again and the build will fail
again the same way.** It is an install/store defect, not a source defect, and it is recorded here
rather than papered over because it also blocks 29-07's build gate and any CI that builds the web
app.

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
| 6 | `pnpm --filter @pikar/web build` | **passed.** `/dashboard/workspace` compiles. (The `server-only` shim from §5 was still present in `node_modules`; a fresh `pnpm install` needs it again.) |
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

**THE SPEC IS STILL UNRUN.** §4 is still empty. Fixing a locator is not evidence, and the plan's
browser criterion is not met.

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
   stays readable after it. Covered by the new (UNRUN) e2e test in §3.
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
