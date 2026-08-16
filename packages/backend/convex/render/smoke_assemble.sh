#!/usr/bin/env bash
# smoke_assemble.sh — a REAL ffmpeg render of a mixed-kind, variable-duration reel.
#
# NOT SHIPPED INTO THE SANDBOX. This is a developer harness for `assemble_final.sh`, which is the
# only file in this directory the runner writes into a VM. It exists because the assembler is a
# shell script: no unit test can tell you that zoompan is smooth, that drawtext actually drew, or
# that a silent scene still concatenates — only a render can, and every input here is SYNTHESISED
# by ffmpeg itself, so there are no committed binary fixtures and no network.
#
# What it proves, and each one is a failure that would otherwise reach a paid sandbox:
#   * four scenes of DIFFERENT lengths sum to an exact 30s, and land within 0.5s of it
#   * a still becomes a moving scene, a text card is drawn, an upload/clip is normalised
#   * a scene with NO voice take is silent rather than an error
#   * the sidecar records per-scene duration/visual and RUNNING-SUM offsets
#   * the card is not a black rectangle (drawtext failing silently is the whole reason to check)
#   * (wave 4) a voice line LONGER than its own scene renders — carrying over the cut into the
#     next scene instead of being rejected by a per-cell band. Scene 2 is 6s and its take carries
#     7.2s of speech; under wave 3 that was a hard error, and it is the point of the wave.
#   * (wave 4) the narration assert is NOT vacuous. The run ends by rendering the SAME deck a
#     second time through a deliberately sabotaged COPY of the script — one sed, muting the voice
#     takes as they enter the master mix — and requires that run to FAIL with the narration error.
#     The phase's named risk is this gate quietly going vacuous under optional narration, and an
#     assert nobody has watched go red is not evidence. The sabotage lives here and never in the
#     shipped script: a production assembler with a "skip the gate" switch is the same hole.
#     `SMOKE_SKIP_RED=1` skips that second render when you only want the ~40s happy path.
#
# Usage:  bash smoke_assemble.sh <path-to-assemble_final.sh> <work-dir> [font.ttf]
#
# On a machine whose ffmpeg has no usable fontconfig (the Windows gyan.dev build under msys),
# drawtext SEGFAULTS on every invocation — including one with no fontfile at all. Point
# FONTCONFIG_FILE at a minimal fonts.conf naming a font directory and it works. That is an
# environment fault, not a script fault, and it is written down here because it costs an hour to
# rediscover.
set -euo pipefail

SH="$1"; WORK="$2"; SRC_FONT="${3:-/c/Windows/Fonts/arial.ttf}"
rm -rf "$WORK"; mkdir -p "$WORK/in" "$WORK/out"
cd "$WORK"

W=360; H=640; FPS=24

# scene 1 — video, 8s (deliberately 8.4s so the clip-covers-window check has slack to pass)
ffmpeg -y -loglevel error -f lavfi -t 8.4 -i "testsrc2=s=${W}x${H}:r=${FPS}" \
  -f lavfi -t 8.4 -i "sine=f=220:r=48000" -c:v libx264 -preset ultrafast -c:a aac -shortest in/block01.mp4
# scene 2 — still, 6s
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=s=640x640" -frames:v 1 in/block02.png
# scene 3 — card, 4s. A colon and an apostrophe on purpose: `text=` would need escaping and
# `textfile=` must not. A `%{pts}` line proves expansion=none is actually off.
printf 'Ninety minutes a day: gone.\nYou approve; we type.\n%%{pts} must render literally\n' > in/card03.txt
# scene 4 — video, 12s
ffmpeg -y -loglevel error -f lavfi -t 12.4 -i "testsrc2=s=${W}x${H}:r=${FPS}" \
  -c:v libx264 -preset ultrafast -an in/block04.mp4

# Voice takes. There is NO per-cell band any more (wave 4): a line is written for the reel and may
# run past its own scene. Scene 2 is 6s and deliberately carries 7.2s of speech, which wave 3
# rejected outright — it now spills into the silent card that follows it, which is exactly what
# "a silent scene lends its window to the line before it" means once the mix is one timeline.
# Scene 3 gets NO take — a deliberately silent card, which is the optional-voice path.
mkspeech() { # $1=out $2=speech-seconds  (0.2s lead + tone + 0.2s tail)
  ffmpeg -y -loglevel error \
    -f lavfi -t 0.2 -i anullsrc=r=24000:cl=mono \
    -f lavfi -t "$2" -i "sine=f=300:r=24000" \
    -f lavfi -t 0.2 -i anullsrc=r=24000:cl=mono \
    -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]" -map "[a]" -ar 24000 -ac 1 "$1"
}
mkspeech in/voice01.wav 7.2
mkspeech in/voice02.wav 7.2   # 7.2s of speech in a 6s scene — the whole point of wave 4
mkspeech in/voice04.wav 11.2

# The font is copied to a RELATIVE, colon-free path. A Windows font lives at `C:/…`, and a colon
# inside an ffmpeg filtergraph is an option separator that needs escaping — which the sandbox's
# `/usr/share/fonts/…` never does. Copying keeps the smoke exercising the SAME script line the
# sandbox will, instead of a Windows-only escaping variant of it.
cp "$SRC_FONT" in/font.ttf
export ASSEMBLE_FONT="in/font.ttf"
SCENES=(--scene video:8 --scene image:6 --scene card:4 --scene video:12)
bash "$SH" "${SCENES[@]}" --target-seconds 30 --in in --out out/final.mp4

# ── ASSERTIONS. A render that exits 0 is not a render that is correct. ──────────────────────────
fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

FD="$(dur out/final.mp4)"
# ±0.5s, matching the tightened assert inside the script — not ±1s, which would pass a reel the
# script itself would refuse.
awk -v d="$FD" 'BEGIN{x=d-30; if(x<0)x=-x; exit (x<=0.5)?0:1}' || fail "final is ${FD}s, expected 30s +/-0.5 (8+6+4+12)"
[ -f out/final.mp4.assembly.json ] || fail "no sidecar was written"

# The audio must span the WHOLE reel, not stop at the last take. Under the old per-scene mix this
# was true because every scene carried its own stream; under one amix it is true because of the
# full-length silence bed, which is a thing that can be dropped by accident.
AD="$(ffprobe -v error -select_streams a:0 -show_entries stream=duration -of csv=p=0 out/final.mp4 | head -1)"
awk -v a="$AD" -v d="$FD" 'BEGIN{x=a-d; if(x<0)x=-x; exit (x<=0.5)?0:1}' || fail "audio is ${AD}s against ${FD}s of video — the mix does not span the reel"

node -e '
const s=JSON.parse(require("fs").readFileSync("out/final.mp4.assembly.json","utf8"));
const bad=(m)=>{console.error("SMOKE FAIL: "+m);process.exit(1)};
if(s.scene_count!==4) bad("scene_count "+s.scene_count);
if(s.block_count!==undefined||s.clip_seconds!==undefined||s.blocks!==undefined) bad("the v1 sidecar fields came back — packages/core/src/assembly.ts refuses this outright");
if(s.target_duration_s!==30) bad("target_duration_s "+s.target_duration_s);
const kinds=s.scenes.map(b=>b.visual).join(",");
if(kinds!=="video,image,card,video") bad("visual kinds: "+kinds);
const durs=s.scenes.map(b=>b.duration_s).join(",");
if(durs!=="8,6,4,12") bad("per-scene duration_s: "+durs);
const starts=s.scenes.map(b=>b.start_s).join(",");
if(starts!=="0,8,14,18") bad("running-sum offsets: "+starts);
// The SILENT card must record zero speech, and the narrated scenes must record real speech.
if(s.scenes[2].speech_dur_s!==0) bad("card scene claims speech: "+s.scenes[2].speech_dur_s);
for(const i of [0,1,3]) if(!(s.scenes[i].speech_dur_s>1)) bad("scene "+i+" lost its speech");
if(s.scenes.some(b=>b.overrun)) bad("an overrun survived to the sidecar");
// WAVE 4, the load-bearing row: scene 2 is 6s and its line carries ~7.2s of speech. Wave 3 exited
// with "REWRITE the narration" here. If this ever reads <=6 again, the per-cell band grew back.
if(!(s.scenes[1].speech_dur_s>6.5)) bad("scene 2 speech is "+s.scenes[1].speech_dur_s+"s — a take that outruns its scene was trimmed or rejected");
// ...and it must be ANCHORED at its scene start (8s), not centred at 8+(6-7.2)/2 = 7.4s.
if(Math.abs(s.scenes[1].speech_abs_s-8)>0.35) bad("scene 2 speech starts at "+s.scenes[1].speech_abs_s+"s, expected ~8s (anchored, not centred)");
// The takes must still be in order on the timeline — captions rebase off these.
const abs=s.scenes.map(b=>b.speech_abs_s);
for(let i=1;i<abs.length;i++) if(!(abs[i]>abs[i-1])) bad("speech_abs_s is not monotonic: "+abs.join(","));
console.log("  sidecar OK: 4 scenes, kinds "+kinds+", durations "+durs+", offsets "+starts);
console.log("  scene 2 carries "+s.scenes[1].speech_dur_s+"s of speech in a 6s scene, anchored at "+s.scenes[1].speech_abs_s+"s");
'

# expansion=none: the literal %{pts} must NOT have been evaluated into a timestamp. Extract the
# card frame and OCR-free-check by pixel: an evaluated %{pts} renders DIFFERENT text, so instead
# assert the card frame is not blank — the cheap, honest check a smoke can make.
ffmpeg -y -v error -ss 16 -i out/final.mp4 -frames:v 1 out/card.png
NONBLACK="$(ffmpeg -v error -i out/card.png -vf "blackframe=amount=98" -f null - 2>&1 | grep -c blackframe || true)"
[ "$NONBLACK" = "0" ] || fail "the card frame is blank — drawtext drew nothing"

# The still branch must be ANIMATED, not merely a decodable six-second freeze. Sample decoded
# frames from the middle of scene 2 and compare their frame hashes. Hashes
# are compared only with one another, never with a machine-specific golden: libx264/FFmpeg builds
# may encode the same picture differently, while a moving decoded window must still produce a new
# frame on most samples. Mapping the decoded video stream explicitly keeps audio packets and
# container timestamps out of the count; the invariant sees pixels only.
motion_stats() { # $1=file $2=start-seconds $3=duration-seconds -> "frames unique_hashes"
  ffmpeg -v error -ss "$2" -i "$1" -t "$3" -map 0:v:0 -an -f framemd5 - 2>/dev/null \
    | awk -F', ' '!/^#/ && NF {n++; seen[$NF]=1} END {for (h in seen) u++; printf "%d %d", n+0, u+0}'
}
read -r MOTION_FRAMES MOTION_UNIQUE <<< "$(motion_stats out/final.mp4 8.5 2)"
[ "$MOTION_FRAMES" -ge 40 ] || fail "animated still yielded only ${MOTION_FRAMES} sampled frames"
[ "$MOTION_UNIQUE" -ge $(((MOTION_FRAMES * 3) / 4)) ] || \
  fail "animated still changed in only ${MOTION_UNIQUE}/${MOTION_FRAMES} sampled frames — zoompan is static or visibly stepping"
echo "  animated still moved in ${MOTION_UNIQUE}/${MOTION_FRAMES} decoded frame samples"

# ── THE NARRATION ASSERT, OBSERVED RED ─────────────────────────────────────────────────────────
# Risk 1 of this phase: with optional narration, "narration in every window" becomes trivially
# passable if it is relaxed instead of re-expressed, and this repo has a named defect class for
# exactly that. A green assert proves nothing on its own — so break the one thing it watches and
# require the failure. The break is ONE sed on a COPY: the voice takes enter the master mix at
# volume=0. Everything else — the takes, the delays, the sidecar, the durations — is untouched, so
# a pass here would mean the gate is measuring something other than "the voice reached the mix".
if [ "${SMOKE_SKIP_RED:-0}" != "1" ]; then
  sed 's|,adelay=${TAKE_PAD\[k\]}|,volume=0,adelay=${TAKE_PAD[k]}|' "$SH" > sabotaged.sh
  grep -q 'volume=0,adelay' sabotaged.sh || fail "the sabotage sed matched nothing — the mix line was renamed, so this check is no longer breaking what it thinks it is"
  rm -rf red; mkdir -p red/out; cp -r in red/in
  set +e
  (cd red && bash ../sabotaged.sh "${SCENES[@]}" --target-seconds 30 --in in --out out/final.mp4) > red.log 2>&1
  RC=$?
  set -e
  [ "$RC" -ne 0 ] || fail "the muted-voice render SUCCEEDED — the narration assert is vacuous"
  grep -q "is NOT in the mix" red.log || fail "the muted-voice render failed for the wrong reason:$(printf '\n')$(tail -3 red.log)"
  echo "  narration assert observed RED with the voices muted (exit $RC)"
fi

echo "SMOKE OK: 30s reel from video+image+card+video, a line outrunning its scene, sidecar validated, card drew text, narration assert seen red"
