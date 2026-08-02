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
 */

import { err, ok, type Result } from "./result";
import { CLIP_SECONDS } from "./storyboard";

export type AssemblyBlock = {
  blockIndex: number;
  windowStartS: number;
  /** The take's own leading silence. Half of the captions rebase. */
  leadSilenceS: number;
  /** Absolute position of this block's SPEECH in the finished file. The other half:
   *  `absolute_t = speechAbsS + (word_t_in_clean_take - leadSilenceS)`. */
  speechAbsS: number;
  speechDurS: number;
  overrun: boolean;
};

export type AssemblyReport = {
  blockCount: number;
  clipSeconds: number;
  totalDurationS: number;
  actualDurationS: number;
  gates: readonly string[];
  blocks: readonly AssemblyBlock[];
};

export type AssemblyError =
  | {
      code:
        | "empty"
        | "bad_json"
        | "not_an_object"
        | "missing_field"
        | "block_count_mismatch"
        | "bad_clip_seconds"
        | "duration_mismatch"
        | "non_monotonic_speech";
    }
  | {
      code: "block_overrun" | "speech_exceeds_window" | "missing_speech_anchor";
      blockIndex: number;
    };

/** The script asserts its own output to ±1s; the validator holds it to the same number rather than
 *  inventing a second tolerance that could disagree with the gate that produced the file. */
export const DURATION_TOLERANCE_S = 1;

const CLIP_SET = new Set<number>(CLIP_SECONDS);
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

  if (!num(o.block_count) || !num(o.clip_seconds) || !num(o.total_duration_s)) {
    return err({ code: "missing_field" });
  }
  if (!num(o.actual_duration_s) || !Array.isArray(o.blocks) || !Array.isArray(o.gates)) {
    return err({ code: "missing_field" });
  }
  const blockCount = o.block_count;
  const clipSeconds = o.clip_seconds;

  // {5,10} — the same closed set the price table and the parser enforce. A sidecar claiming any
  // other window describes a render nobody priced.
  if (!CLIP_SET.has(clipSeconds)) return err({ code: "bad_clip_seconds" });
  if (o.blocks.length !== blockCount) return err({ code: "block_count_mismatch" });
  if (blockCount < 1) return err({ code: "block_count_mismatch" });

  const expected = blockCount * clipSeconds;
  if (!near(o.total_duration_s, expected) || !near(o.actual_duration_s, expected)) {
    return err({ code: "duration_mismatch" });
  }

  const blocks: AssemblyBlock[] = [];
  let previousSpeechAbs = Number.NEGATIVE_INFINITY;
  for (const [index, entry] of o.blocks.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return err({ code: "not_an_object" });
    }
    const b = entry as Record<string, unknown>;

    // Both rebase anchors, both required: without either one the captions have nothing to shift
    // against, so a render that omitted one did not produce the record the contract requires.
    if (!num(b.speech_abs_s) || !num(b.lead_silence_s)) {
      return err({ code: "missing_speech_anchor", blockIndex: index });
    }
    if (!num(b.window_start_s) || !num(b.speech_dur_s) || typeof b.overrun !== "boolean") {
      return err({ code: "missing_field" });
    }

    // D8 makes an overrunning voice line a HARD ERROR, so a sidecar reporting one is reporting a
    // FAILED render, not a rendered failure. The shipped script exits before writing the sidecar
    // in that case — this refusal exists for a sidecar that did NOT come from it.
    if (b.overrun) return err({ code: "block_overrun", blockIndex: index });
    // …and the same thing by arithmetic, in case the flag itself is the lie.
    if (b.speech_dur_s > clipSeconds) {
      return err({ code: "speech_exceeds_window", blockIndex: index });
    }
    if (b.speech_abs_s <= previousSpeechAbs) return err({ code: "non_monotonic_speech" });
    previousSpeechAbs = b.speech_abs_s;

    blocks.push({
      blockIndex: num(b.block_index) ? b.block_index : index,
      windowStartS: b.window_start_s,
      leadSilenceS: b.lead_silence_s,
      speechAbsS: b.speech_abs_s,
      speechDurS: b.speech_dur_s,
      overrun: b.overrun,
    });
  }

  return ok({
    blockCount,
    clipSeconds,
    totalDurationS: o.total_duration_s,
    actualDurationS: o.actual_duration_s,
    gates: o.gates.filter((g): g is string => typeof g === "string"),
    blocks,
  });
}

/** The one-line question every caller actually asks. */
export const isGovernedRender = (raw: string): boolean => parseAssemblySidecar(raw).ok;
