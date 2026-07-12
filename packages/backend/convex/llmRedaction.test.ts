// @vitest-environment node
//
// Static-scan enforcement of the redact-then-model contract (GRDL-01/02). The model
// surface (llm.ts) must be structurally incapable of reading raw goal text or leaking
// raw PII, and its only system prompt must come from the skills registry (CLAUDE.md §5).
// Mirrors auditImmutability.test.ts's on-disk readSource pattern; runs in `node`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const convexDir = dirname(fileURLToPath(import.meta.url));
const readSource = (file: string): string => readFileSync(join(convexDir, file), "utf8");

test("llm.ts cannot reach raw goal text (no getForDelivery, no .goal)", () => {
  const src = readSource("llm.ts");
  // The fail-closed reader (getSafeTextByHash) is the ONLY text source — the raw-goal
  // reader and the .goal field must be structurally absent (GRDL-01/02).
  expect(src).not.toMatch(/getForDelivery/);
  expect(src).not.toMatch(/\.goal\b/);
  expect(src).toMatch(/getSafeTextByHash/);
});

test("raw PII entities never appear in the model/guard/pipeline surface", () => {
  // scanText returns { safeText, counts, entities }; `entities` is the raw-PII field and
  // must never be destructured here — only safeText/counts may cross (CLAUDE.md §4).
  for (const file of ["llm.ts", "guardrails.ts", "pipeline.ts"]) {
    expect(readSource(file), `${file} references raw PII entities`).not.toMatch(/entities/);
  }
});

test("llm.ts uses ONLY skill.body as the system prompt (no hardcoded prompts)", () => {
  const src = readSource("llm.ts");
  const allSystem = src.match(/system:/g) ?? [];
  const skillSystem = src.match(/system:\s*skill\.body/g) ?? [];
  // Every `system:` occurrence must be `system: skill.body` — prompts load from the
  // registry, never hardcoded in source (CLAUDE.md §5).
  expect(allSystem.length).toBeGreaterThan(0);
  expect(skillSystem.length).toBe(allSystem.length);
});

// ── 03.1-09: the COCKPIT content plane cannot leak raw email content to any log (§4) ─────────
// The `plans` table + cockpit.ts hold the raw recipients/subject/body (CLAUDE.md §1). The
// redaction invariant (SC5) is that none of that raw content reaches an audit/deadLetters/
// telemetry payload. The RUNTIME scan of a real fan-out is `assertNoRawPiiFanout` (smokeAssert.ts,
// exercised live by smoke:fanout — a durable workflow convex-test cannot run). These are its
// UNIT-layer complement: the content plane is redaction-safe BY CONSTRUCTION — it emits no
// log-plane write at all, and its single crossing into the delivery audit trail carries refs only.

test("cockpit content-plane modules emit NO audit/DLQ/telemetry write (redaction-safe by construction)", () => {
  // The plan/draft content plane must never itself write a log-plane row — those writes belong
  // ONLY to the shared governed delivery layer (keyed by correlationId, refs-only). If cockpit.ts
  // and plans.ts insert nothing into audit/deadLetters/telemetry and call no audit.log, raw
  // recipient/subject/body cannot structurally leak to a log from here (CLAUDE.md §4).
  for (const file of ["cockpit.ts", "plans.ts"]) {
    const src = readSource(file);
    expect(src, `${file} inserts into a log-plane table`).not.toMatch(
      /\.insert\(\s*["'](audit|deadLetters|telemetry)["']/,
    );
    expect(src, `${file} calls audit.log`).not.toMatch(/audit\.log\b/);
  }
});

test("cockpit's only delivery-audit crossing (workflow.start context payload) carries refs only", () => {
  // executePlan hands a `context.payload` to the fan-out's onComplete audit trail. It MUST be a
  // ref ({ planId }) — never the raw subject/body/recipient/bodyIntent/draft/goal — or the
  // fan-out audit becomes a PII honeypot (CLAUDE.md §4).
  const src = readSource("cockpit.ts");
  const payloads = src.match(/payload:\s*\{[^}]*\}/g) ?? [];
  expect(payloads.length).toBeGreaterThan(0);
  for (const p of payloads) {
    expect(p, `cockpit context payload leaks raw content: ${p}`).not.toMatch(
      /subject|body|recipient|bodyIntent|draft|goal/,
    );
  }
});
