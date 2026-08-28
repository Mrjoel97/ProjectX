// The ONE model route table — the copy-drift defect, closed and pinned.
//
// `resolveModel` existed SEVEN times — `llm.ts`, `blueprint.ts`, `onboarding.ts`, `vaultDigest.ts`,
// `vaultLlm.ts`, `voiceDoc.ts`, `knowledgeLlm.ts` — and only `llm.ts`'s ever grew the `or/` branch,
// while `DEFAULT_MODEL` is `"or/openai/gpt-4o-mini"`. Every other copy hands an OpenRouter ROUTE id
// to the OpenAI provider: a different endpoint with a different key. Nothing in any suite could see
// it, because every test drives a `SMOKE::` seam that never reaches a provider at all.
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
   * ⚠ FIVE MODULES STILL HOLD THE STALE PRIVATE COPY, AND ALL FIVE ARE MISROUTING TODAY.
   *
   * Each is the identical one-liner `openai(id.replace(/^openai\//, ""))`, and each calls it with
   * `DEFAULT_MODEL` — which has been `"or/openai/gpt-4o-mini"` since commit 845f4b1 — so each sends
   * an OpenRouter route id to the OpenAI provider on every production run. This is NOT a knowledge
   * plane defect and it is not fixed here: changing which provider and which key five landed
   * subsystems talk to is its own change, with its own playbooks and its own verification, and
   * bundling it into a knowledge-plane remediation would be the wrong blast radius.
   *
   * The list is the tripwire in BOTH directions: a SIXTH copy fails this test, and so does leaving
   * a name here after its copy is gone. Delete a name when its module imports the shared table.
   */
  const KNOWN_STALE_COPIES = [
    "../blueprint.ts",
    "../onboarding.ts",
    "../vaultDigest.ts",
    "../vaultLlm.ts",
    "../voiceDoc.ts",
  ];

  const privateResolvers = () => {
    const found: string[] = [];
    for (const [path, raw] of Object.entries(rawSources)) {
      if (path.endsWith(".test.ts") || path.endsWith("lib/models.ts")) continue;
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      if (!src.includes("resolveModel(")) continue;
      if (!/from "\.(\.)?\/lib\/models"/.test(src)) found.push(path);
    }
    return found.sort();
  };

  test("no NEW module invents a route table, and no stale one is left on the list once fixed", () => {
    // The regression is not a wrong branch — it is a SECOND branch table, written next door, that
    // nothing keeps in step. `llm.ts` is allowed its own `resolveModel` wrapper because it owns the
    // Node-only `google/` branch, and it is required to delegate everything else.
    expect(privateResolvers()).toEqual([...KNOWN_STALE_COPIES].sort());
  });

  test("every stale copy is the SAME misroute, so the list is a debt and not a design", () => {
    // If one of them ever grows its own branch, this stops being a deletion and becomes a merge.
    for (const path of KNOWN_STALE_COPIES) {
      expect(rawSources[path], `${path} is on the stale list but does not exist`).toBeTruthy();
      expect(rawSources[path] ?? "", `${path} no longer holds the stale one-liner`).toMatch(
        /const resolveModel = \(id: string\): LanguageModel => openai\(id\.replace\(/,
      );
    }
  });

  test("the scan is not vacuous — it can see modules that DO resolve models", () => {
    const users = Object.keys(rawSources).filter(
      (path) => !path.endsWith(".test.ts") && (rawSources[path] ?? "").includes("resolveModel("),
    );
    expect(users.length).toBeGreaterThan(1);
    expect(users.some((p) => p.endsWith("/llm.ts"))).toBe(true);
    expect(users.some((p) => p.endsWith("/knowledgeLlm.ts"))).toBe(true);
  });
});
