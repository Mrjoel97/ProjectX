# 20-15 — SUMMARY

**Plan:** the renderer — a Next.js route handler that starts an ephemeral Vercel Sandbox, runs
`assemble_final.sh` over the landed clips and voice takes, and returns a validated `final.mp4` plus
its sidecar, **with no Vercel access token existing anywhere in the system**.

**Status: implementation complete, NOT live-verified** (2026-08-02). **Cost: $0** — no sandbox has
ever been created, by a test or otherwise.

## Task 1 — the checkpoint, SETTLED

| | |
|---|---|
| **Vercel plan tier** | **Pro** (owner, 2026-08-02) |
| **Route `maxDuration`** | **300 s** — `RENDER_MAX_DURATION_S`, and a literal in `route.ts` |
| **Sandbox `timeout`** | **240 s** — `RENDER_SANDBOX_TIMEOUT_MS`, strictly below, 60 s teardown margin |
| **Headroom** | ~2× over the modelled 60–150 s render |

Selected `proceed-fits`. Both numbers are recorded in `docs/playbooks/media.md` beside the
dependency section, which is the plan-tier record delta pitfall 18 requires.

`buildSandboxOptions` **CLAMPS** rather than trusting its caller (`Math.min`), so the
strictly-below invariant is the builder's and holds for every call site at once.

## What was verified from the PRIMARY SOURCE, not from docs

`@vercel/sandbox@2.9.2` was installed into `apps/web` and its own `.d.ts` + README read directly.
Every line of the plan's SDK snippet checks out, and one claim was confirmed that the whole design
rests on:

> **vendor README: *"Sandboxes are persistent by default."*** — delta pitfall 14 is correct, and
> `persistent: false` is genuinely load-bearing rather than defensive.

Also confirmed at source: `source: { type: "snapshot", snapshotId }` is a real union branch;
`timeout` is **milliseconds**; `networkPolicy` accepts the literal `"deny-all"`;
`readFileToBuffer` returns `Promise<Buffer | null>`; `runCommand` returns `{ exitCode, stdout(),
stderr() }` with **`stderr()` a function**; `snapshot({ expiration: 0 })` exists and stops the
sandbox as part of the process; `getCredentials` resolves `VERCEL_OIDC_TOKEN` via `@vercel/oidc`
and its own error text names `vercel link` + `vercel env pull` as the local path — so the bake
script needs no personal access token either.

## The request/response shapes — 20-16 and 20-17 are written against these

**Convex → route** (`POST ${MEDIA_RENDER_URL}`, `Authorization: Bearer ${MEDIA_RENDER_SECRET}`):

```jsonc
{
  "renderId":    "<batchId>",        // correlation only, never a security input
  "blockCount":  6,
  "clipSeconds": 10,                 // 5 | 10, the closed set
  "inputs":      [{ "name": "block01.mp4", "jobId": "<mediaJobs id>" }, …],
  "uploadUrls":  { "mp4": "<convex upload url>", "sidecar": "<convex upload url>" }
}
```

**Route → Convex**, always HTTP 200 (a governed stop is a value, not a transport failure):

```jsonc
{ "ok": true,  "mp4StorageId": "…", "sidecarStorageId": "…", "renderMs": 91000,
  "gates": ["…"], "blockCount": 6 }
{ "ok": false, "code": "<RenderReasonCode | RenderRunnerCode | RenderReturnError.code>" }
```

**Blob route:** `GET {convexSiteOrigin}/media/blob/{jobId}` with the same bearer → the asset bytes
with the ROW's own MIME type, or 401/404.

**`inputs[].name` is `block01.mp4` / `voice01.wav` — 1-based, zero-padded to two digits.** The
plan's own interfaces snippet wrote `block-01.mp4` with a hyphen, which the script would never
find. `renderInputName` is the single source of that mapping.

## Deviations from the plan, recorded

1. **The bake script is at `apps/web/scripts/bake-sandbox-snapshot.mjs`, not
   `packages/backend/scripts/`.** The plan asked for both "`@vercel/sandbox` in `apps/web` ONLY"
   and "the bake script in `packages/backend/scripts/`", and under pnpm's default isolated linker
   those are incompatible: the package is materialised at `apps/web/node_modules/@vercel/sandbox`
   and nowhere else (verified — no `packages/backend/node_modules/@vercel`, no root one), so the
   import cannot resolve from `packages/backend/`. `vercel link` also points at `apps/web`, which
   is where `vercel env pull` writes the OIDC token. **`watch.json` already registered
   `apps/web/scripts/bake-sandbox-snapshot.mjs`** — the registration and this placement agree.
   Added `pnpm --filter @pikar/web bake:sandbox`.

2. **The route's BODY lives in `@pikar/core` as `handleRenderRequest(req, deps)`; `route.ts` is a
   ~50-line adapter.** This is CLAUDE.md §1, and it is the only way the plan's own Task 3
   assertions are testable: `apps/web` has no unit-test runner, and "a bad bearer creates NO
   sandbox" is a statement about control flow that Playwright cannot make and a real
   `Sandbox.create` would charge for. With the SDK injected, all of it runs at $0. The adapter also
   does the `Buffer` ↔ `Uint8Array` conversion, which keeps `packages/core` Node-free.

3. **`maxDuration` is a LITERAL plus a scan, not an import.** Next.js reads route segment config by
   static analysis at build time, so `export const maxDuration = RENDER_MAX_DURATION_S` does not
   resolve. `llmRedaction.test.ts` asserts the literal still equals the exported constant and that
   the sandbox timeout is strictly below it — the drift guard the import would have been.

4. **No committed stub mp4.** `MEDIA_SANDBOX_FIXTURE` carries the route's JSON *response*, so the
   Convex side never needs mp4 bytes; the return-validation matrix is asserted in `@pikar/core`
   against in-memory buffers. One less binary in git for the same coverage.

5. **A THIRD env var, `MEDIA_RENDER_URL`** (Convex side), which the plan's `user_setup` did not
   list but its own Task 3 required. The route reads `NEXT_PUBLIC_CONVEX_URL`, which `apps/web`
   already has — **no new secret**, and both blob and upload origins are derived from it.

6. **`@pikar/backend` gained one export**, `./render/assembleScript`, so the route can write the
   script into the VM. Shipping the script bytes in the HTTP body was rejected: that is executable
   code over the wire, attacker-controllable the moment the bearer leaks.

7. **`requireEnvMedia` is now exported** from `media.ts` (reuse, ladder rung 2) rather than
   duplicated in `renderReel.ts`.

8. **Task 4 item 6 was not actionable as written.** It said to "bump the media audit-site count",
   but the scan's `MEDIA_MODULES` is `["media.ts", "mediaComplete.ts"]` and the render audit lives
   in `render/renderReel.ts` — outside that set, so the pin would have kept passing at 1 while no
   longer covering the thing it was written for. **`render/renderReel.ts` was ADDED to
   `MEDIA_MODULES`**, the count bumped 1 → 2, the payload-literal count 3 → 4, and the site is now
   pinned per-module (`media.ts` 0, `mediaComplete.ts` 1, `renderReel.ts` 1).

9. **The audit payload is `{ batchId, planId, blockCount, renderMs, sidecarHash, gatesPassed }`** —
   the plan named `jobId` and `assetHash`. A render has no single `jobId` (it spans a batch), and
   `assetHash` is not derivable: the mp4 goes VM → upload URL → storage and never passes through
   Convex, so hashing it would mean reading 10 MB back through an action for a log field.
   `gatesPassed` is a COUNT, taken from the re-validated sidecar rather than from what the route
   claimed.

10. **`Sandbox.create` appears TWICE, not once** — the route and the owner-run bake script. The
    scan asserts exactly that pair, and that the route's argument is `buildSandboxOptions(...)`
    and never an inline literal.

11. **No HMAC path segment on the blob route**, unlike `/fal/callback/*`. fal is a third party
    holding no secret of ours, so its segment is the only thing that can authenticate it; here the
    caller already proves knowledge of `MEDIA_RENDER_SECRET` in the header, and an HMAC keyed on
    that same secret is derivable by anyone who has it. Ceremony, not defence.

12. **The plan's phrase "reading `tenantId` from the ROW" describes no mechanism, and the code does
    not pretend otherwise.** The blob route is handed a job id it did not choose; the only honest
    guarantee it makes is that it invents nothing. **The tenant boundary is upstream**, in
    `batchToRender`'s tenant-prefixed `by_batch` index. Both the code comment and the playbook say
    so in those words.

## TWO TESTS WERE VACUOUS AND ONLY RUNNING THE MUTATION FOUND THEM

The plan says *"Observe it; do not assume it."* That earned its place twice:

1. **The route's unset-secret 401.** The first version stubbed the secret to `""` and sent
   `Authorization: "Bearer "`. It passed **with the `!secret` guard deleted** — header values are
   whitespace-trimmed on the way in, so a trailing space is untypeable and the test proved nothing.
   The string that actually reaches the compare is **`Bearer undefined`**, which is exactly the
   fail-open `http.ts:92`'s `!expected` half exists to close. Rewritten to send it (plus
   `Bearer null`, `Bearer`, and the real secret) — then observed RED (200 instead of 401).

2. **The blob route's unset-secret 401**, same defect, same fix: `vi.stubEnv(name, undefined)` and
   not `""`. Then observed RED.

Both notes are recorded at the assertions so the next reader does not re-introduce the weaker form.

## Mutation checks — ALL OBSERVED RED, then restored

| Mutation | Result |
|---|---|
| delete `persistent: false` from `buildSandboxOptions` | RED |
| delete `networkPolicy: "deny-all"` | RED (same run) |
| make `validateRenderReturn` accept `overrun: true` | RED — block-4 fixture flipped to publishable |
| drop the `!secret` half of the route's bearer guard | RED — `Bearer undefined` returned 200 |
| drop the `!expected` half of the blob route's guard | RED — 200 instead of 401 |
| plant `process.env.VERCEL_TOKEN` in `route.ts` | RED — the D11 repo-wide scan fired |

## Verification

- `@pikar/core` **536/536** across 23 files (68 of them this plan's `render.test.ts`); typecheck clean.
- `convex/media.test.ts` **100/100** (18 new); `convex/llmRedaction.test.ts` **56/56** (6 new scans).
- Backend typecheck **13 errors, all in `.test.ts`, ZERO non-test — delta EXACTLY 0** against the
  re-measured 13 baseline. (One `Uint8Array<ArrayBuffer>` slip added +1 and was fixed, not absorbed.)
- `pnpm --filter @pikar/web build` **green**, `/api/media/render` registered as a dynamic route;
  `apps/web` typecheck clean. This is the check vitest cannot do and the plan marked required.
- `node scripts/check-playbooks.mjs` exits **0**.
- `biome check` clean on all five new files (formatted; no pre-existing file was reformatted).
- `graphify update .` + `node scripts/extract-convex-edges.mjs` re-run.

⚠ **The FULL backend suite is FLAKY on this machine, and it is not this plan's doing.** Across five
runs: one was completely green (**56/56 files, 1045 tests**), and the others failed 3–6 tests in
`intake.test.ts` *or* `onboarding.test.ts` — a different file each time, each passing in isolation
(`intake` 10/10 in 6.2 s standalone vs a 20 s timeout under the full run). Reducing concurrency to
`--maxWorkers=3` did not change it, and excluding this plan's two touched test files made it pass —
i.e. it is whole-suite scheduling pressure, not an assertion. **Do not read a red full-suite run as
a 20-15 regression without first running the file alone.**

## STILL OWED — the owner's, and none of it is code

**Nothing here has ever rendered anything.** The numbers in this summary are *settled*, not
*measured*: there is no observed cold-start, no observed render wall-clock, and no snapshot id.

1. `openssl rand -hex 32` → set on BOTH sides: `npx convex env set MEDIA_RENDER_SECRET …` (from
   `packages/backend`) AND as a Vercel Project Environment Variable.
2. `npx convex env set MEDIA_RENDER_URL https://<app>/api/media/render`.
3. `cd apps/web && npx vercel link && npx vercel env pull`, then
   `pnpm --filter @pikar/web bake:sandbox` → set `MEDIA_SANDBOX_SNAPSHOT_ID` on Vercel and record
   the id + bake date in `media.md`.
4. Plan **20-11**'s owner-run live gate is the first real `Sandbox.create` (~$0.02) and the first
   chance to measure cold start and wall clock. Record both back into `media.md`.

## Notes for the plans downstream

- **20-16** calls `internal.render.renderReel.renderReel({ tenantId, batchId })` and gets
  `{ ok, reason? }`. The render terminal (`plans.renderStatus` / `renderStorageId` /
  `sidecarStorageId` / `sidecarHash` / `renderReason` / `renderedAt`) is already written by
  `recordRender` — 20-16 owns retention (deleting the intermediates on success, KEEPING them on
  failure), not the terminal.
- **20-17** adds its second ffmpeg pass behind the same route. `dejavu-sans-fonts` and a
  **`libass`-enabled** ffmpeg are already baked, and the bake FAILS if libass is missing — so a
  caption burn adds nothing to the image. It must not read `stderr()` anywhere; the scan pins that.
- ⚠ **A deck containing a TEXT or SCREEN REC block cannot render at all.** `reserveJobInner`
  creates a video line only `if (isPaidBlock(block))`, so those indices have a voice take and no
  clip, and the assembler requires both. It is refused **free**, as `incomplete_blocks`, before a
  VM exists. Making those blocks renderable (a generated title card) is a **scope decision for the
  canvas (20-09/20-10)**, not a patch in the render path.
- `extract-convex-edges.mjs` reports `render.renderReel` as **unresolved** — the fixup does not
  resolve nested-directory `internal.<dir>.<module>` references, so the blob route's edge to
  `resolveRenderAsset` is missing from the graph. Cosmetic; the graph under-reports one edge.
