---
phase: 21-user-authored-skills-and-routines
plan: 05
subsystem: cockpit
requirements: [SKILL-01]
requirement_status: OPEN — deliberately not marked complete
tags: [saved-prompts, routine-v0, workspace, fresh-thread, no-automation]
dependency_graph:
  requires:
    - "21-01: savedPrompts table + by_tenant_createdAt / by_tenant_textHash"
    - "21-02: the current state of workspace/page.tsx (SkillAuthoringPanel mount)"
    - "pre-existing: useSendCockpitMessage (the ONE browser send door), HeaderMenu, ErrorBoundary"
  provides:
    - "savedPrompts.save / list / remove (bounded, tenant-owned, idempotent per tenant)"
    - "normalizePromptText / derivePromptTitle / SAVED_PROMPT_* bounds"
    - "ChatPane pinLabel + the Pin chip on user bubbles"
    - "PinnedPrompts / PinnedPromptsFallback header menu + runPinned fresh-thread path"
  affects: ["21-06", "21-07"]
tech_stack:
  added: []
  patterns:
    - "content-plane row with NO audit event — a reversible preference is not a governance event"
    - "planted refs-only control row to make a log-plane needle scan non-vacuous"
    - "one absolutely-positioned wrapper so two existing hover chips can coexist without new CSS"
key_files:
  created:
    - packages/backend/convex/savedPrompts.ts
    - packages/backend/convex/savedPrompts.test.ts
    - apps/web/app/(app)/dashboard/workspace/pinnedPrompts.test.ts
  modified:
    - apps/web/app/(app)/dashboard/workspace/ChatPane.tsx
    - apps/web/app/(app)/dashboard/workspace/page.tsx
    - docs/playbooks/cockpit.md
    - docs/playbooks/agent-runtime.md
    - docs/playbooks/business-evaluation.md
metrics:
  commits:
    - "cf18305 — bounded saved-prompt CRUD (2 files, +514 / -0)"
    - "fc20c60 — Pin chip + Pinned prompts menu + fresh-thread Run (3 files, +467 / -9)"
    - "64d704c — cockpit.md routine-v0 contract + 21-05-PLAN.md (2 files, +330 / -0)"
    - "c5ed771 — two check-playbooks false-positive bumps, claiming nothing (2 files, +40 / -0)"
  files_changed: 9
  insertions: 1351
  deletions: 9
  spend_usd: 0.00
  completed: 2026-08-11
---

# Phase 21 Plan 05: Routine v0 — Pinned Prompts Summary

A user can pin one of their own messages and re-run it later as an **ordinary fresh cockpit turn**
through the same clock-bearing hook every typed message uses — with no scheduler, no `routines`
table, and no second send path anywhere in the codebase.

---

## Measured Results

Every number below was read off a command run in this session. Nothing is estimated.

| Gate | Command | Result |
|---|---|---|
| Backend CRUD suite (plan's Task-1 verify) | `pnpm exec vitest run convex/savedPrompts.test.ts --maxWorkers=1` | **13/13 passed**, exit 0 |
| Backend guard set | `… vitest run savedPrompts + importGuard + auditImmutability + llmRedaction --maxWorkers=1` | **152/152 passed**, 4 files |
| Import guard alone | `… vitest run convex/importGuard.test.ts --maxWorkers=1` | **76/76** (was 75/75 at 21-01 — it picked up the new module) |
| Web pinned-prompts suite (plan's Task-2 verify) | `pnpm --filter web exec vitest run '…/pinnedPrompts.test.ts'` | **14/14 passed**, exit 0 |
| Full web suite | `pnpm --filter web exec vitest run` | **202/202 passed**, 12 files (was 188/188 at 21-02; +14 = exactly this plan's) |
| Web typecheck | `pnpm typecheck` (apps/web) | exit **0**, three separate runs |
| Backend typecheck, with my files, before the sibling's commit | `tsc --noEmit -p tsconfig.json` at `cf18305` | exit **0**, **zero diagnostics** |
| Backend typecheck, after the sibling's `ce04642` | same command | exit 2 — **1 diagnostic, in `convex/skills.test.ts:1704`, not my file** (see Deviations) |
| Playbook gate (plan's Task-3 verify) | `node scripts/check-playbooks.mjs` | exit **0**, empty output (after two false positives were cleared) |
| Whitespace | `git diff --check` on every path I touched | exit **0** |
| Biome, owned backend files | `biome check convex/savedPrompts.ts convex/savedPrompts.test.ts` | exit **0** |
| Biome, owned web files | `biome check ChatPane.tsx page.tsx pinnedPrompts.test.ts` | exit **0** (2 warnings, both mine and intentional — see Deviations) |
| Eval runner self-check (the ONLY permitted eval invocation) | `node scripts/run-eval-golden.mjs --self-check` | **PASSED** — 36 fixtures valid, 12 gated skills derived, exit 0 |
| **Model spend** | — | **$0.00 — no model call, no eval gate run, no `--skill` pin, no live send** |

**The eval gate was NOT run.** A standing do-not-rerun order is in force (last full attempt timed
out at 1808s / exit 124), and this plan needs no gate run: it adds no prompt, no skill body and no
model call. `--self-check` is free and offline.

### The known Windows OOM, measured rather than hidden

The first `vitest run convex/savedPrompts.test.ts` died with
`FATAL ERROR: Committing semi space failed. Allocation failed - JavaScript heap out of memory`,
and two subsequent invocations died to shell-level resource exhaustion
(`Resource temporarily unavailable`, `cygpath … child_copy` — **47 `node.exe` processes** were live,
i.e. sibling lanes). Every result reported above was obtained under
`NODE_OPTIONS=--max-old-space-size=8192` and re-run to confirm. `npx convex codegen` also crashed
esbuild twice before succeeding on the third attempt. **No code or config was changed for any of
this** — do not read one of these as a red test without diagnostics on the line above it.

---

## What Was Built

### Task 1 — `savedPrompts.ts` (135 lines) + `savedPrompts.test.ts` (379 lines)

A thin `tenantQuery`/`tenantMutation` adapter over 21-01's table. Three functions, no fourth.

| Function | Args | Bound | Refusal |
|---|---|---|---|
| `save` | `{text}` **only** | `SAVED_PROMPT_MAX_BYTES = 4000` **UTF-8 bytes** | blank ⇒ `SAVED_PROMPT_EMPTY`; over cap ⇒ `SAVED_PROMPT_TOO_LONG: <bytes> > 4000 bytes` |
| `list` | none | `by_tenant_createdAt` · `.order("desc")` · `.take(20)` | — |
| `remove` | `{id: v.id("savedPrompts")}` | one exact-row read | missing **and** foreign ⇒ the same `{removed: false}` |

`tenantId`, `title`, `textHash` and `createdAt` are all derived server-side, so Convex's arg
validator is the refusal boundary — a caller cannot even *name* a field it does not own, and there
is no `schedule`, `trigger`, `status` or `nextRunAt` to name in the first place.

**The cap is BYTES, via `TextEncoder`.** A character cap lets one multibyte paste carry ~3x the
tokens the number implies. The test's positive witness is an at-cap value assembled to be *exactly*
4000 bytes with **fewer characters than bytes** (`expect(atCap.length).toBeLessThan(4000)`), so the
boundary is provably measured in the right unit; 4001 bytes is refused and writes nothing.

**Idempotence is per tenant, not global.** `textHash` is `lib/hash.contentHash` (rung 2 — the
existing implementation, not a fourth SHA-256) over the *normalized* text: CRLF folded, outer
whitespace trimmed, **interior blank lines preserved**. A re-pin with `\r\n` and surrounding spaces
returns the same id and mints nothing; tenant B pinning byte-identical text gets its own row.
`title` is the bounded 80-char first nonblank line — **the text itself is never truncated**, because
a shortened prompt would replay a different instruction than the one the user pinned.

**No audit event is written at all.** A reversible UI preference is not a governance event, and an
audit row carrying the prompt would be exactly the PII honeypot CLAUDE.md §4 exists to prevent. The
privacy test plants a **refs-only control audit row** (a `savedPromptRef` + the `textHash`) purely so
the needle scan is proven to read something — an empty-table scan "passes" for the trivial reason
that there is nothing to read.

`remove` performs exactly one `ctx.db.delete` (asserted by count in the source contract) and the
test proves a planted `plans` row survives it. A saved prompt has no `threadId` and owns no
conversation.

### Task 2 — the surface (`ChatPane.tsx` +78/−4, `page.tsx` +149/−5, `pinnedPrompts.test.ts` 249 lines)

**`ChatPane`:** `Copy` and the Pin chip live inside **one** `{mine && (…)}` block, so an assistant
bubble has no Pin *by construction* rather than by a second guard. The two chips sit in a
`.bubble-actions` wrapper that takes the absolute position `.msg-copy` used to own — two `.msg-copy`
buttons would otherwise stack on each other at the same coordinates. **`globals.css` was not
touched**: the chips reuse the existing class and go `position: static` inside the wrapper (it is
not in this plan's `files_modified`, and it did not need to be). A pin that has a state is forced to
`opacity: 1`, because a "Pin failed" chip that vanishes when the pointer leaves has told the user
nothing.

`pinLabel()` is an exported pure labeller and the only place the four sentences live:
`Pin prompt` / `Pinning…` / `Pinned ✓` / `Pin failed — try again`. **A failed pin sets a label and
does not rethrow** — unlike `onSend`, which deliberately rethrows after restoring the user's text.
That asymmetry is asserted in both directions (the `pin` slice has no `throw`; the `onSend` slice
has `throw err;`), because a convenience must never take the conversation with it.

**`page.tsx`:** `PinnedPrompts` + `PinnedPromptsFallback` beside `PastChats`, using the existing
`HeaderMenu`/scrim/`head-menu-item`/`head-menu-empty` idiom and the existing **`StarIcon`** — no new
route, no nav entry, no component library, no new dependency, no new icon (BRAND §8.3). It owns its
own `useQuery` inside `<ErrorBoundary label="pinned-prompts">`, the `PastChats` precedent verbatim,
so a failing read degrades *this menu* and not the cockpit.

Honest states: `Loading…`, "No pinned prompts yet. Pin one from a message you have sent.",
`Running…`, `Deleting…`, and an inline announced `role="status"` notice — never
`window.alert`/`confirm`, never a dialog, never amber (BRAND §2 spends `--held` on the approval gate
alone; asserted as four forbidden strings). Accessible names carry the **verb**
(`Run pinned prompt: ${p.title}` / `Delete pinned prompt: ${p.title}`) because twenty rows of prompt
titles are otherwise indistinguishable to a screen reader. Run closes the menu on **success only** —
closing on failure would dismiss its own error notice.

**The Run path is the whole point:**

```ts
const send = useSendCockpitMessage();
const res = await send({ text });          // no threadId ⇒ a fresh ordinary thread
registerThread(res.threadId, text);
```

wrapped in `setSending(true/false)` so the ChatPane bubble and the workspace `ActivityCard` light up
for a pinned run exactly as for a typed one. Because it is the same door, guardrails, spend,
activity, plan lifecycle and the Approve gate are unchanged **by construction** — there was nothing
new to re-verify on those paths, and nothing was.

The test asserts this with a regex over *every* `send({…})` call in the file
(`expect(sendCalls).toEqual(["text"])`), not a substring, and pins the no-current-thread rule with a
lookbehind (`/(?<!res\.)\bthreadId\b/`) so `res.threadId` — the id coming *back* — is allowed while
the page's open-conversation state is not.

### Task 3 — `cockpit.md` (+133, zero deletions)

The API table, the byte cap, the per-tenant dedupe rule, the content-plane/log-plane boundary, the
four Run consequences, the surface contract, the delete-ownership rule, the verification commands,
the manual browser steps, the four-row mutation ledger, and an explicit **evidence gate**: cron,
recurrence, trigger rows, execution history, routine status, an authoring canvas and a graph DSL are
post-beta and gated on *one* observation — a real user manually re-running a pinned prompt twice.
"The word 'routine' is not authorization."

---

## Mutation Proofs

Every mutation was applied to a byte-exact working copy, run, its **verbatim** red recorded, then
restored from the pristine copy and re-verified (`diff -q` → identical, and the suite re-run green).

### The four 21-VALIDATION.md ledger rows owned by this plan

| Row | Exact mutation | Observed red (verbatim) | Restored |
|---|---|---|---|
| **11. Prompt delete ownership** | `if (!row \|\| row.tenantId !== ctx.tenantId)` → `if (!row)` | `FAIL … a foreign id and a missing id return the SAME not-found result and mutate nothing` — `AssertionError: expected { removed: true } to deeply equal { removed: false }`; **1 failed \| 12 passed** | yes — 13/13 |
| **12b. Prompt log privacy** | added `ctx.db.insert("audit", { … payload: { savedPromptRef, text: normalized } })` to `save` | `FAIL … save and remove write NO audit/dead-letter/telemetry row, and no needle reaches one` — `AssertionError: expected '{"audit":[{"_creationTime":1786396439…' not to contain 'ZP5ALPHA9c4e2b71'`; **1 failed \| 12 passed** | yes — 13/13 |
| **10a. Trusted browser send** | `useSendCockpitMessage()` → `useAction(api.cockpit.sendCockpitMessage)` (+ the import) | `FAIL … NO component constructs the raw cockpit action` — `AssertionError: expected '"use client";\n\nimport { api } from …' not to contain 'api.cockpit.sendCockpitMessage'`; **2 failed \| 12 passed** | yes — 14/14 |
| **10b. Fresh-thread run** | `await send({ text })` → `await send({ threadId, text })` | `FAIL … Run goes through the trusted hook with NO threadId, and registers the id it returns` — `AssertionError: expected [ 'threadId, text' ] to deeply equal [ 'text' ]`; **1 failed \| 13 passed** | yes — 14/14 |

Row 10b's red is exactly what the ledger specifies: the **positive** witness
(`registerThread(res.threadId, text)`) still passes while the no-threadId assertion fails.

### Two honest notes about these proofs

**Row 12b forced a test restructure, and it is worth recording why.** On the first attempt the
mutation turned the test red on `expect(before.audit).toHaveLength(0)` — a *row count* on the line
above the needle scan — which short-circuited the assertion the ledger actually names. A count is a
stronger but narrower fact, and letting it fire first would have let me claim a needle-scan proof I
had not obtained. The test now asserts the **scan first** and the counts after, with a comment
saying so; on the re-run the red is the scan, and the control row's `textHash` `toContain` on the
line above it passes, proving the scan was reading real data.

**The 12b mutation writes the audit row with a direct `ctx.db.insert("audit", …)` rather than
`internal.audit.log`.** `audit.log` maintains the `auditCounts` aggregate component, which this
harness does not register, so routing through it would have produced a *component-not-registered*
red — a red for the wrong reason. The direct insert is precisely "the prompt text reached an audit
payload", which is what the row is about.

### Anti-vacuity

No zero/absence assertion in this plan stands alone:

- the blank/over-cap refusals sit beside an **at-cap 4000-byte multibyte** value being accepted, and
  each refusal asserts the row count is unchanged rather than merely that it threw.
- "B cannot see A's prompt" sits beside `expect(JSON.stringify(listA)).toContain(NEEDLE_A)` and
  `expect(JSON.stringify(listB)).toContain(NEEDLE_B)`.
- the log-plane needle scan ends up asserting `toContain(row.textHash)` on the planted control row,
  so the scan is proven to read.
- `{removed: false}` for a foreign id sits beside the **owner's** `{removed: true}` two lines later,
  so the refusal is a refusal and not a broken delete; the missing-id case is then asserted
  `toEqual(foreign)` rather than re-asserted from scratch.
- the 20-row cap test plants a **foreign row with the newest timestamp of all** — the exact row an
  unscoped read would surface first.
- every forbidden-string scan in `pinnedPrompts.test.ts` carries a positive witness in the same
  test (`useSendCockpitMessage()` beside the raw-action absence; `{list, remove, save}` pinned by
  equality beside the scheduler-word absence; `var(--ink-soft)` beside the no-hex assertion).
- the `Pin prompt` scan asserts **exactly one** occurrence in the file *and* that it sits inside the
  `{mine && (` block, with a length floor on the slice — an `indexOf`-derived empty slice "contains"
  nothing and passes vacuously (the 21-02 lesson, applied).

---

## NOT DONE AND NOT CLAIMED

**SKILL-01 stays OPEN. Do not check it off.** Concretely, as of `c5ed771`:

- **No browser proof, of anything.** `pinnedPrompts.test.ts` is a **source-text scan**: `apps/web`'s
  vitest config is node-only with no jsdom and no testing-library, and that config documents adding
  them as a deliberate upgrade. It proves the shipped source contains and lacks exact strings. **It
  proves nothing about pixels, layout, keyboard focus order, whether the menu opens, whether the
  chip is reachable by hover or keyboard, or that any of this renders at all.** No Playwright spec
  was written or run and no dev server was started. The browser proof is 21-06's.
- **No prompt has ever been pinned or run against a real deployment.** Every result here is
  `convex-test` in-memory or a string scan. `sendCockpitMessage` was never invoked — not once, not
  in a smoke run. The claim "Run produces the same governed turn as typing" is an argument from
  *identity of call site* (same hook, no extra argument), which is strong, and it is **not** an
  observation.
- **The "deleting a pin never deletes a chat" proof covers app tables only.** It plants a `plans`
  row and asserts it survives, plus a source-count assertion that `remove` performs exactly one
  `ctx.db.delete`. The `@convex-dev/agent` **component's** thread/message tables were not registered
  in this harness and were therefore not snapshotted. The reason the claim still holds is
  structural — `savedPrompts` has no `threadId` column and the module names no other table — not
  empirical.
- **`list` is a `take`, not pagination.** A tenant with more than 20 pins silently sees only the
  newest 20. Honest for v0 (twenty pinned prompts is a product signal), but it is a cap, and there
  is no "show more".
- **Concurrency is per-menu, not per-tenant.** `disabled = busy || running || deleting` prevents a
  second Run *in this browser tab*. Two tabs, or two devices, can each start a pinned run; nothing
  server-side serializes them. That is the same exposure a user typing in two tabs already has.
- **Nothing observes whether a user re-runs a prompt twice.** The evidence gate written into
  `cockpit.md` names that observation as the precondition for any automation, and **this plan ships
  no instrumentation to detect it**. Someone will have to look. No counter, no telemetry field, no
  audit event (deliberately — see §4 above), no dashboard.
- **No `routines` table, cron, `ctx.scheduler`, trigger, recurrence, `nextRunAt`, execution history,
  routine status, authoring canvas or graph DSL** exists or was added. Asserted mechanically in both
  test files against comment-stripped source.
- **No skill, registry, eval, evidence, activation or rollback work.** `tenantSkills` was not read or
  written; `publishUserCandidate`, `loadEffectiveSkill` and `composeUserSkillBody` were not called
  or changed. 21-02's finding stands unchanged: **no tenant row can become `active` through any code
  path**, and the authoring panel's "Live" copy remains unreachable in production until 21-04. I
  built nothing on top of that activation.
- **`convex/_generated/` was regenerated on this machine** (`npx convex codegen`, third attempt) so
  `api.savedPrompts` would typecheck. It is git-ignored and was not committed; a fresh clone runs
  codegen per CLAUDE.md §7.

---

## Deviations

**Rule 3 (blocking) — my own test bug, caught by its own boundary.** The first at-cap fixture was
`"あ".repeat(4000 / 3)`, which truncates to 1333 characters = **3999** bytes, and the test said so:
`expected Uint8Array[…] to have a length of 4000 but got 3999`. Fixed by padding to exactly the cap
and adding `expect(atCap.length).toBeLessThan(4000)` so the fixture also proves it is genuinely
multibyte. This is the boundary case being *executed*, which is the point of having it.

**Rule 3 (blocking) — `_generated/api.d.ts` had no `savedPrompts`, and the backend typecheck said
so.** 20 `TS2339: Property 'savedPrompts' does not exist` diagnostics. `npx convex codegen` crashed
esbuild (goroutine stack dump) twice under the machine's memory pressure and succeeded on the third
attempt. No file was hand-edited to work around it.

**Rule 3 (blocking) — `noUncheckedIndexedAccess`.** Six `TS18048/TS2532` diagnostics from
`const [row] = …`. Rather than `!` (which mutes the compiler and is a biome warning in this repo), I
added a four-line `at(rows, i)` helper that throws a readable fixture-bug message. No production
code changed.

**Rule 3 (blocking) — `lint/suspicious/noExportsInTest`.** My decorative
`export type SavedPromptId` at the bottom of the test was a biome error. Deleted, and replaced with
something that actually earns its place: a source assertion that `remove`'s arg is
`v.id("savedPrompts")`. Deletion over addition.

**Rule 3 (blocking) — biome formatting on owned files.** `biome check --write` scoped to the five
files this plan owns; all five then exit 0. Two `noTemplateCurlyInString` **warnings** remain in
`pinnedPrompts.test.ts` and are intentional: the assertions
`expect(menu).toContain("\`Run pinned prompt: ${p.title}\`")` are *about* source text that contains a
template literal, so turning them into template strings would destroy the thing being asserted.
`biome check` on the three web files exits **0** with those two warnings.

**Rule 3 (blocking) — the Stop hook blamed me for the concurrent 21-03 lane, and the fix claims
nothing.** `check-playbooks.mjs` blocked on `business-evaluation.md (changed: evaluations.ts)` and
`agent-runtime.md (changed: smoke.ts)`. Neither file is in any of my commits — `evaluations.ts`,
`smoke.ts` and `dispatch.ts` were dirty in the shared tree and all three are named in the 21-03
lane's own file list. The hook builds its changed-set from the whole working tree.

Cleared in `c5ed771` with **date-bump-only** entries, the shape `skill-registry.md` and
`agent-runtime.md` already use for this exact false positive: each states **in its first sentence**
that nothing was re-verified and that it documents no change of its own, names the five paths 21-05
actually touched with their commit hashes, and hands the real entry back to 21-03 with an explicit
"do not treat this bump as coverage". **I did not run, read, re-measure, endorse, revert or restage
that lane's change**, and I make no claim about whether it is correct. `skill-registry.md` — theirs
by assignment — was **not touched**.

A third block then named a new uncovered file, `packages/backend/convex/__h_smoke.ts`. It is a
transient harness artifact of the same sibling lane; I did **not** add it to `watch.json` or to
`_unassigned` (that would be making an ownership decision about someone else's file). By the next
check it had been deleted by its own lane and the gate passed. **`watch.json` needed no change from
me**: `savedPrompts.ts`/`savedPrompts.test.ts` were registered to `cockpit.md` by 21-01, and the new
web test falls under `cockpit.md`'s existing `apps/web/app/(app)/dashboard/workspace/` prefix.

**Out of scope, NOT fixed — a red backend typecheck belonging to 21-03.** After the sibling's commit
`ce04642` landed mid-session, `tsc --noEmit` on `packages/backend` reports exactly one diagnostic:

```
convex/skills.test.ts(1704,23): error TS2339: Property 'status' does not exist on type
'{ _id: Id<"tenantSkills">; … } | {}'.  Property 'status' does not exist on type '{}'.
```

It is `expect(beforeRest.status)` on a `const { … } = beforeRow ?? {}` destructure. **It is not
mine**: `git log -1 -- convex/skills.test.ts` → `ce04642 feat(21-03) …`; that commit grew the file
from 1479 to 1857 lines and line 1704 is inside the new content; the same command exited **0 with
zero diagnostics** at `cf18305`, with both of my backend files already in the tree; and
`grep -c "savedPrompts" tsc.log` → **0**. Per the scope boundary I did not touch it. **21-03 owns
`skills.test.ts` and must fix this before the phase can claim a green backend typecheck.**

**Shared-tree hygiene.** All four commits used `git commit -- <explicit paths>`, which takes those
paths from the working tree and ignores the rest of the index. The only `git add` calls were three
explicit new-file paths, each immediately followed by a pathspec commit in the **same shell
invocation** to close the race window. **No `git add -A`, `git add .` or `git add <dir>` was ever
run.** `.git/MERGE_HEAD` was checked before every commit and was absent every time. All four commits
were verified with `git merge-base --is-ancestor <sha> HEAD` after each one and again at the end —
**all four survive**; nothing fell out and nothing had to be re-applied. The sibling's `ce04642`
landed between `cf18305` and `fc20c60` and was left entirely alone.

**`.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md` and `graphify-out/` were
NOT modified or staged.** `ROADMAP.md` carries another lane's uncommitted 2758-line edit and
`graphify-out/` is a shared generated artifact carrying other lanes' state. See "State handoff".

**No Rule 1, 2 or 4 deviations.** Nothing of this plan's was found broken (the one bug found was my
own test fixture, above), nothing was missing that correctness or security required beyond what the
plan specified, and nothing architectural was in question — the whole plan is *deliberately* the
version with no architecture in it.

### Ponytail ladder, where it actually bit

- **Rung 2 (already here):** `contentHash` instead of a fourth `createHash("sha256")`; `StarIcon`
  instead of a new pin glyph; `HeaderMenu`/`head-menu-*`/`ErrorBoundary` instead of a menu
  component; `.msg-copy` instead of a new chip class; `useSendCockpitMessage` instead of a send.
- **Rung 1 (does this need to exist):** no `savedPrompts` domain module under `packages/*`. The four
  "domain" helpers are a trim, a byte count and a first-line slice with exactly one caller each; a
  package for them is an abstraction nobody asked for. Marked with a `ponytail:` comment naming the
  upgrade path (move to `packages/core` when a second runtime needs the same normalization).
- **Deletion over addition:** the `SavedPromptId` type export was removed rather than suppressed.
- **What was NOT made lazy:** input validation at the trust boundary (blank, byte cap, exact-row
  ownership, non-oracle not-found), and the log-plane privacy scan.

---

## Graph

`graphify update .` rebuilt **15919 nodes / 18234 edges / 1603 communities**;
`node scripts/extract-convex-edges.mjs` re-injected **+436 convex edges, +65 table edges (39
tables)** and removed 9366 noise nodes. **`graphify-out/` was not staged** — it is a shared generated
artifact carrying other lanes' uncommitted state.

---

## State handoff (NOT written — other lanes own these files)

- **STATE.md** — Current Plan advances past 21-05; Stopped At: `Completed 21-05-PLAN.md`. Decisions
  worth recording: *"21-05: routine v0 is a pinned prompt replayed as a FRESH ordinary cockpit turn
  through `useSendCockpitMessage` with no threadId — there is no scheduler, and cron/recurrence/
  history/status are evidence-gated on a user re-running a prompt twice."* and *"21-05: prompt text
  is content-plane and writes NO audit event; the privacy test plants a refs-only control row so the
  needle scan is not vacuous."*
- **ROADMAP.md** — Phase 21 plan progress advances by one completed plan (21-01, 21-02, 21-03 and
  21-05 are now done; 21-04, 21-06, 21-07 outstanding). Phase status stays in-progress.
- **REQUIREMENTS.md** — **SKILL-01 stays OPEN.** Owner activation and rollback (21-04), the
  authenticated browser checkpoint (21-06) and the live gate (21-07) are all outstanding, and this
  plan has **no browser proof at all**.

---

## Next

**21-06** owns the only thing that can turn any of this from a string scan into a fact: an
authenticated Playwright run that pins a real message, opens the star menu, presses the prompt, and
asserts a **new** tab appears carrying the same governed plan/approval flow — plus that Delete
removes the pin and leaves the chat in Past chats. Two specific traps for it: the pin chip is
`opacity: 0` until `.bubble-wrap:hover` or `:focus-visible`, so a naive click will miss it; and the
menu closes on a successful Run, so the post-Run assertions must target the tab strip, not the menu.

**21-03's `convex/skills.test.ts:1704` typecheck error is outstanding and is theirs** — the phase
cannot claim a green backend typecheck until it is fixed.

## Self-Check: PASSED

- `packages/backend/convex/savedPrompts.ts` — FOUND (135 lines, created in `cf18305`)
- `packages/backend/convex/savedPrompts.test.ts` — FOUND (379 lines, created)
- `apps/web/app/(app)/dashboard/workspace/ChatPane.tsx` — FOUND (+78 / −4 in `fc20c60`)
- `apps/web/app/(app)/dashboard/workspace/page.tsx` — FOUND (+149 / −5)
- `apps/web/app/(app)/dashboard/workspace/pinnedPrompts.test.ts` — FOUND (249 lines, created)
- `docs/playbooks/cockpit.md` — FOUND (+133, zero deletions, in `64d704c`)
- `.planning/phases/21-user-authored-skills-and-routines/21-05-PLAN.md` — FOUND (197 lines, newly tracked)
- `docs/playbooks/agent-runtime.md` / `business-evaluation.md` — FOUND (+20 each, date-bump-only, `c5ed771`)
- Commits `cf18305`, `fc20c60`, `64d704c`, `c5ed771` — all four re-verified with
  `git merge-base --is-ancestor <sha> HEAD` **after this summary was written**
