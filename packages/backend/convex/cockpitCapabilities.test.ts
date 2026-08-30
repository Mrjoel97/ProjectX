import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  applyGmailCapability,
  GMAIL_TOOL_NAMES,
  isHarnessDrivenEvaluation,
  routeCockpitIntent,
  shouldUseGmailCapability,
} from "./cockpitCapabilities";

describe("cockpit capability routing", () => {
  test.each([
    "Draft an email to Amina about the proposal",
    "Reply to Sarah's message about Q3",
    "Check my inbox for anything urgent",
    "What happened in my inbox today?",
    "Can you give me a briefing of my inbox from this week?",
    "Send the proposal to Amina",
    "Email Amina the revised quote",
    "Add jane@example.com as the recipient",
  ])("routes genuine email-dependent intent: %s", (text) => {
    expect(routeCockpitIntent(text)).toMatchObject({ primary: "email", gmailRequired: true });
  });

  test.each([
    ["Evaluate my business using SWOT", "business"],
    ["Use my uploaded notes to refine our pricing", "knowledge"],
    ["What is our cash runway?", "finance"],
    ["Research three local competitors", "research"],
    ["Create a one-pager for the new offer", "content"],
    ["Build an email marketing strategy", "business"],
    ["Create an email onboarding sequence", "content"],
  ])("keeps non-email business work off the Gmail rail: %s", (text, capability) => {
    const route = routeCockpitIntent(text);
    expect(route.gmailRequired).toBe(false);
    expect(route.capabilities).toContain(capability);
  });

  test("removes Gmail tools while preserving broader business capabilities", () => {
    const tools = Object.fromEntries(
      [...GMAIL_TOOL_NAMES, "searchVault", "evaluateBusiness", "readFinance", "createDocument"].map(
        (name) => [name, { name }],
      ),
    );
    const selected = applyGmailCapability(tools, false);
    for (const name of GMAIL_TOOL_NAMES) expect(selected).not.toHaveProperty(name);
    expect(Object.keys(selected).sort()).toEqual(
      ["createDocument", "evaluateBusiness", "readFinance", "searchVault"].sort(),
    );
  });

  test("keeps the full record for an enabled email route", () => {
    const tools = { listInbox: {}, searchVault: {} };
    expect(applyGmailCapability(tools, true)).toBe(tools);
  });

  test("a bare answer continues an active email plan", () => {
    expect(shouldUseGmailCapability("Meeting reminder", true)).toBe(true);
    expect(shouldUseGmailCapability("Keep it warm and concise", true)).toBe(true);
  });

  test("an explicit non-email request overrides an old email draft", () => {
    expect(shouldUseGmailCapability("Evaluate my business using SWOT", true)).toBe(false);
    expect(shouldUseGmailCapability("Research three local competitors", true)).toBe(false);
    expect(shouldUseGmailCapability("Create a one-pager for the new offer", true)).toBe(false);
  });

  test("the production loop does not query the Gmail grant on a non-email route", () => {
    const source = readFileSync(fileURLToPath(new URL("./llm.ts", import.meta.url)), "utf8");
    expect(source).toMatch(
      /smokeOp \|\| !gmailRequired[\s\S]{0,120}internal\.gmailAuth\.hasGmailConnection/,
    );
  });

  test("a throwaway golden tenant bypasses the live Gmail grant — pinned or NOT", () => {
    // THE REGRESSION THIS FUNCTION EXISTS FOR. An UNPINNED eval run used to return false here,
    // withholding the email rail from a tenant that is disconnected by design. Every email fixture
    // then failed with `recipients: []` and a tool list of `{proposeCalendarEvent, stageCrmWrite}`
    // — the recipient tools were structurally absent — and the run measured the harness rather
    // than the product. Flipping either assertion to false is how that comes back.
    expect(isHarnessDrivenEvaluation("eval-a80e0816")).toBe(true);
    expect(isHarnessDrivenEvaluation("eval-d0556903")).toBe(true);
  });

  test("the guard that keeps this away from real users is the PREFIX, and only the prefix", () => {
    // Safe to rest the whole bypass on this: `sendCockpitMessage` is a `tenantAction` that passes
    // `ctx.tenantId` from the authenticated identity, so a real user cannot present an `eval-`
    // tenant. Nothing a caller sends reaches this argument.
    expect(isHarnessDrivenEvaluation("real-tenant")).toBe(false);
    expect(isHarnessDrivenEvaluation("k57rowabcdef")).toBe(false);
    // Not a substring match: the marker has to START the id, or any tenant could claim it.
    expect(isHarnessDrivenEvaluation("tenant-eval-a80e0816")).toBe(false);
    expect(isHarnessDrivenEvaluation("")).toBe(false);
  });

  // THE THREE RUN SHAPES THAT EACH COST MONEY, one assertion apiece. Every one is a harness-driven
  // run, and under the old pin-keyed predicate the second and third returned false.
  //
  // 21-03 widened the predicate from one pin scope to two. That fix did not hold, because the shape
  // that broke next carried NO pin in either scope. The predicate is the TENANT now, so a fourth
  // run shape cannot reintroduce this by arriving with a pin nobody enumerated.
  test("every harness run shape keeps the email rail, however it pins", () => {
    // 1. Global pin (`--skill cockpit-agent@26`) — the shape every historical green run used.
    expect(isHarnessDrivenEvaluation("eval-a80e0816")).toBe(true);
    // 2. Tenant pin only (`--tenant-skill <id>`) — 21-03, scored 21/41 for $0.4157.
    expect(isHarnessDrivenEvaluation("eval-6e021dce")).toBe(true);
    // 3. A pin on some OTHER skill, or none at all — `--skill research-specialist@9` scored 26/46,
    //    and the unpinned `--only` probe sent to diagnose it reproduced the same artifact.
    expect(isHarnessDrivenEvaluation("eval-d0556903")).toBe(true);
  });
});
