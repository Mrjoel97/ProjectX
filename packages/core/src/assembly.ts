/**
 * The assembly.json sidecar validator (MEDIA-01, D8). Pure TS, Convex-free (CLAUDE.md §1).
 *
 * ponytail: this validator IS the definition of "a governed render". D8: *"a final video without
 * an assembly.json was hand-assembled."* So an invalid sidecar does not mean "render with a
 * warning" — it means the reel is NOT published and the job fails with a code. Plan 20-16 enforces
 * that; this file is what it enforces. Upgrade path if the sidecar ever gains fields: add them
 * here with their range checks, and the runner does not change.
 *
 * SNAKE_CASE IN, CAMELCASE OUT. The sidecar is written by a shell script
 * (`packages/backend/convex/render/assemble_final.sh`) and uses `speech_abs_s`; the TS domain uses
 * `speechAbsS`. The mapping lives HERE, in one place, so a field-name correction is a one-file
 * change — which is the whole reason this validator is a separate artifact from the runner.
 *
 * Every failure RETURNS a discriminated code. Nothing throws, including on malformed JSON: a
 * sidecar is untrusted input (it comes back from a sandbox), and a governed stop is a value.
 *
 * ── 20.2 wave 5: the SCENE shape, and the v1 shape REFUSED ─────────────────────────────────────
 *
 * A reel is a list of scenes with their own lengths, so `block_count` × `clip_seconds` is no
 * longer a length and `clip_seconds` is no longer a fact. The v1 shape is refused OUTRIGHT rather
 * than tolerated alongside: a sidecar is proof of a governed render, and a validator that accepts
 * two shapes proves neither. That refusal is safe because it was MEASURED before it shipped —
 * production held 257 `plans` rows and zero carried a `sidecarStorageId`, so no published reel has
 * a v1 sidecar to orphan.
 *
 * What this file now re-asserts from the bytes, independently of the script that wrote them:
 * the scenes sum to the declared target, the running-sum offsets are actually running sums, no
 * line runs past the end of the reel, and no line runs into the next one. Those are exactly the
 * guarantees `assemble_final.sh` enforces — restated here so a sidecar that did NOT come from it
 * has to lie about every one of them rather than just about the flag.
 */

import { err, ok, type Result } from "./result";

/** The three kinds of picture the assembler can build. Deliberately the SCRIPT's vocabulary
 *  (`video`/`image`/`card`), not the deck's `VisualKind` — this is what the renderer did, and the
 *  mapping from what the deck ASKED for lives upstream at the reserve. */
export const ASSEMBLY_VISUALS = ["video", "image", "card"] as const;
export type AssemblyVisual = (typeof ASSEMBLY_VISUALS)[number];

export type AssemblyScene = {
  index: number;
  /** Running sum of the prior scene durations — NOT `index × clipSeconds`. */
  startS: number;
  durationS: number;
  visual: AssemblyVisual;
  /** The take's own leading silence. Half of the captions rebase. */
  leadSilenceS: number;
  /** Absolute position of this scene's SPEECH in the finished file. The other half:
   *  `absolute_t = speechAbsS + (word_t_in_clean_take - leadSilenceS)`. */
  speechAbsS: number;
  /** `0` for a deliberately silent scene. This is the ONLY record of which scenes owned a take,
   *  and `buildCaptionLines` keys the transcript offsets off it. */
  speechDurS: number;
  overrun: boolean;
};

export type AssemblyReport = {
  sceneCount: number;
  /** The DECLARED reel length the deck was priced and written against. */
  targetDurationS: number;
  totalDurationS: number;
  actualDurationS: number;
  gates: readonly string[];
  scenes: readonly AssemblyScene[];
};

export type AssemblyError =
  | {
      code:
        | "empty"
        | "bad_json"
        | "not_an_object"
        | "legacy_sidecar"
        | "missing_field"
        | "scene_count_mismatch"
        | "duration_mismatch"
        | "non_monotonic_speech";
    }
  | {
      code:
        | "scene_overrun"
        | "bad_scene_shape"
        | "bad_scene_offset"
        | "speech_past_reel"
        | "overlapping_speech"
        | "missing_speech_anchor";
      sceneIndex: number;
    };

/** The script asserts its own output to ±0.5s (20.2 wave 4 tightened it from 1s, because every
 *  duration on a scene timeline is one the script chose and built to); the validator holds it to
 *  the same number rather than inventing a second tolerance that could disagree with the gate that
 *  produced the file. */
export const DURATION_TOLERANCE_S = 0.5;

/** The slack `assemble_final.sh` allows on its two timeline checks, for `silencedetect`'s own
 *  resolution. Restated here so the validator refuses exactly what the script refuses. */
export const TIMELINE_SLACK_S = 0.05;

const VISUAL_SET = new Set<string>(ASSEMBLY_VISUALS);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const near = (a: number, b: number) => Math.abs(a - b) <= DURATION_TOLERANCE_S;

export function parseAssemblySidecar(raw: string): Result<AssemblyReport, AssemblyError> {
  // An EMPTY sidecar and a MALFORMED one are different operational stories, so they get different
  // codes: empty means the script died before it wrote one (the render never finished), malformed
  // means it wrote one and something corrupted it.
  if (raw.trim() === "") return err({ code: "empty" });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ code: "bad_json" });
  }
  // `typeof null === "object"`, and an array is an object too — both are "valid JSON that is not a
  // sidecar", which is a different failure from "not JSON at all".
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err({ code: "not_an_object" });
  }
  const o = parsed as Record<string, unknown>;

  // THE V1 SHAPE, NAMED. Falling through to `missing_field` would be technically correct and
  // operationally useless: "a field is missing" sends someone looking for a corrupted write, where
  // "this is the old shape" says the runner is stale and names the fix. Any ONE of the three
  // retired fields is enough — a sidecar carrying them is not a scene-timeline render whatever
  // else it also carries.
  if (o.block_count !== undefined || o.clip_seconds !== undefined || o.blocks !== undefined) {
    return err({ code: "legacy_sidecar" });
  }

  if (!num(o.scene_count) || !num(o.target_duration_s) || !num(o.total_duration_s)) {
    return err({ code: "missing_field" });
  }
  if (!num(o.actual_duration_s) || !Array.isArray(o.scenes) || !Array.isArray(o.gates)) {
    return err({ code: "missing_field" });
  }
  const sceneCount = o.scene_count;
  const targetDurationS = o.target_duration_s;

  if (o.scenes.length !== sceneCount) return err({ code: "scene_count_mismatch" });
  if (sceneCount < 1) return err({ code: "scene_count_mismatch" });

  // The declared target IS the length. `total_duration_s` is the sum the script computed and
  // `actual_duration_s` is what ffprobe measured; all three must agree, or the file is not the
  // reel that was priced.
  if (o.total_duration_s !== targetDurationS) return err({ code: "duration_mismatch" });
  if (!near(o.actual_duration_s, targetDurationS)) return err({ code: "duration_mismatch" });

  const scenes: AssemblyScene[] = [];
  let previousSpeechAbs = Number.NEGATIVE_INFINITY;
  let runningStart = 0;
  for (const [index, entry] of o.scenes.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return err({ code: "not_an_object" });
    }
    const s = entry as Record<string, unknown>;

    // Both rebase anchors, both required: without either one the captions have nothing to shift
    // against, so a render that omitted one did not produce the record the contract requires.
    if (!num(s.speech_abs_s) || !num(s.lead_silence_s)) {
      return err({ code: "missing_speech_anchor", sceneIndex: index });
    }
    if (!num(s.start_s) || !num(s.duration_s) || !num(s.speech_dur_s)) {
      return err({ code: "missing_field" });
    }
    if (typeof s.overrun !== "boolean") return err({ code: "missing_field" });

    // A scene's length and kind are what make the deck a reel rather than a list. An unknown kind
    // is a renderer we did not ship talking to us.
    if (s.duration_s <= 0 || typeof s.visual !== "string" || !VISUAL_SET.has(s.visual)) {
      return err({ code: "bad_scene_shape", sceneIndex: index });
    }
    // THE RUNNING SUM, re-derived rather than trusted. `startS` disagreeing with the durations
    // before it is the exact failure the scene contract replaced `index × clipSeconds` to prevent,
    // and captions rebase against these numbers.
    if (s.start_s !== runningStart) return err({ code: "bad_scene_offset", sceneIndex: index });
    runningStart += s.duration_s;

    // D8 makes an overrunning voice line a HARD ERROR, so a sidecar reporting one is reporting a
    // FAILED render, not a rendered failure. The shipped script exits before writing the sidecar
    // in that case — this refusal exists for a sidecar that did NOT come from it.
    if (s.overrun) return err({ code: "scene_overrun", sceneIndex: index });
    // …and the same thing by arithmetic, in case the flag itself is the lie. NOT "speech longer
    // than its own scene" — since wave 4 that is legal and is the point of the scene timeline.
    // What is still forbidden is speech running off the END of the reel, where it would be cut
    // mid-word.
    if (s.speech_dur_s < 0) return err({ code: "bad_scene_shape", sceneIndex: index });
    if (s.speech_abs_s + s.speech_dur_s > targetDurationS + TIMELINE_SLACK_S) {
      return err({ code: "speech_past_reel", sceneIndex: index });
    }
    if (s.speech_abs_s <= previousSpeechAbs) return err({ code: "non_monotonic_speech" });
    previousSpeechAbs = s.speech_abs_s;

    scenes.push({
      index: num(s.index) ? s.index : index,
      startS: s.start_s,
      durationS: s.duration_s,
      visual: s.visual as AssemblyVisual,
      leadSilenceS: s.lead_silence_s,
      speechAbsS: s.speech_abs_s,
      speechDurS: s.speech_dur_s,
      overrun: s.overrun,
    });
  }

  // The scenes must actually add up to what the deck declared. Checked AFTER the loop because the
  // running sum is built there, and checked at all because `total_duration_s` is the script's own
  // arithmetic — agreeing with it proves nothing about the per-scene rows the captions read.
  if (runningStart !== targetDurationS) return err({ code: "duration_mismatch" });

  // NO TWO LINES AT ONCE. The other half of what replaced the per-cell band: over the scenes that
  // OWN a take, in order, one line may not still be speaking when the next one starts.
  const narrated = scenes.filter((s) => s.speechDurS > 0);
  for (const [i, s] of narrated.entries()) {
    const next = narrated[i + 1];
    if (next && s.speechAbsS + s.speechDurS > next.speechAbsS + TIMELINE_SLACK_S) {
      return err({ code: "overlapping_speech", sceneIndex: s.index });
    }
  }

  return ok({
    sceneCount,
    targetDurationS,
    totalDurationS: o.total_duration_s,
    actualDurationS: o.actual_duration_s,
    gates: o.gates.filter((g): g is string => typeof g === "string"),
    scenes,
  });
}

/** The one-line question every caller actually asks. */
export const isGovernedRender = (raw: string): boolean => parseAssemblySidecar(raw).ok;
