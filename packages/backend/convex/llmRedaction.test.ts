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
      new RegExp(`eventType:\\s*["']${eventType.replace(".", "\\.")}["'][\\s\\S]*?payload:\\s*(\\{[^}]*\\})`),
    );
    expect(m, `${eventType} audit payload not found`).not.toBeNull();
    const payload = m![1].replace(/\/\/[^\n]*/g, "");
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
  const postFetches = [...src.matchAll(/fetch\(\s*([^,\s]+)\s*,\s*\{\s*method:\s*["']POST["']/g)].map(
    (m) => m[1],
  );
  expect(postFetches, "the POST fetch targets changed").toEqual(["TOKEN_ENDPOINT", "SEND_ENDPOINT"]);
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
  expect(returns.length, "no return statements found in briefInbox — the scan is vacuous").toBeGreaterThan(0);
  for (const r of returns) {
    expect(r, `a briefInbox return references rawBodies (body text would reach the loop): ${r}`).not.toMatch(
      /rawBodies/,
    );
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
  expect(schemas.length, "no jsonSchema definitions found — has the idiom changed?").toBeGreaterThan(0);

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
      const required = [...requiredMatch[1].matchAll(/["'](\w+)["']/g)].map((r) => r[1]);
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
    expect(block, `${id} appears in the tool-bearing loop region (raw bodies would be ingested)`).not.toContain(
      id,
    );
  }
});

test("llm.ts briefing.created audit payload is refs-only ({ briefingId, range, listedCount, digestedCount })", () => {
  // Clone of the mailbox.searched/mailbox.listed discipline: ids + counts ONLY. A gist or sender
  // here would make the audit log the PII honeypot §4 exists to prevent.
  const src = readSource("llm.ts");
  const m = src.match(/eventType:\s*["']briefing\.created["'][\s\S]*?payload:\s*(\{[^}]*\})/);
  expect(m, "briefing.created audit payload not found").not.toBeNull();
  const payload = m![1];
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
  expect(returns.length, "no return statements found in briefInbox — the scan is vacuous").toBeGreaterThan(0);
  for (const r of returns) {
    expect(r, `a briefInbox return references synopsis (model prose would reach the loop): ${r}`).not.toMatch(
      /synopsis/,
    );
  }
  // And it must NOT appear in the briefing.created audit payload object.
  const auditPayload = block.match(/eventType:\s*["']briefing\.created["'][\s\S]*?payload:\s*(\{[^}]*\})/);
  expect(auditPayload, "briefing.created payload not found in briefInbox").not.toBeNull();
  expect(auditPayload![1], "synopsis leaked into the refs-only briefing.created payload").not.toMatch(
    /synopsis/,
  );
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
  expect(block, "the body-bearing identifier `originalBody` is gone from replyToMessage").toMatch(/originalBody/);
  // Its ONE sanctioned destination is the toolless drafter.
  expect(block, "originalBody never reaches internal.llm.draftReply").toMatch(
    /runAction\(internal\.llm\.draftReply/,
  );
  // The block writes NO audit — so the body/From can never reach an audit payload from here.
  expect(block, "replyToMessage writes a log-plane row (the body could reach an audit payload)").not.toMatch(
    /audit\.log\b|\.insert\(\s*["'](?:audit|deadLetters|telemetry)["']|payload:/,
  );
  // No return may carry the body into the tool-bearing loop.
  const returns = block.match(/return\s+[^;]*;/g) ?? [];
  expect(returns.length, "no return statements found in replyToMessage — the scan is vacuous").toBeGreaterThan(0);
  for (const r of returns) {
    expect(r, `a replyToMessage return references the original body: ${r}`).not.toMatch(/originalBody/);
  }
});

test("replyToMessage: the resolved From address reaches patchPlan ONLY — never a tool return (§2-D)", () => {
  const block = replyToMessageBlock();
  // The address-bearing identifier is present and reaches the recipient-by-ref patch.
  expect(block, "the address-bearing identifier `address` is gone from replyToMessage").toMatch(/const address =/);
  expect(block, "the address never reaches patchPlan (recipient-by-ref)").toMatch(/recipients:\s*\[address\]/);
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
  expect(block, "draftReply is NO LONGER TOOLLESS — it passes tools to the model").not.toMatch(/\btools\s*:/);
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
  expect(scanAt, "scanText must run before draftCockpit (redact-before-model)").toBeLessThan(draftAt);
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
  expect(start, `${name} is gone from llm.ts — the emitter was removed or renamed`).toBeGreaterThanOrEqual(0);
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
  expect(payloads.length, "no voice audit payloads found — the scan is vacuous").toBeGreaterThanOrEqual(3);
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
  // refused / dispatched / completed. A FOURTH lineage write is a new §4 surface, so the count is
  // pinned the way cockpit.ts's two audit.log sites are.
  expect(payloads.length, "dispatch.ts audit payload count changed").toBe(3);
  // All three SPREAD a shared `refs` object — scanning the payloads alone would miss a leak added
  // one line above them, so the spread source is scanned as a payload too.
  const refs = src.match(/const refs = (\{[^}]*\})/);
  expect(refs, "the shared `refs` object is gone from dispatch.ts — the scan is half-blind").not.toBeNull();

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
  for (const file of ["pipeline.ts", "cockpit.ts", "deadLetter.ts", "notifications.ts", "notifyExternal.ts", "http.ts"]) {
    const src = readSource(file).replace(/\/\/[^\n]*/g, "");
    const messages = [...src.matchAll(/notifications\.notify,\s*\{[\s\S]*?message:\s*([^\n]*)/g)].map(
      (m) => m[1] ?? "",
    );
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
  expect(ext, "notifyExternal reads a request/plan content field or takes a requestId ref").not.toMatch(
    /\.(body|subject|recipient|recipients|draft|goal|snippet|gist)\b|\brequestId\b/,
  );

  // The choke point schedules dispatch with { tenantId, kind } ONLY — never the message/requestId/content
  // (the loop guard is also a §4 guard: nothing content-bearing crosses into the external channel).
  const notif = readSource("notifications.ts").replace(/\/\/[^\n]*/g, "");
  const sched = notif.match(/runAfter\(\s*0\s*,\s*internal\.notifyExternal\.dispatch\s*,\s*(\{[^}]*\})/);
  expect(sched, "notify does not schedule notifyExternal.dispatch").not.toBeNull();
  expect(sched?.[1], "the dispatch schedule carries more than { tenantId, kind }").not.toMatch(
    /\b(message|requestId|body|subject|recipient|draft|goal)\b/,
  );
});
