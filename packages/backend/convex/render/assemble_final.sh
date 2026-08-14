#!/usr/bin/env bash
# assemble_final.sh — ONE command that turns N scene sources + their voice takes into ONE
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
# ── SCENES (phase 20.2 wave 3) ────────────────────────────────────────────────────────────────
# A reel is a list of SCENES, each with its OWN length and its OWN kind of picture:
#
#   video  <in>/blockNN.mp4   a generated or user-supplied clip
#   image  <in>/blockNN.png   ONE still, animated by a slow pan/zoom for the scene's length
#   card   <in>/cardNN.txt    a text card the assembler DRAWS — no generation, no upload
#
# `--blocks N --clip-seconds C` still works and is exactly N scenes of `video:C`. It is not a
# second code path: it FILLS the same scene arrays, so the uniform reel is the general one with
# every entry equal. That is what lets the block contract keep rendering byte-identically while
# the scene contract is still being built (waves 4-8).
#
# WHY image AND card EXIST AT ALL: an unpaid block used to be an UNRENDERABLE one. `TEXT` and
# `SCREEN REC` got no video line, so nothing ever wrote their `blockNN.mp4`, and this script
# hard-errors on the first missing input — so `media.reserveJobInner` refused any deck containing
# one, and the deck the specialist was TAUGHT to write could not be made. These two branches are
# what remove that refusal's reason to exist. A still costs ~a tenth of a generated clip and is
# frame-exact at any length, which is also what makes an exact 15/30/60-second reel possible.
#
# GUARANTEES — each one encodes a failure that has actually happened:
#   * FIXED LENGTH = the sum of the scene lengths. The video is NEVER shortened to fit the audio;
#     the final duration is asserted on the output and the script FAILS if it is off by >1s.
#   * NO TIME-STRETCH, EVER. No atempo, no speed change, no trimming speech. A voice line whose
#     SPEECH is longer than its window is a HARD ERROR — rewrite the line and regenerate upstream.
#   * A clip shorter than its scene by > 0.5s is a HARD ERROR. A held still frame is not a scene.
#     (A `card` or an `image` is BUILT to length, so it cannot fail this — only `video` can.)
#   * SPEECH-CENTRED, not file-centred: leading and trailing silence in the TTS take is measured
#     (silencedetect) and ignored, so a padded take cannot shift the words off their scene.
#   * NARRATION IN EVERY NARRATED WINDOW, asserted on the joined track before finalisation. A
#     window that is quiet through its centre has no narration — the "silent second half" failure
#     of every hand-rolled assembly. A scene with NO take is deliberately silent and is skipped.
#   * LEVEL LAW: voice is always 1.0; the clips' own diegetic SFX sit under it at 0.12
#     (--sfx-vol, hard-clamped ≤ 0.20); final two-pass LINEAR loudnorm at -16 LUFS.
#   * An assembly.json SIDECAR is written last. A final video without one was hand-assembled.
#
# Usage:
#   assemble_final.sh --blocks N [--clip-seconds 10] [--in in] [--out out/final.mp4] [--sfx-vol 0.12]
#   assemble_final.sh --scene video:8 --scene image:6 --scene card:4 --scene video:12 [...]
#
# Inputs are DISCOVERED BY INDEX, not passed as pairs: scene 1 reads `<in>/block01.*` and
# `<in>/voice01.wav`, … through N. That is deliberate — upstream took positional clip/voice pairs
# and needed a filename-number sanity check because "block03 + voice05" was its #1 failure.
# Deriving every name from the same loop counter makes that mismatch impossible instead of
# detectable.
#
# A VOICE TAKE IS OPTIONAL (20.2). A scene may be deliberately silent — the scene contract allows
# an empty narration cell, and a silent scene lends its window to the line before it. A MISSING
# take is silence; it is never an error.
#
# Captions are NOT burned here. They are a separate stage run AFTER assembly, on the CLEAN voice
# takes plus this script's sidecar. The upstream in-assembler Whisper path was removed on
# 2026-07-29 for transcribing MIXED audio (music and SFX under the speech) and swallowing words.
#
# DELIBERATELY NOT HARVESTED (deferred; re-adding either is a scope decision, not a patch):
# `--music` (ducked bed), `--song` (music-video mode), `--stepped` (on-twos cadence), the poster
# frame, and the `--manifest` / `--allow-mismatch` pair plumbing that index discovery replaces.
#
# Requires: ffmpeg, ffprobe, awk. A `card` scene additionally needs a TrueType font in the image.
set -euo pipefail

IN_DIR="in"; OUT="out/final.mp4"; CLIP=10; SFXVOL="0.12"; BLOCKS=""
KINDS=(); SECS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --blocks) BLOCKS="$2"; shift 2 ;;
    --clip-seconds) CLIP="$2"; shift 2 ;;
    # KIND:SECONDS, one per scene, IN ORDER. Order is the reel's order and the index, which is the
    # same rule the deck parser follows — the display `#` column is never read as a position.
    --scene)
      KINDS+=("${2%%:*}"); SECS+=("${2##*:}"); shift 2 ;;
    --in) IN_DIR="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --sfx-vol) SFXVOL="$2"; shift 2 ;;
    --subs) echo "ERROR: --subs was removed. Captions are a separate stage: assemble first, then run captions on the CLEAN voice takes + <out>.assembly.json." >&2; exit 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ONE of the two shapes, never both — a run that says both is a caller that does not know which
# contract it is on, and guessing would pick a length nobody priced.
if [[ ${#KINDS[@]} -gt 0 && -n "$BLOCKS" ]]; then
  echo "ERROR: pass --scene OR --blocks, never both." >&2; exit 2
fi

if [[ ${#KINDS[@]} -eq 0 ]]; then
  # THE UNIFORM PATH, expressed as scenes. `--blocks` is REQUIRED on every run, including short
  # ones: the count is asserted BEFORE any work, so a dropped block FAILS instead of silently
  # shipping a hole in the reel.
  [[ -n "$BLOCKS" ]] || { echo "ERROR: --blocks N is REQUIRED — pass the expected block count." >&2; exit 1; }
  awk -v b="$BLOCKS" 'BEGIN{exit (b+0>=1 && b+0==int(b+0))?0:1}' || { echo "ERROR: --blocks must be a positive integer, got: $BLOCKS" >&2; exit 1; }
  # The same closed set the price table and storyboard parser enforce. Historical Wan durations
  # stay accepted while new Sora decks use 4, 8 or 12 seconds.
  [[ "$CLIP" == "4" || "$CLIP" == "5" || "$CLIP" == "8" || "$CLIP" == "10" || "$CLIP" == "12" ]] || { echo "ERROR: unsupported --clip-seconds: $CLIP" >&2; exit 1; }
  for ((i=0;i<BLOCKS;i++)); do KINDS+=("video"); SECS+=("$CLIP"); done
fi

SCENES=${#KINDS[@]}
[[ "$SCENES" -ge 1 ]] || { echo "ERROR: no scenes — pass --scene KIND:SECONDS or --blocks N." >&2; exit 1; }
for ((i=0;i<SCENES;i++)); do
  case "${KINDS[i]}" in video|image|card) ;; *) echo "ERROR: unknown scene kind: ${KINDS[i]} (want video, image or card)" >&2; exit 2 ;; esac
  awk -v s="${SECS[i]}" 'BEGIN{exit (s+0>=1 && s+0==int(s+0))?0:1}' || { echo "ERROR: scene $((i+1)) length must be a positive whole number of seconds, got: ${SECS[i]}" >&2; exit 1; }
done

# LEVEL LAW: voice is ALWAYS 1.0; SFX is clamped at 0.20 so no caller can bury the narration.
SFXVOL="$(awk -v v="$SFXVOL" 'BEGIN{v=v+0; if(v<0)v=0; if(v>0.2){print "WARN: --sfx-vol clamped to 0.20 (voice stays 1.0)" > "/dev/stderr"; v=0.2} printf "%.3f", v}')"
for b in ffmpeg ffprobe awk; do command -v "$b" >/dev/null 2>&1 || { echo "ERROR: '$b' not found" >&2; exit 1; }; done
mkdir -p "$(dirname "$OUT")"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PBJSON=()   # per-scene sidecar entries

# THE FONT, PROBED RATHER THAN ASSUMED, and only when a card is actually in the deck. The sandbox
# image bakes DejaVu for libass (plan 20-17), but a path is a thing that silently moves between
# base images — and a card whose text failed to draw is a black rectangle the render still calls
# a success. Probe, then hard-error naming the fix.
FONT=""
if printf '%s\n' "${KINDS[@]}" | grep -qx card; then
  # The libass precedent from `burn_caps.sh`: REFUSE a build that cannot draw rather than produce
  # a black rectangle with exit 0. drawtext is a --enable-libfreetype filter and is absent from
  # minimal builds.
  ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' drawtext ' || { echo "ERROR: this ffmpeg has no 'drawtext' filter — libfreetype is missing from the image, and a 'card' scene cannot be drawn." >&2; exit 1; }
  for cand in ${ASSEMBLE_FONT:-} \
      /usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf \
      /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf; do
    [[ -n "$cand" && -f "$cand" ]] && { FONT="$cand"; break; }
  done
  if [[ -z "$FONT" ]]; then
    for dir in /usr/share/fonts /usr/local/share/fonts; do
      [[ -d "$dir" ]] || continue
      FONT="$(find "$dir" -type f -iname '*.ttf' 2>/dev/null | sort | head -1)"
      [[ -n "$FONT" ]] && break
    done
  fi
  [[ -n "$FONT" ]] || { echo "ERROR: a 'card' scene needs a TrueType font and none was found — install dejavu-sans-fonts in the image or set ASSEMBLE_FONT." >&2; exit 1; }
fi

# GEOMETRY comes from the first VIDEO scene, because that is the only kind whose size we do not
# choose. A deck of stills and cards has no such reference, so it takes the portrait tier the
# price table pins. Named here rather than passed as a flag: a caller that could set it could set
# a size nobody priced the encode time for.
W=720; H=1280; FPS=30
for ((i=0;i<SCENES;i++)); do
  [[ "${KINDS[i]}" == "video" ]] || continue
  c0="$IN_DIR/$(printf 'block%02d.mp4' $((i+1)))"
  [[ -f "$c0" ]] || { echo "ERROR: clip not found: $c0" >&2; exit 1; }
  DIMS="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$c0")"
  W="${DIMS%%,*}"; H="${DIMS##*,}"
  FPS_RAW="$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$c0")"
  FPS="$(awk -F/ '{ if(NF==2 && $2>0) printf "%.4f",$1/$2; else print $1 }' <<< "$FPS_RAW")"; [ -z "$FPS" ] && FPS=30
  break
done

TOT=0; for ((i=0;i<SCENES;i++)); do TOT=$((TOT + ${SECS[i]})); done
echo "[1/3] ${SCENES} scenes -> ${W}x${H} @ ${FPS}fps, ${TOT}s total; speech-centred, no atempo" >&2

LIST="$TMP/list.txt"; : > "$LIST"
NARRATED=""   # "start:end" per NARRATED window, for the assert below
START=0
for ((i=0;i<SCENES;i++)); do
  n=$((i+1)); SEC="${SECS[i]}"; KIND="${KINDS[i]}"
  voice="$IN_DIR/$(printf 'voice%02d.wav' "$n")"
  # NORMALISE THE PICTURE FIRST, to exactly SEC seconds at W×H@FPS. Every kind lands in the same
  # shape, so the audio placement below does not care which kind it came from.
  pic="$TMP/p_$(printf '%03d' "$i").mp4"
  NORM="fps=${FPS},format=yuv420p,setsar=1"
  case "$KIND" in
    video)
      clip="$IN_DIR/$(printf 'block%02d.mp4' "$n")"
      [[ -f "$clip" ]] || { echo "ERROR: clip not found: $clip" >&2; exit 1; }
      D="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip")"
      awk -v d="$D" -v c="$SEC" 'BEGIN{exit (d < c-0.5) ? 0 : 1}' && {
        echo "ERROR: clip $n is only ${D}s (<${SEC}s) — REGENERATE the block; a held still frame is not a scene." >&2; exit 1; }
      # Freeze probes: head (first ~1.5s) and tail (last ~2s). Warnings — regenerate the block.
      FRZH="$(ffmpeg -v info -t 1.5 -i "$clip" -vf "freezedetect=n=-60dB:d=1.0" -an -f null - 2>&1 | grep -c freeze_start || true)"
      [[ "$FRZH" != "0" ]] && echo "WARN: clip $n opens on ~static frames — regenerate this block." >&2
      FRZT="$(ffmpeg -v info -sseof -2 -i "$clip" -vf "freezedetect=n=-60dB:d=1.2" -an -f null - 2>&1 | grep -c freeze_start || true)"
      [[ "$FRZT" != "0" ]] && echo "WARN: clip $n ends on ~static frames (frozen tail) — consider regenerating." >&2
      ffmpeg -y -loglevel error -i "$clip" \
        -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,${NORM},tpad=stop_mode=clone:stop_duration=${SEC}" \
        -an -t "$SEC" -c:v libx264 -preset veryfast -crf 20 "$pic"
      ;;
    image)
      still=""
      for ext in png jpg jpeg webp; do
        cand="$IN_DIR/$(printf 'block%02d.%s' "$n" "$ext")"
        [[ -f "$cand" ]] && { still="$cand"; break; }
      done
      [[ -n "$still" ]] || { echo "ERROR: still not found: $IN_DIR/$(printf 'block%02d' "$n").{png,jpg,jpeg,webp}" >&2; exit 1; }
      D="$SEC"
      # KEN BURNS. The x4 upscale BEFORE zoompan is not decoration: zoompan steps the crop window
      # in whole source pixels, so at native size a slow push visibly stutters. Upscaling first
      # makes each step a quarter-pixel at output scale, which reads as smooth. `d=1` advances the
      # zoom once per input frame, and `-loop 1 -framerate` supplies SEC*FPS identical frames.
      ffmpeg -y -loglevel error -loop 1 -framerate "$FPS" -t "$SEC" -i "$still" \
        -vf "scale=${W}*4:${H}*4:force_original_aspect_ratio=increase,crop=${W}*4:${H}*4,zoompan=z='min(zoom+0.0012,1.20)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H},${NORM}" \
        -an -t "$SEC" -c:v libx264 -preset veryfast -crf 20 "$pic"
      ;;
    card)
      txt="$IN_DIR/$(printf 'card%02d.txt' "$n")"
      [[ -f "$txt" ]] || { echo "ERROR: card text not found: $txt" >&2; exit 1; }
      D="$SEC"
      # `textfile=` NOT `text=`: the card's words are model-authored and would otherwise need
      # shell AND filtergraph escaping of `:` `'` `\` `%`, which is the kind of quoting that works
      # until someone writes a colon. `expansion=none` is the load-bearing half — without it
      # drawtext EVALUATES `%{...}` in the file, so model-authored text could run ffmpeg
      # expressions inside the VM. It is a trust boundary, not a formatting preference.
      ffmpeg -y -loglevel error -f lavfi -t "$SEC" -i "color=c=black:s=${W}x${H}:r=${FPS}" \
        -vf "drawtext=fontfile='${FONT}':textfile='${txt}':expansion=none:fontcolor=white:fontsize=${H}/22:line_spacing=14:x=(w-text_w)/2:y=(h-text_h)/2,${NORM}" \
        -an -t "$SEC" -c:v libx264 -preset veryfast -crf 20 "$pic"
      ;;
  esac

  out="$TMP/b_$(printf '%03d' "$i").mp4"
  if [[ -f "$voice" ]]; then
    A="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$voice")"
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

    # HARD checks. The window floor is SEC-1.4 and the ceiling is SEC, expressed relative to the
    # SCENE so a deck of mixed lengths keeps the same headroom everywhere. Upstream learned this
    # the expensive way: a tighter 9.4-9.8s window sat in the DEAD ZONE between the two modes TTS
    # actually returns (~9.0s and ~10.4s for the same line), so good takes were rejected and two
    # dev runs on 2026-07-29 burned ~150 generations on 18 lines before someone started cutting
    # silence inside the takes to pass. Audio surgery is audible; 0.7s of lead and tail is not.
    SPEECH_MIN="$(awk -v c="$SEC" 'BEGIN{printf "%.3f", c-1.4}')"
    SPEECH_MAX="$(awk -v c="$SEC" 'BEGIN{printf "%.3f", c}')"
    OVERRUN=false
    awk -v s="$SPEECH" -v hi="$SPEECH_MAX" 'BEGIN{exit (s > hi) ? 0 : 1}' && OVERRUN=true
    awk -v s="$SPEECH" -v lo="$SPEECH_MIN" -v hi="$SPEECH_MAX" 'BEGIN{exit (s < lo || s > hi) ? 0 : 1}' && {
      echo "ERROR: voice $n carries ${SPEECH}s of speech; required ${SPEECH_MIN}-${SPEECH_MAX}s — REWRITE the narration and regenerate (never pad, atempo, or trim speech)." >&2; exit 1; }

    # LEVEL-MATCH each voice input BEFORE it enters the mix. A fresh TTS take lands near -31 dB
    # mean while dialogue lifted out of a generated clip lands near -21 dB; mixing both at 1.0
    # gives the "narrator blocks are quiet, character blocks are loud" complaint. One single-pass
    # loudnorm per input removes the spread mechanically, before any SFX is placed under it.
    VN="$TMP/v_$(printf '%03d' "$i").wav"
    if ffmpeg -y -loglevel error -i "$voice" -af "loudnorm=I=-19:TP=-1.5:LRA=11" -ar 48000 -ac 2 "$VN" 2>/dev/null; then
      voice="$VN"
    else
      echo "WARN: could not level-match voice $n — mixing it as-is; scene loudness may differ from its neighbours." >&2
    fi

    # Centre the SPEECH in the scene: speech starts at (SEC - speech)/2, compensating for the
    # file's own leading silence. NO atempo.
    PAD_MS="$(awk -v ss="$SS" -v sp="$SPEECH" -v c="$SEC" 'BEGIN{t0=(c-sp)/2; if(t0<0)t0=0; d=t0-ss; if(d<0)d=0; printf "%d", d*1000}')"
    # Keep the source's own diegetic SFX under the voice. A built picture (image/card) has no
    # audio stream at all, and neither does a normalised clip — the SFX is taken from the ORIGINAL
    # clip, which is why `video` re-reads it here.
    if [[ "$KIND" == "video" ]] && [[ "$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$IN_DIR/$(printf 'block%02d.mp4' "$n")" | head -1)" == "audio" ]]; then
      FC="[1:a]adelay=${PAD_MS}:all=1,apad[vo];[2:a]volume=${SFXVOL},apad[sfx];[sfx][vo]amix=inputs=2:duration=first:normalize=0[a]"
      ffmpeg -y -loglevel error -i "$pic" -i "$voice" -i "$IN_DIR/$(printf 'block%02d.mp4' "$n")" -filter_complex "$FC" \
        -map 0:v -map "[a]" -t "$SEC" -c:v copy -c:a aac -b:a 192k "$out"
    else
      FC="[1:a]adelay=${PAD_MS}:all=1,apad[a]"
      ffmpeg -y -loglevel error -i "$pic" -i "$voice" -filter_complex "$FC" \
        -map 0:v -map "[a]" -t "$SEC" -c:v copy -c:a aac -b:a 192k "$out"
    fi

    # The captions rebase, and the whole reason these two numbers are recorded:
    #   absolute_t = speech_abs_s + (word_t_in_clean_take - lead_silence_s)
    # Captions are timed on the CLEAN voice take (no SFX to confuse the STT) and shifted by these.
    SPEECH_ABS="$(awk -v st="$START" -v p="$PAD_MS" -v ss="$SS" 'BEGIN{printf "%.3f", st + p/1000 + ss}')"
    NARRATED="${NARRATED}${START}:$((START + SEC)) "
    printf '  scene %02d (%s): %ss, take %.2fs, speech %.2fs -> starts at %ss\n' "$n" "$KIND" "$SEC" "$A" "$SPEECH" "$SPEECH_ABS" >&2
  else
    # A DELIBERATELY SILENT SCENE. Not an error: the scene contract allows an empty narration cell
    # and a silent scene lends its window to the line before it. It still needs an audio stream,
    # or `concat` would produce a file whose audio stops partway through.
    A=0; SS=0; SPEECH=0; OVERRUN=false; IPN=0; SPEECH_ABS="$START"
    ffmpeg -y -loglevel error -i "$pic" -f lavfi -t "$SEC" -i anullsrc=r=48000:cl=stereo \
      -map 0:v -map 1:a -t "$SEC" -c:v copy -c:a aac -b:a 192k "$out"
    printf '  scene %02d (%s): %ss, silent\n' "$n" "$KIND" "$SEC" >&2
  fi
  # RELATIVE, not absolute. The concat demuxer resolves each entry against the LIST FILE's own
  # directory, and every scene is written beside it — so a basename is both shorter and the only
  # form that survives the list being read from a different mount or drive than it was written on.
  echo "file '$(basename "$out")'" >> "$LIST"

  # `overrun` is FALSE by construction here — an overrunning line exited above. The field is
  # written anyway so that a sidecar which did NOT come from this script has to lie explicitly,
  # and so the validator's refusal has something to refuse.
  PBJSON[i]="$(printf '{"block_index":%d,"window_start_s":%s,"duration_s":%s,"visual":"%s","lead_silence_s":%.3f,"speech_abs_s":%s,"speech_dur_s":%.3f,"clip_dur_s":%.3f,"overrun":%s,"internal_pauses":%d,"freeze_head":%s,"freeze_tail":%s}' \
    "$i" "$START" "$SEC" "$KIND" "$SS" "$SPEECH_ABS" "$SPEECH" "$D" "$OVERRUN" "${IPN:-0}" \
    "$([[ "${FRZH:-0}" != "0" ]] && echo true || echo false)" "$([[ "${FRZT:-0}" != "0" ]] && echo true || echo false)")"
  FRZH=0; FRZT=0
  START=$((START + SEC))
done

VOTRACK="$TMP/joined.mp4"
echo "[2/3] concat -> single track" >&2
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c:v libx264 -preset veryfast -crf 20 -c:a aac -movflags +faststart "$VOTRACK"

# NARRATION-PER-WINDOW assert: every NARRATED window must carry voice-level audio (peaks > -18dB;
# SFX at 0.12 tops out around -18.4dB and stays below). Inspect the centre 60% of each window so
# the gate scales from four-second Sora scenes through the historical ten-second tiers.
#
# Only NARRATED windows are checked. A scene with no take is silent BY CONSTRUCTION, and asserting
# narration over it would fail every deck that uses a card — while checking "every scene" and then
# excusing the silent ones is how this gate goes vacuous. The list is built from the takes that
# actually existed, so a scene that was SUPPOSED to have a take and lost it still fails: its
# window never enters the list, and the sidecar records `speech_dur_s: 0` against it.
if [[ -n "$NARRATED" ]]; then
  QUIET_DUR="$(awk -v c="$(awk -v n="$SCENES" -v t="$TOT" 'BEGIN{printf "%.2f", t/n}')" 'BEGIN{d=c*0.6; if(d<1)d=1; printf "%.2f", d}')"
  QUIET="$(ffmpeg -i "$VOTRACK" -af "silencedetect=noise=-18dB:d=${QUIET_DUR}" -f null - 2>&1 | grep -Eo 'silence_(start|end): *[0-9.]+' || true)"
  EMPTY="$(awk -v spec="$NARRATED" '
    /silence_start/ { s[++k]=$NF+0; next }
    /silence_end/   { e[k]=$NF+0 }
    END {
      m=split(spec, w, " ");
      for (i=1;i<=m;i++) { if (w[i]=="") continue;
        split(w[i], se, ":"); dur=se[2]-se[1]; ws=se[1]+dur*0.2; we=se[2]-dur*0.2;
        for (j=1;j<=k;j++) { ee=(e[j]>0)?e[j]:1e9;
          if (s[j]<=ws && ee>=we) { printf "%s%d", (out++?",":""), i; break } } } }' <<< "$QUIET")"
  if [[ -n "$EMPTY" ]]; then
    echo "ERROR: narrated windows [$EMPTY] have NO narration in their windows — the voice never made it into the mix. Fix the inputs and re-run; do NOT deliver." >&2
    exit 1
  fi
  echo "  narration present in every narrated window" >&2
fi

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

# The fixed-length guarantee, asserted on the OUTPUT: |actual - sum(scene lengths)| <= 1s.
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
#
# `clip_seconds` is the LONGEST scene on a mixed deck. It is meaningless there and the validator
# stops reading it in wave 5 — `target_duration_s` and the per-scene `duration_s` are what replace
# it. On a uniform deck it is still the block length, so a block-contract render produces the same
# sidecar it always did.
CLIPOUT="${SECS[0]}"; for ((i=0;i<SCENES;i++)); do [[ "${SECS[i]}" -gt "$CLIPOUT" ]] && CLIPOUT="${SECS[i]}"; done
SIDE="${OUT}.assembly.json"
{
  printf '{"script":"assemble_final.sh","out":"%s","block_count":%d,"clip_seconds":%s,"target_duration_s":%s,"total_duration_s":%s,"actual_duration_s":%s,"width":%s,"height":%s,"fps":"%s","sfx_vol":%s,"gates":["speech_within_window","clip_covers_window","speech_centred","no_time_stretch","narration_every_window","linear_loudnorm_-16","duration_within_1s","full_decode"],"blocks":[' \
    "$(basename "$OUT")" "$SCENES" "$CLIPOUT" "$TOT" "$TOT" "$FDUR" "$W" "$H" "$FPS" "$SFXVOL"
  for ((i=0;i<SCENES;i++)); do printf '%s%s' "${PBJSON[i]}" "$([[ $i -lt $((SCENES-1)) ]] && echo ,)"; done
  printf '],"ts":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$SIDE"
echo "ASSEMBLY-SIDECAR: $SIDE" >&2
echo "DONE: $OUT  (ONE file, ${SCENES} scenes, ${TOT}s expected, actual ${FDUR}s; decode-validated)" >&2
