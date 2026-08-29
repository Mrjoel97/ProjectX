# 29-07 FIX2 — the container half of `/dashboard/workflows`

One code commit (`556d9ea`) plus this record. Worktree `C:/Users/expert/AppData/Local/Temp/pikar29`,
branch `feat/29-unified-knowledge`.

## What was wrong, and what is now true

### 1. The container was unpinned. It is now driven as an interaction.

Four mutations that make the route functionally inert all passed the customizer suite at 109/109:
`onChoose={choose}`, `onSet={setValue}` and `onSubmit={() => void submit()}` cut to no-ops, and
`setBaseline(values)` deleted from the save's success arm. The SSR suite renders `CustomizerView`
from props and fires no event, so it could never say whether the container was wired to that view.
Three of the four were disclosed in the previous round as "SOURCE-SCAN coverage, not behaviour
coverage". That disclosure was honest and it was not coverage.

`apps/web/app/(app)/dashboard/workflows/WorkflowPackCustomizer.container.test.ts` (new, 12 tests)
mounts the REAL `WorkflowPackCustomizer` under jsdom with `createRoot`, dispatches real click and
`input` events (native value setter + bubbling `input`, which is how React hears a controlled
control), and reads text back out of `container.textContent`. `convex/react` is the only stub:
`useQuery` answers by the function reference's OWN path via `getFunctionName`, so a rename of either
query breaks the file instead of silently feeding the wrong rows into the wrong hook — and one test
asserts those three paths are the ones the component asks for.

The walked path is: mount → nothing offered → click a workflow → form opens prefilled from the
server's row → type → the change summary follows → save → the four closed-form arguments go out →
the result is announced → save again → the second call carries the version the first one wrote.
Plus the refusal arms: `invalid_values` on a field's own note (and it clears on retype),
`empty_customization`, a transport throw leaving the button pressable, and choosing a different
workflow clearing the previous one's refusal and values.

**Dependency added: `jsdom` (one, an `apps/web` devDependency).** No testing-library — `react` and
`react-dom` were already here, and React 19 ships `act`. It is opted into PER FILE with a
`// @vitest-environment jsdom` docblock, so every other `apps/web` test still runs in node.
`apps/web/vitest.config.mts` named jsdom as the upgrade path for exactly this case; its now-false
"there is no jsdom … so React components still cannot be rendered here" comment is corrected in the
same commit. `pnpm-lock.yaml` moves: jsdom's tree, plus pnpm rewriting the vitest peer key
(`vitest@3.2.7(…)(jsdom@27.4.0)`) in every workspace. `packages/core` was re-run whole afterwards
(45 files / 1457, unchanged) to check that rewrite broke nothing.

### 2. The optimistic-concurrency refusal could not fire. Now it can.

`submit()` read `selected.myBaseVersion` off the LIVE reactive `listPacks` query at save time while
the form's contents were snapshotted at open time by `choose()`. A concurrent publish moved the
token without moving the data it describes: the save carried the OTHER draft's version, the server
accepted it as current, and `stale_base_version` — the guard that exists for this exact race —
became unreachable for the container path. Silent last-write-wins, which is the failure
`publishPackCustomization`'s own docstring calls the version of that failure nobody notices.

The base version is now snapshotted in `choose()` beside `setBaseline(prior)`, passed to the view as
a `baseVersion` prop, and moved only by a save success (together with the baseline) or by
`adoptedBase` on a refusal. **The surface also rendered a false sentence in that state**, naming a
version whose settings were not on the form; `lineageLine` now reads "This edit is based on your
saved version N" — true after a refusal, where "your latest saved version is N" was not — and every
saved-version sentence on the surface reads the frozen prop rather than the live row.

### 3. The build record. Both previous versions of it were wrong.

Neither "the gate cannot run in this worktree at all" nor "it runs, nothing imports `server-only`".
What is true: Next aliases the bare specifier `server-only` — which IS imported, from inside
`@convex-dev/auth`, reached by `middleware.ts` and `app/layout.tsx` — to
`next/dist/compiled/server-only/empty`, a legitimately-shipped 0-byte file that a freshly created
git worktree's `pnpm install --frozen-lockfile` may not materialise. The main tree has it and CI
builds. The repair is one line in `node_modules`, committed nowhere:

```
: > "$(readlink -f apps/web/node_modules/next)/dist/compiled/server-only/empty.js"
```

That is now in `docs/playbooks/workflow-packs.md` under *How to verify*, where an operator hitting
the failure will look, together with the two fixes that do NOT work (declaring `server-only` in
`apps/web/package.json`; a `packageExtensions` entry on `@convex-dev/auth`). The file was already
present and 0 bytes in this worktree when this round started, and `pnpm --filter @pikar/web add -D
jsdom` did not remove it. Nothing was committed for any of this.

### 4. The §9 violation is repaired.

The previous round's code commit (`27b5248`) changed two files under `workflow-packs.md`'s watched
path prefix without touching the playbook — its playbook commit landed BEFORE its code commit, and
the Stop hook only inspects the working tree, so nothing could see it. This round's playbook update
is in the same commit as its code, and the stale `apps/web 97/97` (a FILE count recorded under a
PACKAGE label, and already stale when written) is retracted in the 29-07-FIX block.

### 5. The false absolutes are deleted, not narrowed.

- `WorkflowPackCustomizer.tsx:35` — "Nothing below is exported for a test to call directly", which
  the same commit falsified by exporting `prefillFrom` 532 lines below it. Deleted.
- `WorkflowPackCustomizer.test.ts:9` — "there is nothing here to call instead of rendering", and
  the "no jsdom, so there is no click and no typing here" paragraph. Both replaced with what the
  file does and does not prove.
- `test("no copy function is exported …")` retitled to
  `"none of the eleven copy functions this surface has is exported"` — its body scans a literal list
  of eleven names, so it catches a rename or a deletion of any of them and cannot see a twelfth
  added tomorrow. The title now says that.
- The three-`toContain` container scan is deleted; a comment points at the interaction test.

## Mutations observed RED (all reverted; the tree was re-measured at 121/121 afterwards)

Run: `cd apps/web && pnpm vitest run WorkflowPackCustomizer` (121 tests across the two files).

| # | Mutation | Result |
|---|---|---|
| X1 | `onChoose={choose}` → `onChoose={() => {}}` | 11 failed / 110 passed |
| X2 | `onSubmit={() => void submit()}` → `() => {}` | 8 failed / 113 passed |
| X3 | `onSet={setValue}` → `onSet={() => {}}` | 5 failed / 116 passed |
| X4 | delete `setBaseline(values)` from the success arm | 1 failed / 120 passed |
| X5 | delete `setBaseVersion(res.version)` from the success arm | 2 failed / 119 passed |
| X6 | send `selected.myBaseVersion` (live) instead of the snapshot | 2 failed / 119 passed |
| X7 | delete `setBaseVersion(pack?.myBaseVersion ?? null)` from `choose()` | 3 failed / 118 passed |
| X8 | delete the `stale_base_version` → `setAdoptedBase` line | 2 failed / 119 passed |

X1–X4 are the exact four the verifier reported green at 109/109. X6 is the concurrency defect
itself: with it applied, the first save carries the other tab's version 7, the server accepts it,
and the refusal the test asserts never happens.

One more, on the file I own but did not change:
`packages/backend/convex/workflowPackDiscovery.ts`, `myBaseVersion: newestMine?.version ?? null` →
`myBaseVersion: null` → 3 of 12 RED. Reverted. That is the evidence behind "no change needed
there": the defect was entirely client-side, and the server's per-name base-version resolution is
already pinned.

## Gates run

| Gate | Result |
|---|---|
| `cd apps/web && pnpm vitest run WorkflowPackCustomizer` | 2 files / **121 passed** (109 SSR + 12 container) |
| `cd apps/web && pnpm vitest run` | 38 files / **762 passed** |
| `cd apps/web && pnpm typecheck` | clean |
| `cd packages/backend && pnpm vitest run workflowPackDiscovery` | **12/12** |
| `cd packages/core && pnpm vitest run` | 45 files / **1457 passed** |
| `npx biome check apps/web/app/(app)/dashboard/workflows/` | clean |
| `pnpm --filter @pikar/web build` | **EXIT=0**, `ƒ /dashboard/workflows` in the route table |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | stdout empty (no `"decision":"block"`) |

**The `apps/web` package total of 762 is not comparable to the 749 the verifier measured**: two
sibling agents have uncommitted work in this worktree (`KnowledgeSearchPanel.{tsx,test.ts}`,
`packages/core/src/knowledgeSearch.ts`, and R2-TAIL's backend files). Trust the two FILE counts —
109 and 12 — which are entirely mine. The whole-package number will move again when the siblings
commit.

## NOT CLOSED — say it plainly

- **The authenticated browser gate for `/dashboard/workflows` is still UNRUN.** There is no
  Playwright spec for this route (`apps/web/e2e/` has no `workflows.spec.ts`) and this round did not
  write one — it was not in this round's instructions, and a live run is out of scope here anyway
  (it needs a live Convex deployment, a seeded E2E user and real credentials, and it spends money).
  **jsdom is not a browser**: no layout, no paint, no real focus ring, no CSS. Every accessibility
  claim on this surface that depends on painted geometry is still unverified, and the route is
  deliberately still out of the nav for that reason.
- **A published pack customization remains inert in production.** `planTenantActivation` refuses
  every `pack-*` name (`PACK_GATE`), and `cockpit.ts` — the only caller of `runWorkflowPack` —
  passes `skillVersions` only, never `tenantSkillIds`. The surface says both, and a test reads
  `cockpit.ts` to keep the second sentence true. Unchanged by this round.
- **The stale-base retry replaces settings the user never saw.** After adopting the server's newer
  version, pressing save again writes the whole set from this form, so the other draft's fields are
  replaced. That is what the copy says ("Saving replaces all of them with what is on this form")
  and it is informed last-write-wins, not a merge. A real merge is a product decision, not a fix.
- **`packages/backend/convex/gmail.ts:263,370` — handed off, not fixed.** Two offline-fixture paths
  are selected by a tenant-supplied payload (`name.startsWith("SMOKE::")`, reached from `llm.ts`'s
  `resolveContacts` tool with the model's free text) rather than by the deployment fact
  `offlineSeamAvailable()` uses. Pre-existing, outside this lane's ownership, bounded impact (two
  example.com records and a deterministic throw, no privilege, no tenant crossing). It belongs to
  whoever owns `gmail.ts`.
- **`graphify update .` was NOT run.** `graphify-out/*` is already dirty from another process in
  this shared worktree and is excluded from commits; a concurrent rebuild would churn or corrupt it.
  A SessionStart hook re-runs it.

## Files touched outside the ownership list

Both are unclaimed by any sibling (`packages/backend/vitest.config.mts` is R2-TAIL's;
`apps/web/vitest.config.mts` is not):

- `apps/web/package.json`, `pnpm-lock.yaml` — the `jsdom` devDependency.
- `apps/web/vitest.config.mts` — comment only. Its "there is no jsdom" paragraph became false the
  moment jsdom was added, and leaving it would have been the exact finding class this round exists
  to close.
- `.planning/…/29-07-FIX-SUMMARY.md:27` — one wrong line citation corrected
  (`run-workflow-pack-evals.mjs:1329` → `:1335`, where `function seedCase` actually is; 1329 is a
  blank line). The substantive claim on that line was already correct.
