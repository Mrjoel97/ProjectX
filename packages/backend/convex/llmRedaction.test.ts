// @vitest-environment node
//
// Static-scan enforcement of the redact-then-model contract (GRDL-01/02). The model
// surface (llm.ts) must be structurally incapable of reading raw goal text or leaking
// raw PII, and its only system prompt must come from the skills registry (CLAUDE.md §5).
// Mirrors auditImmutability.test.ts's on-disk readSource pattern; runs in `node`.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const convexDir = dirname(fileURLToPath(import.meta.url));
const readSource = (file: string): string => readFileSync(join(convexDir, file), "utf8");

/** Every hand-written convex source, comment-stripped, as [relative path, code]. Recursive so
 *  `lib/` and `render/` are covered; `_generated/` and tests are not source. Added by plan 20-06 for
 *  the two whole-tree pins at the bottom of this file (terminal writers, storage.getUrl). */
function allConvexSources(dir = convexDir, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "_generated" || entry.name === "node_modules") continue;
      out.push(...allConvexSources(join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push([
        rel,
        readSource(rel)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|\s)\/\/.*$/gm, "$1"),
      ]);
    }
  }
  return out;
}

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
  // §5: prompts load from the registry, never hardcoded. A model call gets its system prompt
  // EITHER inline as `system: skill.body` OR via the `system` variable the tool-loop threads
  // through (runAgentLoop), which each call site sets to skill.body. The banned thing is a
  // hardcoded STRING/template literal as a system prompt — assert there is none, and that the
  // registry-loaded body is in fact used as a system prompt.
  const hardcoded = src.match(/system:\s*["'`]/g) ?? [];
  expect(hardcoded.length, "a hardcoded system prompt literal is present in llm.ts").toBe(0);
  expect(src, "the registry skill body is never used as the system prompt").toMatch(
    /system:\s*skill\.body/,
  );
});

test("runCockpitAgent has one spine-first turn-prompt assembly with the exact legacy fallback", () => {
  const src = readSource("llm.ts");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  const handler = code.slice(
    code.indexOf("export const runCockpitAgent"),
    code.indexOf("export const __invokeCockpitTool"),
  );

  expect(handler).toMatch(
    /prompt:\s*buildTurnPrompt\(\{\s*spine,\s*history,\s*plan,\s*tz:\s*clientContext\?\.tz,\s*text\s*\}\)/,
  );
  expect(handler.match(/\bprompt:/g) ?? []).toHaveLength(1);
  expect(src).not.toContain(
    "prompt: `${buildHistoryBlock(history)}${buildAgentContext(plan ?? {}, clientContext?.tz)}\\n\\nThe user says: ${text}`",
  );

  // The helper is deliberately one expression: null contributes zero bytes, while a present spine
  // is the first block and the current user turn remains the final line.
  expect(code).toMatch(
    /return `\$\{spine === null \? "" : `\$\{spine\}\\n\\n`\}\$\{buildHistoryBlock\(history\)\}\$\{buildAgentContext\(plan \?\? \{\}, tz\)\}\\n\\nThe user says: \$\{text\}`;/,
  );
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
  // ONLY to the shared governed delivery layer (keyed by correlationId, refs-only). plans.ts
  // stays audit-free. cockpit.ts's SINGLE allowed crossing is the refs-only plan.canceled cancel
  // audit (03.5-03; payload {planId} only) — asserted the way gmail.ts's mailbox.searched is:
  // the call may exist, its payload must carry no raw content field (CLAUDE.md §4).
  for (const file of ["cockpit.ts", "plans.ts"]) {
    const src = readSource(file);
    expect(src, `${file} inserts into a log-plane table`).not.toMatch(
      /\.insert\(\s*["'](audit|deadLetters|telemetry)["']/,
    );
  }
  expect(readSource("plans.ts"), "plans.ts calls audit.log").not.toMatch(/audit\.log\b/);
  const cockpit = readSource("cockpit.ts");
  // cockpit.ts's allowed crossings are the TWO refs-only cancel/reschedule audits (03.5-03 +
  // 03.5-05), each payload {planId} only. A THIRD audit.log here would be a new content-plane leak
  // surface, so the count is pinned — and BOTH payloads are asserted refs-only (a strengthen over the
  // old count-1 scan, which predated plan.rescheduled; NOT a weaken — every eventType is checked).
  expect(cockpit.match(/audit\.log\b/g) ?? [], "cockpit.ts audit.log call sites").toHaveLength(2);
  for (const eventType of ["plan.canceled", "plan.rescheduled"]) {
    const m = cockpit.match(
      new RegExp(
        `eventType:\\s*["']${eventType.replace(".", "\\.")}["'][\\s\\S]*?payload:\\s*(\\{[^}]*\\})`,
      ),
    );
    expect(m, `${eventType} audit payload not found`).not.toBeNull();
    const payload = m![1]!.replace(/\/\/[^\n]*/g, "");
    expect(payload, `${eventType} payload must be refs-only: ${m![1]}`).not.toMatch(
      /\b(subject|body|recipients|sendAt|greetingName|recipientBodies)\b/,
    );
  }
});

// ── 03.2-04: the read-side (mailbox search) audit + drafter greeting stay refs-only (SC3) ────────

test("gmail.ts mailbox.searched audit payload is refs-only ({ queryHash, resultCount })", () => {
  // The ONLY new read-side audit (Plan 03) records that a search happened — a hash of the name +
  // a count, NEVER the name/address/subject/messageId itself (CLAUDE.md §4 / SC3).
  const src = readSource("gmail.ts");
  const m = src.match(/eventType:\s*["']mailbox\.searched["'][\s\S]*?payload:\s*(\{[^}]*\})/);
  expect(m, "mailbox.searched audit payload not found").not.toBeNull();
  const payload = m?.[1];
  if (payload === undefined) throw new Error("mailbox.searched audit payload not found");
  expect(payload).toMatch(/queryHash/);
  expect(payload).toMatch(/resultCount/);
  // queryHash: contentHash(name) is a HASH of the name (refs-only) — strip the wrapper, then the
  // remaining payload must carry NO raw mailbox field.
  const stripped = payload.replace(/contentHash\([^)]*\)/g, "HASH");
  expect(stripped, `mailbox.searched payload leaks a raw field: ${payload}`).not.toMatch(
    /\b(name|address|subject|messageId|from|to|cc)\b/,
  );
});

// ── 03.7-02: the inbox read plane is refs-only-audited and provably WRITE-FREE (CKPT-04/SC-3) ────

test("gmail.ts mailbox.listed audit payload is refs-only ({ range, resultCount })", () => {
  // The briefing's list audit records THAT a list happened — the caller-supplied `range` LITERAL
  // (an enum from the tool's inputSchema, never user prose) + a count. A sender/subject/snippet
  // here would turn the audit into the PII honeypot §4 exists to prevent.
  const src = readSource("gmail.ts");
  const m = src.match(/eventType:\s*["']mailbox\.listed["'][\s\S]*?payload:\s*(\{[^}]*\})/);
  expect(m, "mailbox.listed audit payload not found").not.toBeNull();
  const payload = m![1];
  expect(payload).toMatch(/range/);
  expect(payload).toMatch(/resultCount/);
  expect(payload, `mailbox.listed payload leaks a raw mailbox field: ${payload}`).not.toMatch(
    /\b(from|to|cc|sender|subject|snippet|gist|body|name|address|messageId)\b/,
  );
});

test("gmail.ts performs ZERO mailbox writes — no modify/trash/label endpoint exists", () => {
  // The briefing is read-only BY CONSTRUCTION (locked decision): the granted gmail.modify scope is
  // never exercised for a write. These endpoint substrings must be structurally absent — a future
  // "just mark it read" would have to defeat this test, which is the point.
  const src = readSource("gmail.ts").replace(/\/\/[^\n]*/g, ""); // prose may name them; CODE may not
  for (const verb of ["/modify", "/trash", "/untrash", "/batchModify", "/labels"]) {
    expect(src, `gmail.ts references the mailbox-write endpoint ${verb}`).not.toContain(verb);
  }
});

test("the ONLY POST fetches in gmail.ts are TOKEN_ENDPOINT (refresh) and SEND_ENDPOINT (governed send)", () => {
  // Every mailbox READ is a GET. The two legitimate POSTs are the token refresh and the governed
  // send; a THIRD POST would be a new write verb reaching Gmail without a governance gate, so the
  // counts must match exactly — a POST that is not one of these two fails here.
  const src = readSource("gmail.ts");
  const postFetches = [
    ...src.matchAll(/fetch\(\s*([^,\s]+)\s*,\s*\{\s*method:\s*["']POST["']/g),
  ].map((m) => m[1]);
  expect(postFetches, "the POST fetch targets changed").toEqual([
    "TOKEN_ENDPOINT",
    "SEND_ENDPOINT",
  ]);
  // …and no OTHER `method: "POST"` exists anywhere in the module (e.g. on a template-literal URL).
  const allPosts = src.match(/method:\s*["']POST["']/g) ?? [];
  expect(
    allPosts.length,
    `gmail.ts has ${allPosts.length} POSTs but only ${postFetches.length} are the sanctioned token/send calls`,
  ).toBe(postFetches.length);
});

test("the briefing read actions check the inboxFixtures seam BEFORE the token (no-token test path)", () => {
  // The seam only works if the fixture check precedes freshAccessToken — otherwise a fixture tenant
  // dead-ends at not_connected and the offline E2E / eval injection probe silently measure nothing
  // (research Pitfall 3). Assert the source ORDER inside each action, the draftBody-scan precedent.
  const src = readSource("gmail.ts");
  for (const fn of ["export const listInbox", "export const fetchInboxBodies"]) {
    const start = src.indexOf(fn);
    expect(start, `${fn} not found`).toBeGreaterThanOrEqual(0);
    const rest = src.slice(start);
    const end = rest.indexOf("\nexport const", 1);
    const block = end >= 0 ? rest.slice(0, end) : rest;
    const fixtureAt = block.indexOf("getInboxFixture");
    const tokenAt = block.indexOf("freshAccessToken");
    expect(fixtureAt, `${fn} never checks the inboxFixtures seam`).toBeGreaterThanOrEqual(0);
    expect(tokenAt, `${fn} never calls freshAccessToken`).toBeGreaterThanOrEqual(0);
    expect(fixtureAt, `${fn} must check the fixture BEFORE freshAccessToken`).toBeLessThan(tokenAt);
  }
});

test("briefings.ts is content-plane only — it emits NO audit/DLQ/telemetry write (§4)", () => {
  // The briefing row holds the raw senders + gists. Like plans.ts, this module must never itself
  // write a log-plane row — the refs-only mailbox.listed event belongs to the ACTING module (gmail.ts).
  const src = readSource("briefings.ts");
  expect(src, "briefings.ts inserts into a log-plane table").not.toMatch(
    /\.insert\(\s*["'](audit|deadLetters|telemetry)["']/,
  );
  expect(src, "briefings.ts calls audit.log").not.toMatch(/audit\.log\b/);
});

// ── 03.7-03: THE TOOLLESS-INGESTION INVARIANT (CKPT-04 / SC-2) ────────────────────────────────
//
// The phase's core security boundary, stated once: raw message bodies (any third-party mailbox
// content) only ever reach an LLM inside toolless, schema-validated calls; no tool-bearing loop
// ingests raw bodies — the loop consumes structured digests/counts only.
//
// Prose cannot hold that, so it is pinned STRUCTURALLY here (agent-runtime.md invariant 10 names
// these tests). The body-bearing identifier is deliberately named `rawBodies` and the scans key on
// it — brittle by nature, which is the accepted house style; each scan below asserts the identifier
// is PRESENT as well as correctly-placed, so a rename fails loudly instead of passing vacuously.

/** Slice the briefInbox tool block: `briefInbox: tool(` → the end of buildCockpitTools. */
function briefInboxBlock(): string {
  const src = readSource("llm.ts");
  const start = src.indexOf("briefInbox: tool(");
  expect(start, "briefInbox tool not found — did it get renamed?").toBeGreaterThanOrEqual(0);
  return src.slice(start);
}

test("rawBodies flows ONLY into the toolless digest — never into a briefInbox return (SC-2)", () => {
  const block = briefInboxBlock();
  // Present at all (a rename must not silently void every scan below).
  expect(block, "the body-bearing identifier `rawBodies` is gone from briefInbox").toMatch(
    /rawBodies/,
  );
  // It must reach the digest sub-call — that is its ONE sanctioned destination.
  expect(block, "rawBodies never reaches internal.llm.digestInbox").toMatch(
    /runAction\(internal\.llm\.digestInbox/,
  );
  // THE assertion: no `return` in this block may reference the body-bearing value. Bodies (and
  // gists) must never ride the tool's return into the tool-bearing loop's context.
  const returns = block.match(/return\s+[^;]*;/g) ?? [];
  expect(
    returns.length,
    "no return statements found in briefInbox — the scan is vacuous",
  ).toBeGreaterThan(0);
  for (const r of returns) {
    expect(
      r,
      `a briefInbox return references rawBodies (body text would reach the loop): ${r}`,
    ).not.toMatch(/rawBodies/);
  }
});

test("the digestInbox call is structurally TOOLLESS (generateObject, no tools:)", () => {
  // The whole defense: an injected body reaches a model that CANNOT act. If `tools:` ever appears
  // in this block, a message body would be ingested by a tool-bearing call and the invariant dies.
  const src = readSource("llm.ts");
  const start = src.indexOf("export const digestInbox");
  expect(start, "digestInbox not found").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("\nexport const", 1);
  const block = end >= 0 ? rest.slice(0, end) : rest;

  expect(block, "digestInbox does not use generateObject").toMatch(/generateObject/);
  expect(block, "digestInbox is NO LONGER TOOLLESS — it passes tools to the model").not.toMatch(
    /\btools\s*:/,
  );
  // The prompt is registry-loaded (§5) and the schema is index-keyed (ADR-004): a model-supplied
  // sender/ts would let untrusted content own a structural fact.
  expect(block, "digestInbox does not load the inbox-digest skill").toMatch(/INBOX_DIGEST_SKILL/);
});

test("every generateObject schema is STRICT-mode legal (all properties required)", () => {
  // 03.7-05, found by a live eval run: OpenAI structured outputs run in STRICT mode, which
  // requires every key in `properties` to also appear in `required`. A merely-"optional" field
  // makes the API reject the SCHEMA — so the call throws 100% of the time, on every input. No
  // mocked-model unit test can see this (the mock never validates), and the offline smoke path
  // short-circuits before the call, which is exactly how `deadline` shipped broken: the digest
  // failed on every live briefing until this scan's fixture caught it.
  // The way to say "may be absent" is a NULLABLE-and-required field (`type: ["string","null"]`),
  // normalized back off after the call. This scan holds that line for every jsonSchema in llm.ts.
  const src = readSource("llm.ts");
  const schemas = [...src.matchAll(/const (\w*[Ss]chema) = jsonSchema</g)].map((m) => m[1]);
  expect(
    schemas.length,
    "no jsonSchema definitions found — has the idiom changed?",
  ).toBeGreaterThan(0);

  for (const name of schemas) {
    const start = src.indexOf(`const ${name} = jsonSchema<`);
    const rest = src.slice(start);
    const end = rest.indexOf("\n});");
    const block = rest.slice(0, end >= 0 ? end : undefined);

    // Each `properties: { ... }` object paired with the `required: [...]` that follows it.
    for (const m of block.matchAll(/properties:\s*\{/g)) {
      const from = m.index + m[0].length;
      // Keys at THIS nesting level: a key is `name:` at the object's own depth (depth 1 here).
      let depth = 1;
      const keys: string[] = [];
      let i = from;
      let lineStart = i;
      for (; i < block.length && depth > 0; i++) {
        const c = block[i];
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        else if (c === "\n") lineStart = i + 1;
        if (depth === 1 && c === ":") {
          const key = block.slice(lineStart, i).trim();
          if (/^[a-zA-Z_]\w*$/.test(key)) keys.push(key);
        }
      }
      const requiredMatch = /required:\s*\[([^\]]*)\]/.exec(block.slice(i));
      if (keys.length === 0 || !requiredMatch) continue;
      // Group 1 exists whenever the regex matched, which `!requiredMatch` above already guarded.
      const required = [...requiredMatch[1]!.matchAll(/["'](\w+)["']/g)].map((r) => r[1]);
      const missing = keys.filter((k) => !required.includes(k));
      expect(
        missing,
        `${name}: ${missing.join(", ")} in properties but not in required — OpenAI strict mode ` +
          `REJECTS this schema, so the call throws on every input. Make it nullable-and-required.`,
      ).toEqual([]);
    }
  }
});

test("no body-bearing identifier reaches the tool-bearing loop region of llm.ts (SC-2)", () => {
  // runAgentLoop IS the tool-bearing surface (generateText + tools). Neither the body-bearing
  // variable nor the body-fetch action may appear anywhere in it — the loop consumes counts only.
  const src = readSource("llm.ts");
  const start = src.indexOf("async function runAgentLoop");
  expect(start, "runAgentLoop not found").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("\n// ── SMOKE::");
  const block = end >= 0 ? rest.slice(0, end) : rest;

  expect(block, "the tool-bearing loop region is empty — the scan is vacuous").toMatch(
    /generateText/,
  );
  for (const id of ["rawBodies", "fetchInboxBodies"]) {
    expect(
      block,
      `${id} appears in the tool-bearing loop region (raw bodies would be ingested)`,
    ).not.toContain(id);
  }
});

test("llm.ts briefing.created audit payload is refs-only ({ briefingId, range, listedCount, digestedCount })", () => {
  // Clone of the mailbox.searched/mailbox.listed discipline: ids + counts ONLY. A gist or sender
  // here would make the audit log the PII honeypot §4 exists to prevent.
  const src = readSource("llm.ts");
  const m = src.match(/eventType:\s*["']briefing\.created["'][\s\S]*?payload:\s*(\{[^}]*\})/);
  expect(m, "briefing.created audit payload not found").not.toBeNull();
  const payload = m?.[1];
  if (payload === undefined) throw new Error("briefing.created audit payload not found");
  expect(payload).toMatch(/briefingId/);
  expect(payload).toMatch(/listedCount/);
  expect(payload).toMatch(/digestedCount/);
  // `x.length` is a COUNT, not content — strip those before the leak scan, exactly as the
  // mailbox.searched test strips its contentHash(...) wrapper to HASH. What remains must be
  // refs/counts only, so `items` surviving the strip WOULD be a real leak.
  const stripped = payload.replace(/\b[A-Za-z]\w*\.length\b/g, "COUNT");
  expect(stripped, `briefing.created payload leaks message content: ${payload}`).not.toMatch(
    /\b(from|to|cc|sender|subject|snippet|gist|body|rawBodies|items|address|messageId)\b/,
  );
});

test("the digest synopsis rides the briefings row ONLY — never the loop return, never the audit (SC-2)", () => {
  // The synopsis is model prose over untrusted bodies (Gap 1.1). Like a gist it belongs on the
  // content-plane ROW, and it must NEVER cross into the counts-only tool return (the tool-bearing
  // loop's context) NOR the refs-only briefing.created payload (§4). Mirrors the rawBodies scan.
  // Bound to buildCockpitTools' close — briefInboxBlock() runs to EOF, which would sweep in
  // digestInbox's OWN synopsis-bearing returns (they are legal there; this scan is about the tool).
  const full = briefInboxBlock().replace(/\r\n/g, "\n");
  const closeAt = full.indexOf("\n  };\n}");
  expect(closeAt, "buildCockpitTools close not found after briefInbox").toBeGreaterThan(0);
  // Strip line comments — the invariant is about the CODE surface. Prose that documents the
  // boundary by name (a comment mentioning "return" or "synopsis") must not trip the scan.
  const block = full.slice(0, closeAt).replace(/\/\/[^\n]*/g, "");
  // Present at all — a rename must not silently void the scan.
  expect(block, "digest.synopsis is gone from briefInbox").toMatch(/digest\.synopsis|synopsis/);
  // It reaches the briefings insert — its ONE sanctioned destination.
  const insertMatch = block.match(/internal\.briefings\.insert,\s*\{[\s\S]*?\}\)/);
  expect(insertMatch, "briefings.insert call not found in briefInbox").not.toBeNull();
  expect(insertMatch![0], "synopsis never reaches the briefings row").toMatch(/synopsis/);
  // THE assertion: no `return` in briefInbox may carry the synopsis into the loop.
  const returns = block.match(/return\s+[^;]*;/g) ?? [];
  expect(
    returns.length,
    "no return statements found in briefInbox — the scan is vacuous",
  ).toBeGreaterThan(0);
  for (const r of returns) {
    expect(
      r,
      `a briefInbox return references synopsis (model prose would reach the loop): ${r}`,
    ).not.toMatch(/synopsis/);
  }
  // And it must NOT appear in the briefing.created audit payload object.
  const auditPayload = block.match(
    /eventType:\s*["']briefing\.created["'][\s\S]*?payload:\s*(\{[^}]*\})/,
  );
  expect(auditPayload, "briefing.created payload not found in briefInbox").not.toBeNull();
  expect(
    auditPayload![1],
    "synopsis leaked into the refs-only briefing.created payload",
  ).not.toMatch(/synopsis/);
});

// ── 03.11-04 (RPLY-01): the replyToMessage toolless-ingestion boundary (§2-D / SC-2) ──────────────
// replyToMessage fetches the untrusted ORIGINAL body and resolves the target's From address server-
// side. The body may reach ONLY the toolless draftReply; the From address may reach ONLY patchPlan
// (recipient-by-ref). NEITHER may cross into the tool return (the loop's context) or an audit payload.
// The scans below are mutation-verified the 03.7 way: (A) interpolating `${originalBody}` into a
// return trips the body scan RED; (B) interpolating `${address}` into the return trips the From scan
// RED; (C) adding `tools:{}` to draftReply trips the toolless scan RED — each confirmed, then reverted.

/** Slice the replyToMessage tool block: `replyToMessage: tool(` → the buildCockpitTools close. */
function replyToMessageBlock(): string {
  const full = readSource("llm.ts").replace(/\r\n/g, "\n");
  const start = full.indexOf("replyToMessage: tool(");
  expect(start, "replyToMessage tool not found — did it get renamed?").toBeGreaterThanOrEqual(0);
  const rest = full.slice(start);
  const closeAt = rest.indexOf("\n  };\n}");
  expect(closeAt, "buildCockpitTools close not found after replyToMessage").toBeGreaterThan(0);
  // Strip line comments — the invariant is about the CODE surface (comments name the fields by design).
  return rest.slice(0, closeAt).replace(/\/\/[^\n]*/g, "");
}

test("replyToMessage: the original body flows ONLY into draftReply — never a return, never an audit (SC-2)", () => {
  const block = replyToMessageBlock();
  // Present at all — a rename must not silently void the scan.
  expect(block, "the body-bearing identifier `originalBody` is gone from replyToMessage").toMatch(
    /originalBody/,
  );
  // Its ONE sanctioned destination is the toolless drafter.
  expect(block, "originalBody never reaches internal.llm.draftReply").toMatch(
    /runAction\(internal\.llm\.draftReply/,
  );
  // The block writes NO audit — so the body/From can never reach an audit payload from here.
  expect(
    block,
    "replyToMessage writes a log-plane row (the body could reach an audit payload)",
  ).not.toMatch(/audit\.log\b|\.insert\(\s*["'](?:audit|deadLetters|telemetry)["']|payload:/);
  // No return may carry the body into the tool-bearing loop.
  const returns = block.match(/return\s+[^;]*;/g) ?? [];
  expect(
    returns.length,
    "no return statements found in replyToMessage — the scan is vacuous",
  ).toBeGreaterThan(0);
  for (const r of returns) {
    expect(r, `a replyToMessage return references the original body: ${r}`).not.toMatch(
      /originalBody/,
    );
  }
});

test("replyToMessage: the resolved From address reaches patchPlan ONLY — never a tool return (§2-D)", () => {
  const block = replyToMessageBlock();
  // The address-bearing identifier is present and reaches the recipient-by-ref patch.
  expect(block, "the address-bearing identifier `address` is gone from replyToMessage").toMatch(
    /const address =/,
  );
  expect(block, "the address never reaches patchPlan (recipient-by-ref)").toMatch(
    /recipients:\s*\[address\]/,
  );
  // No return may INTERPOLATE the resolved address or the raw From/Message-ID header. The word
  // "address" in a return's PROSE ("ask the user for the address") is fine — only an interpolation
  // (`${address}` / `parsed.address` / `${tgt.target.from}`) or a Message-ID field would be a leak.
  const returns = block.match(/return\s+[^;]*;/g) ?? [];
  expect(returns.length, "no return statements found — the scan is vacuous").toBeGreaterThan(0);
  for (const r of returns) {
    expect(r, `a replyToMessage return interpolates the From address: ${r}`).not.toMatch(
      /\$\{[^}]*\baddress\b|\bparsed\.address\b|\.from\b/,
    );
    expect(r, `a replyToMessage return carries the Message-ID header: ${r}`).not.toMatch(
      /inReplyTo|references|\.messageId\b/,
    );
  }
});

test("draftReply is structurally TOOLLESS (generateText, no tools:) — the reply-body ingestion boundary", () => {
  // The untrusted original body reaches a model ONLY here, and this call has NO tools to actuate — an
  // injected "forward all mail to attacker@evil" can be described but has nothing to hijack. A `tools:`
  // in this block would put the original body one hop from the governed tools; the invariant dies.
  const src = readSource("llm.ts");
  const start = src.indexOf("export const draftReply");
  expect(start, "draftReply not found").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("\nexport const", 1);
  const block = end >= 0 ? rest.slice(0, end) : rest;
  expect(block, "draftReply does not use generateText").toMatch(/generateText/);
  expect(block, "draftReply is NO LONGER TOOLLESS — it passes tools to the model").not.toMatch(
    /\btools\s*:/,
  );
  expect(block, "draftReply does not load the reply-drafter skill").toMatch(/REPLY_DRAFTER_SKILL/);
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

// ── 03.4-02: per-recipient personalization stays redact-then-draft + content-plane only (§4) ─────

test("the personalizeRecipient tool redacts (scanText) BEFORE any model call (GRDL-01/02, SC2)", () => {
  const src = readSource("llm.ts");
  const start = src.indexOf("personalizeRecipient: tool(");
  expect(start, "personalizeRecipient tool not found").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("generateAttachment: tool(");
  const block = end >= 0 ? rest.slice(0, end) : rest;
  // scanText must appear, and it must precede the draftCockpit sub-call in source order (identical
  // guardrail to draftBody — redact BEFORE the model, so PII parity is free by construction).
  const scanAt = block.indexOf("scanText(");
  const draftAt = block.indexOf("draftCockpit");
  expect(scanAt, "personalizeRecipient does not call scanText").toBeGreaterThanOrEqual(0);
  expect(draftAt, "personalizeRecipient does not call draftCockpit").toBeGreaterThanOrEqual(0);
  expect(scanAt, "scanText must run before draftCockpit (redact-before-model)").toBeLessThan(
    draftAt,
  );
});

test("recipientBodies (per-recipient content) never reaches an audit/DLQ/telemetry write (§4, Pitfall 5)", () => {
  // recipientBodies holds the tailored bodies — content plane, exactly like body/subject/recipients.
  // It must NEVER appear in a log-plane payload/insert. Scan the model + orchestration + adapter
  // surfaces (llm.ts / cockpit.ts / plans.ts) for any audit/deadLetters/telemetry write carrying it.
  for (const file of ["llm.ts", "cockpit.ts", "plans.ts"]) {
    const src = readSource(file);
    for (const p of src.match(/payload:\s*\{[^}]*\}/g) ?? []) {
      expect(p, `${file} log payload leaks recipientBodies: ${p}`).not.toMatch(/recipientBodies/);
    }
    for (const ins of src.match(
      /\.insert\(\s*["'](?:audit|deadLetters|telemetry)["'][\s\S]{0,400}?\)/g,
    ) ?? []) {
      expect(ins, `${file} log insert leaks recipientBodies`).not.toMatch(/recipientBodies/);
    }
  }
});

// ── 03.9-02: the ACTIVITY TRACE cannot become a mail-content surface (CKPT-05 / §4) ───────────
//
// Invariant 10's scans above cover llm.ts's existing surfaces; NOTHING would have caught a step row
// growing a `label` field fed from `toolOutput.output`. These three close that. The trace is UI
// state (legitimate — like briefings' gists), but the SDK hands the emitter the FULL model context
// and every tool's complete return value, so the hazard is one careless spread away.

/** The `agentSteps: defineTable({ ... })` object body from schema.ts (comments stripped). */
function agentStepsSchemaBlock(): string {
  // Prose may NAME the forbidden fields (documenting the absence is useful); CODE may not.
  const src = readSource("schema.ts").replace(/\/\/[^\n]*/g, "");
  const start = src.indexOf("agentSteps: defineTable({");
  expect(start, "the agentSteps table block is gone — renamed?").toBeGreaterThanOrEqual(0);
  const from = src.indexOf("({", start) + 2;
  let depth = 1;
  let i = from;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return src.slice(from, i - 1);
}

test("the agentSteps schema declares NO field outside the allow-list (§4 IS the schema)", () => {
  // THE structural §4 guard. The row is a closed tool union + a phase enum + numbers: there is
  // deliberately no label/text/detail/result field, so there is nothing for mail content to leak
  // INTO. A `count: v.number()` literally cannot hold a subject line. The cheapest invariant is a
  // missing field — this test is what keeps it missing.
  const ALLOWED = [
    "tenantId",
    "threadId",
    "turnId",
    "stepKey",
    "tool",
    "phase",
    "startedAt",
    "endedAt",
    "durationMs",
    "count",
  ];
  const body = agentStepsSchemaBlock();
  // Keys at the table object's OWN depth (a nested v.union(...)/v.literal(...) contributes none).
  const fields: string[] = [];
  let depth = 0;
  let lineStart = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "\n") lineStart = i + 1;
    if (depth === 0 && c === ":") {
      const key = body.slice(lineStart, i).trim();
      if (/^[a-zA-Z_]\w*$/.test(key)) fields.push(key);
    }
  }
  expect(fields.length, "no agentSteps fields parsed — the scan is vacuous").toBeGreaterThan(0);
  expect(fields, "the closed `tool` union is gone").toContain("tool");
  const extra = fields.filter((f) => !ALLOWED.includes(f));
  expect(
    extra,
    `agentSteps grew ${extra.join(", ")} — a step row must hold refs/enums/counts ONLY. The SDK's ` +
      `tool events carry the full model context and listInbox's return carries SUBJECTS; a text ` +
      `field here is one careless spread from a §4 leak.`,
  ).toEqual([]);
});

/** One onToolExecution* callback from llm.ts — the destructured PARAMS plus the body. */
function callbackBlock(name: string): string {
  const src = readSource("llm.ts").replace(/\/\/[^\n]*/g, ""); // the comments name the hazards by design
  const start = src.indexOf(`${name}: async (`);
  expect(
    start,
    `${name} is gone from llm.ts — the emitter was removed or renamed`,
  ).toBeGreaterThanOrEqual(0);
  const bodyStart = src.indexOf("{", src.indexOf("=>", start));
  let depth = 1;
  let i = bodyStart + 1;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return src.slice(start, i); // from the params, so a widened `(event)` is visible to the scan
}

test("the onToolExecution* callbacks never touch the §4-hazardous event fields (Pitfall 5)", () => {
  for (const name of ["onToolExecutionStart", "onToolExecutionEnd"]) {
    const block = callbackBlock(name);
    // Present and actually emitting (a rename/removal must fail loudly, not pass vacuously).
    expect(block, `${name} writes no step row — the scan is vacuous`).toMatch(
      /internal\.agentSteps\.(record|finish)/,
    );
    // `messages: ModelMessage[]` is the FULL model context the SDK hands both callbacks.
    expect(block, `${name} references event.messages — the full model context`).not.toMatch(
      /\bmessages\b/,
    );
    // `toolOutput.output` is the tool's complete return value: listInbox's carries SUBJECTS,
    // resolveContacts' carries display-name labels. `.type` is the ONLY sanctioned read.
    expect(block, `${name} references toolOutput.output — a tool's raw return value`).not.toMatch(
      /\.output\b/,
    );
    // A spread pipes the whole event in wholesale — the leak this file exists to make impossible.
    expect(block, `${name} spreads the event object`).not.toMatch(/\.\.\./);
  }
});

test("agentSteps.ts is content-plane only — it emits NO audit/DLQ/telemetry write (§4)", () => {
  // The briefings.ts / plans.ts property, verbatim. The trace is UI state, not an audit trail: the
  // agent's refs-only trail already exists (mailbox.searched / mailbox.listed / briefing.created)
  // and belongs to the ACTING module. A second, less-governed shadow log here would be a §4
  // regression with no requirement behind it.
  const src = readSource("agentSteps.ts");
  expect(src, "agentSteps.ts inserts into a log-plane table").not.toMatch(
    /\.insert\(\s*["'](audit|deadLetters|telemetry)["']/,
  );
  expect(src, "agentSteps.ts calls audit.log").not.toMatch(/audit\.log\b/);
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

// ── 03.5-02: the deferred-send scheduling fields stay on the content plane (§4) ───────────────────
// setSendTime resolves a natural-language time to an absolute sendAt on the plan row. sendAt +
// scheduledFunctionId (and the raw NL time text) are content/handle plane — exactly like body/
// recipientBodies — and must NEVER reach an audit/deadLetters/telemetry payload (CLAUDE.md §4). The
// runtime proof is the live smoke fan-out's assertNoRawPiiFanout; these are the static complement.

test("the setSendTime tool crosses ONLY into patchPlan — no audit/DLQ/telemetry write (§4)", () => {
  const src = readSource("llm.ts");
  const start = src.indexOf("setSendTime: tool(");
  expect(start, "setSendTime tool not found").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("setMode: tool(");
  const block = end >= 0 ? rest.slice(0, end) : rest;
  // The send time is content plane: its ONLY persistence crossing is patchPlan. No log-plane write
  // may live in the tool — so sendAt / the raw NL time can never leak to a log from here.
  expect(block, "setSendTime writes a log-plane row").not.toMatch(
    /audit\.log\b|\.insert\(\s*["'](?:audit|deadLetters|telemetry)["']|deadLetter/,
  );
  expect(block, "setSendTime does not persist via patchPlan").toMatch(/patchPlan/);
});

test("scheduling fields (sendAt / scheduledFunctionId) never reach an audit/DLQ/telemetry write (§4)", () => {
  // Like body/subject/recipientBodies, the scheduling fields must never appear in a log-plane
  // payload or insert. Scan the model + orchestration + adapter surfaces (llm.ts / cockpit.ts /
  // plans.ts) for any audit/deadLetters/telemetry write carrying them.
  for (const file of ["llm.ts", "cockpit.ts", "plans.ts"]) {
    const src = readSource(file);
    for (const p of src.match(/payload:\s*\{[^}]*\}/g) ?? []) {
      expect(p, `${file} log payload leaks a scheduling field: ${p}`).not.toMatch(
        /sendAt|scheduledFunctionId/,
      );
    }
    for (const ins of src.match(
      /\.insert\(\s*["'](?:audit|deadLetters|telemetry)["'][\s\S]{0,400}?\)/g,
    ) ?? []) {
      expect(ins, `${file} log insert leaks a scheduling field`).not.toMatch(
        /sendAt|scheduledFunctionId/,
      );
    }
  }
});

// ── 06-05 (VOIC-02/03): the voice-session audit rows stay refs/counts-only (§4) ──────────────────
// The raw transcript is NEVER server-stored (schema §4-clean); the brief BODY is vault CONTENT (it
// keeps PII by design). The ONLY log-plane crossings voice.ts makes are the session_started /
// session_ended audits, and those must carry {sessionId} + token COUNTS only — never the transcript,
// the callId (a session secret the hangup path uses), the client/API secret, or the brief text. This
// scan is mutation-checked the 03.7 way: interpolating `transcript`/`callId` into a payload trips it
// RED (confirmed, then reverted).

test("voice.ts session audit payloads are refs/counts-only ({sessionId}+counts, no transcript/callId/secret) — §4", () => {
  const src = readSource("voice.ts");
  const payloads = [...src.matchAll(/payload:\s*(\{[^}]*\})/g)].map((m) => m[1] ?? "");
  // Present at all: the started + clean-ended + abnormal-ended audits (a removal must fail loudly).
  expect(
    payloads.length,
    "no voice audit payloads found — the scan is vacuous",
  ).toBeGreaterThanOrEqual(3);
  // The counts ARE allowed and DO ride the ended payloads — assert one is present so the scan is not
  // vacuously strict (it proves these are the real session payloads, not empty objects).
  expect(
    payloads.some((p) => /inAudioTok/.test(p)),
    "no voice audit payload carries the token counts — is this the wrong file?",
  ).toBe(true);
  for (const p of payloads) {
    // sessionId is the sanctioned ref; the four *Tok fields are counts. Everything below is a raw
    // content / secret field that must NEVER enter a voice audit row (§4). `\btext\b` matches a bare
    // `text:` (the brief body) but NOT the `textInTok`/`textOutTok` count keys (word-boundary).
    expect(p, `voice audit payload leaks a raw/secret field: ${p}`).not.toMatch(
      /\b(callId|transcript|clientSecret|secret|apiKey|OPENAI_API_KEY|markdown|briefBody)\b|\btext\b|\bbody\b/,
    );
  }
});

// ── 15-03 (DISP-01): the sub-agent LINEAGE rows are refs-only at the SOURCE (§4) ─────────────────
// dispatch.ts writes three `internal.audit.log` rows per hop, and the thing they must never carry
// is the specialist's REPLY — grounded business prose, exactly the content §4 keeps out of the
// audit plane. A runtime scan only covers the payload shapes a test happened to write; this covers
// the SOURCE, so a field added tomorrow fails here even with no new test. Mutation-checked the
// 03.7 way: adding `bodyLen: turn.reply.length` to the completed payload trips it RED.

test("dispatch.ts lineage payloads reference no specialist output (reply/body/text/output) — §4", () => {
  // Prose names the forbidden fields by design ("NO reply, NO body…") — the invariant is about CODE.
  const src = readSource("dispatch.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const payloads = [...src.matchAll(/payload:\s*(\{[^}]*\})/g)].map((m) => m[1] ?? "");
  // refused / dispatched / completed, plus 15-04's thrown-turn `subagent.refused` — the one place
  // an EXCEPTION reaches the audit plane, and therefore the one most likely to be handed
  // `err.message`. 16-07 adds the FIFTH: `research.persist_failed`, the vault-write failure, which
  // is the second exception-fed site and was REVIEWED against this rule when the count moved —
  // it carries `{...lineageRefs(args), reason: "persist_error"}`, a CODE and refs, never the caught
  // error. A SIXTH is a new §4 surface and must be reviewed the same way, not renumbered.
  // 16-09 adds that SIXTH: the zero-search early return (`a research run that never searched
  // writes no vault document`). REVIEWED against this rule before the count moved, which is what
  // the sentence above demands — it carries `{...lineageRefs(args), reason: "not_researched",
  // webSearchCalls: 0}`: refs, a CODE literal from the closed reason set, and a COUNT. No reply,
  // body, text or output, and nothing derived from one. §4-clean. A SEVENTH gets the same
  // treatment — review the payload, then move the number and say here what you reviewed.
  //
  // 20-08 adds the SEVENTH and EIGHTH — the media storyboard terminal. BOTH REVIEWED against this
  // rule before the count moved, which is what the sentence above demands:
  //   `media.deck_refused`   — `{...lineageRefs(args), reason: <ParsedDeck reason>, blockIndex,
  //                            chars}`. The reason is a CODE from the parser's CLOSED union; the
  //                            block index is a REF and the character count is a COUNT. **The
  //                            narration text itself never enters** — that is the whole reason the
  //                            parser returns `{blockIndex, chars}` rather than the offending line,
  //                            and dispatch.test.ts asserts the 186-char string appears NOWHERE in
  //                            the audit plane.
  //   `media.deck_persisted` — `{...lineageRefs(args), blocks, clipSeconds, narrationChars,
  //                            hasArtDirection}`. Four COUNTS and a boolean. `narrationChars` is a
  //                            NUMBER (the total the tts reservation is priced from), never the
  //                            narration. No script, no prompt, no art direction, no block text.
  // Both are §4-clean. A NINTH is a new §4 surface and gets the same treatment, not a renumber.
  expect(payloads.length, "dispatch.ts audit payload count changed").toBe(8);
  // All of them SPREAD one shared refs object (15-04 made it the `lineageRefs` helper so the throw
  // path could not drift from the rest) — scanning the payloads alone would miss a leak added
  // inside it, so its body is scanned as a payload too.
  const refs = src.match(/const lineageRefs = \([^)]*\) => \(?(\{[^}]*\})/);
  expect(
    refs,
    "the shared refs object is gone from dispatch.ts — the scan is half-blind",
  ).not.toBeNull();

  for (const p of [...payloads, refs![1] ?? ""]) {
    expect(p, `a dispatch lineage payload carries specialist output: ${p}`).not.toMatch(
      /\b(reply|body|text|output)\b/,
    );
  }
});

// ── 07-05 (OPSG-05): the notify choke point + external channel carry NO content (§4) ──────────────
// Every Phase-7 notification MESSAGE is a static label — `notificationMessage(kind)` or a static-label
// interpolation (`${LABELS[reason]}`) — NEVER an interpolated content field (body/subject/recipient/
// name/…). The external email (notifyExternal) sends only the kind enum member + notificationMessage:
// no requestId, no content. Mutation-checked the 03.7 way: interpolating `${body}` into any notify
// message, or a content field into notifyExternal's mail, trips these RED (confirmed, then reverted).

/** A `${…content…}` interpolation of a content-bearing field — the thing a notify message may NEVER carry. */
const CONTENT_INTERPOLATION =
  /\$\{[^}]*\b(body|subject|recipient|recipients|draft|goal|editedBody|bodyIntent|snippet|gist|address|greetingName|name)\b/;

test("no notify call interpolates a content field into its message (§4 static-label firewall)", () => {
  // The notify call-sites across the phase. `message:` is a static label or a static-label interpolation;
  // it must never carry a `${...content...}`. Comments are stripped — prose names the fields by design.
  let scanned = 0;
  for (const file of [
    "pipeline.ts",
    "cockpit.ts",
    "deadLetter.ts",
    "notifications.ts",
    "notifyExternal.ts",
    "http.ts",
  ]) {
    const src = readSource(file).replace(/\/\/[^\n]*/g, "");
    const messages = [
      ...src.matchAll(/notifications\.notify,\s*\{[\s\S]*?message:\s*([^\n]*)/g),
    ].map((m) => m[1] ?? "");
    for (const msg of messages) {
      scanned++;
      expect(msg, `${file} interpolates content into a notify message: ${msg}`).not.toMatch(
        CONTENT_INTERPOLATION,
      );
    }
  }
  expect(scanned, "no notify messages were scanned — the firewall is vacuous").toBeGreaterThan(0);
});

test("the external channel sends only the kind label + notificationMessage — no content, no requestId (§4)", () => {
  // notifyExternal builds the email from the kind enum member (subject) + notificationMessage(kind)
  // (body) ONLY. Strip comments (they name the forbidden fields by design), then assert the mail-
  // building code carries no content field and no requestId — the external notice can leak nothing.
  const ext = readSource("notifyExternal.ts").replace(/\/\/[^\n]*/g, "");
  expect(ext, "notifyExternal does not send notificationMessage(kind) as the body").toMatch(
    /buildMime\([^)]*notificationMessage\(/,
  );
  // No content INTERPOLATION and no content PROPERTY READ (a request/plan field) may appear — and it
  // must take no requestId ref. (The `body:` fetch-option key is the HTTP request body, not content,
  // so the scan targets `${…content…}` / `.content` / the ref arg, never the bare key.)
  expect(ext, "notifyExternal interpolates a content field into the mail").not.toMatch(
    CONTENT_INTERPOLATION,
  );
  expect(
    ext,
    "notifyExternal reads a request/plan content field or takes a requestId ref",
  ).not.toMatch(/\.(body|subject|recipient|recipients|draft|goal|snippet|gist)\b|\brequestId\b/);

  // The choke point schedules dispatch with { tenantId, kind } ONLY — never the message/requestId/content
  // (the loop guard is also a §4 guard: nothing content-bearing crosses into the external channel).
  const notif = readSource("notifications.ts").replace(/\/\/[^\n]*/g, "");
  const sched = notif.match(
    /runAfter\(\s*0\s*,\s*internal\.notifyExternal\.dispatch\s*,\s*(\{[^}]*\})/,
  );
  expect(sched, "notify does not schedule notifyExternal.dispatch").not.toBeNull();
  expect(sched?.[1], "the dispatch schedule carries more than { tenantId, kind }").not.toMatch(
    /\b(message|requestId|body|subject|recipient|draft|goal)\b/,
  );
});

// ── 14-09 (DOCV-01 / SC4): the voice-doc log plane carries refs, hashes and counts ONLY ───────────
//
// SC4 — "no report content leaks into audit/telemetry/step rows" — is NOT observable at runtime in a
// passing system. It only becomes visible after it has already leaked, at which point the audit log
// IS the PII honeypot CLAUDE.md §4 exists to prevent. So it is enforced statically, here.
//
// Phase 14 raised the stakes: 14-01 widened `evaluations.findings[]` with `citationExcerpt` so the
// LOCKED "quoted passage where available" decision could reach the screen. That excerpt is VERBATIM
// REPORT CONTENT. It is legal in the `evaluations` row and legal on screen; it is illegal in every
// `payload:` object and every `agentSteps` row. It is the single most dangerous identifier in the
// phase, so it is banned by name below, twice.
//
// Every scan here was mutation-verified (plant the forbidden value, confirm RED, revert). A scan
// that cannot go red is theatre. Each also asserts its target is PRESENT, so a rename fails loudly
// rather than passing vacuously.
//
// THE LEDGER (14-09, verified 2026-07-26 — re-runnable; each was confirmed RED, then reverted):
//   M1  raw `query` added to the voicedoc.searched payload  -> "EVERY payload object" + "voicedoc.searched"
//   M2  `citationExcerpt` added to the voicedoc.reviewed payload -> "EVERY payload object" + "voicedoc.reviewed"
//   M3  a THIRD internal.audit.log call site added          -> "log-plane surface is PINNED"
//   M4  `citationTitle` added to docReviewSchema (+required) -> "welds citations in code"
//   M5  `excerpt` renamed to `quote` in docReviewSchema      -> "DOES declare excerpt"
//   M6  `proofMetric` dropped from a required array          -> "STRICT-mode legal"
//   M7  an `audit.log` write planted in PostCall.tsx         -> "never turns a finding excerpt into a log field"
// M4/M5 are why the ledger exists: `properties` keys sit at 10 spaces and `required` at 8, so a
// literal-anchor mutation silently misses and reports a false PASS. Anchor on a regex, not on
// indentation, if you re-run these.

/** Content-plane identifiers that must never appear in a voice-doc log-plane payload.
 *  `\bquery\b(?!Hash)` bans the raw query while allowing `queryHash`; `\btext\b` bans a bare `text:`
 *  while allowing the `textInTok`/`textOutTok` count keys. */
const VOICEDOC_FORBIDDEN =
  /passages|chunks|\btext\b|\blabel\b|citationTitle|citationExcerpt|\bexcerpt\b|transcript|\bquery\b(?!Hash)/;

test("voiceDoc.ts: EVERY payload object is free of report content (SC4)", () => {
  // Comments stripped: the prose in this module legitimately NAMES these identifiers (it explains
  // the very ban being enforced). Code may not.
  const src = readSource("voiceDoc.ts").replace(/\/\/[^\n]*/g, "");
  const payloads = [...src.matchAll(/payload:\s*(\{[^}]*\})/g)].map((m) => m[1] ?? "");

  // Presence first: a file-wide scan over zero payloads passes vacuously and proves nothing.
  expect(payloads.length, "no voiceDoc payloads found - the scan is vacuous").toBe(2);
  for (const p of payloads) {
    expect(p, `voiceDoc payload leaks report content: ${p}`).not.toMatch(VOICEDOC_FORBIDDEN);
  }
});

test("voicedoc.searched carries sessionId + queryHash + resultCount, never the query", () => {
  const src = readSource("voiceDoc.ts").replace(/\/\/[^\n]*/g, "");
  const m = src.match(/eventType:\s*["']voicedoc\.searched["'][\s\S]*?payload:\s*(\{[^}]*\})/);
  expect(m, "voicedoc.searched audit not found").toBeTruthy();
  const payload = m?.[1] ?? "";
  // The HASH rides, the query does not - the same shape as gmail.ts's mailbox.searched.
  expect(payload).toMatch(/queryHash/);
  expect(payload).toMatch(/resultCount/);
  expect(payload).not.toMatch(VOICEDOC_FORBIDDEN);
});

test("voicedoc.reviewed carries counts + a verdict, no finding label, citation or excerpt", () => {
  const src = readSource("voiceDoc.ts").replace(/\/\/[^\n]*/g, "");
  const m = src.match(/eventType:\s*["']voicedoc\.reviewed["'][\s\S]*?payload:\s*(\{[^}]*\})/);
  expect(m, "voicedoc.reviewed audit not found").toBeTruthy();
  const payload = m?.[1] ?? "";
  expect(payload).toMatch(/findingCount/);
  expect(payload).toMatch(/gapCount/);
  expect(payload).toMatch(/verdict/);
  // A finding LABEL and a citationExcerpt are the two things a reviewer would most plausibly add
  // here "for debuggability". Both are report content. Both are banned.
  expect(payload, `voicedoc.reviewed leaks report content: ${payload}`).not.toMatch(
    VOICEDOC_FORBIDDEN,
  );
});

test("voiceDoc.ts log-plane surface is PINNED: exactly 2 audit sites, no telemetry/DLQ/agentSteps", () => {
  const src = readSource("voiceDoc.ts").replace(/\/\/[^\n]*/g, "");
  // A COUNT, not a ">= 1": pinning it makes a third audit row a failing test rather than a
  // silently-shipped leak. If you add a legitimate one, update this number DELIBERATELY.
  const auditSites = [...src.matchAll(/internal\.audit\.log\b/g)].length;
  expect(
    auditSites,
    "voiceDoc.ts audit call-site count changed - is the new payload SC4-safe?",
  ).toBe(2);
  // The module writes to no other log-plane table at all.
  expect(src).not.toMatch(/\.insert\(\s*["']telemetry["']/);
  expect(src).not.toMatch(/\.insert\(\s*["']deadLetters["']/);
  expect(src).not.toMatch(/agentSteps/);
});

test("docReviewSchema welds citations in code - the MODEL schema has no citation/verdict/route field", () => {
  const src = readSource("voiceDoc.ts");
  const start = src.indexOf("const docReviewSchema = jsonSchema<");
  expect(start, "docReviewSchema not found - has the producer been renamed?").toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf("\n});");
  const block = (end >= 0 ? rest.slice(0, end) : rest).replace(/\/\/[^\n]*/g, "");

  // SC2 BY CONSTRUCTION: the model cannot omit or invent a citation it was never asked for. Each of
  // these is welded by `shapeDocReview` in pure code, so its ABSENCE here is the guarantee.
  for (const welded of [
    "citationDocId",
    "citationTitle",
    "verdict",
    "route",
    "playbook",
    "leverageRank",
  ]) {
    expect(
      block,
      `docReviewSchema lets the model author ${welded} - it must be welded in code`,
    ).not.toMatch(new RegExp(`\\b${welded}\\b`));
  }
});

test("docReviewSchema DOES declare excerpt - the one model-authored citation input", () => {
  const src = readSource("voiceDoc.ts");
  const start = src.indexOf("const docReviewSchema = jsonSchema<");
  const rest = src.slice(start);
  const end = rest.indexOf("\n});");
  const block = (end >= 0 ? rest.slice(0, end) : rest).replace(/\/\/[^\n]*/g, "");

  // A PRESENCE assertion, deliberately. `excerpt` is the ONE exception to the weld - only whoever
  // read the passage can quote it - and it is half of 14-CONTEXT.md's locked citation decision
  // ("document-level always, PLUS a quoted passage where available"). A future "tighten the schema"
  // cleanup that deletes it would silently drop that half of a locked decision, and every other test
  // here would still pass. This is the test that fails instead.
  expect(
    block,
    "docReviewSchema no longer declares excerpt - half the locked citation decision is gone",
  ).toMatch(/\bexcerpt\b/);
});

test("voiceDoc.ts jsonSchema blocks are STRICT-mode legal (every property also required)", () => {
  // The same trap 03.7-05 hit live: OpenAI structured outputs run in STRICT mode, which requires
  // every `properties` key to appear in `required`. A merely-optional field makes the API reject the
  // SCHEMA, so the call throws on EVERY input - invisible to a mocked unit test and to the SMOKE
  // path, which short-circuits before the call. `excerpt` is exactly such a field, which is why it is
  // declared `type: ["string","null"]` AND required rather than optional.
  const src = readSource("voiceDoc.ts");
  const schemas = [...src.matchAll(/const (\w*[Ss]chema) = jsonSchema</g)].map((m) => m[1]);
  expect(
    schemas.length,
    "no jsonSchema in voiceDoc.ts - has the producer changed shape?",
  ).toBeGreaterThan(0);

  for (const name of schemas) {
    const start = src.indexOf(`const ${name} = jsonSchema<`);
    const rest = src.slice(start);
    const end = rest.indexOf("\n});");
    const block = rest.slice(0, end >= 0 ? end : undefined);
    for (const m of block.matchAll(/properties:\s*\{/g)) {
      const from = (m.index ?? 0) + m[0].length;
      let depth = 1;
      const keys: string[] = [];
      let i = from;
      let lineStart = i;
      for (; i < block.length && depth > 0; i++) {
        const c = block[i];
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        else if (c === "\n") lineStart = i + 1;
        if (depth === 1 && c === ":") {
          const key = block.slice(lineStart, i).trim();
          if (/^[a-zA-Z_]\w*$/.test(key)) keys.push(key);
        }
      }
      const after = block.slice(i);
      const req = after.match(/required:\s*\[([^\]]*)\]/);
      expect(req, `${name}: a properties block has no required array`).toBeTruthy();
      const required = (req?.[1] ?? "").match(/["'](\w+)["']/g)?.map((s) => s.slice(1, -1)) ?? [];
      for (const k of keys) {
        expect(
          required,
          `${name}: property "${k}" is not in required (STRICT mode rejects it)`,
        ).toContain(k);
      }
    }
  }
});

test("the assemble script is NOT a skills registry row (delta pitfall 17 — the RCE door)", () => {
  // CLAUDE.md §5 makes PROMPTS registry rows. The obvious generalisation — "the assemble script
  // should be a registry row too" — is REMOTE CODE EXECUTION: a registry row is mutable by a
  // database write, and this string is executed as a shell script inside a VM that holds tenant
  // media. The script is a repo file (`convex/render/assemble_final.sh`) with a byte-identity
  // drift test against its bundler-safe mirror. This scan is the door.
  //
  // Comments are stripped before matching (the 15.2-07 lesson): this very file, and skills.ts's
  // own commentary, may NAME the banned thing while explaining it. Prose may; CODE may not.
  const seeds = readSource("skills.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  // No seed entry may be named for the assembler…
  expect(
    seeds,
    "an `assemble` seed entry would make the shell script a mutable DB row",
  ).not.toMatch(/name:\s*["'`]assemble/i);
  expect(seeds).not.toMatch(/\bASSEMBLE\w*_SKILL\b/);
  // …and no seed body may come from the render directory, whatever the entry is called.
  expect(
    seeds,
    "a seeds body sourced from convex/render/ is the same door by another name",
  ).not.toMatch(/from\s+["'`][^"'`]*render\//);
  expect(seeds).not.toMatch(/assembleScriptBody/);

  // Non-vacuity floor: if `readSource` or the comment-strip ever returns nothing, the four
  // assertions above pass by finding nothing. The seeds array must still be in there.
  expect(seeds).toMatch(/const seeds = \[/);
});

test("the voice-doc UI never turns a finding excerpt into a log field", () => {
  // The excerpt's whole journey is server row -> screen. These three components are the only new
  // places it is READ, so they are the only new places it could be re-logged on the way past.
  // Neither a log-plane write nor a telemetry sink may appear in any of them.
  const webDir = join(convexDir, "../../../apps/web/app/(app)/dashboard");
  for (const rel of ["voice/PostCall.tsx", "voice/DocStrip.tsx", "workspace/cards.tsx"]) {
    // Strip BLOCK comments as well as line comments: these files carry JSX `{/* … */}` prose that
    // legitimately names the banned identifiers — it is the §4 reminder telling the next reader NOT
    // to log an excerpt. Prose may name them; CODE may not. The file-wide idiom, applied to TSX.
    const src = readFileSync(join(webDir, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src, `${rel} writes a log-plane row`).not.toMatch(/audit\.log\b/);
    expect(src, `${rel} calls a telemetry sink`).not.toMatch(/\btelemetry\b/);
  }
});

// ── 20-06 (MEDIA-01 / SC4): the media log plane carries refs, hashes, counts and one enum ─────────
//
// A signed fal URL is BOTH a content leak and a live credential. The whole reason plan 20-06
// downloads the asset inside the webhook is so there is nowhere in the schema for one to live —
// but "nowhere in the schema" does not stop someone putting one in an audit payload. That is what
// these scans are for, and they are the §4 guard the TYPE system cannot give us:
// `packages/contracts/src/audit.ts` permits ANY string in its flat map by design.
//
// Every scan below asserts its target is PRESENT before asserting anything about it, so a rename
// fails loudly rather than passing vacuously.

// 20-15 added `render/renderReel.ts`. It had to be added HERE and not merely counted: the audit
// site it introduces lives OUTSIDE the two-module set, so without this line the "exactly N audit
// sites" pin below would not have seen the render payload at all and would have kept passing at 1
// — a scan that silently stops covering the thing it was written for.
const MEDIA_MODULES = ["media.ts", "mediaComplete.ts", "render/renderReel.ts"] as const;
const stripCode = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

/**
 * The media audit payload allow-list, AS SHIPPED. Ids, hashes, counts and two enums — nothing else.
 *
 * Deliberately differs from plan 20-06's list in two places, both recorded in 20-06-SUMMARY.md:
 * `lineCount` is OUT (a per-row terminal has no line count without a batch scan, and `batchId` is
 * already the join key), and `reconciled` + `failureReason` are IN (`reconciled` is what makes the
 * EXACT_SPEND_KINDS skip observable and therefore testable; `failureReason` is already a CODE).
 */
const MEDIA_AUDIT_ALLOWED = new Set([
  "jobId",
  "batchId",
  "planId",
  "falRequestId",
  "kind",
  "model",
  "resolution",
  "promptHash",
  "assetHash",
  "verdict",
  "estCents",
  "actualCents",
  "reconciled",
  "failureReason",
  // 20-15, the render terminal. All four are counts or hashes: `renderMs` is a duration,
  // `gatesPassed` is the LENGTH of the sidecar's gate list (never the gate names), `sidecarHash`
  // is a content hash and `blockCount` is a count. No filename, no narration, no URL, no stderr.
  "renderMs",
  "gatesPassed",
  "sidecarHash",
  "blockCount",
  // 20-16's render DEAD LETTER. A code, not ffmpeg's prose — `reasonCodeFor` is the only thing
  // that ever reads stderr and it returns a member of a closed union.
  "reasonCode",
]);

/** Top-level keys of an object literal. A plain comma split is enough BECAUSE `mediaComplete.ts`
 *  deliberately hoists any call-valued field out of its payload literals — see the comment at the
 *  `resolution` hoist. If that ever stops being true this needs a depth-tracking parser, which is
 *  the signal to hoist instead. */
const keysOf = (literal: string): string[] =>
  literal
    .replace(/^\s*\{/, "")
    .replace(/\}\s*$/, "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith("..."))
    .map((part) => (part.split(":")[0] ?? "").trim());

/** Every media audit payload literal: the `payload:` object handed to `audit.log`, and the argument
 *  of each `audit(...)` helper call that feeds it. */
function mediaAuditLiterals(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const file of MEDIA_MODULES) {
    const code = stripCode(readSource(file));
    for (const m of code.matchAll(/payload:\s*(\{[^}]*\})/g)) out.push([file, m[1] ?? ""]);
    for (const m of code.matchAll(/\bawait audit\((\{[^}]*\})\)/g)) out.push([file, m[1] ?? ""]);
  }
  return out;
}

test("media audit payloads are refs-only — every key is on the allow-list", () => {
  const literals = mediaAuditLiterals();
  // A file-wide scan over zero payloads passes vacuously and proves nothing.
  // 3 -> 4 at 20-15 (the render terminal's audit) -> 5 at 20-16 (the render dead letter, whose
  // payload is scanned by the SAME allow-list on purpose: a dead letter is a log-plane row and §4
  // applies to it identically).
  // -> 7 at 20-17: the caption terminal's `media.captioned` audit and the caption dead letter.
  // Both are scanned by this SAME allow-list, and neither needed a new key — a caption burn
  // produces a duration and two refs, which is all a successful re-encode of an already-published
  // reel can honestly report.
  expect(literals.length, "no media audit payloads found - the scan is vacuous").toBe(7);
  for (const [file, literal] of literals) {
    for (const key of keysOf(literal)) {
      expect(
        MEDIA_AUDIT_ALLOWED.has(key),
        `${file} media audit payload carries a non-allow-list key "${key}": ${literal}`,
      ).toBe(true);
    }
  }
});

test("NO url / href / http substring reaches a media audit payload", () => {
  // Mutation check (20-06): add `url: falUrl` to the landing payload and this goes RED.
  for (const [file, literal] of mediaAuditLiterals()) {
    expect(literal, `${file} media audit payload names a URL: ${literal}`).not.toMatch(
      /url|href|http/i,
    );
  }
});

test("no prompt text and no narration text reaches the media log plane — only promptHash", () => {
  for (const file of MEDIA_MODULES) {
    const code = stripCode(readSource(file));
    // `promptHash` is the ONLY representation permitted. `\bprompt\b` bans a bare prompt field
    // while allowing the hash; `narration` is banned outright (it is D8's spoken line).
    for (const [, literal] of mediaAuditLiterals().filter(([f]) => f === file)) {
      expect(literal, `${file} audit payload carries raw prompt/narration: ${literal}`).not.toMatch(
        /\bprompt\b(?!Hash)|narration/,
      );
    }
    // ...and no other log-plane sink exists in these modules at all — EXCEPT the render
    // terminal's single dead letter, which 20-16 requires: a failed render does not retry, so the
    // dead letter is the only durable record that it happened. Its keys are pinned by
    // MEDIA_AUDIT_ALLOWED above AND by an exact-key assertion in media.test.ts, so it is governed
    // rather than exempt. The ban still holds absolutely for the submit and landing planes.
    if (file !== "render/renderReel.ts") {
      expect(code, `${file} writes a deadLetters row`).not.toMatch(
        /\.insert\(\s*["']deadLetters["']/,
      );
    }
    expect(code, `${file} writes a telemetry row`).not.toMatch(/\.insert\(\s*["']telemetry["']/);
  }
});

test("the media log-plane surface is PINNED: exactly 2 audit sites across the three modules", () => {
  // A COUNT, not a ">= 1". Plans 20-09 (canvas), 20-16 (retention) and 20-17 (captions) EACH add
  // audit sites and must EACH bump this number deliberately, having checked the new payload
  // against MEDIA_AUDIT_ALLOWED above. 1 -> 2 at 20-15: the render terminal.
  const sites = MEDIA_MODULES.map(
    (f) => [...stripCode(readSource(f)).matchAll(/internal\.audit\.log\b/g)].length,
  );
  expect(
    sites.reduce((a, b) => a + b, 0),
    "media audit call-site count changed - is the new payload refs-only? (20-09/20-16/20-17 each bump this)",
  ).toBe(3);
  // And WHERE they live: the THREE TERMINALS — the fal landing, the render and the caption burn —
  // never the submit path and never a pre-flight. `media.ts` staying at ZERO is the load-bearing
  // half: it holds the prompts and the narration, and 20-17 gave it a whole new action without
  // giving it a log-plane sink.
  expect(sites[0], "media.ts grew an audit site").toBe(0);
  expect(sites[1], "mediaComplete.ts is the landing terminal").toBe(1);
  expect(sites[2], "render/renderReel.ts holds the render AND caption terminals").toBe(2);
});

test("only media.ts and mediaComplete.ts write a TERMINAL mediaJobs status, and succeeded is mediaComplete's alone", () => {
  // CORRECTION to research's SC2 line, recorded in 20-06-SUMMARY.md: research says the webhook is
  // the ONLY writer of succeeded/failed/blocked. That is not achievable — a 422
  // content_policy_violation is SYNCHRONOUS at submit and produces no webhook at all, so media.ts
  // must be able to write blocked/failed. The honest pin is the two-module set with `succeeded`
  // reachable from the terminal ALONE.
  // NOTE for plan 20-16: the render terminal writes `plans.renderStatus`, not `mediaJobs.status`,
  // so it does not widen this set. If it ever needs to, that is a deliberate edit HERE.
  const terminal = /\bstatus:\s*["'](succeeded|failed|blocked)["']/;
  const writers = new Set<string>();
  const succeeders = new Set<string>();
  let scanned = 0;
  for (const [rel, code] of allConvexSources()) {
    if (!code.includes("mediaJobs")) continue; // only modules that touch the table at all
    scanned++;
    if (terminal.test(code)) writers.add(rel);
    if (/\bstatus:\s*["']succeeded["']/.test(code)) succeeders.add(rel);
  }
  expect(
    scanned,
    "no mediaJobs-touching modules were scanned - the pin is vacuous",
  ).toBeGreaterThan(1);
  expect([...writers].sort()).toEqual(["media.ts", "mediaComplete.ts"]);
  expect([...succeeders]).toEqual(["mediaComplete.ts"]);
});

test("storage.getUrl is only ever called inside a tenantQuery", () => {
  // A storage URL is a BEARER CAPABILITY. Reached from anything but a tenant-guarded read it is one
  // step from a log line or an unguarded return.
  // THIS SCAN IS WHAT PLAN 20-17 MUST NOT BREAK: handing fal a `ctx.storage.getUrl()` result as the
  // STT `audio_url` would give a third party a bearer capability to a tenant's asset. If 20-17
  // needs the bytes at a provider, it uploads them - it does not hand over a URL.
  const builder =
    /=\s*(tenantQuery|tenantMutation|tenantAction|internalQuery|internalMutation|internalAction|httpAction|action|mutation|query)\s*\(/g;
  let sites = 0;
  for (const [rel, code] of allConvexSources()) {
    for (const call of code.matchAll(/storage\.getUrl/g)) {
      sites++;
      const enclosing = [...code.slice(0, call.index).matchAll(builder)].pop();
      expect(
        enclosing?.[1],
        `${rel}: storage.getUrl is not inside a tenantQuery (found ${enclosing?.[1] ?? "top level"})`,
      ).toBe("tenantQuery");
    }
  }
  expect(sites, "no storage.getUrl call sites found - the scan is vacuous").toBeGreaterThan(0);
});

// ── 20-15 (MEDIA-01 / D11): the render stage's structural guarantees ──────────────────────────
//
// The sandbox is a trust boundary in BOTH directions, and the type system can express neither
// direction. These scans are what make the guarantees structural rather than a promise in a
// playbook. Each asserts its target is PRESENT before asserting anything about it, so a rename
// fails loudly rather than passing vacuously.

const webRoot = join(convexDir, "../../../apps/web");
const renderRoute = join(webRoot, "app/api/media/render/route.ts");
const bakeScript = join(webRoot, "scripts/bake-sandbox-snapshot.mjs");
const coreRender = join(convexDir, "../../core/src/render.ts");
const readAt = (path: string): string => readFileSync(path, "utf8");

test("NOTHING FORBIDDEN crosses into the sandbox — not a key, not a tenant, not a URL", () => {
  // The request body `renderReel` constructs IS the complete list of what reaches the runner, and
  // the runner writes only that plus the assemble script into the VM. Scan the literal itself
  // rather than the file: the handler legitimately HAS a `tenantId` arg (it is what scopes the
  // query), and it must simply never travel.
  const src = stripCode(readSource("render/renderReel.ts"));
  const body = src.match(/body:\s*JSON\.stringify\(([\s\S]*?)\n\s{6}\}\)/)?.[1];
  expect(body, "the render request body literal was not found - the scan is vacuous").toBeTruthy();

  for (const banned of [
    "FAL_KEY",
    "OPENAI_API_KEY",
    "VERCEL_TOKEN",
    "SKILLOPT_TOKEN",
    "FAL_WEBHOOK_SECRET",
    "tenantId",
    "getUrl",
    "narration",
    "prompt",
  ]) {
    expect(body, `the render request body carries ${banned}`).not.toMatch(
      new RegExp(`\\b${banned}\\b`),
    );
  }
  // And no URL of any kind: the runner is handed opaque job ids and builds every blob URL itself
  // from OUR derived origin. The two `uploadUrls` are the deliberate exception and are named.
  expect(body).toMatch(/uploadUrls/);
  expect(
    body?.replace(/uploadUrls/g, ""),
    "a URL other than the upload pair crosses in",
  ).not.toMatch(/url|href|http/i);
});

test("NO VERCEL ACCESS TOKEN EXISTS ANYWHERE — D11's headline property, asserted not asserted-about", () => {
  // A Vercel access token is scoped to a TEAM, not a capability: it can deploy, delete projects
  // and read every project environment variable. That is strictly more powerful than anything
  // else this codebase holds, and it would falsify ADR-011's cleanest property — "an API key in a
  // deployment secret is the whole auth story", true of FAL_KEY precisely because FAL_KEY can only
  // generate media. D11 chose a route handler over a Convex-hosted runner SPECIFICALLY so that
  // none exists. This is the assertion that keeps it true.
  //
  // Comments are stripped first (the file-wide idiom): the route and the bake script both NAME
  // these variables while explaining why they are absent. Prose may; CODE may not.
  const sources: Array<[string, string]> = [
    ...allConvexSources(),
    ["apps/web/.../route.ts", readAt(renderRoute)],
    ["apps/web/scripts/bake-sandbox-snapshot.mjs", readAt(bakeScript)],
    ["packages/core/src/render.ts", readAt(coreRender)],
  ];
  let scanned = 0;
  for (const [rel, raw] of sources) {
    scanned++;
    const code = stripCode(raw);
    for (const banned of ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"]) {
      expect(code, `${rel} references ${banned} in CODE`).not.toMatch(new RegExp(banned));
    }
  }
  expect(scanned, "no sources were scanned - the pin is vacuous").toBeGreaterThan(3);
  // Non-vacuity floor for the two hand-added files: they must actually be readable and non-empty.
  expect(readAt(renderRoute)).toMatch(/Sandbox\.create/);
  expect(readAt(bakeScript)).toMatch(/snapshot/);
});

test("Sandbox.create appears TWICE and the render one is never an inline literal", () => {
  // Two, not one: the render route, and the OWNER-RUN bake script (egress open, zero tenant
  // bytes, run by hand). Any third occurrence is a new VM nobody reviewed.
  const all = [
    ...allConvexSources().map(([rel, code]) => [rel, code] as const),
    ["route.ts", stripCode(readAt(renderRoute))] as const,
    ["bake-sandbox-snapshot.mjs", stripCode(readAt(bakeScript))] as const,
  ];
  const sites = all.filter(([, code]) => /Sandbox\.create/.test(code)).map(([rel]) => rel);
  expect(sites.sort()).toEqual(["bake-sandbox-snapshot.mjs", "route.ts"]);

  // THE ONE THAT MATTERS: the render route's argument is `buildSandboxOptions(...)`, never an
  // object literal. That is precisely what makes `persistent: false` and `networkPolicy:
  // "deny-all"` assertable without a real VM — an inline literal could only be tested by booting
  // one. Deleting either field is a mutation check in packages/core's render.test.ts.
  expect(stripCode(readAt(renderRoute))).toMatch(/Sandbox\.create\(options\)/);
  expect(
    stripCode(readAt(renderRoute)),
    "the route builds its own sandbox options inline",
  ).not.toMatch(/Sandbox\.create\(\s*\{/);
});

test("no `name:` and no `persistent: true` anywhere in the render diff", () => {
  // A NAMED sandbox is resumable BY NAME, which is the whole persistence mechanism — and
  // persistence means tenant A's clips survive into the VM that renders tenant B's reel. Both are
  // cross-tenant leaks created by an option, not by a bug.
  for (const [rel, path] of [
    ["core/render.ts", coreRender],
    ["route.ts", renderRoute],
    ["bake-sandbox-snapshot.mjs", bakeScript],
  ] as const) {
    const code = stripCode(readAt(path));
    expect(code, `${rel} sets persistent: true`).not.toMatch(/persistent:\s*true/);
    expect(code, `${rel} names a sandbox`).not.toMatch(/\bname:\s*["'`]/);
  }
  // Non-vacuity: the option that MUST be there, is.
  expect(stripCode(readAt(coreRender))).toMatch(/persistent:\s*false/);
  expect(stripCode(readAt(coreRender))).toMatch(/networkPolicy:\s*"deny-all"/);
});

test("ffmpeg's stderr is READ exactly once, and on the same line it becomes a code", () => {
  // ffmpeg's stderr contains file paths and, on a caption burn, narration text. It is §4 content
  // and must never be persisted. `reasonCodeFor` returns a value from a closed union, so the
  // input cannot appear in the output BY CONSTRUCTION — but only if nothing else ever reads the
  // string. This is that guarantee.
  const code = stripCode(readAt(coreRender));
  const reads = [...code.matchAll(/\.stderr\(\)/g)];
  // TWO as of 20-17: the assemble pass and the caption burn — and the burn's is the more dangerous
  // of the pair, because `subtitles=` echoes the track it choked on and that track is NARRATION.
  expect(reads, "no stderr read found - the scan is vacuous").toHaveLength(2);
  // …and EVERY one of them is an ARGUMENT to reasonCodeFor, never a value bound to anything else.
  // Counting the call sites is what turns "it is" into "every one is": two reads, two calls.
  expect([
    ...code.matchAll(/reasonCodeFor\(\s*run\.exitCode,\s*await run\.stderr\(\)\s*\)/g),
  ]).toHaveLength(2);

  // Nowhere else on the render path may read it at all.
  for (const [rel, path] of [
    ["route.ts", renderRoute],
    ["render/renderReel.ts", join(convexDir, "render/renderReel.ts")],
  ] as const) {
    expect(stripCode(readAt(path)), `${rel} reads ffmpeg stderr`).not.toMatch(/\.stderr\(\)/);
  }
  // The bake script IS exempt and this records why rather than leaving it to a reader: it runs by
  // hand, against a sandbox created with ZERO tenant bytes in it, and prints to the owner's own
  // console. There is no tenant content in that VM for stderr to carry.
  expect(stripCode(readAt(bakeScript))).toMatch(/\.stderr\(\)/);
});

test("the route's maxDuration LITERAL still equals the exported constant", () => {
  // Next.js reads route segment config by STATIC ANALYSIS at build time, so `export const
  // maxDuration = RENDER_MAX_DURATION_S` does not resolve — the route must carry a literal. This
  // scan is the drift guard the import would otherwise have been, and without it the sandbox
  // timeout could quietly stop being below the function's ceiling.
  const literal = readAt(renderRoute).match(/export const maxDuration = (\d+)/)?.[1];
  expect(literal, "the route's maxDuration literal was not found").toBeTruthy();
  const constant = readAt(coreRender).match(/RENDER_MAX_DURATION_S = (\d+)/)?.[1];
  expect(constant, "RENDER_MAX_DURATION_S was not found").toBeTruthy();
  expect(literal, "route maxDuration has drifted from RENDER_MAX_DURATION_S").toBe(constant);

  // And the sandbox timeout is STRICTLY below it, in the same units.
  const timeoutMs = Number(
    readAt(coreRender)
      .match(/RENDER_SANDBOX_TIMEOUT_MS = ([\d_]+)/)?.[1]
      ?.replace(/_/g, ""),
  );
  expect(timeoutMs).toBeGreaterThan(0);
  expect(timeoutMs).toBeLessThan(Number(literal) * 1000);
});

test("no audio_url the media plane submits can originate from ctx.storage.getUrl", () => {
  // THE TRUST BOUNDARY THIS PLAN EXISTS AROUND (20-17). Every fal STT endpoint takes a URL fal
  // must FETCH. Our audio lives in `ctx.storage`, and `plans.attachmentUrls`' own header calls a
  // signed storage URL a BEARER CAPABILITY — handing one to a third party gives them read access
  // to a tenant's bytes for the life of the signature. The bytes go as a `data:` URI instead, so
  // no URL of ours exists to hand over.
  //
  // Scanned rather than described: this is a one-line "fix" away from being false, and the
  // symptom would be invisible — the transcript would come back correct either way.
  const media = stripCode(readSource("media.ts"));
  // Anchored on CODE at both ends, never on a comment: `stripCode` deletes comments, so a comment
  // marker resolves to -1 and `slice(start, -1)` silently returns the rest of the FILE — a scan
  // that reads far more than it claims to and fails for reasons that have nothing to do with it.
  const submitAt = media.indexOf("export const submitCaptions");
  const nextExport = media.indexOf("\nexport const", submitAt + 1);
  const submitFn = media.slice(submitAt, nextExport === -1 ? media.length : nextExport);
  expect(submitFn.length, "submitCaptions not found - has it been renamed?").toBeGreaterThan(200);
  expect(submitFn, "the captions submit reaches for a signed storage URL").not.toMatch(
    /storage\.getUrl/,
  );
  // …and the only thing that becomes an `audio_url` anywhere in the module is the data URI.
  const audioUrlAssignments = [...media.matchAll(/audio_?[Uu]rl:\s*([^,\n]+)/g)].map((m) =>
    (m[1] ?? "").trim(),
  );
  // Three: the field's TYPE on `SubmittableSpec`, the wire field in `buildSubmitBody`, and the one
  // construction site. The type declaration is included deliberately — if the field is ever
  // widened or re-typed, this count moves and the change gets read.
  expect(audioUrlAssignments.length, "no audio_url assignment found - the scan is vacuous").toBe(3);
  for (const value of audioUrlAssignments) {
    expect(value, `audio_url is built from "${value}"`).toMatch(
      // `^string` is the TYPE declaration on `SubmittableSpec`; the other two are the wire field
      // and the one construction site. Nothing else may ever produce this value.
      /^string\b|spec\.audioUrl|audioDataUri\(/,
    );
  }
});

test("storage.delete has exactly ONE site in the media subsystem — the retention loop", () => {
  // D12(b) is delete-on-SUCCESS and keep-on-FAILURE, and the failure half is the one that is easy
  // to get backwards and impossible to notice. A second deletion site is how a delete-on-failure
  // bug gets introduced later, so the site count is pinned rather than the behaviour described.
  // Scoped to the MEDIA subsystem: `llm.ts` deletes its own transient blobs and is not this
  // policy's business. What must stay single-sited is the deletion of TENANT MEDIA.
  const sites: Array<[string, number]> = [];
  for (const [rel, code] of allConvexSources()) {
    if (!rel.startsWith("render/") && !rel.startsWith("media")) continue;
    const n = [...code.matchAll(/storage\.delete\b/g)].length;
    if (n > 0) sites.push([rel, n]);
  }
  // TWO as of 20-17, both still inside the one module. The second is the caption terminal deleting
  // the UNCAPTIONED cut after repointing `renderStorageId` at the captioned one — that is a delete
  // of tenant media, so it is pinned here rather than exempted. What the count still forbids is a
  // deletion site appearing in the submit or landing planes, which is where a delete-on-failure bug
  // would hide.
  expect(sites).toEqual([["render/renderReel.ts", 2]]);

  // …and it is inside the SUCCESS arm. The failure arm returns before reaching it, which is what
  // makes "the intermediates are the only debugging evidence a failed render leaves" true.
  const src = stripCode(readSource("render/renderReel.ts"));
  const failureArm = src.slice(
    src.indexOf("if (!a.result.ok)"),
    src.indexOf('renderStatus: "rendered"'),
  );
  expect(failureArm, "the failure arm deletes an intermediate").not.toMatch(/storage\.delete/);
  // The CAPTION terminal's failure arm, held to the same rule: a failed burn deletes nothing at
  // all — not the uncaptioned reel it failed to replace, and not the takes that fed it.
  const capFailureArm = src.slice(
    src.indexOf("if (!a.result.ok)", src.indexOf("export const recordCaptionBurn")),
    src.indexOf("const uncaptioned"),
  );
  expect(capFailureArm, "the caption failure arm deletes something").not.toMatch(/storage\.delete/);
});
