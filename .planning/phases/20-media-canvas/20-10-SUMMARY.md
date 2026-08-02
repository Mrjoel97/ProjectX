# 20-10 — SUMMARY

**Plan:** the canvas is SEEN — a media plan renders its art direction, its finished reel, its block
deck with live per-block clip AND voice status, the landed assets, and the five editor affordances,
in the workspace right pane as one more `plan.kind`.

**Status: implementation complete, builds green, NEVER RENDERED IN A BROWSER** (2026-08-03).
**Cost: $0.** Commit `e9bb2c6`.

**Scope note:** this plan shipped with ONE addition the plan did not specify — an **"Open canvas"
toggle** in the workspace header, requested by the owner mid-session. It is recorded here rather
than in a separate plan because it is nine lines of state and one button, and it changes nothing
about the canvas itself.

## Task 1 — the `cards.tsx` branch, kept to its stated size

```ts
if (plan.kind === "media") {
  return <MediaCanvas plan={plan} threadId={threadId} />;
}
```

Beside the `memo` and `calendar_event` branches, carrying the same justifying comment adapted:
everything below is email chrome (recipients, mode, a send-time picker, "Send to N recipients") and
every word of it would be a lie on a storyboard. `hasDraft` now excludes `"media"` exactly as it
excludes `"memo"`, or a DRAFT card prints beside the canvas.

**`PlanCards` was NOT widened.** `CardList`'s trace, `SourceCard` and `EvaluationCard` still render
above the canvas, which is correct.

**One deviation from "keep the diff to two lines":** four style objects (`capsTeal`, `typeBadge`,
`briefingSheet`, `snippetSheet`) gained `export`. **No value changed** — the alternative was
duplicating brand tokens into a second file, which is how two surfaces drift apart. Six words, and
the file is otherwise untouched.

## Task 2 — the canvas

`MediaCanvas.tsx`, a self-querying dumb renderer (the `SourceCard` idiom): `byPlan`, `assetUrls`,
`reel`, `jobEstimate`, taken by the component rather than threaded through props.

**NO POLLING, and this is the rule most at risk from a well-meaning edit.** A clip is 1–3 minutes of
wall clock and the render adds 1–3 more, so the canvas has to stay meaningful through minutes of
nothing arriving — but the mechanism is Convex reactivity, not a ticker. There is no `setInterval`
in this surface and there must never be one.

### The reel region's five states, and the one that is a trap

| State | Copy |
|---|---|
| no `renderStatus` | "No reel has been requested for this plan yet." |
| `pending`, nothing landed | "Not assembled yet. The reel is built after every block's clip and voice have landed." |
| `pending`, **assets landed** | **"The reel is out of date — the blocks have changed since it was assembled."** |
| `rendering` | "Assembling the reel… (usually 1–3 minutes)" |
| `rendered` + url | the `<video>`, plus `N blocks · N seconds · every block's narration fits its window` |
| `rendered`, **no url** | "The render finished but did not produce a valid assembly record, so it was not published." |
| `failed` | the reasonCode in WORDS (`failureText`), never a bare code |

**The out-of-date state is the trap.** 20-09's `clearRender` resets the render fields on every
structural edit, so a stale reel and a never-built one are BOTH `renderStatus: "pending"` and are
indistinguishable from that field alone. **The landed-asset count is the only thing that separates
them**, and saying "not assembled yet" over a deck the user already paid to render is a lie they can
watch.

`rendered` with no url is not a bug: `media.reel` returns a url only when the sidecar validated, so
that combination is a governed refusal to publish and gets its own sentence.

### Two status rows per block, never one

A block is a pipeline of two jobs from two providers whose webhooks land minutes apart. A block
whose voice is ready and whose clip is not MUST look different from the reverse. Both rows use
`.trace-line` inside `aria-live="polite"` — a silent progress surface reproduces the "is it stuck?"
complaint for non-sighted users through exactly the minutes where it matters most.

Wording differs per pipeline on purpose: "Generating…" is wrong for audio, "Recording the
narration…" is wrong for video.

### The verdict copy is a compliance statement

`none_reported` → **"Not checked — this model reports no safety verdict."** Never a green tick.
Every Wan 2.5 video and every voice take lands there, and rendering it as a pass makes a claim fal
never made. Never colour alone, for any of the four verdicts.

## Task 3 — the gate and the five affordances

The Generate button is **`disabled`** until `jobEstimate` resolves — genuinely disabled, not merely
styled that way, because a disabled *look* on a live button is a click that spends money the user was
told it could not. The panel prints all four itemised lines plus the total, the model and resolution
they were priced at, and today's remaining budget.

Every refusal names its lever (`refusalText`), and **the narration refusal's cure — Edit narration
with a live character count against the block's own `maxChars` — is on the tile it names.** The
count turns `--held-text` amber past the limit (`--held-text`, never `--held`, which is a fill token
and fails contrast as text), and **the count itself is the signal** so the state is never carried by
colour alone.

Five affordances, labelled free or paid: edit prompt, edit narration, move up/down (one
`reorderBlocks` call with the whole new order), delete block — free; regenerate this block — paid,
and it says in words that it buys a new clip and voice take AND rebuilds the reel.

**Nothing beyond those five.** No timeline, no transitions, no filters, no layers, no masking, no
music controls, no client-side rendering — D7's ceiling, and the canvas sits exactly at it.

## The 18-07 collision, resolved

18-07's `OutputCard` landed first but is a **thread-scoped self-querying component for created vault
docs, not a reusable card primitive** — there was nothing to import. The tiles reuse its VISUAL
vocabulary instead, including its badge decision: **teal in the FILL, `--ink` for the label**,
because `--teal-600` as small text is ~2.9:1 and BRAND §6 bans it. Do not "restore" teal text there.
There is one Output-card look, implemented twice for two different data sources — not two designs.

## The one legitimate hardcoded colour

The art direction's palette hexes are the CONTENT being displayed, so they are inline styles by
necessity; CLAUDE.md §10 is about product CHROME. Each swatch prints its hex **as text beside it**,
so a colour is never named only by a colour.

## The toggle (owner request, not in the plan)

An "Open canvas" / "Back to workspace" button beside "Clear workspace" swaps the right pane between
`CardList` and `CanvasPane`. **A viewport, not a route:** local state, so the thread, the tab strip
and every in-flight subscription survive the switch — a `<Link>` to a second page would put the
conversation a back-button away. `?view=canvas` is read once from `window.location.search` (the repo
idiom; `useSearchParams` would force a Suspense boundary for a value that never changes after
mount). `aria-pressed` plus a CHANGING LABEL carry the state, never styling alone.

`CanvasPane` self-queries the thread's plan so the toggle stays a boolean that knows nothing about
media, and its empty states are honest: a thread with no media plan says so and says what would
produce one.

## Verification

| Check | Result |
|---|---|
| web `tsc --noEmit` | exit 0 |
| `next build` | green |
| Biome | `MediaCanvas.tsx` clean; `page.tsx` back to its EXACT HEAD baseline (one pre-existing `useExhaustiveDependencies`) |
| `check-playbooks.mjs` | exit 0 (`cockpit.md` + `media.md` bumped) |
| Browser | **NEVER RENDERED** |

## ⚠ What is owed, and why it could not be discharged here

**No human has seen this surface, and no automated check can substitute.** It typechecks and builds;
it has never been rendered against a real media plan — and **it cannot be, because nothing can create
a `plan.kind === "media"` row until 20-12 teaches the agent `dispatchMedia`, which is parked on the
Phase-16 gate.** Every existing thread shows the empty state.

Two ways to close it, both open:
1. Seed one media plan into a local deployment and look at it (dev data, trivially deletable).
2. Land 20-12, then drive it end to end at 20-11's live gate.

Until one happens, treat every visual claim in this summary as **read off the source, not off a
screen**.
