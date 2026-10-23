# Quality follow-up — 2026-10-23

The owner said "proceed and spawn multiple agents" after reviewing the isolated PR83 handoff.
The same branch remains the working boundary. Prior head `7a4e7e0f` passed exact-source CI
run39694182029; the changes below require their own final source checks. This continues partial
53-03, not a completed plan or a change to the primary Phase48→52 order. Phase53 remains0/3.

No provider request, credential read, purchase retry, financial settlement, registry activation,
deployment, main merge or publication is part of this follow-up. Reported shared charges remain
$0.9213768 and the original STT artifact-gate hold remains preserved.

## Readability and workspace changes

The checked caption builder optionally rebalances whole words within each verified narration
take. It retains the greedy cue count and32-character ceiling, first reduces cues shorter than
0.75s, then reduces the fastest reading rate. The bounded search accepts at most128 words per
take; longer inputs retain the existing linear grouping. Unverified legacy callers keep their
original behavior. No word timestamp, take ownership, narration or audio speed is invented.
The app's caption action explicitly opts in.

Actual147-word evidence yields6→3 cues above20characters/second, no cue shorter than0.75s,
and worst reading rate42.50→27.17characters/second. The shortest cue is0.76s. All18 takes
retain exact outer word endpoints. Three narration passages remain inherently too fast for the
target; further improvement needs slower source speech and a separately qualified comparison.
The balancer also avoids introducing cue boundaries through overlapping word ranges, retaining
the prior greedy fallback if no clean partition exists. Fifty-nine focused core tests passed.

The workspace keeps its brand/layout and gains a visible h1, dark teal small labels, current-chat
accessibility state and inline mobile video playback intent. Known image MIME types correct a
misleading image filename suffix without changing downloaded bytes. Existing Office filenames,
valid JPEG aliases and generic/unknown MIME hints remain intact. The browser test's SVG extension
expectation is updated. Twenty-eight focused reader/download/tab tests passed. The first run
found a cross-realm byte-array assertion in the new SVG test and an unchanged worksheet timeout;
byte values are now compared directly, and the worksheet passed unchanged on the repeat run.

An Edge fixture using actual WorkspacePage, SplitPane, ArtifactViewerBody and their CSS passed
at390/1440px: h1, current-chat/New-chat state, computed dark teal text, native controls,
playsInline, decoded playback and no overflow, page errors or external requests. Auth/data hooks
and unrelated children were inert mocks, with fallback fonts; this is component evidence, not
hosted/authenticated/iPhone acceptance. Four screenshots were inspected. The final assertion
report passed, but cleanup awaited handles and required cancellation (CLI exit1); a separate
exit0 TCP-refusal check confirms the owned fixture server closed. The report preserves that
qualification rather than claiming a clean full CLI run. Independent read-only reviews found
no actionable caption/app-opt-in or download-extension issues.

## Audio investigation

Offline measurement of the earlier candidates found30s=-15.94LUFS/-1.48dBTP and
60s=-16.01LUFS/-1.60dBTP, with no full-scale or nonfinite decoded samples. This is numerical
evidence, not listening acceptance. The30s encoded stream is96kHz while60s is48kHz. One30s
AAC packet declares94.667ms rather than the usual10.667ms; raw decoding covers30.016s against
the30.10s container. Monotonic packet timestamps alone do not prove continuous PCM coverage.

The assembler requests linear loudness normalization, which can fall back to dynamic under
[FFmpeg's documented conditions](https://www.ffmpeg.org/ffmpeg-filters.html#loudnorm);
its historical gate unconditionally says linear. The approved narrow repair pins48kHz output and
records the actual normalization mode, retaining legacy sidecar compatibility and the existing
priced video profile. Missing statistics must not be reported as a successful mode. Actual new
exports and focused runtime checks qualify this repair before its source is handed back. The
focused real-FFmpeg finalization fixture passed linear/dynamic (using explicitly simulated
first-pass measurements), intentional-silence mode and absent-statistics refusal. A fake mode
line outside the actual filter JSON block cannot satisfy the verdict. The unchanged full mixed
visual fixture timed out at120s on this host; its timeout was not weakened, and that run is not
a success receipt. Actual new exports and current-source CI are recorded below; the long
mixed-visual fixture is still not a local pass.

The first new30s export disproved the hypothesis that48kHz alone fixes the timestamp defect;
it was stopped after packet validation, before rendering60s. A short audio-only reproduction
from contiguous decoded48k PCM reproduced the84ms jump after dynamic loudnorm without video
concat/muxing. Appending exactly `asetpts=N/SR/TB` produced30.016s declared duration and no
extended packet, while preserving identical AAC payload and decoded float PCM. The approved
repair therefore derives final audio timestamps from consumed sample count after loudnorm.
It does not use asynchronous sample insertion/removal, respeed narration or change its gain.
The source guard permits only that exact quoted terminal filter expression; alternate audio
expressions and video setpts remain refused. The stopped first export stays separate from the
new `phase53-reel-readability-20261023-clockfix` sample folder.

FFmpeg's [official filter documentation source](https://github.com/FFmpeg/FFmpeg/blob/master/doc/filters.texi)
documents both linear-to-dynamic fallback and sample-count timestamps. The final focused run
passed24 checks, explicitly excluding the earlier long mixed-visual fixture:23 source/mirror
checks plus real finalization covering linear/dynamic/none, missing-statistics refusal and
3.016s non-whole-buffer packet/span checks. This is not a full visual-fixture pass.

## Source and final checks

At the audio/readability handoff, golden source revision is
`2026-09-11.budgeted-evaluator.47841af295e24fbbf57ccf33a5b53a6b8615a214310c0c691ab7a0904c51be83`.
The46-case corpus hash remains
`5dbe6fdbd447ab2a152ccf928d195ed404ca3bf431f5240397f6be3b627e55fd`.
Vertical remains`ace853904b28c76f71615cdf79fac15254c9981bc0cb3cd8dc4c95685efe09df`,40 cases/six lanes.
Source identity refresh does not issue semantic qualification or reuse old paid consent.
Full workspace typechecking passed12/12 packages; whole-tree Biome passed1209 files again
after the final timestamp fixture edit; five evaluator-identity tests, planning consistency,
playbook coverage and whitespace checks passed. Graphify is unavailable in PATH;
the existing Convex-edge fixup ran with zero new edges, not a fresh AST graph qualification.

The new clockfix30s sample passed the natural pipeline:48kHz, actual dynamic normalization,
30.016s declared and decoded PCM span, zero extended AAC packets, -15.94LUFS/-1.50dBTP,
zero nonfinite/full-scale samples and identical audio payload through caption burn. Its12
balanced cues retain all50 words and original take bounds. This is measured technical evidence,
not listening acceptance. At the source-commit boundary the one already-started60s assembly
still awaited validation during severe host process/filesystem slowdown; it is not counted as
a successful export. No second invocation or new provider request was started.

That same60s invocation subsequently completed successfully (session92796, exit0). Both final
exports preserve all40 protected original files. The60s stream reports actual linear mode at
48kHz,60.010s declared/60.010667s decoded span, zero extended AAC packets, -16.01LUFS/-1.60dBTP
and no nonfinite/full-scale decoded samples. Its audio packet payload is unchanged through
caption burn. The30s stream uses actual dynamic mode. Both are720×1280/30fps with36 positive
cues covering147 exact words; minimum durations are0.76s/0.80s, with zero cues under0.75s
and three remaining cues over20CPS. This supersedes the pending export status at commit time,
not the original stopped paid benchmark or its hold.

The local candidate fingerprint is
`ac4ccfbf8c35939d32c128872e22a46f79871f0ead34b3bbe04aee2deca8b3d5`.
The30s captioned output SHA256 is
`c8dd7de185744b715cb46ca0fd75d19a192cac58bab0fa120f16aa969b91affe`.
The60s captioned output SHA256 is
`f9188ae95f8ff905973629054c58b469fe3bb42f6cd1e67444ceda4e7d328163`.
The completed reassembly receipt SHA256 is
`f5fd668b872da293e951bf1020b53d58dd0ae5234e8dee4f0f96ed3468a1257b`.
Outputs, input bindings, measurements and credits remain separate local review artifacts under
`.tmp/phase53-reel-readability-20261023-clockfix`; the purchased originals are not committed.
The30s B-roll/high-still/endcard frames and an actual cue midpoint were visually inspected.
The60s cue midpoints at33.056s ("a comfortable reach") and53.173s ("your own routine") were
also inspected: legible, inside the safe margins and above native player controls.

An additional short synthetic clock-removal negative control is inconclusive: the fixed branch
ran, while the clock-removed subprocess did not finish its unchanged30s window on this host.
This is not a demonstrated mutant rejection or proof that the short runtime fixture alone
detects clock removal. No source edit/retry followed. The actual30s before/after reproduction,
sample/payload identity, strict source guard and final natural-pipeline measurements retain
their stated scope.

[Exact-source CI39953265545](https://github.com/Mrjoel97/ProjectX/actions/runs/39953265545)
passed for implementation commit`afaedd6fffc8e20f5d2f993a130a90ac62ab3412`: typecheck, lint,
all22 free gates, full unit suite,182 operator regressions, planning evidence and production build.
The frontend passed1237 tests with two existing skips; backend passed4687 with both optional
real-FFmpeg fixtures skipped because their required local toolchain was unavailable. Those skips
are not runtime-render passes. The focused real audio fixture and both natural-pipeline exports
ran locally; the long synthetic mixed-visual timeout remains an explicit limitation. No runtime
or fixture timeout was weakened. Final listening and owner creative acceptance remain open.

The ignored one-use rebuild helper has a discovered marker-name mismatch: it checks
`reassembly-started.json` but writes`render-started.json`. Its hash-bound running bytes are
preserved, not silently fixed/replayed. That helper is retired after its sole authorized run;
future versions must refuse either marker and pre-existing outputs before writing. This does
not change the canonical production renderer or authorize another benchmark/export attempt.

## Batch delivery continuation

The owner subsequently said proceed, then asked to focus on finishing. This continuation is
limited to ready-file batch delivery and making the existing video runtime checks execute in CI.
No new paid call, credential read, generation, deployment or registry operation is introduced.

The click-only download manifest requires the exact tenant/conversation/campaign, validates all
1–15 unique child memberships, and resolves current owned image slots or the existing governed
video final. Partial availability has explicit omissions and existing music attribution. Videos
retain the existing rendered/storage/sidecar/summary and terminal-caption contract; there is no
new persisted render-batch provenance field or claim of stronger historical video binding.

One sequential, cancellable ZIP uses installed fflate through a dedicated Vault subpath, never
the Office parser barrel. STORE preserves original bytes; safe ordinal filenames use actual
known image MIME extensions. A README describes the availability snapshot, omitted outputs and
music credits without copying capability fields or internal IDs. Both aggregate input and final
ZIP output, including headers/README, are bounded to200MiB. Failure saves no partial archive.
The UI requests a fresh manifest only on explicit download, supports retry/cancel and aborts on
scope change/unmount. Its completion message means browser download started, not OS save proof.

Focused checks passed34 backend tests and39 frontend tests (15 collection,11 archive,13 original
download regressions). ZIP tests independently decode original bytes through the installed ZIP
decoder and exercise sequential fetch, late cancellation, MIME correction, omission/credit copy,
invalid manifests, unavailable originals, streamed/declared aggregate limits and final ZIP overhead.
Actual-component browser checks passed at390px and1440px with native ZIP downloads. An independent
.NET ZIP reader verified original image/video bytes and the omission/credit README in both archives;
cancellation produced no additional ZIP. The harness was interrupted during browser cleanup after
those assertions, so this is scoped evidence, not a clean whole-harness exit. A separate exit0 TCP
refusal confirmed the owned fixture server closed. Evidence is in the ignored batch-archive-ui-qa
report. Exact-head hosted CI remains pending at this commit boundary and is recorded on PR83.

CI installs/probes Bash, FFmpeg, FFprobe and DejaVu Sans before the existing test step. Missing
prerequisites fail when CI is exactlytrue/1; Turbo forwards/hashes CI, while local optional skips
remain. Twenty-five isolated availability-guard scenarios passed. Existing fixture/job timeouts
are unchanged. Actual hosted execution of both FFmpeg fixtures is required before calling this
gap closed; prior skipped fixtures are not converted into passing evidence.

CI39967368898 on86db38c7 passed both actual FFmpeg fixtures (14.718 seconds combined), typecheck,
lint,22 free gates and1260 frontend tests with two existing skips. Its sole backend failure was
the terminal media-job writer pin: the new batch read made the pre-existing campaign cancellation
write visible to that inventory. Queued cancellation now calls a synchronous owned-batch helper
in media.ts within the same transaction; submitted work remains untouched. The two-module writer
pin is unchanged. A new cancellation regression checks actual job rows; final CI must rerun.

Current golden source revision after that correction is
`2026-09-11.budgeted-evaluator.36d5c34e09b87bbfb45e0cb53f529b213ed381ebb23dc5c6dc44eefe44d8baf4`.
The46-case corpus/hash and40-case vertical corpus remain unchanged. Source identity refresh is
not paid semantic qualification or reusable consent. Phase53 remains0/3 and the primary order
and all previous financial/qualification receipts remain unchanged.

## Remaining acceptance

Generated motion still fails physical/identity review. Reusing the high still plus licensed B-roll
is an explicit editorial fallback. Higher image presets need a persisted immutable quality/placement
tuple through price, exact review, job reservation, provider submission and reconciliation; the
benchmark is not permission to flip the current default. The inactive director candidate needs
governed qualification and an explicit registry decision. Final listening, creative review, hosted
authorization/recovery and live batch-crash behavior remain open.
