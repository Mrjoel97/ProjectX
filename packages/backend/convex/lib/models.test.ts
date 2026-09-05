// The ONE model route table — behavioural tests only.
//
// `resolveModel` existed SEVEN times — `llm.ts`, `blueprint.ts`, `onboarding.ts`, `vaultDigest.ts`,
// `vaultLlm.ts`, `voiceDoc.ts`, `knowledgeLlm.ts` — and only `llm.ts`'s ever grew the `or/` branch,
// while `DEFAULT_MODEL` is `"or/openai/gpt-4o-mini"`. Every other copy handed an OpenRouter ROUTE id
// to the OpenAI provider: a different endpoint with a different key. All seven were converted to
// import this table (2026-08-28). Nothing enforces that they stay converted — see below.
//
// These tests assert the RESOLVED PROVIDER, not that a function was called: `.provider` and
// `.modelId` are what the AI SDK actually sends the request with.
//
// ── WHAT USED TO BE HERE, AND WHY IT IS NOT ───────────────────────────────────────────────────
//
// A source-text scan for "a second route table" (a name scan, then a call-shape scan, then a
// provider-IMPORT scan, then an export-surface pin) used to live in this file. It was defeated
// five times, each escape RUN as a planted module under `convex/` that left the whole suite green:
// a renamed const (`pickModel`), a renamed callee (`createOpenAI({…})(id)` and a local alias), the
// documented subpath specifier `@ai-sdk/openai/internal`, `export default openai;`, and finally
// LEADING WHITESPACE against an anchored `^export` match. It is DELETED rather than iterated a
// sixth time: a green regex that reads as protection and is not is worse than a stated gap.
//
// COPY-DRIFT IS THEREFORE UNGUARDED. See `docs/playbooks/cockpit.md`'s model-routing section and
// `.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md` for the five escapes
// and the upgrade path (an AST/type-level pass or a lint rule — not a pattern over source text).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { missingEnv } from "./env";
import {
  NODE_ONLY_MODEL_PREFIX,
  offlineSeamAvailable,
  resolveModel,
  transcriptionModel,
  transcriptionUsage,
} from "./models";

// A key is needed only to CONSTRUCT the provider; nothing here makes a request.
process.env.OPENROUTER_API_KEY ??= "test-openrouter-key";
process.env.OPENAI_API_KEY ??= "test-openai-key";

/**
 * `LanguageModel` is `LanguageModelV2 | string` in ai@5 — a bare string means "let the caller's
 * default provider decide", which is precisely the routing this table exists to take away from
 * chance. So a string here is a failure, not a shape to widen the assertions for.
 */
const resolved = (id: string) => {
  const model = resolveModel(id);
  if (typeof model === "string") throw new Error(`resolveModel(${id}) returned a bare id`);
  return model;
};

describe("resolveModel routes an id to the provider that id names", () => {
  test("an `or/` id goes to OpenRouter with the ROUTE PREFIX STRIPPED", () => {
    // THE DEFECT, as a value: before this module existed, `knowledgeLlm.ts` resolved this id with
    // `openai(id.replace(/^openai\//, ""))`, which leaves `or/openai/gpt-4o-mini` untouched and
    // sends it to OpenAI, which has never heard of that model.
    const model = resolved("or/openai/gpt-4o-mini");
    expect(model.provider).toContain("openrouter");
    expect(model.provider).not.toContain("openai.");
    expect(model.modelId).toBe("openai/gpt-4o-mini");
  });

  test("the DEFAULT model — the one the knowledge plane actually sends — routes to OpenRouter", async () => {
    // Read from `@pikar/cost` rather than spelled here, because the whole failure was a constant
    // changing under copies that did not move with it.
    const { DEFAULT_MODEL } = await import("@pikar/cost");
    const model = resolved(DEFAULT_MODEL);
    expect(DEFAULT_MODEL.startsWith("or/"), `${DEFAULT_MODEL} is no longer an or/ route`).toBe(
      true,
    );
    expect(model.provider).toContain("openrouter");
    expect(model.modelId).toBe(DEFAULT_MODEL.slice(3));
  });

  test("a `stealth/` id keeps its FULL id — OpenRouter wants it and PRICING is keyed on it", () => {
    const model = resolved("stealth/ox-alpha");
    expect(model.provider).toContain("openrouter");
    expect(model.modelId).toBe("stealth/ox-alpha");
  });

  test("a bare or `openai/` id goes to OpenAI with the vendor prefix stripped", () => {
    for (const id of ["openai/gpt-4o-mini", "gpt-4o-mini"]) {
      const model = resolved(id);
      expect(model.provider).toContain("openai");
      expect(model.provider).not.toContain("openrouter");
      expect(model.modelId).toBe("gpt-4o-mini");
    }
  });

  test("a `google/` id FAILS CLOSED rather than being silently routed to OpenAI", () => {
    // Its provider is Node-only, so it cannot live here. Returning `openai("gemini-2.5-flash")`
    // would be the same class of silent misroute this module exists to end.
    expect(() => resolveModel("google/gemini-2.5-flash")).toThrow(/Node runtime/);
    expect(NODE_ONLY_MODEL_PREFIX).toBe("google/");
  });
});

// ── The offline-seam operator signal ─────────────────────────────────────────
//
// THE DEFECT THIS BLOCK EXISTS FOR: the gate was `!OPENAI_API_KEY && !OPENROUTER_API_KEY` ALONE.
// That closed a content-selected fabrication and opened an UNCONDITIONAL one — a deployment that
// merely LOST its keys fabricates instead of failing, everywhere the predicate is consumed, with no
// error and nobody's consent. Consent is now POSITIVE and the credential check is the second belt.
//
// Every expected value here is a LITERAL (`"PIKAR_OFFLINE_FIXTURES"`, `"1"`, `true`/`false`) rather
// than an import: a test that imports the name or the value it is pinning moves with the subject
// and can never fail.
//
// Mutations RUN against this block (each reverted after):
//   • drop the flag conjunct (back to `!OPENAI && !OPENROUTER`) -> "absence of a credential is a
//     MISCONFIGURATION" goes RED.
//   • drop BOTH credential conjuncts (flag alone) -> the two "a key still closes it" cases go RED.
//   • `=== "1"` -> `!== undefined` -> the `"0"` case goes RED.
describe("offlineSeamAvailable is a POSITIVE operator opt-in, not the absence of a key", () => {
  afterEach(() => vi.unstubAllEnvs());

  const seam = (flag: string | undefined, openai: string | undefined, or: string | undefined) => {
    vi.stubEnv("PIKAR_OFFLINE_FIXTURES", flag);
    vi.stubEnv("OPENAI_API_KEY", openai);
    vi.stubEnv("OPENROUTER_API_KEY", or);
    return offlineSeamAvailable();
  };

  test("the opt-in ON A KEYLESS deployment is the ONLY true case", () => {
    expect(seam("1", undefined, undefined)).toBe(true);
  });

  test("absence of a credential is a MISCONFIGURATION, and no longer chooses the fixture", () => {
    // THE REGRESSION, as a value. A production deployment whose keys are unset or blanked used to
    // land here and get `true` — every consumer then fabricated silently. It must fall through to
    // the model path, where `resolveModel(DEFAULT_MODEL)` throws for the missing key.
    expect(seam(undefined, undefined, undefined)).toBe(false);
    expect(seam(undefined, "", "")).toBe(false);
    expect(() => resolveModel("or/openai/gpt-4o-mini")).toThrow(/OPENROUTER_API_KEY is not set/);
  });

  test("a key still closes the seam even WITH the opt-in — either key, on its own", () => {
    expect(seam("1", "sk-live", undefined)).toBe(false);
    expect(seam("1", undefined, "or-live")).toBe(false);
  });

  test('only the literal "1" is consent — "0" and "" are not', () => {
    expect(seam("0", undefined, undefined)).toBe(false);
    expect(seam("", undefined, undefined)).toBe(false);
  });

  test("the seam and the readiness screen share ONE value test, and differ only on the key", () => {
    // THE DEFECT, as a value. "Is this fixture seam on?" was decided twice with two rules:
    // `offlineSeamAvailable()` wanted the literal "1"; `missingEnv().fixturesActive` used the
    // generic non-blank test. At `PIKAR_OFFLINE_FIXTURES=on` — the spelling every other fixture
    // flag in this repo takes (`FAL_FIXTURE`, and `env.test.ts` uses the value "on") — BOTH halves
    // of the contradiction held at once: a readiness screen saying a fabrication seam was LIVE and
    // a fixture that was silently OFF, plus an unexplained `OPENROUTER_API_KEY is not set`.
    //
    // Expected values are LITERALS, so this is not the two sites agreeing with each other about
    // nothing: the third column is the answer, and the assertion is that BOTH sites give it.
    const cases: Array<[string | undefined, boolean]> = [
      ["1", true],
      [" 1 ", true],
      ["on", false],
      ["true", false],
      ["0", false],
      ["", false],
      [undefined, false],
    ];
    for (const [value, expected] of cases) {
      vi.stubEnv("PIKAR_OFFLINE_FIXTURES", value);
      vi.stubEnv("OPENAI_API_KEY", undefined);
      vi.stubEnv("OPENROUTER_API_KEY", undefined);
      expect(offlineSeamAvailable(), `the SEAM at ${JSON.stringify(value)}`).toBe(expected);
      expect(
        missingEnv((n) => process.env[n]).fixturesActive.includes("PIKAR_OFFLINE_FIXTURES"),
        `the READINESS SCREEN at ${JSON.stringify(value)}`,
      ).toBe(expected);
    }

    // THE ONE DELIBERATE ASYMMETRY, pinned so it stays a decision rather than becoming the next
    // divergence: the screen reports THE FLAG, the seam ANDs the flag with "neither model key".
    // On a keyed deployment the operator HAS consented and the seam is inert — which is what the
    // manifest row's `whatBreaks` says ("Ignored while either model key is set") — and a fixture
    // warning that is louder than the seam is the safe direction for this one.
    vi.stubEnv("PIKAR_OFFLINE_FIXTURES", "1");
    vi.stubEnv("OPENAI_API_KEY", "sk-live");
    vi.stubEnv("OPENROUTER_API_KEY", undefined);
    expect(offlineSeamAvailable()).toBe(false);
    expect(missingEnv((n) => process.env[n]).fixturesActive).toContain("PIKAR_OFFLINE_FIXTURES");
  });
});

// Merged 2026-09-05 from the media lane (33.2-04/05): transcription rides the same module, and a
// NARROW literal-call tripwire — it catches `openai("…")` / `openai.transcription(` spelled out in a
// feature file, nothing more; the broader route-table scan was deleted above for the reasons given.
describe("lib/models — transcription and the literal-call tripwire", () => {
  test("transcription: an or/ id rides the OpenAI-compatible provider at OpenRouter, prefix stripped", () => {
    process.env.OPENROUTER_API_KEY ??= "test-key-never-sent";
    const routed = transcriptionModel("or/openai/whisper-1") as unknown as {
      provider: string;
      modelId: string;
    };
    expect(routed.provider).toMatch(/^openai\.transcription/);
    expect(routed.modelId).toBe("openai/whisper-1");
    const direct = transcriptionModel("openai/whisper-1") as unknown as { modelId: string };
    expect(direct.modelId).toBe("whisper-1");
  });

  // On the routed id the SDK reports no duration; the provider's body is the bill. A caller that
  // priced `durationInSeconds ?? 0` would record $0 and walk past the kill switch.
  test("transcriptionUsage reads OpenRouter's usage block and tolerates its absence", () => {
    expect(
      transcriptionUsage({
        responses: [{ body: { text: "x", usage: { seconds: 3, cost: 0.0003 } } }],
      }),
    ).toEqual({ seconds: 3, costUsd: 0.0003 });
    expect(transcriptionUsage({ responses: [{ body: { text: "x" } }] })).toEqual({});
    expect(transcriptionUsage({})).toEqual({});
    expect(
      transcriptionUsage({ responses: [{ body: { usage: { seconds: "3", cost: Number.NaN } } }] }),
    ).toEqual({});
  });

  // The defect class: a module-local copy of the resolver that never learned the `or/` route.
  // Five files carried one for nine days and broke every vault ingest. Only this module may turn
  // an id into a provider call; llm.ts wraps it for the stealth/ and google/ branches.
  test("no other module under convex/ builds a model on its own — resolver copy, literal, or transcription", () => {
    const root = join(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "_generated" || entry.name === "node_modules") continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
          if (p.endsWith(join("lib", "models.ts"))) continue;
          const src = readFileSync(p, "utf8");
          // A resolver copy, a literal `openai("gpt-4o-mini")`, or a direct transcription model.
          // (`openai.tools.webSearch` in llm.ts is a provider-executed TOOL, not a model — allowed.)
          if (/openai\(\s*id\.replace|\bopenai\(\s*["'`]|openai\.transcription\(/.test(src)) {
            offenders.push(p.slice(root.length + 1));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
