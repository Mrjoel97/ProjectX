// The voice-brief drafting seam (draftVoiceBrief, VOIC-03) — mirrors documentDraft.test.ts.
//
// draftVoiceBrief lives INSIDE llm.ts (the only "use node" module) and turns a kept transcript
// into fixed-section brief markdown. These offline tests prove: (a) the brief body comes from the
// registry (fails closed unseeded — no hardcoded prompt, §5); (b) the SMOKE:: sentinel returns a
// deterministic brief with NO model call, all fixed sections present, empty sections as "None",
// and the full transcript welded verbatim (never model-authored).
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const SMOKE = "SMOKE::route=direct_llm::";

test("draftVoiceBrief loads the voice-brief body from the registry (fails closed unseeded)", async () => {
  const t = convexTest(schema, modules);
  // No seedSkills → no active voice-brief row. A registry-backed drafter fails closed
  // (NO_ACTIVE_SKILL) BEFORE the SMOKE short-circuit; a hardcoded prompt would never throw.
  await expect(
    t.action(internal.llm.draftVoiceBrief, {
      tenantId: "t1",
      transcript: [{ speaker: "user", text: `${SMOKE}anything` }],
      language: "en",
    }),
  ).rejects.toThrow();
});

test("SMOKE:: returns a deterministic fixed-section brief offline (no model call), transcript welded + empty section as None", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const md: string = await t.action(internal.llm.draftVoiceBrief, {
    tenantId: "t1",
    transcript: [
      { speaker: "user", text: `${SMOKE}Let's finalize the Q3 offsite.` },
      { speaker: "assistant", text: "Booked the venue for the 14th." },
    ],
    language: "en",
  });

  // Every fixed section is present as a plain UPPERCASE label (no markdown `#`) in composer order.
  for (const heading of [
    "SUMMARY",
    "DECISIONS",
    "ACTION ITEMS",
    "OPEN QUESTIONS",
    "DISCUSSION",
    "CONVERSATION",
  ]) {
    expect(md).toContain(heading);
  }
  // The brief carries NO markdown syntax — clean plain text for the vault + plan handoff.
  expect(md).not.toMatch(/[#*]/);
  // The spoken language is recorded on a leading Language line (an in-language brief knows its language).
  expect(md).toContain("Language: en");
  // The full transcript is welded VERBATIM in code as plain `Speaker: text` — both turns, never model-authored.
  expect(md).toContain("user: SMOKE::route=direct_llm::Let's finalize the Q3 offsite.");
  expect(md).toContain("assistant: Booked the venue for the 14th.");
  // An empty narrative section renders the literal "None" (open questions is empty offline).
  expect(md).toContain("OPEN QUESTIONS\n\nNone");
});
