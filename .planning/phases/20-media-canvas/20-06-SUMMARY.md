# 20-06 — SUMMARY

**Plan:** the authenticated callback and the landing plane. **Status: complete, UNCOMMITTED**
(shared tree — see `## Committing`). Cost to build: **$0** — every callback body is synthesized
locally and every asset download is a spy.

## What shipped

| File | What changed |
|---|---|
| `packages/backend/convex/mediaComplete.ts` | **NEW.** `resolveJob` (the HMAC gate) + `landResult` (verdict, kind-aware reconciliation, the one audit line) + `EXACT_SPEND_KINDS` |
| `packages/backend/convex/http.ts` | a FOURTH route: `POST /fal/callback/*` — the timestamp window, the segment split, `ASSET_PATH`, the SSRF gate, the download, the discard |
| `packages/backend/convex/lib/hash.ts` | `contentHash` widened to `string \| BufferSource` |
| `packages/backend/convex/media.test.ts` | 59 → **76 tests** |
| `packages/backend/convex/llmRedaction.test.ts` | 44 → **50 tests** (the six §4 scans) |
| `docs/playbooks/media.md` | `## The landing plane (20-06)` + `Last verified` |
| `docs/playbooks/cockpit.md` | `Last verified` — `http.ts` is a watched path |

Verification: full backend **991/991 across 56 files** (was 967); backend `tsc --noEmit` **13 — the
pre-existing baseline, delta 0**, none in any file this plan touched; `biome check` **delta 0 on all
five source files** (baselined via `git show HEAD:<path>` → throwaway sibling → count → delete).
All four mutation checks observed RED and restored.

## THE WEBHOOK URL — it matches 20-05 character for character

```
${CONVEX_SITE_URL}/fal/callback/${jobId}.${hmacHex(jobId, FAL_WEBHOOK_SECRET)}
```

`resolveJob` recovers the jobId with **`lastIndexOf(".")`**, exactly as 20-05-SUMMARY.md specified
and as `gmailAuth.verifyState:66` does. **No `callbackHash` is stored** — the digest is re-derived,
so there is nothing to leak or drift.

## The exact audit allow-list AS SHIPPED, and the PINNED site count

```
jobId, batchId, planId, falRequestId, kind, model, resolution, promptHash,
assetHash, verdict, estCents, actualCents, reconciled, failureReason
```

`eventType: "media.landed"`, `actor: "fal"`, `correlationId: batchId`. **Audit-site count is PINNED
at 1** (`media.ts` = 0, `mediaComplete.ts` = 1). **Plans 20-09, 20-14, 20-16 and 20-17 each add
sites and must each bump that literal deliberately** — the assertion message names all four.

Two deliberate differences from the plan's list, both in `MEDIA_AUDIT_ALLOWED`:

- **`lineCount` is OUT.** A per-row terminal has no line count without a batch scan, and `batchId`
  is already the join key that recovers it. A number that means nothing at the site it is emitted
  from is not a ref, it is noise.
- **`reconciled` and `failureReason` are IN.** `reconciled` is what makes the `EXACT_SPEND_KINDS`
  skip **observable** (see the mutation-check correction below) — without it the guard is untestable
  and would rot. `failureReason` is already constrained to a CODE by the submit adapter's contract,
  and a failed landing that says nothing about why is a log line with no value.

## `ASSET_PATH` and `EXACT_SPEND_KINDS` — 20-14 and 20-17 each add an arm

```ts
// http.ts — keyed on the ROW's kind, never on the payload's shape.
const ASSET_PATH = {
  video: (p) => p.video?.url,
  image: (p) => p.images?.[0]?.url,
};                                    // 20-14 adds `tts: (p) => p.audio?.url`
// mediaComplete.ts
const EXACT_SPEND_KINDS = new Set(["tts", "stt"]);   // already contains both; 20-14/20-17 add NOTHING here
```

An unhandled kind lands `failureReason: "unhandled_kind"` with **zero fetches** — a test drives a
`tts` row with a body that deliberately *does* carry a findable `audio.url` and asserts nothing was
downloaded. **`EXACT_SPEND_KINDS` is already correct for both future kinds**, so 20-14 and 20-17
each touch one line of `ASSET_PATH` and no part of the security half.

## THE TERMINAL-WRITER PIN — the corrected version, and why

Research's SC2 line says *"the webhook is the ONLY writer of `succeeded`/`failed`/`blocked`."*
**That is not achievable and not desirable.** A 422 `content_policy_violation` is **synchronous at
submit** and produces no webhook at all, so `media.ts` must be able to write `blocked`/`failed`.

The honest pin, scanned across the whole `convex/` tree (every module that mentions `mediaJobs`):

- terminal writers == **exactly `{media.ts, mediaComplete.ts}`**
- `status: "succeeded"` == **`mediaComplete.ts` alone**

**Note for plan 20-16:** the render terminal writes `plans.renderStatus`, **not**
`mediaJobs.status`, so it does not widen this set. If it ever needs to, that is a deliberate edit to
the scan.

## Deliberate deviations from the plan — read these before writing a dependent plan

1. **`pathPrefix`, not a glob.** The plan wrote `path: "/fal/callback/*"`. Convex's router has **no
   `*` syntax** — that route would have matched literally nothing. Shipped as
   `pathPrefix: "/fal/callback/"`.
2. **THE `!secret` GUARD LIVES IN `resolveJob`, NOT AT THE ROUTE — and the plan's own mutation check
   is why.** The plan put a fail-closed `if (!secret) return 401` at the route AND had `resolveJob`
   re-derive independently. With both, deleting the route's guard changes nothing (the query still
   refuses), so *"drop the `!secret` guard — the unset-env 401 test must go RED"* would have been
   **vacuous**. One guard, at the place the comparison actually happens, and the mutation check
   fires. Root cause over symptom.
3. **THE `EXACT_SPEND_KINDS` MUTATION CHECK CANNOT BE WINDOW-BASED. Corrected, and re-run.** The
   plan asked: *"remove `tts` from `EXACT_SPEND_KINDS` — the zero-window-delta assertion must go
   RED (the landing would re-price from a duration the provider never sent)."* It cannot: because
   the provider sends nothing, a re-price falls back to the SUBMITTED spec, so `actual == est` and
   **the window still does not move**. The distinction the set actually draws is *skipped* vs
   *failed-to-guess*, so the observable had to be the `reconciled` enum. Observed with `tts`
   removed: `expected 'reprice_failed' to be 'exact_by_construction'` — the landing was guessing,
   which is precisely what the set exists to prevent, and the check now fires.
4. **No `audio: false`-style guessing at the asset URL either — an SSRF gate the plan did not ask
   for.** The plan says the URL is "validated" without saying how. Shipped: **https only**, host
   must be `fal.media`/`fal.ai`/`fal.run` or a subdomain (suffix match on `.${host}`, so
   `fal.media.evil.com` is refused), and a **32 MiB** download ceiling. Without this the route is an
   SSRF into whatever the caller names, and the caller only had to know one job's digest. Four
   hostile URLs are asserted, including the cloud metadata endpoint and `file://`.
5. **`contentHash` widened to `string | BufferSource`** (`lib/hash.ts`, not in the plan's
   `files_modified`). A landed asset needs a hash over its BYTES, and a second three-line SHA-256 is
   exactly the duplication that module exists to prevent. **`BufferSource`, not `Uint8Array`** — a
   bare `Uint8Array` is `Uint8Array<ArrayBufferLike>` under TS 5.7+ and may be
   SharedArrayBuffer-backed, which `crypto.subtle.digest` rejects; that cost one real typecheck
   error before it was right. Every shipped string caller is byte-identical.
6. **`resolutionRef(...)` is HOISTED out of the audit payload literal.** Its call argument contained
   a comma, which would have forced `llmRedaction.test.ts`'s allow-list scan to be a depth-tracking
   parser instead of a comma split. **The code bends to keep the guard cheap, not the other way
   round** — and the scan's own comment says that if this stops being true, the fix is to hoist,
   not to grow the parser.
7. **Two failure codes the plan did not name:** `asset_empty` and `no_request_id`'s sibling
   `no_asset_url` — a 200 whose payload carries no URL at the row's kind path. Both would otherwise
   be lines that land `succeeded` with zero bytes.
8. **`media.test.ts`'s harness now registers `auditCounts`.** `audit.log` mirrors every insert into
   the aggregate, so the landing tests cannot run without it (the `calendar.test.ts` pair of lines).

## The four mutation checks — every one observed, then restored

| mutation | what fired |
|---|---|
| `url: "https://v3.fal.media/x.mp4"` added to the landing payload | **2 scans RED** — *"carries a non-allow-list key `url`"* AND *"names a URL"* |
| the no-moderation video yields `checker_clear` | `- "verdict": "none_reported"` — the honest-verdict test |
| `if (!secret) return null` deleted from `resolveJob` | *"an UNSET FAL_WEBHOOK_SECRET is 401"* RED |
| `"tts"` removed from `EXACT_SPEND_KINDS` | `expected 'reprice_failed' to be 'exact_by_construction'` |

Restored after each; `tsc` back to 13, media 76/76, llmRedaction 50/50.

## Committing — the tree is still shared

`ls .git/MERGE_HEAD` → absent. **Six files are entirely this plan's** and commit safely by pathspec:

```
packages/backend/convex/mediaComplete.ts      (new — already registered in watch.json line 167)
packages/backend/convex/http.ts
packages/backend/convex/lib/hash.ts
packages/backend/convex/llmRedaction.test.ts
packages/backend/convex/media.test.ts         (also carries 20-05)
docs/playbooks/media.md                       (also carries 20-05)
```

**Two files still carry a FOREIGN lane's uncommitted hunks** and must NOT be pathspec-committed —
both inherited from 20-05, see that summary for the hunk-select recipe:
`packages/backend/convex/gmailAuth.ts` and `docs/playbooks/cockpit.md`.
**`git stash` remains BANNED in this tree.**

## Three things a later plan must know

1. **⚠️ THE ABSENT-TIMESTAMP REFUSAL RESTS ON AN UNVERIFIED ASSUMPTION.** The route requires
   `x-fal-webhook-timestamp` and 401s without it. Research §1.2 is only MEDIUM-HIGH that fal sends
   it on every delivery. If it does not, **every callback 401s** — loudly, not silently.
   **Plan 20-11's owner-run live gate is where that is confirmed**, and it is the FIRST thing to
   check if live clips submit fine and never land.
2. **Scan 6 is the tripwire plan 20-17 must not break.** `storage.getUrl` is asserted to be reachable
   only inside a `tenantQuery` (today: `plans.ts` twice, both `tenantQuery`). Handing fal a
   `ctx.storage.getUrl()` result as the STT `audio_url` would give a third party a bearer capability
   to a tenant's asset. If 20-17 needs the bytes at a provider, it **uploads** them.
3. **`check-playbooks.mjs` still reports `block` for `docs/playbooks/onboarding.md`**, against the
   *profile* lane's uncommitted work (now `BlueprintDiff.tsx` / `BlueprintPanel.tsx` /
   `NarrativePanel.tsx` / `ShapePanel.tsx` / `page.tsx` — the file list moves as that lane works).
   **Foreign, deliberately not bumped, OWNER DECISION 2026-08-02** — the same standing call recorded
   in 20-05-SUMMARY.md, including why the hook has no acknowledge-without-touching path. This plan's
   two playbooks are not in the demand list, so its §9 obligation is discharged.
</content>
