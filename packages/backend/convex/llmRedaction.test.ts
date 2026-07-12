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

// ── 03.2-04: the read-side (mailbox search) audit + drafter greeting stay refs-only (SC3) ────────

test("gmail.ts mailbox.searched audit payload is refs-only ({ queryHash, resultCount })", () => {
  // The ONLY new read-side audit (Plan 03) records that a search happened — a hash of the name +
  // a count, NEVER the name/address/subject/messageId itself (CLAUDE.md §4 / SC3).
  const src = readSource("gmail.ts");
  const m = src.match(/eventType:\s*["']mailbox\.searched["'][\s\S]*?payload:\s*(\{[^}]*\})/);
  expect(m, "mailbox.searched audit payload not found").not.toBeNull();
  const payload = m![1];
  expect(payload).toMatch(/queryHash/);
  expect(payload).toMatch(/resultCount/);
  // queryHash: contentHash(name) is a HASH of the name (refs-only) — strip the wrapper, then the
  // remaining payload must carry NO raw mailbox field.
  const stripped = payload.replace(/contentHash\([^)]*\)/g, "HASH");
  expect(stripped, `mailbox.searched payload leaks a raw field: ${payload}`).not.toMatch(
    /\b(name|address|subject|messageId|from|to|cc)\b/,
  );
});

test("draftCockpit receives NO mailbox header hints — greetingName is the only mailbox-derived arg", () => {
  // The resolved display NAME reaches the drafter for the greeting; header hints (subject/date/
  // count/the raw matches) must NEVER reach the LLM (SC3). Scope to the draftCockpit block.
  const src = readSource("llm.ts");
  const start = src.indexOf("export const draftCockpit");
  const rest = src.slice(start);
  // End at the true close of the draftCockpit block — the next top-level export. (Was
  // "export const route"; the cockpit tool set now sits between them and legitimately
  // mentions `matches` via rankCandidates, so this must bound draftCockpit ONLY.)
  const end = rest.indexOf("\nexport function buildAgentContext");
  // Strip line comments — the invariant is about the CODE surface, not prose that documents the
  // forbidden fields by name (which is itself useful).
  const draftBlock = (end >= 0 ? rest.slice(0, end) : rest).replace(/\/\/[^\n]*/g, "");
  expect(draftBlock).toMatch(/greetingName/); // the one allowed mailbox-derived field
  expect(draftBlock, "draftCockpit references a mailbox header hint").not.toMatch(
    /lastSubject|lastDateMs|matches/,
  );
  expect(draftBlock, "draftCockpit references a header count").not.toMatch(/\bcount\b/);
});

// ── 03.2.1-03: the Executive-Agent reasoning surface is provably index/label-only ──────────────
// buildAgentContext + buildCockpitTools are the model-facing surface (Plan 04's loop feeds them
// to generateText). The runtime proof is Plan 04's mock-model test; these are the STATIC
// complement — the context is built from buildRecipientView (index+label, never an address), and
// the draftBody tool still redacts (scanText) before the drafting sub-call.

test("buildAgentContext is index/label-only (buildRecipientView, no raw recipients array interpolated)", () => {
  const src = readSource("llm.ts");
  const start = src.indexOf("export function buildAgentContext");
  expect(start, "buildAgentContext not found").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("\nexport function buildCockpitTools");
  const block = end >= 0 ? rest.slice(0, end) : rest;
  // The recipient view MUST come from buildRecipientView (index+label) …
  expect(block).toMatch(/buildRecipientView/);
  // … and the raw `recipients` string[] must never be interpolated straight into the model-facing
  // string (e.g. `${plan.recipients}` / `recipients.join(`) — that would leak addresses (§2-D).
  expect(block, "buildAgentContext interpolates the raw recipients array").not.toMatch(
    /\$\{[^}]*\brecipients\b[^}]*\}|\brecipients\s*\.\s*join\s*\(/,
  );
});

test("the draftBody tool redacts (scanText) BEFORE any model call (GRDL-01/02)", () => {
  const src = readSource("llm.ts");
  const start = src.indexOf("draftBody: tool(");
  expect(start, "draftBody tool not found").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("proposePlan: tool(");
  const block = end >= 0 ? rest.slice(0, end) : rest;
  // scanText must appear, and it must precede the draftCockpit sub-call in source order.
  const scanAt = block.indexOf("scanText(");
  const draftAt = block.indexOf("draftCockpit");
  expect(scanAt, "draftBody tool does not call scanText").toBeGreaterThanOrEqual(0);
  expect(draftAt, "draftBody tool does not call draftCockpit").toBeGreaterThanOrEqual(0);
  expect(scanAt, "scanText must run before draftCockpit (redact-before-model)").toBeLessThan(
    draftAt,
  );
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
