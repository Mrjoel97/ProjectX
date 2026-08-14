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
# the scene contract is still being built (waves 5-8).
#
# ── THE MASTER AUDIO TIMELINE (phase 20.2 wave 4) ─────────────────────────────────────────────
# Audio used to be mixed INSIDE each scene and the finished scenes concatenated. That made the
# scene the mixing unit, which is the only reason a voice line had to fit `[SEC-1.4, SEC]` — a
# 56-character cell nobody writes good narration into.
#
# Now every scene is built as a SILENT picture, the pictures are concatenated ONCE, and every
# voice take plus every clip's own diegetic audio is placed on ONE timeline at its ABSOLUTE
# offset and mixed in a SINGLE amix. A line is therefore free to run past its own scene and
# carry over the cut, which is what narration written for a REEL actually does.
#
# What replaces the per-cell band — two errors that are about the TIMELINE, not the cell:
#   * a line whose speech runs past the END OF THE REEL (it would be cut mid-word), and
#   * a line whose speech runs into the START of the NEXT line (two narrators at once).
# Both are still HARD ERRORS to be rewritten upstream. Neither is a length nobody can hit.
#
# WHY image AND card EXIST AT ALL: an unpaid block used to be an UNRENDERABLE one. `TEXT` and
# `SCREEN REC` got no video line, so nothing ever wrote their `blockNN.mp4`, and this script
# hard-errors on the first missing input — so `media.reserveJobInner` refused any deck containing
# one, and the deck the specialist was TAUGHT to write could not be made. These two branches are
# what remove that refusal's reason to exist. A still costs ~a tenth of a generated clip and is
# frame-exact at any length, which is also what makes an exact 15/30/60-second reel possible.
#
# GUARANTEES — each one encodes a failure that has actually happened:
#   * FIXED LENGTH = the TARGET (--target-seconds, defaulting to the sum of the scene lengths).
#     A deck whose scenes do not sum to the declared target is refused BEFORE any work, and the
#     video is NEVER shortened to fit the audio; the final duration is asserted on the output and
#     the script FAILS if it is off by >0.5s. The tolerance was 1s while a clip's length was
#     whatever the provider returned; every duration here is one we choose, so it is 0.5s now.
#   * NO TIME-STRETCH, EVER. No atempo, no speed change, no trimming speech. A voice line whose
#     SPEECH runs past the end of the reel, or into the next line, is a HARD ERROR — rewrite the
#     line and regenerate upstream. It may freely run past its OWN scene (master timeline).
#   * A clip shorter than its scene by > 0.5s is a HARD ERROR. A held still frame is not a scene.
#     (A `card` or an `image` is BUILT to length, so it cannot fail this — only `video` can.)
#   * SPEECH-CENTRED, not file-centred: leading and trailing silence in the TTS take is measured
#     (silencedetect) and ignored, so a padded take cannot shift the words off their scene. A take
#     LONGER than its scene cannot be centred in it, so it anchors at that scene's start instead.
#   * NARRATION OVER EVERY NARRATED SPAN, asserted on the mixed track before finalisation. The
#     span checked is the TAKE's own speech span on the master timeline, not the scene's window:
#     a span quiet through its centre means the voice never reached the mix — the "silent second
#     half" failure of every hand-rolled assembly. A scene with NO take declares no span and is
#     never checked; a scene that DOES have a take always is, so the gate cannot go vacuous by
#     a deck simply using more silent scenes.
#   * LEVEL LAW: voice is always 1.0; the clips' own diegetic SFX sit under it at 0.12
#     (--sfx-vol, hard-clamped ≤ 0.20); final two-pass LINEAR loudnorm at -16 LUFS.
#   * An assembly.json SIDECAR is written last. A final video without one was hand-assembled.
#
# Usage:
#   assemble_final.sh --blocks N [--clip-seconds 10] [--in in] [--out out/final.mp4] [--sfx-vol 0.12]
#   assemble_final.sh --scene video:8 --scene image:6 --scene card:4 --scene video:12 [...]
#   ... [--target-seconds 30]   the DECLARED reel length; the scenes must sum to exactly it
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

IN_DIR="in"; OUT="out/final.mp4"; CLIP=10; SFXVOL="0.12"; BLOCKS=""; TARGET=""
KINDS=(); SECS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --blocks) BLOCKS="$2"; shift 2 ;;
    --clip-seconds) CLIP="$2"; shift 2 ;;
    # The DECLARED reel length, off the deck header. Asserted twice: the scenes must sum to it
    # before any work, and the finished file must land within 0.5s of it.
    --target-seconds) TARGET="$2"; shift 2 ;;
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

# THE TARGET, asserted BEFORE any work. A deck that promised 30 seconds and lists scenes summing
# to 28 is a deck that was mispriced and miswritten, and finding that out after the paid clips are
# already in the input directory costs the whole reel. Refuse it while it is still free.
if [[ -n "$TARGET" ]]; then
  awk -v t="$TARGET" 'BEGIN{exit (t+0>=1 && t+0==int(t+0))?0:1}' || { echo "ERROR: --target-seconds must be a positive integer, got: $TARGET" >&2; exit 1; }
  [[ "$TOT" -eq "$TARGET" ]] || { echo "ERROR: the scenes sum to ${TOT}s but the deck declares --target-seconds ${TARGET} — fix the deck; the assembler will not pad or trim to reach a target." >&2; exit 1; }
else
  TARGET="$TOT"
fi

echo "[1/4] ${SCENES} scenes -> ${W}x${H} @ ${FPS}fps, ${TOT}s total; speech-centred, no atempo" >&2

LIST="$TMP/list.txt"; : > "$LIST"
# The master timeline, gathered in the loop and MIXED ONCE below. Every delay here is ABSOLUTE
# (milliseconds from the start of the reel), which is the whole change: a take is no longer
# placed relative to a scene it is then trapped inside.
TAKE_FILE=(); TAKE_PAD=(); TAKE_ABS=(); TAKE_SPEECH=(); TAKE_SCENE=()
DIEG_FILE=(); DIEG_PAD=()
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

  # THE DIEGETIC BED. A generated clip's own SFX has to come off the ORIGINAL file — the picture
  # built above is silent by construction — and it is lifted out here, at this scene's length, so
  # the master mix below is a list of wavs and offsets rather than a second pass over the inputs.
  if [[ "$KIND" == "video" ]]; then
    src="$IN_DIR/$(printf 'block%02d.mp4' "$n")"
    if [[ "$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$src" | head -1)" == "audio" ]]; then
      dieg="$TMP/d_$(printf '%03d' "$i").wav"
      if ffmpeg -y -loglevel error -i "$src" -vn -t "$SEC" -ar 48000 -ac 2 "$dieg" 2>/dev/null; then
        DIEG_FILE+=("$dieg"); DIEG_PAD+=($((START * 1000)))
      fi
    fi
  fi

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

    # NO PER-CELL BAND (wave 4). The old floor/ceiling of [SEC-1.4, SEC] existed because the
    # SCENE was the mixing unit; it is not any more. Upstream learned what a tight band costs the
    # expensive way — a 9.4-9.8s window sat in the DEAD ZONE between the two modes TTS actually
    # returns (~9.0s and ~10.4s for the same line), so good takes were rejected and two dev runs
    # on 2026-07-29 burned ~150 generations on 18 lines before someone started cutting silence
    # inside the takes to pass. Audio surgery is audible. The replacement checks are on the
    # TIMELINE (past the reel's end, or into the next line) and run once all takes are known.
    OVERRUN=false

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

    # PLACEMENT on the master timeline, in ABSOLUTE milliseconds. Speech is centred in its own
    # scene — `(SEC - speech)/2` past the scene's start — compensating for the take's own leading
    # silence. A take LONGER than its scene cannot be centred in it without starting before the
    # scene does, so it ANCHORS at the scene's start and carries over the cut instead. NO atempo.
    PAD_MS="$(awk -v st="$START" -v ss="$SS" -v sp="$SPEECH" -v c="$SEC" 'BEGIN{t0=st+(c-sp)/2; if(sp>c)t0=st; d=t0-ss; if(d<0)d=0; printf "%d", d*1000}')"

    # The captions rebase, and the whole reason these two numbers are recorded:
    #   absolute_t = speech_abs_s + (word_t_in_clean_take - lead_silence_s)
    # Captions are timed on the CLEAN voice take (no SFX to confuse the STT) and shifted by these.
    # Recomputed FROM the delay rather than from the intent, so the clamp above cannot make the
    # sidecar disagree with the mix.
    SPEECH_ABS="$(awk -v p="$PAD_MS" -v ss="$SS" 'BEGIN{printf "%.3f", p/1000 + ss}')"
    TAKE_FILE+=("$voice"); TAKE_PAD+=("$PAD_MS"); TAKE_ABS+=("$SPEECH_ABS")
    TAKE_SPEECH+=("$SPEECH"); TAKE_SCENE+=("$n")
    printf '  scene %02d (%s): %ss, take %.2fs, speech %.2fs -> starts at %ss\n' "$n" "$KIND" "$SEC" "$A" "$SPEECH" "$SPEECH_ABS" >&2
  else
    # A DELIBERATELY SILENT SCENE. Not an error: the scene contract allows an empty narration cell
    # and a silent scene lends its window to the line before it — which under the master timeline
    # is literal, since the previous line may still be speaking here.
    A=0; SS=0; SPEECH=0; OVERRUN=false; IPN=0; SPEECH_ABS="$START"
    printf '  scene %02d (%s): %ss, silent\n' "$n" "$KIND" "$SEC" >&2
  fi
  # RELATIVE, not absolute. The concat demuxer resolves each entry against the LIST FILE's own
  # directory, and every scene is written beside it — so a basename is both shorter and the only
  # form that survives the list being read from a different mount or drive than it was written on.
  # The PICTURE is what is listed: it carries no audio at all, and the audio arrives in one mix.
  echo "file '$(basename "$pic")'" >> "$LIST"

  # `overrun` is FALSE by construction — a line that overruns THE REEL, or the next line, exits at
  # the timeline checks below, and this sidecar is only written after they pass. Overrunning its
  # own SCENE is no longer an overrun at all. The field is written anyway so that a sidecar which
  # did NOT come from this script has to lie explicitly, and so the validator has something to
  # refuse.
  PBJSON[i]="$(printf '{"block_index":%d,"window_start_s":%s,"duration_s":%s,"visual":"%s","lead_silence_s":%.3f,"speech_abs_s":%s,"speech_dur_s":%.3f,"clip_dur_s":%.3f,"overrun":%s,"internal_pauses":%d,"freeze_head":%s,"freeze_tail":%s}' \
    "$i" "$START" "$SEC" "$KIND" "$SS" "$SPEECH_ABS" "$SPEECH" "$D" "$OVERRUN" "${IPN:-0}" \
    "$([[ "${FRZH:-0}" != "0" ]] && echo true || echo false)" "$([[ "${FRZT:-0}" != "0" ]] && echo true || echo false)")"
  FRZH=0; FRZT=0
  START=$((START + SEC))
done

# ── THE TIMELINE CHECKS, in place of the per-cell band ────────────────────────────────────────
# These are the two ways speech can still be WRONG once a line is free to cross a scene boundary.
# Both are hard errors for the same reason the band was: the fix is to rewrite the line upstream,
# never to stretch, trim or pad audio here. 0.05s of slack absorbs silencedetect's own resolution.
NTAKE=${#TAKE_FILE[@]}
TAKE_END=()
for ((k=0;k<NTAKE;k++)); do
  TAKE_END[k]="$(awk -v a="${TAKE_ABS[k]}" -v s="${TAKE_SPEECH[k]}" 'BEGIN{printf "%.3f", a+s}')"
  awk -v e="${TAKE_END[k]}" -v t="$TOT" 'BEGIN{exit (e > t+0.05) ? 0 : 1}' && {
    echo "ERROR: voice ${TAKE_SCENE[k]} is still speaking at ${TAKE_END[k]}s but the reel ends at ${TOT}s — the line would be cut mid-word. REWRITE it shorter or give the deck more seconds (never pad, atempo, or trim speech)." >&2; exit 1; }
  if [[ $((k+1)) -lt "$NTAKE" ]]; then
    awk -v e="${TAKE_END[k]}" -v nx="${TAKE_ABS[k+1]}" 'BEGIN{exit (e > nx+0.05) ? 0 : 1}' && {
      echo "ERROR: voice ${TAKE_SCENE[k]} runs to ${TAKE_END[k]}s but voice ${TAKE_SCENE[k+1]} starts at ${TAKE_ABS[k+1]}s — two narrators would speak at once. REWRITE one of the two lines shorter." >&2; exit 1; }
  fi
done

VOSIL="$TMP/silent.mp4"
echo "[2/4] concat -> single silent picture track" >&2
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -an -c:v libx264 -preset veryfast -crf 20 "$VOSIL"

# ── THE SINGLE MIX ────────────────────────────────────────────────────────────────────────────
# Input 0 is the picture. Input 1 is a silence bed spanning the WHOLE reel — it costs nothing at
# normalize=0 and it means the mix always has an input and always spans the video, so a reel with
# no narration at all still carries a full-length audio stream instead of stopping partway.
# Everything after that is one take or one diegetic bed, delayed to its ABSOLUTE offset.
echo "[3/4] mix ${NTAKE} take(s) + ${#DIEG_FILE[@]} diegetic bed(s) on ONE timeline" >&2
VOTRACK="$TMP/joined.mp4"
MIXARGS=(); FC=""; LBLS="[1:a]"; NMIX=1; IDX=2
AFMT="aformat=sample_rates=48000:channel_layouts=stereo"
for ((k=0;k<NTAKE;k++)); do
  MIXARGS+=(-i "${TAKE_FILE[k]}")
  FC="${FC}[${IDX}:a]${AFMT},adelay=${TAKE_PAD[k]}:all=1[t${k}];"
  LBLS="${LBLS}[t${k}]"; NMIX=$((NMIX+1)); IDX=$((IDX+1))
done
NDIEG=${#DIEG_FILE[@]}
for ((k=0;k<NDIEG;k++)); do
  MIXARGS+=(-i "${DIEG_FILE[k]}")
  FC="${FC}[${IDX}:a]${AFMT},volume=${SFXVOL},adelay=${DIEG_PAD[k]}:all=1[s${k}];"
  LBLS="${LBLS}[s${k}]"; NMIX=$((NMIX+1)); IDX=$((IDX+1))
done
# normalize=0 is the LEVEL LAW in one option: amix's default divides every input by the number of
# inputs, which would make a reel quieter simply for having more lines in it.
FC="${FC}${LBLS}amix=inputs=${NMIX}:duration=longest:normalize=0[a]"
ffmpeg -y -loglevel error -i "$VOSIL" -f lavfi -t "$TOT" -i anullsrc=r=48000:cl=stereo \
  ${MIXARGS[@]+"${MIXARGS[@]}"} -filter_complex "$FC" \
  -map 0:v -map "[a]" -t "$TOT" -c:v copy -c:a aac -b:a 192k -movflags +faststart "$VOTRACK"

# NARRATION-OVER-EVERY-NARRATED-SPAN assert: each take's own speech span on the master timeline
# must carry voice-level audio (peaks > -18dB; SFX at 0.12 tops out around -18.4dB and stays
# below). The centre 60% of the span is inspected, so the gate scales from a two-second line to a
# fifteen-second one without a per-tier constant.
#
# The spans come from the takes that ACTUALLY EXISTED, which is what keeps this gate honest under
# optional narration: a scene with no take declares no span and is never checked, but a scene that
# HAS a take is always checked — so a deck cannot make the gate vacuous by adding silent scenes,
# and a take that was level-matched, delayed and then lost on its way into the mix still fails
# here. Checking "every scene" and then excusing the silent ones is the version that goes vacuous.
if [[ "$NTAKE" -gt 0 ]]; then
  NARRATED=""
  for ((k=0;k<NTAKE;k++)); do NARRATED="${NARRATED}${TAKE_SCENE[k]}:${TAKE_ABS[k]}:${TAKE_END[k]} "; done
  # One threshold for the whole file, so it has to be short enough for the SHORTEST span's centre.
  QUIET_DUR="$(awk -v spec="$NARRATED" 'BEGIN{m=split(spec,w," "); mn=1e9; for(i=1;i<=m;i++){if(w[i]=="")continue; split(w[i],se,":"); d=se[3]-se[2]; if(d<mn)mn=d} d=mn*0.6; if(d<0.3)d=0.3; printf "%.2f", d}')"
  QUIET="$(ffmpeg -i "$VOTRACK" -af "silencedetect=noise=-18dB:d=${QUIET_DUR}" -f null - 2>&1 | grep -Eo 'silence_(start|end): *[0-9.]+' || true)"
  EMPTY="$(awk -v spec="$NARRATED" '
    /silence_start/ { s[++k]=$NF+0; next }
    /silence_end/   { e[k]=$NF+0 }
    END {
      m=split(spec, w, " ");
      for (i=1;i<=m;i++) { if (w[i]=="") continue;
        split(w[i], se, ":"); dur=se[3]-se[2]; ws=se[2]+dur*0.2; we=se[3]-dur*0.2;
        for (j=1;j<=k;j++) { ee=(e[j]>0)?e[j]:1e9;
          if (s[j]<=ws && ee>=we) { printf "%s%s", (out++?",":""), se[1]; break } } } }' <<< "$QUIET")"
  if [[ -n "$EMPTY" ]]; then
    echo "ERROR: the narration declared for scene(s) [$EMPTY] is NOT in the mix — those spans are silent through their centre. Fix the inputs and re-run; do NOT deliver." >&2
    exit 1
  fi
  echo "  narration present across all ${NTAKE} narrated span(s)" >&2
fi

echo "[4/4] finalize -> $OUT" >&2
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

# The fixed-length guarantee, asserted on the OUTPUT against the DECLARED TARGET: 0.5s, not 1s.
# The old tolerance was sized for clips whose length was whatever the provider returned. Every
# duration on a scene timeline is one this script chose and built to, so a whole second of drift
# is no longer measurement noise — it is a scene that did not come out the length it was given.
FDUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")"
awk -v d="$FDUR" -v e="$TARGET" 'BEGIN{x=d-e; if(x<0)x=-x; exit (x<=0.5)?0:1}' || {
  echo "ERROR: final duration ${FDUR}s != declared ${TARGET}s (+/-0.5s) — do NOT deliver; investigate the inputs." >&2; exit 1; }

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
# The validator still refuses a sidecar whose `speech_dur_s` exceeds `clip_seconds`, and on the
# scene timeline a line is ALLOWED to be longer than the longest scene. That refusal goes away
# with `clip_seconds` itself in wave 5; until then, say so out loud rather than let a render that
# cost money be refused at publish with no explanation anywhere.
for ((k=0;k<NTAKE;k++)); do
  awk -v s="${TAKE_SPEECH[k]}" -v c="$CLIPOUT" 'BEGIN{exit (s>c)?0:1}' && \
    echo "WARN: voice ${TAKE_SCENE[k]} carries ${TAKE_SPEECH[k]}s of speech, longer than the longest scene (${CLIPOUT}s). The render is correct, but the wave-4 sidecar validator will refuse it as speech_exceeds_window until clip_seconds is removed (wave 5)." >&2
done
SIDE="${OUT}.assembly.json"
{
  printf '{"script":"assemble_final.sh","out":"%s","block_count":%d,"clip_seconds":%s,"target_duration_s":%s,"total_duration_s":%s,"actual_duration_s":%s,"width":%s,"height":%s,"fps":"%s","sfx_vol":%s,"gates":["speech_fits_the_reel","no_overlapping_lines","clip_covers_window","speech_centred","no_time_stretch","narration_every_narrated_span","master_audio_timeline","linear_loudnorm_-16","duration_within_0.5s","full_decode"],"blocks":[' \
    "$(basename "$OUT")" "$SCENES" "$CLIPOUT" "$TARGET" "$TOT" "$FDUR" "$W" "$H" "$FPS" "$SFXVOL"
  for ((i=0;i<SCENES;i++)); do printf '%s%s' "${PBJSON[i]}" "$([[ $i -lt $((SCENES-1)) ]] && echo ,)"; done
  printf '],"ts":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$SIDE"
echo "ASSEMBLY-SIDECAR: $SIDE" >&2
echo "DONE: $OUT  (ONE file, ${SCENES} scenes, ${TOT}s expected, actual ${FDUR}s; decode-validated)" >&2
