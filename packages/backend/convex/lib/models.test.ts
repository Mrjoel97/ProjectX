// The ONE model route table — the copy-drift defect, closed and pinned.
//
// `resolveModel` existed SEVEN times — `llm.ts`, `blueprint.ts`, `onboarding.ts`, `vaultDigest.ts`,
// `vaultLlm.ts`, `voiceDoc.ts`, `knowledgeLlm.ts` — and only `llm.ts`'s ever grew the `or/` branch,
// while `DEFAULT_MODEL` is `"or/openai/gpt-4o-mini"`. Every other copy handed an OpenRouter ROUTE id
// to the OpenAI provider: a different endpoint with a different key. Nothing in any suite could see
// it, because every test drives a `SMOKE::` seam that never reaches a provider at all. All seven are
// converted now, and the second describe below pins that END STATE rather than a shrinking list.
//
// So these tests assert the RESOLVED PROVIDER, not that a function was called: `.provider` and
// `.modelId` are what the AI SDK actually sends the request with.
import { afterEach, describe, expect, test, vi } from "vitest";
import { missingEnv } from "./env";
import { NODE_ONLY_MODEL_PREFIX, offlineSeamAvailable, resolveModel } from "./models";

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

/** Raw sources for the "no fifth copy" scan. edge-runtime has no `node:fs`. */
const rawSources = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

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

  test("THE SEAM AND THE READINESS SCREEN CANNOT DISAGREE ABOUT WHETHER IT IS ON", () => {
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

describe("no module keeps its own copy of the route table", () => {
  /**
   * THE END STATE: there is exactly ONE `resolveModel`, in this file, plus `llm.ts`'s documented
   * wrapper. This list is EMPTY and must stay empty.
   *
   * It was five: `blueprint.ts`, `onboarding.ts`, `vaultDigest.ts`, `vaultLlm.ts`, `voiceDoc.ts`,
   * each holding the identical `openai(id.replace(/^openai\//, ""))` one-liner and each calling it
   * with `DEFAULT_MODEL` — which has been `"or/openai/gpt-4o-mini"` since commit 845f4b1 — so each
   * sent an OpenRouter ROUTE id to the OpenAI provider on every production run. All five now import
   * the shared table. Business-blueprint derivation, onboarding, vault digests, the graph extractor
   * / document classifier and the voice-doc reviewer were all misrouting; nothing in any suite could
   * see it, because every test drives a `SMOKE::` seam that never reaches a provider.
   *
   * ⚠ THIS TEST IS NAME-BASED AND THAT IS ITS CEILING. It only looks at a module at all if the
   * module's source mentions `resolveModel(`, so a private copy called `pickModel` is invisible to
   * it — the repo's own recorded lesson (deletion-only mutation is blind to renaming; a symbol gate
   * has already stayed green through a rename here once). The IMPORT scan below is the one a rename
   * cannot get past; the SHAPE scan is not, and said it was for three iterations. Do not add a name
   * back to this list to make either green — convert the module.
   */
  const ALLOWED_PRIVATE_RESOLVERS: string[] = [];

  /** This module. Vite normalises the `../**` glob key for a sibling to `./models.ts`. */
  const isSharedTable = (path: string) => path === "./models.ts" || path.endsWith("/lib/models.ts");

  const privateResolvers = () => {
    const found: string[] = [];
    for (const [path, raw] of Object.entries(rawSources)) {
      if (path.endsWith(".test.ts") || isSharedTable(path)) continue;
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
      if (!src.includes("resolveModel(")) continue;
      if (!/from "\.(\.)?\/lib\/models"/.test(src)) found.push(path);
    }
    return found.sort();
  };

  test("EXACTLY ONE shared table: no module resolves a model without importing it", () => {
    // The regression is not a wrong branch — it is a SECOND branch table, written next door, that
    // nothing keeps in step. `llm.ts` is allowed its own `resolveModel` WRAPPER because it owns the
    // Node-only `google/` branch, and it satisfies this scan by importing the shared table and
    // delegating everything else to it.
    expect(privateResolvers()).toEqual(ALLOWED_PRIVATE_RESOLVERS);
  });

  /**
   * THE PROVIDER-IMPORT CHANNEL GUARD — a CHANNEL guard, and the claim is now sized to that.
   *
   * The scan below (`DYNAMIC_MODEL_ROUTE`) is on its third iteration and was STILL escapable on all
   * three, because it hardcodes the CALLEE SPELLING. Both of these beat it, and were run against it:
   *   `createOpenAI({ apiKey })(id.replace(/^openai\//, ""))`  — the identifier before `(` is `)`
   *   `const P = createOpenAI({ apiKey }); P(id.slice(7))`      — the provider under a local alias
   * A module holding both, planted under `convex/`, left the whole guard 14/14 GREEN. This one does
   * not read the call at all: to route with an AI-SDK provider a module must first IMPORT one, and
   * the specifier is a string a rename does not touch.
   *
   * ⚠ THE PREVIOUS VERSION OF THIS PARAGRAPH SAID "the ONLY way to get a provider is the provider
   * package's MODULE SPECIFIER". THAT WAS FALSE, IT WAS THE FOURTH ESCAPABLE ITERATION OF THIS
   * GUARD, AND IT IS DELETED RATHER THAN RE-WORDED. Verified escapes, each run against the old
   * regex `/["'](?:@ai-sdk\/[a-z0-9-]+|…)["']/`:
   *   • `import { OpenAIChatLanguageModel } from "@ai-sdk/openai/internal";` — a DOCUMENTED subpath
   *     export (`node_modules/@ai-sdk/openai/package.json` declares `"./internal"`) shipping the raw
   *     model class. The old regex anchored on the closing quote, so any `/subpath` tail was
   *     invisible, and the capitalised class name also dodged `DYNAMIC_MODEL_ROUTE`'s alternation.
   *     A planted module holding a full private route table left the suite 17/17 GREEN.
   *   • `` await import(`@ai-sdk/openai`) `` — a template literal, not `"` or `'`.
   *   • `export default openai;` in THIS file — see the export-surface pin below.
   * The first two are closed by the regex now (subpath tail + backtick). The third is closed by the
   * pin. WHAT IS STILL OPEN, stated because a tripwire that reads as protection and is not is worse
   * than an acknowledged gap:
   *   (i)  A NON-LITERAL specifier — `await import("@ai-sdk/" + "openai")`. A regex cannot see a
   *        concatenation; only an AST pass could, and that is the upgrade path if this ever matters.
   *   (ii) RAW HTTP, which needs no provider package at all — and this repo DOES IT TODAY, on a
   *        landed path: `vaultRag.ts`'s `embeddingV2` (~:230-270) picks provider label, env-key NAME
   *        and endpoint URL from a runtime decision and calls `fetch`, holding zero provider
   *        imports. It is deliberate (an ai@6/@7 major skew, documented there), but it means "no
   *        module holds a provider" was never true of this codebase. Nothing pins that adapter to
   *        this table.
   *   (iii) A module importing a provider that an allow-listed file RE-EXPORTS. Closed for THIS
   *        file by the export-surface pin below — the only one a converted module imports from —
   *        and open for the other four.
   *
   * SCOPE, also previously over-claimed: the glob is `../**\/*.ts` from `convex/lib`, so this sees
   * `convex/` ONLY. `packages/<pkg>/src` is not scanned (grepped by hand this round: no provider import
   * there today).
   */
  const PROVIDER_PACKAGE =
    /["'`](?:@ai-sdk\/[a-z0-9-]+|@openrouter\/ai-sdk-provider)(?:\/[^"'`]*)?["'`]/;

  /**
   * The ONLY files that may hold a provider. Literals, so adding a sixth is a deliberate act.
   *   lib/models.ts    — this table.
   *   llm.ts           — the Node-only `google/` branch, documented above; delegates the rest here.
   *   intake.ts, vaultExtract.ts, vaultTranscribe.ts — ONE FIXED model id each (multimodal /
   *     transcription calls that name a model on purpose). They route nothing, so nothing can drift.
   */
  const PROVIDER_HOLDERS = [
    "../intake.ts",
    "../llm.ts",
    "../vaultExtract.ts",
    "../vaultTranscribe.ts",
    "./models.ts",
  ];

  const providerImporters = () =>
    Object.entries(rawSources)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, raw]) =>
        PROVIDER_PACKAGE.test(raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "")),
      )
      .map(([path]) => path)
      .sort();

  test("no module under convex/ IMPORTS a model provider except the five named here", () => {
    // The rename-proof half. A private route table under any name, built by any call shape, needs
    // this import — so this list going long IS the defect, before a single call is examined. It is
    // "imports", not "holds": raw `fetch` reaches the same endpoints and is out of this channel.
    expect(providerImporters()).toEqual(PROVIDER_HOLDERS);
  });

  test("THE IMPORT GUARD IS NOT VACUOUS: every escape found against it is now caught", () => {
    // Non-vacuity as a VALUE, not as a promise. Each string below is a shape that was RUN against
    // the guard as a real planted module under `convex/`; the first left it green for three
    // iterations, the second and third left it green for a fourth. If any of these flips to false
    // the guard has stopped being able to fail.
    const escapes: Array<[string, string]> = [
      // The two that beat the CALL scan: the callee spelling is `)` and then a local alias.
      [
        "aliased factory",
        [
          'import { createOpenAI } from "@ai-sdk/openai";',
          "const P = createOpenAI({ apiKey: key });",
          "export const modelFor = (id: string) => P(id.startsWith('openai/') ? id.slice(7) : id);",
        ].join("\n"),
      ],
      // THE FOURTH-ITERATION ESCAPE. A documented subpath export shipping the raw model class —
      // no `openai(`, no `createOpenAI`, and the old regex demanded the closing quote right after
      // the package segment.
      [
        "subpath import of the raw model class",
        [
          'import { OpenAIChatLanguageModel } from "@ai-sdk/openai/internal";',
          "export const pickModel = (id: string) =>",
          '  new OpenAIChatLanguageModel(id.replace(/^openai\\//, ""), cfg);',
        ].join("\n"),
      ],
      // Same idea through the other provider's package, and through a template literal.
      ["subpath, other provider", 'import x from "@openrouter/ai-sdk-provider/internal";'],
      ["template-literal specifier", "const p = await import(`@ai-sdk/openai`);"],
    ];
    for (const [what, planted] of escapes) {
      expect(PROVIDER_PACKAGE.test(planted), `the import guard misses: ${what}`).toBe(true);
    }
    // And the call scan calls the first two CLEAN — which is why the import channel is guarded at
    // all. (Its `new OpenAIChatLanguageModel(` shape dodges the callee alternation as well.)
    expect(DYNAMIC_MODEL_ROUTE.test(escapes[0]?.[1] ?? ""), "call scan is not the guard").toBe(
      false,
    );
    expect(DYNAMIC_MODEL_ROUTE.test(escapes[1]?.[1] ?? ""), "call scan is not the guard").toBe(
      false,
    );
    // The ordinary import must still match, or the "escapes are caught" rows above prove nothing.
    expect(PROVIDER_PACKAGE.test('import { openai } from "@ai-sdk/openai";')).toBe(true);
    // ...and a package that merely starts the same way must NOT, or the tail is over-greedy.
    expect(PROVIDER_PACKAGE.test('import x from "@ai-sdk-community/thing";')).toBe(false);
  });

  test("the provider cannot be laundered through this file's exports — ANY spelling", () => {
    // The ceiling named above, closed for the one file every converted module imports. Adding
    // `export { openai }` here would hand every module a provider while the import guard read [].
    //
    // ⚠ THIS PIN USED TO ENUMERATE THE SPELLINGS IT FEARED (`export const|function|type`, plus a
    // ban on `export {` and `export *`) AND THREE ORDINARY ONES WALKED THROUGH IT, each RUN and
    // each leaving the suite 17/17 green: `export default openai;`, `export async function
    // providerFor() { return openai; }`, `export let leaked = openai;`. So it no longer enumerates.
    // EVERY line that starts a top-level export must reduce to one of the three names below; a
    // spelling the name regex cannot read contributes its own raw text and fails loudly.
    const src = rawSources["./models.ts"] ?? rawSources["../lib/models.ts"] ?? "";
    expect(src, "convex/lib/models.ts is not in the raw-source glob").toBeTruthy();
    const exportLines = src.split(/\r?\n/).filter((line) => /^export\b/.test(line));
    const exported = exportLines.map(
      (line) => /^export (?:const|type) (\w+)/.exec(line)?.[1] ?? line,
    );
    expect([...exported].sort()).toEqual([
      "NODE_ONLY_MODEL_PREFIX",
      "offlineSeamAvailable",
      "resolveModel",
    ]);
  });

  /**
   * THE SHAPE, NOT THE NAME — the SECOND net, and it is the weaker one. Kept because inside the
   * five provider holders a provider IS legitimately in scope, so the import guard says nothing
   * there and this is what remains. It hardcodes callee spellings and the two escapes above get
   * past it; do not read a green here as proof that those five hold no route table.
   *
   * A provider factory called with a MODEL ARGUMENT THAT IS NOT A STRING LITERAL is what a private
   * route table IS — a runtime decision about which model id goes to which provider.
   *
   * It covers both providers and both spellings of the defect:
   *   `openai(id.replace(/^openai\//, ""))`   — the original naive one-liner, seven copies of it
   *   `openai(id.startsWith("openai/") ? …)`   — the same table rewritten, invisible to a `.replace` scan
   *   `createOpenRouter({…}).chat(id)`         — the same table built on the other provider
   *
   * A FIXED model id — `openai("gpt-4o-mini")` in `intake.ts` and `vaultExtract.ts`, both of which
   * price on the matching `"openai/gpt-4o-mini"` key — is deliberately NOT flagged. Those are
   * multimodal calls naming one model on purpose; they route nothing, so there is nothing to drift.
   */
  const DYNAMIC_MODEL_ROUTE =
    /(?:\b(?:openai|createOpenAI|createOpenRouter)|\.chat)\s*\(\s*[A-Za-z_$]/;

  test("THE DETECTOR ITSELF: a route table under ANY name is caught, a fixed model id is not", () => {
    // Non-vacuity for the file scan below, and the actual claim being made. The scan can only
    // report `[]` honestly if it would have reported a renamed copy — and the previous version of
    // this guard would have passed every one of these three, because it grepped for the word
    // `resolveModel`.
    for (const renamed of [
      'const pickModel = (id: string) => openai(id.replace(/^openai\\//, ""));',
      'const modelFor = (id: string) => openai(id.startsWith("openai/") ? id.slice(7) : id);',
      "const route = (id: string) => createOpenRouter({ apiKey }).chat(id);",
      "  if (id.startsWith('or/')) return openRouter().chat(id.slice(3));",
    ]) {
      expect(DYNAMIC_MODEL_ROUTE.test(renamed), `not detected: ${renamed}`).toBe(true);
    }
    // The legitimate shape, which must stay legal: one named model, no routing.
    for (const fixed of [
      'model: openai("gpt-4o-mini"),',
      "openRouter().chat('stealth/ox-alpha')",
    ]) {
      expect(DYNAMIC_MODEL_ROUTE.test(fixed), `false positive: ${fixed}`).toBe(false);
    }
  });

  test("no module under convex/ routes a model id to a provider except the shared table", () => {
    // Comments stripped first: this module's own docstrings quote the defect verbatim, and a
    // playbook-grade comment must not be able to fail a source scan.
    const routing = Object.entries(rawSources)
      .filter(([path]) => !isSharedTable(path) && !path.endsWith(".test.ts"))
      .filter(([, raw]) =>
        DYNAMIC_MODEL_ROUTE.test(raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "")),
      )
      .map(([path]) => path)
      .sort();
    expect(routing).toEqual([]);
  });

  test("llm.ts keeps its `google/` wrapper and DELEGATES the rest to the shared table", () => {
    // The one documented exception, pinned so it stays an exception: it may branch on the Node-only
    // prefix, and everything else must go through this module.
    const llm = rawSources["../llm.ts"] ?? "";
    expect(llm, "convex/llm.ts is not in the raw-source glob").toBeTruthy();
    expect(llm).toMatch(/resolveModel as resolveSharedModel.*from "\.\/lib\/models"/);
    expect(llm).toMatch(
      /if \(!id\.startsWith\(NODE_ONLY_MODEL_PREFIX\)\) return resolveSharedModel\(id\);/,
    );
  });

  test("the scan is not vacuous — it can see the modules that DO resolve models", () => {
    const users = Object.keys(rawSources).filter(
      (path) => !path.endsWith(".test.ts") && (rawSources[path] ?? "").includes("resolveModel("),
    );
    // Every module that was converted, by name: if one is deleted or renamed away the list above
    // would go empty for the wrong reason and the first test would still pass.
    for (const name of [
      "/llm.ts",
      "/knowledgeLlm.ts",
      "/blueprint.ts",
      "/onboarding.ts",
      "/vaultDigest.ts",
      "/vaultLlm.ts",
      "/voiceDoc.ts",
    ]) {
      expect(
        users.some((p) => p.endsWith(name)),
        `no module resolving models at ${name}`,
      ).toBe(true);
    }
  });
});
