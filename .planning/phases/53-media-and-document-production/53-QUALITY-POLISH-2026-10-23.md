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
a success receipt. New real30/60exports and exact-head CI remain required.

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

Final golden source revision is
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

The ignored one-use rebuild helper has a discovered marker-name mismatch: it checks
`reassembly-started.json` but writes`render-started.json`. Its hash-bound running bytes are
preserved, not silently fixed/replayed. That helper is retired after its sole authorized run;
future versions must refuse either marker and pre-existing outputs before writing. This does
not change the canonical production renderer or authorize another benchmark/export attempt.

## Remaining acceptance

Generated motion still fails physical/identity review. Reusing the high still plus licensed B-roll
is an explicit editorial fallback. Higher image presets need a persisted immutable quality/placement
tuple through price, exact review, job reservation, provider submission and reconciliation; the
benchmark is not permission to flip the current default. The inactive director candidate needs
governed qualification and an explicit registry decision. Final listening, creative review, hosted
authorization/recovery and live batch-crash behavior remain open.
