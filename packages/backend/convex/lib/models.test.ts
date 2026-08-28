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
import { describe, expect, test } from "vitest";
import { NODE_ONLY_MODEL_PREFIX, resolveModel } from "./models";

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
   * A NEW naive copy anywhere under `convex/` fails this test. Do not add a name back to this list
   * to make that green — convert the module.
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

  test("the naive one-liner exists NOWHERE under convex/ — not even in a module that also imports", () => {
    // The scan above is satisfied by an import, so a module could import the shared table AND keep
    // a stale private copy beside it. This one is blind to imports: it looks for the misroute
    // itself — `openai(<id>.replace(...))` — which is what silently hands an `or/` route id to the
    // OpenAI provider. This module is the one legitimate site of that expression.
    const naive = Object.entries(rawSources)
      .filter(([path]) => !isSharedTable(path))
      .filter(([, raw]) => /\bopenai\(\s*\w+\.replace\(/.test(raw))
      .map(([path]) => path)
      .sort();
    expect(naive).toEqual([]);
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
