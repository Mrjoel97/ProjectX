import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  applyGmailCapability,
  GMAIL_TOOL_NAMES,
  isPinnedCockpitEvaluation,
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

  test("only a pinned throwaway golden tenant bypasses the live Gmail grant", () => {
    expect(isPinnedCockpitEvaluation("eval-a80e0816", 2)).toBe(true);
    expect(isPinnedCockpitEvaluation("eval-a80e0816", undefined)).toBe(false);
    expect(isPinnedCockpitEvaluation("real-tenant", 2)).toBe(false);
  });
});
