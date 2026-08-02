# ADR-013: The render worker is an ephemeral Vercel Sandbox driven from `apps/web` — and no Vercel access token exists anywhere in the system

- **Status**: Accepted (2026-08-03 — Phase 20, MEDIA-01; owner decision, D9 + D11)
- **Recorded**: 2026-08-03 (plan 20-11, after the runner shipped in plan 20-15)
- **Relates to**: [ADR-012](012-media-route-and-the-reel.md) (the reel is the deliverable — this ADR
  is how the last stage of its spine runs), [ADR-011](011-media-provider-fal-wan25.md) (whose
  *"an API key in a deployment secret is the whole auth story"* property this ADR exists to preserve)

## Why this is a SEPARATE ADR from ADR-012

Ponytail favours fewer files, and this is the exception the rule names. D8 (what the product is) and
D9/D11 (how it is rendered) are **two decisions with two different alternatives-rejected sections**,
and ADRs are immutable — **a grab-bag ADR cannot be partially superseded later.** If the renderer is
ever replaced, ADR-013 is superseded and ADR-012 stands untouched. That is worth one file.

## Context

**Convex cannot encode video.** The assemble stage runs `assemble_final.sh`, which needs `ffmpeg`,
`ffprobe`, `awk` and a POSIX shell. A Convex action has none of them, and no amount of TypeScript
closes that gap.

So the reel needs a compute plane that this codebase did not previously have — the first such
requirement in the project's history. Everything below follows from refusing to let that requirement
drag in a new vendor, a new always-on cost, or a credential more powerful than anything the system
already holds.

## Decision 1 — Vercel Sandbox (ephemeral Firecracker microVMs)

Zero new vendors, zero always-on cost, and the harvested bash runs near-verbatim. A post-Approve
path starts the sandbox, streams the landed clips and voice takes in, runs the script, and pulls
`final.mp4` + `final.mp4.assembly.json` back into `ctx.storage`.

**Rejected: a persistent Fly / Cloud Run worker.** A whole new deploy target, a new secret plane and
a monthly floor — the first infrastructure outside Vercel + Convex. The render is bursty (2 jobs/day
at D10's cap), which is the worst possible shape for an always-on worker.

**Rejected: `ffmpeg.wasm` in the browser.** Three reasons, and the third is decisive:

1. the tab must stay open for minutes;
2. it OOMs on multi-block 1080p;
3. **assembly would run client-side, where it cannot be audited, and the sidecar would be
   self-reported by the browser rather than produced by a trusted runner.** ADR-012 makes a valid
   sidecar the proof-of-governed-render. A proof the client writes about itself is not one.

## Decision 2 — the runner lives in `apps/web` as a route handler, NOT in Convex (D11)

This is the sharpest point in this ADR, and it is a security decision wearing a plumbing costume.

Vercel Sandbox's recommended auth is **OIDC minted for a Vercel deployment**. A Convex action is not
one. A Convex-hosted runner would therefore need `VERCEL_TOKEN` + `VERCEL_TEAM_ID` +
`VERCEL_PROJECT_ID` as Convex deployment secrets — and **a Vercel personal access token is scoped to
a TEAM, not to a capability.** It can deploy, delete projects, and read every project environment
variable.

That is strictly more powerful than anything this codebase holds, and it would falsify ADR-011's
cleanest property — *"an API key in a deployment secret is the whole auth story"* — which is true of
`FAL_KEY` **precisely because `FAL_KEY` can only generate media**. A team-scoped PAT sitting beside
it would quietly make that sentence false for the whole system, not just for the render path.

**Decision: the runner is `apps/web/app/api/media/render/route.ts`, where OIDC is automatic and NO
Vercel access token exists anywhere in the system.** A Convex action calls it with a shared bearer
secret. The property is **asserted repo-wide**, not described: plan 20-15 ships a scan, and planting
`process.env.VERCEL_TOKEN` in the route was **observed to turn it red**. The bake script needs no
PAT either — `getCredentials` resolves `VERCEL_OIDC_TOKEN` via `@vercel/oidc`, and its own error
text names `vercel link` + `vercel env pull` as the local path.

The route reuses the shipped `/skillopt/export` bearer pattern (`http.ts:84-97`) run in the opposite
direction, **including its fail-closed `!expected` half** — the guard that refuses when the secret is
*unset*, not merely wrong.

### The cost, stated rather than glossed

- **One HTTP hop** and **one shared bearer secret** (`MEDIA_RENDER_SECRET`, set on both sides).
- **The Vercel function's max duration replaces Convex's 10-minute action limit as the binding
  ceiling.** This is a real regression in headroom and is the number D11 moved.

**Settled at plan 20-15's blocking checkpoint, 2026-08-02:**

| | |
|---|---|
| Vercel plan tier | **Pro** |
| Route `maxDuration` | **300 s** |
| Sandbox `timeout` | **240 s** — strictly below, 60 s teardown margin |
| Headroom | ~2× over the modelled 60–150 s render |

On **Hobby** the default would be 60 s, which does *not* fit the render at all. The sandbox timeout
is strictly below the route's so the VM is stopped by our own `finally` rather than orphaned by the
function being killed mid-cleanup; `buildSandboxOptions` **clamps** rather than trusting its caller,
so the invariant belongs to the builder and holds for every call site at once. Next.js reads route
segment config by static analysis, so the route cannot import the constant — a scan pins the literal
to `RENDER_MAX_DURATION_S` instead, and that scan is the drift guard the import would have been.

**Rejected alternative, recorded because a future reader will re-derive it:** a dedicated
render-only Vercel team holding the token, so the PAT's blast radius is a team with nothing in it.
Lazier by one hop — but it adds three secrets and a team-wide credential to avoid one route file,
and "a team with nothing in it" is a property maintained by discipline rather than by construction.
Not worth it.

## Decision 3 — two STRUCTURAL invariants, recorded as decisions

Both are cross-tenant leak vectors, both are closed by an infrastructure *option* rather than by
code, and a test has been **observed to fail when each is deleted**. They are stated here as
decisions so relaxing either requires a superseding ADR rather than a judgement call in a diff.

| Option | Why it is mandatory |
|---|---|
| **`persistent: false` on every `Sandbox.create`, and never a `name`** | **The SDK default is `true`** — vendor README, read at source: *"Sandboxes are persistent by default."* Left unset, the filesystem is snapshotted on stop and restored on the next resume, so tenant A's clips, voice takes and `final.mp4` survive into the VM that renders tenant B's reel. **A cross-tenant data leak created by an unset option, not by a bug.** `name` is never passed either: a named sandbox is resumable *by name*, which is the persistence mechanism itself. The test asserts `"name" in opts === false`, not `opts.name === undefined` — an explicit `name: undefined` would pass the weaker check and still hand the SDK the key. |
| **`networkPolicy: "deny-all"`** | The VM holds tenant media and must not be able to send it anywhere, even if the script were compromised. This is also **why ffmpeg is baked into a snapshot rather than downloaded per invocation** — deny-all and a per-invocation download are mutually exclusive, and the snapshot is that tension's resolution. |

Both are assertable at $0 **because `buildSandboxOptions` is a pure function rather than an inline
literal** inside `Sandbox.create({...})`. A literal could only be tested by booting a real VM. A
scan pins the route to calling `Sandbox.create(options)` and never `Sandbox.create({`, and asserts
that `Sandbox.create` appears exactly twice in the repo — the route and the owner-run bake script.

## Decision 4 — the sandbox is a trust boundary in BOTH directions

**Nothing sensitive crosses in.** No API key, no fal URL, no Convex signed storage read-URL, and no
`tenantId`. The VM receives block/voice bytes under index-derived filenames
(`block01.mp4` / `voice01.wav`, 1-based, zero-padded), the script, and nothing else. From plan
20-17, narration also crosses in — as the escaped `.ass` caption track, which is what burning
captions means; that is the one addition, and it was made deliberately.

The tenant boundary is **upstream**, in `batchToRender`'s tenant-prefixed `by_batch` index — not in
the route. The route is handed a job id it did not choose, and the only honest guarantee it makes is
that it invents nothing. Both the code comment and the playbook say so in those words, because the
plausible-sounding alternative ("the route reads `tenantId` from the row") describes no mechanism.

**Nothing that comes back is trusted.** The return passes `validateRenderReturn` (magic-byte and
size checks) and `parseAssemblySidecar` (a strict validator over eleven distinct refusal codes)
before anything is published. **A render without a valid sidecar publishes nothing** — the reel is
all-or-nothing. The `overrun: false` field is written by our script *by construction* (an overrunning
line exits 1 before the sidecar exists) and validated anyway, **so that a sidecar which did not come
from this script has to lie explicitly** and the validator's refusal has something to refuse.

ffmpeg's `stderr` never reaches a row, a log or a dead letter: it echoes back the content it choked
on, including the caption track. Failures become codes, never provider or tool prose.

## Decision 5 — the assemble script is CODE, not a `skills` registry row

CLAUDE.md §5 governs **prompts**: no hardcoded agent prompts, everything through the versioned
registry. It would be a natural-looking mistake to file `assemble_final.sh` under that rule.

**A runtime-mutable shell script executed in a VM holding tenant media is remote code execution.**
The script is a committed repo file with a byte-identical TS mirror for the bundler, and a scan
refuses it (and `burn_caps.sh`, on identical terms) as a registry row. The mutation — adding
`{ name: "assemble", body: assembleScriptBody }` to `skills.ts` — was observed to fire the scan.

The script is **harvested, not cloned**: its contract came from the Higgsfield
`faceless-channel-video` workflow v2.0, read once through the MCP and re-authored here. There is no
submodule, no vendored repo, and no reference to that MCP anywhere in shipped code — it is
unreachable from both a Convex action and a Vercel Sandbox, which is the finding ADR-011 exists to
record.

## Decision 6 — the tier's failure mode is a decision, not trivia

**On the Hobby tier, exhausting the free Sandbox allotment PAUSES creation for 30 days rather than
charging.** The render stage stops working mid-month with **no invoice to notice** — a monitoring
blind spot with no cost signal attached, which is a worse operational shape than a bill.

**This project is on Pro** (Decision 2), so it is not currently exposed. It is recorded anyway
because a downgrade re-exposes it silently, and because the mitigation is a design rule that holds
either way: **`MEDIA_SANDBOX_FIXTURE` is the DEFAULT in every test**, and no test may create a real
sandbox. D10 permits ~60 renders/month against ≈150 of Hobby allotment — comfortable, until a retry
storm or one accidental real-sandbox test eats the headroom.

## Consequences

- **The binding duration ceiling is now a Vercel number, not a Convex one**, and it must be recorded
  in `docs/playbooks/media.md` whenever the tier changes. A tier change is a governance event.
- **`@vercel/sandbox` is installed in `apps/web` ONLY.** Under pnpm's isolated linker it is
  materialised nowhere else, which is why the bake script lives at
  `apps/web/scripts/bake-sandbox-snapshot.mjs` rather than under `packages/backend/`.
- **The route's BODY lives in `@pikar/core`** (`handleRenderRequest(req, deps)`); `route.ts` is a
  ~50-line adapter. This is CLAUDE.md §1, and it is the only way *"a bad bearer creates NO sandbox"*
  is testable — `apps/web` has no unit-test runner, and a real `Sandbox.create` would charge.
- **A second ffmpeg pass costs nothing to add** (captions, plan 20-17): `dejavu-sans-fonts` and a
  **libass-enabled** ffmpeg are already baked, and the bake **fails** if libass is missing.
- **`MEDIA_SANDBOX_SNAPSHOT_ID` is operational state**, not config: it is produced by an owner-run
  bake and its id + bake date belong in the playbook.
- **Replacing the renderer supersedes this ADR and leaves ADR-012 standing.** That separation is the
  entire reason this is its own file.
