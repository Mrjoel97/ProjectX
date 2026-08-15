#!/usr/bin/env bash
# burn_caps.sh — ONE ffmpeg pass that burns a timed .ass track into a finished reel.
#
# THIS IS CODE, NOT A PROMPT. CLAUDE.md §5 makes PROMPTS versioned `skills` rows; it does NOT apply
# here and must never be "generalised" to. A registry row is mutable by a database write, and a
# runtime-mutable shell script executed in a VM that holds tenant media is remote code execution.
# This file is a repo file with a byte-identity drift test against its .ts mirror, and there is
# deliberately NO seeds entry for it.
#
# WHY IT IS A SECOND PASS AND NOT A FILTER IN assemble_final.sh:
#   * D8 mandates captions as a separate post-assembly step, and `assemble_final.sh` refuses
#     `--subs` in as many words. The upstream in-assembler Whisper path was removed on 2026-07-29
#     for transcribing MIXED audio (music and SFX under the speech) and swallowing words.
#   * The transcript arrives ASYNCHRONOUSLY, from a provider, after the reel exists. There is no
#     moment during assembly at which the caption track is available.
#
# GUARANTEES:
#   * THE DURATION IS UNCHANGED, asserted to +/-1s on the output. A burn that re-times the video is
#     a burn that has desynchronised the voice from the picture — the one failure that would not be
#     visible in a still frame.
#   * THE AUDIO IS COPIED, never re-encoded. The level law was settled two passes ago (linear
#     loudnorm at -16 LUFS); re-encoding here would re-open it silently.
#   * NO FONT IS FETCHED. `fontsdir` points at the image's own baked fonts, and the sandbox runs on
#     `deny-all` egress, so a fetch is impossible rather than merely discouraged. A font named in
#     the .ass that is not in the image does NOT fail — libass substitutes silently — which is why
#     the writer and the bake script name the same family (DejaVu Sans).
#   * IT REFUSES A BUILD WITHOUT libass rather than producing a caption-free file with exit 0.
#     `subtitles=` on an ffmpeg without libass is an unknown-filter error on some builds and a
#     silent no-op on others; this checks up front instead of trusting which.
#
# Requires: an ffmpeg built with --enable-libass (plan 20-15 bakes the BtbN `linux64-gpl` tarball),
# ffprobe, awk.
#
# Usage:
#   burn_caps.sh [--in in/final.mp4] [--subs in/caps.ass] [--out out/final.captioned.mp4]
set -euo pipefail

IN="in/final.mp4"; SUBS="in/caps.ass"; OUT="out/final.captioned.mp4"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --in) IN="$2"; shift 2 ;;
    --subs) SUBS="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

for b in ffmpeg ffprobe awk; do command -v "$b" >/dev/null 2>&1 || { echo "ERROR: '$b' not found" >&2; exit 1; }; done
[[ -f "$IN" ]] || { echo "ERROR: input not found: $IN" >&2; exit 1; }
[[ -f "$SUBS" ]] || { echo "ERROR: subtitle track not found: $SUBS" >&2; exit 1; }
# A zero-byte track burns cleanly and produces a reel with no captions and exit 0 — the exact
# silent-success this stage exists to avoid.
[[ -s "$SUBS" ]] || { echo "ERROR: subtitle track is empty: $SUBS" >&2; exit 1; }
# NOT `grep -q` — the same pipefail+SIGPIPE race as assemble_final.sh's drawtext probe.
ffmpeg -hide_banner -filters 2>/dev/null | grep ' subtitles ' >/dev/null || { echo "ERROR: this ffmpeg has no 'subtitles' filter — libass is missing from the image" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"

DUR_IN="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")"
echo "[1/2] burning $(grep -c '^Dialogue:' "$SUBS") caption lines over ${DUR_IN}s" >&2

# ONE pass. `-c:a copy` is load-bearing (see the level law above); the video is re-encoded because
# burning is a pixel operation and there is no way around it. CRF 20 / veryfast is the same tier
# the assembler finishes at, so this does not become a second quality decision.
ffmpeg -y -loglevel error -i "$IN" -vf "subtitles=${SUBS}:fontsdir=/usr/share/fonts" \
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a copy -movflags +faststart "$OUT"

[[ -s "$OUT" ]] || { echo "ERROR: burn produced no output" >&2; exit 1; }
DUR_OUT="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")"
awk -v a="$DUR_IN" -v b="$DUR_OUT" 'BEGIN{ d=a-b; if(d<0)d=-d; exit (d<=1)?0:1 }' || {
  echo "ERROR: burned duration ${DUR_OUT}s != expected ${DUR_IN}s — the caption pass re-timed the video" >&2
  exit 1
}
echo "[2/2] ${OUT} (${DUR_OUT}s)" >&2
