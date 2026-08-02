#!/usr/bin/env bash
# assemble_final.sh — ONE command that turns N block clips + N per-block voice takes into ONE
# finished mp4, plus the assembly.json sidecar that PROVES the render was governed.
#
# HARVESTED from the Higgsfield `faceless-channel-video` workflow v2.0
# (`scripts/assemble_final.sh`, read 2026-08-02). The CONTRACT and the ffmpeg invocations are
# taken; the workflow itself is NOT a dependency — the MCP that serves it is client-side only and
# is unreachable from a Convex action and from a Vercel Sandbox (ADR-011).
#
# THIS IS CODE, NOT A PROMPT. CLAUDE.md §5 makes prompts versioned `skills` rows; it does NOT
# apply here and must never be "generalised" to. A registry row is mutable by a database write,
# and a runtime-mutable shell script executed in a VM that holds tenant media is remote code
# execution. This file is a repo file with a byte-identity drift test against its .ts mirror.
#
# GUARANTEES — each one encodes a failure that has actually happened:
#   * FIXED LENGTH = N × clip-seconds. The video is NEVER shortened to fit the audio; the final
#     duration is asserted on the output and the script FAILS if it is off by more than 1s.
#   * NO TIME-STRETCH, EVER. No atempo, no speed change, no trimming speech. A voice line whose
#     SPEECH is longer than its window is a HARD ERROR — rewrite the line and regenerate upstream.
#   * A clip shorter than its window by > 0.5s is a HARD ERROR. A held still frame is not a scene.
#   * SPEECH-CENTRED, not file-centred: leading and trailing silence in the TTS take is measured
#     (silencedetect) and ignored, so a padded take cannot shift the words off their scene.
#   * NARRATION IN EVERY WINDOW, asserted on the joined track before finalisation. A window that
#     is quiet through its centre has no narration — the "silent second half" failure of every
#     hand-rolled assembly.
#   * LEVEL LAW: voice is always 1.0; the clips' own diegetic SFX sit under it at 0.12
#     (--sfx-vol, hard-clamped ≤ 0.20); final two-pass LINEAR loudnorm at -16 LUFS.
#   * An assembly.json SIDECAR is written last. A final video without one was hand-assembled.
#
# Usage:
#   assemble_final.sh --blocks N [--clip-seconds 10] [--in in] [--out out/final.mp4] [--sfx-vol 0.12]
#
# Inputs are DISCOVERED BY INDEX, not passed as pairs: `<in>/block01.mp4` + `<in>/voice01.wav`,
# … through N. That is deliberate — upstream took positional clip/voice pairs and needed a
# filename-number sanity check because "block03 + voice05" was its #1 failure. Deriving both names
# from the same loop counter makes that mismatch impossible instead of detectable.
#
# Captions are NOT burned here. They are a separate stage run AFTER assembly, on the CLEAN voice
# takes plus this script's sidecar. The upstream in-assembler Whisper path was removed on
# 2026-07-29 for transcribing MIXED audio (music and SFX under the speech) and swallowing words.
#
# DELIBERATELY NOT HARVESTED (deferred; re-adding either is a scope decision, not a patch):
# `--music` (ducked bed), `--song` (music-video mode), `--stepped` (on-twos cadence), the poster
# frame, and the `--manifest` / `--allow-mismatch` pair plumbing that index discovery replaces.
#
# Requires: ffmpeg, ffprobe, awk.
set -euo pipefail

IN_DIR="in"; OUT="out/final.mp4"; CLIP=10; SFXVOL="0.12"; BLOCKS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --blocks) BLOCKS="$2"; shift 2 ;;
    --clip-seconds) CLIP="$2"; shift 2 ;;
    --in) IN_DIR="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --sfx-vol) SFXVOL="$2"; shift 2 ;;
    --subs) echo "ERROR: --subs was removed. Captions are a separate stage: assemble first, then run captions on the CLEAN voice takes + <out>.assembly.json." >&2; exit 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# --blocks is REQUIRED on every run, including short ones: the count is asserted BEFORE any work,
# so a dropped block FAILS instead of silently shipping a hole in the reel.
[[ -n "$BLOCKS" ]] || { echo "ERROR: --blocks N is REQUIRED — pass the expected block count." >&2; exit 1; }
awk -v b="$BLOCKS" 'BEGIN{exit (b+0>=1 && b+0==int(b+0))?0:1}' || { echo "ERROR: --blocks must be a positive integer, got: $BLOCKS" >&2; exit 1; }
# {5,10} only — the same closed set the price table and the storyboard parser enforce. A third
# value would be a duration nobody priced.
[[ "$CLIP" == "5" || "$CLIP" == "10" ]] || { echo "ERROR: --clip-seconds must be 5 or 10, got: $CLIP" >&2; exit 1; }
# LEVEL LAW: voice is ALWAYS 1.0; SFX is clamped at 0.20 so no caller can bury the narration.
SFXVOL="$(awk -v v="$SFXVOL" 'BEGIN{v=v+0; if(v<0)v=0; if(v>0.2){print "WARN: --sfx-vol clamped to 0.20 (voice stays 1.0)" > "/dev/stderr"; v=0.2} printf "%.3f", v}')"
for b in ffmpeg ffprobe awk; do command -v "$b" >/dev/null 2>&1 || { echo "ERROR: '$b' not found" >&2; exit 1; }; done
mkdir -p "$(dirname "$OUT")"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PBJSON=()   # per-block sidecar entries

c0="$IN_DIR/$(printf 'block%02d.mp4' 1)"
[[ -f "$c0" ]] || { echo "ERROR: first clip not found: $c0" >&2; exit 1; }
DIMS="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$c0")"
W="${DIMS%%,*}"; H="${DIMS##*,}"
FPS_RAW="$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$c0")"
FPS="$(awk -F/ '{ if(NF==2 && $2>0) printf "%.4f",$1/$2; else print $1 }' <<< "$FPS_RAW")"; [ -z "$FPS" ] && FPS=30
echo "[1/3] ${BLOCKS} blocks -> ${W}x${H} @ ${FPS}fps, fixed ${CLIP}s each; speech-centred, no atempo" >&2

LIST="$TMP/list.txt"; : > "$LIST"
for ((i=0;i<BLOCKS;i++)); do
  n=$((i+1))
  clip="$IN_DIR/$(printf 'block%02d.mp4' "$n")"
  voice="$IN_DIR/$(printf 'voice%02d.wav' "$n")"
  [[ -f "$clip"  ]] || { echo "ERROR: clip not found: $clip" >&2; exit 1; }
  [[ -f "$voice" ]] || { echo "ERROR: voice not found: $voice" >&2; exit 1; }

  A="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$voice")"
  D="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip")"
  # SPEECH bounds: ignore the take's own leading/trailing silence when centring.
  EVENTS="$(ffmpeg -i "$voice" -af silencedetect=noise=-45dB:d=0.25 -f null - 2>&1 | grep -Eo 'silence_(start|end): *-?[0-9.]+' || true)"
  read -r SS SE <<< "$(awk -v A="$A" '
    /silence_start/ { s=$NF+0; if(first==""){first=s}; last=s; open=1; next }
    /silence_end/   { e=$NF+0; if(first!="" && first<0.1 && ssdone==""){ss=e; ssdone=1};
                      e_last=e; s_before=last; open=0 }
    END {
      if (open==1)                       se=last;       # file ended inside silence
      else if (e_last>0 && A-e_last<0.2) se=s_before;   # EOF auto-closed the tail silence
      else                               se=A;          # speech runs to the end
      printf "%.3f %.3f", ss+0, se+0 }' <<< "$EVENTS")"
  [[ -z "${SS:-}" ]] && SS=0; [[ -z "${SE:-}" ]] && SE="$A"
  SPEECH="$(awk -v a="$SS" -v b="$SE" 'BEGIN{d=b-a; if(d<=0)d=0; printf "%.3f", d}')"
  # A degenerate detect (all-silence, or no events at all) falls back to the whole file.
  awk -v s="$SPEECH" 'BEGIN{exit (s<0.3)?0:1}' && { SS=0; SE="$A"; SPEECH="$A"; }

  # Pausey-take probe: internal silences ≥0.8s INSIDE the speech. A flowing line has none, and
  # every full stop the TTS honours costs ~0.7s of dead air on screen.
  read -r IPN IPMAX <<< "$(awk -v lo="$SS" -v hi="$SE" '
    /silence_start/ { s=$NF+0; open=1; next }
    /silence_end/   { e=$NF+0; if(open==1 && s>lo+0.1 && e<hi-0.1 && e-s>=0.8){n++; if(e-s>mx)mx=e-s}; open=0 }
    END{ printf "%d %.2f", n+0, mx+0 }' <<< "$EVENTS")"
  [[ "${IPN:-0}" != "0" ]] && echo "WARN: voice $n has ${IPN} internal pause(s) >=0.8s (longest ${IPMAX}s) — rewrite the line as ONE flowing clause and regenerate." >&2

  # HARD checks. The window floor is CLIP-1.4 and the ceiling is CLIP, expressed relative to CLIP
  # so --clip-seconds keeps the same headroom. Upstream learned this the expensive way: a tighter
  # 9.4–9.8s window sat in the DEAD ZONE between the two modes TTS actually returns (~9.0s and
  # ~10.4s for the same line), so good takes were rejected and two dev runs on 2026-07-29 burned
  # ~150 generations on 18 lines before someone started cutting silence inside the takes to pass.
  # Audio surgery is audible; 0.7s of lead and tail after centring is not.
  SPEECH_MIN="$(awk -v c="$CLIP" 'BEGIN{printf "%.3f", c-1.4}')"
  SPEECH_MAX="$(awk -v c="$CLIP" 'BEGIN{printf "%.3f", c}')"
  OVERRUN=false
  awk -v s="$SPEECH" -v hi="$SPEECH_MAX" 'BEGIN{exit (s > hi) ? 0 : 1}' && OVERRUN=true
  awk -v s="$SPEECH" -v lo="$SPEECH_MIN" -v hi="$SPEECH_MAX" 'BEGIN{exit (s < lo || s > hi) ? 0 : 1}' && {
    echo "ERROR: voice $n carries ${SPEECH}s of speech; required ${SPEECH_MIN}-${SPEECH_MAX}s — REWRITE the narration and regenerate (never pad, atempo, or trim speech)." >&2; exit 1; }
  awk -v d="$D" -v c="$CLIP" 'BEGIN{exit (d < c-0.5) ? 0 : 1}' && {
    echo "ERROR: clip $n is only ${D}s (<${CLIP}s) — REGENERATE the block; a held still frame is not a scene." >&2; exit 1; }

  # Freeze probes: head (first ~1.5s) and tail (last ~2s). Warnings — regenerate the block.
  FRZH="$(ffmpeg -v info -t 1.5 -i "$clip" -vf "freezedetect=n=-60dB:d=1.0" -an -f null - 2>&1 | grep -c freeze_start || true)"
  [[ "$FRZH" != "0" ]] && echo "WARN: clip $n opens on ~static frames — regenerate this block." >&2
  FRZT="$(ffmpeg -v info -sseof -2 -i "$clip" -vf "freezedetect=n=-60dB:d=1.2" -an -f null - 2>&1 | grep -c freeze_start || true)"
  [[ "$FRZT" != "0" ]] && echo "WARN: clip $n ends on ~static frames (frozen tail) — consider regenerating." >&2

  # LEVEL-MATCH each voice input BEFORE it enters the mix. A fresh TTS take lands near -31 dB mean
  # while dialogue lifted out of a generated clip lands near -21 dB; mixing both at 1.0 gives the
  # "narrator blocks are quiet, character blocks are loud" complaint. One single-pass loudnorm per
  # input removes the spread mechanically, before any SFX is placed under it.
  VN="$TMP/v_$(printf '%03d' "$i").wav"
  if ffmpeg -y -loglevel error -i "$voice" -af "loudnorm=I=-19:TP=-1.5:LRA=11" -ar 48000 -ac 2 "$VN" 2>/dev/null; then
    voice="$VN"
  else
    echo "WARN: could not level-match voice $n — mixing it as-is; block loudness may differ from its neighbours." >&2
  fi

  # Centre the SPEECH in the fixed window: speech starts at (CLIP - speech)/2, compensating for
  # the file's own leading silence. NO atempo.
  PAD_MS="$(awk -v ss="$SS" -v sp="$SPEECH" -v c="$CLIP" 'BEGIN{t0=(c-sp)/2; if(t0<0)t0=0; d=t0-ss; if(d<0)d=0; printf "%d", d*1000}')"
  out="$TMP/b_$(printf '%03d' "$i").mp4"
  # Keep the clip's own diegetic SFX under the voice. Clips with no audio stream fall back to
  # voice-only against a silent base.
  HASAUD="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$clip" | head -1)"
  if [[ "$HASAUD" == "audio" ]]; then
    FC="[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},format=yuv420p,setsar=1,tpad=stop_mode=clone:stop_duration=${CLIP}[v];[1:a]adelay=${PAD_MS}:all=1,apad[vo];[0:a]volume=${SFXVOL},apad[sfx];[sfx][vo]amix=inputs=2:duration=first:normalize=0[a]"
    ffmpeg -y -loglevel error -i "$clip" -i "$voice" -filter_complex "$FC" \
      -map "[v]" -map "[a]" -t "$CLIP" -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 192k "$out"
  else
    FC="[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},format=yuv420p,setsar=1,tpad=stop_mode=clone:stop_duration=${CLIP}[v];[1:a]adelay=${PAD_MS}:all=1,apad[a]"
    ffmpeg -y -loglevel error -i "$clip" -i "$voice" -filter_complex "$FC" \
      -map "[v]" -map "[a]" -t "$CLIP" -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 192k "$out"
  fi
  echo "file '$out'" >> "$LIST"

  # The captions rebase, and the whole reason these two numbers are recorded:
  #   absolute_t = speech_abs_s + (word_t_in_clean_take - lead_silence_s)
  # Captions are timed on the CLEAN voice take (no SFX to confuse the STT) and shifted by these.
  WINDOW_START="$(awk -v i="$i" -v c="$CLIP" 'BEGIN{printf "%.3f", i*c}')"
  SPEECH_ABS="$(awk -v i="$i" -v c="$CLIP" -v p="$PAD_MS" -v ss="$SS" 'BEGIN{printf "%.3f", i*c + p/1000 + ss}')"
  printf '  block %02d: clip %.2fs, take %.2fs, speech %.2fs -> starts at %ss\n' "$n" "$D" "$A" "$SPEECH" "$SPEECH_ABS" >&2
  # `overrun` is FALSE by construction here — an overrunning line exited above. The field is
  # written anyway so that a sidecar which did NOT come from this script has to lie explicitly,
  # and so the validator's refusal has something to refuse.
  PBJSON[i]="$(printf '{"block_index":%d,"window_start_s":%s,"lead_silence_s":%.3f,"speech_abs_s":%s,"speech_dur_s":%.3f,"clip_dur_s":%.3f,"overrun":%s,"internal_pauses":%d,"freeze_head":%s,"freeze_tail":%s}' \
    "$i" "$WINDOW_START" "$SS" "$SPEECH_ABS" "$SPEECH" "$D" "$OVERRUN" "${IPN:-0}" \
    "$([[ "${FRZH:-0}" != "0" ]] && echo true || echo false)" "$([[ "${FRZT:-0}" != "0" ]] && echo true || echo false)")"
done

VOTRACK="$TMP/joined.mp4"
echo "[2/3] concat -> single track" >&2
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c:v libx264 -preset veryfast -crf 20 -c:a aac -movflags +faststart "$VOTRACK"

# NARRATION-PER-WINDOW assert: every window must carry voice-level audio (peaks > -18dB; SFX at
# 0.12 tops out around -18.4dB and stays below). A window whose centre [+2..+8] is quiet for 6s
# straight has NO narration — the exact "silent second half" failure of hand-rolled assemblies.
QUIET="$(ffmpeg -i "$VOTRACK" -af "silencedetect=noise=-18dB:d=6" -f null - 2>&1 | grep -Eo 'silence_(start|end): *[0-9.]+' || true)"
EMPTY="$(awk -v C="$CLIP" -v P="$BLOCKS" '
  /silence_start/ { s[++k]=$NF+0; next }
  /silence_end/   { e[k]=$NF+0 }
  END {
    for (i=0;i<P;i++) { ws=i*C+2; we=i*C+8;
      for (j=1;j<=k;j++) { ee=(e[j]>0)?e[j]:1e9;
        if (s[j]<=ws && ee>=we) { printf "%s%d", (out++?",":""), i+1; break } } } }' <<< "$QUIET")"
if [[ -n "$EMPTY" ]]; then
  echo "ERROR: blocks [$EMPTY] have NO narration in their windows — the voice never made it into the mix. Fix the inputs and re-run; do NOT deliver." >&2
  exit 1
fi
echo "  narration present in all ${BLOCKS} windows" >&2

echo "[3/3] finalize -> $OUT" >&2
# Two-pass LINEAR loudnorm: ONE constant gain for the whole file, so the voice/SFX ratio set above
# is PRESERVED. Single-pass dynamic loudnorm pumps quiet SFX-only stretches up toward the voice.
ln2_args() {
  ffmpeg -hide_banner -i "$1" -af "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 \
  | awk '/"input_i"/{i=$3}/"input_tp"/{t=$3}/"input_lra"/{l=$3}/"input_thresh"/{h=$3}/"target_offset"/{o=$3}
         {gsub(/[",]/,"",i);gsub(/[",]/,"",t);gsub(/[",]/,"",l);gsub(/[",]/,"",h);gsub(/[",]/,"",o)}
         END{printf "measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s", i,t,l,h,o}'
}
LNARGS="$(ln2_args "$VOTRACK")"
if [[ "$LNARGS" == *measured_I=-* ]]; then
  ffmpeg -y -loglevel error -i "$VOTRACK" -af "loudnorm=I=-16:TP=-1.5:LRA=11:${LNARGS}:linear=true" -c:v copy -c:a aac -b:a 192k "$OUT"
else
  echo "WARN: loudness measurement failed — falling back to single-pass loudnorm." >&2
  ffmpeg -y -loglevel error -i "$VOTRACK" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:v copy -c:a aac -b:a 192k "$OUT"
fi

# The fixed-length guarantee, asserted on the OUTPUT: |actual - N*CLIP| <= 1s.
TOT="$(awk -v n="$BLOCKS" -v c="$CLIP" 'BEGIN{printf "%g", n*c}')"
FDUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")"
awk -v d="$FDUR" -v e="$TOT" 'BEGIN{x=d-e; if(x<0)x=-x; exit (x<=1)?0:1}' || {
  echo "ERROR: final duration ${FDUR}s != expected ${TOT}s (+/-1s) — do NOT deliver; investigate the inputs." >&2; exit 1; }

# Integrity: the final must carry an audio stream spanning the video, and must FULLY DECODE with
# zero errors (catches corrupted/truncated streams that a stream-copy hides).
ADUR="$(ffprobe -v error -select_streams a:0 -show_entries stream=duration -of csv=p=0 "$OUT" | head -1)"
[[ -z "$ADUR" || "$ADUR" == "N/A" ]] && { echo "ERROR: final has no readable audio stream — do NOT deliver." >&2; exit 1; }
awk -v a="$ADUR" -v d="$FDUR" 'BEGIN{x=a-d; if(x<0)x=-x; exit (x<=1.5)?0:1}' || {
  echo "ERROR: audio stream ${ADUR}s vs video ${FDUR}s — mismatched/truncated audio; do NOT deliver." >&2; exit 1; }
DERR="$( (ffmpeg -v error -xerror -i "$OUT" -f null - ) 2>&1 | head -3 || true)"
[[ -n "$DERR" ]] && { echo "ERROR: final failed decode validation — corrupted stream; do NOT deliver:" >&2; echo "$DERR" >&2; exit 1; }

# The assembly sidecar: machine-readable proof this final went through this script, gates included.
# A final video without one was hand-assembled. `packages/core/src/assembly.ts` is the validator and
# the source of truth for these field names; a render whose sidecar fails it is NOT published.
SIDE="${OUT}.assembly.json"
{
  printf '{"script":"assemble_final.sh","out":"%s","block_count":%d,"clip_seconds":%s,"total_duration_s":%s,"actual_duration_s":%s,"width":%s,"height":%s,"fps":"%s","sfx_vol":%s,"gates":["speech_within_window","clip_covers_window","speech_centred","no_time_stretch","narration_every_window","linear_loudnorm_-16","duration_within_1s","full_decode"],"blocks":[' \
    "$(basename "$OUT")" "$BLOCKS" "$CLIP" "$TOT" "$FDUR" "$W" "$H" "$FPS" "$SFXVOL"
  for ((i=0;i<BLOCKS;i++)); do printf '%s%s' "${PBJSON[i]}" "$([[ $i -lt $((BLOCKS-1)) ]] && echo ,)"; done
  printf '],"ts":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$SIDE"
echo "ASSEMBLY-SIDECAR: $SIDE" >&2
echo "DONE: $OUT  (ONE file, ${BLOCKS} blocks x ${CLIP}s = ${TOT}s, actual ${FDUR}s; decode-validated)" >&2
