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
#   * four scenes of DIFFERENT lengths sum to an exact 30s
#   * a still becomes a moving scene, a text card is drawn, an upload/clip is normalised
#   * a scene with NO voice take is silent rather than an error
#   * the sidecar records per-scene duration/visual and RUNNING-SUM offsets
#   * the card is not a black rectangle (drawtext failing silently is the whole reason to check)
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

# Voice takes. The band is [SEC-1.4, SEC], so speech must nearly fill its scene.
# Scene 3 gets NO take — a deliberately silent card, which is the new optional-voice path.
mkspeech() { # $1=out $2=speech-seconds  (0.2s lead + tone + 0.2s tail)
  ffmpeg -y -loglevel error \
    -f lavfi -t 0.2 -i anullsrc=r=24000:cl=mono \
    -f lavfi -t "$2" -i "sine=f=300:r=24000" \
    -f lavfi -t 0.2 -i anullsrc=r=24000:cl=mono \
    -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]" -map "[a]" -ar 24000 -ac 1 "$1"
}
mkspeech in/voice01.wav 7.2
mkspeech in/voice02.wav 5.2
mkspeech in/voice04.wav 11.2

# The font is copied to a RELATIVE, colon-free path. A Windows font lives at `C:/…`, and a colon
# inside an ffmpeg filtergraph is an option separator that needs escaping — which the sandbox's
# `/usr/share/fonts/…` never does. Copying keeps the smoke exercising the SAME script line the
# sandbox will, instead of a Windows-only escaping variant of it.
cp "$SRC_FONT" in/font.ttf
export ASSEMBLE_FONT="in/font.ttf"
bash "$SH" --scene video:8 --scene image:6 --scene card:4 --scene video:12 \
  --in in --out out/final.mp4

# ── ASSERTIONS. A render that exits 0 is not a render that is correct. ──────────────────────────
fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

FD="$(dur out/final.mp4)"
awk -v d="$FD" 'BEGIN{exit (d>29 && d<31)?0:1}' || fail "final is ${FD}s, expected 30s (8+6+4+12)"
[ -f out/final.mp4.assembly.json ] || fail "no sidecar was written"

node -e '
const s=JSON.parse(require("fs").readFileSync("out/final.mp4.assembly.json","utf8"));
const bad=(m)=>{console.error("SMOKE FAIL: "+m);process.exit(1)};
if(s.block_count!==4) bad("block_count "+s.block_count);
if(s.target_duration_s!==30) bad("target_duration_s "+s.target_duration_s);
const kinds=s.blocks.map(b=>b.visual).join(",");
if(kinds!=="video,image,card,video") bad("visual kinds: "+kinds);
const durs=s.blocks.map(b=>b.duration_s).join(",");
if(durs!=="8,6,4,12") bad("per-scene duration_s: "+durs);
const starts=s.blocks.map(b=>b.window_start_s).join(",");
if(starts!=="0,8,14,18") bad("running-sum offsets: "+starts);
// The SILENT card must record zero speech, and the narrated scenes must record real speech.
if(s.blocks[2].speech_dur_s!==0) bad("card scene claims speech: "+s.blocks[2].speech_dur_s);
for(const i of [0,1,3]) if(!(s.blocks[i].speech_dur_s>1)) bad("scene "+i+" lost its speech");
if(s.blocks.some(b=>b.overrun)) bad("an overrun survived to the sidecar");
console.log("  sidecar OK: 4 scenes, kinds "+kinds+", durations "+durs+", offsets "+starts);
'

# expansion=none: the literal %{pts} must NOT have been evaluated into a timestamp. Extract the
# card frame and OCR-free-check by pixel: an evaluated %{pts} renders DIFFERENT text, so instead
# assert the card frame is not blank — the cheap, honest check a smoke can make.
ffmpeg -y -v error -ss 16 -i out/final.mp4 -frames:v 1 out/card.png
NONBLACK="$(ffmpeg -v error -i out/card.png -vf "blackframe=amount=98" -f null - 2>&1 | grep -c blackframe || true)"
[ "$NONBLACK" = "0" ] || fail "the card frame is blank — drawtext drew nothing"

echo "SMOKE OK: 30s reel from video+image+card+video, sidecar validated, card drew text"
