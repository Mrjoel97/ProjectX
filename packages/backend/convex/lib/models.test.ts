import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveModel, transcriptionModel, transcriptionUsage } from "./models";

// LanguageModel is `string | LanguageModelV2`; both providers hand back the object form.
const shape = (id: string) => resolveModel(id) as unknown as { provider: string; modelId: string };

describe("lib/models — the one resolver", () => {
  test("an or/ id routes to OpenRouter with the ROUTE prefix stripped; the bare vendor id goes direct", () => {
    process.env.OPENROUTER_API_KEY ??= "test-key-never-sent";
    const routed = shape("or/openai/gpt-4o-mini");
    expect(routed.provider).toMatch(/^openrouter/);
    expect(routed.modelId).toBe("openai/gpt-4o-mini"); // what OpenRouter is asked for — no `or/`
    const direct = shape("openai/gpt-4o-mini");
    expect(direct.provider).toMatch(/^openai/);
    expect(direct.modelId).toBe("gpt-4o-mini");
  });

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
  test("no other module under convex/ resolves a model id on its own", () => {
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
          if (/openai\(\s*id\.replace/.test(src)) offenders.push(p.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
