// The user's skill-authoring surface: what it MAY do, and the much longer list of what it must
// never offer or reveal (21-02, SKILL-01).
//
// SOURCE-TEXT SCAN, deliberately. `apps/web`'s vitest config is node-only with no jsdom and no
// testing-library, and that config documents adding them as a deliberate upgrade rather than a
// side effect — so a `.tsx` cannot be rendered here. This is the `crmCard.test.ts` /
// `vaultSurface.test.ts` idiom the config points at.
//
// What that means honestly: this proves the SHIPPED SOURCE contains (and does not contain) exact
// things. It does NOT prove pixels. The browser proof is 21-06's Playwright spec, and this file is
// not a substitute for it — it is the guard that catches the next edit which quietly adds an
// Activate button or renders a base body.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  USER_AUTHORABLE_SKILL_METADATA,
  USER_AUTHORABLE_SKILLS,
  USER_SKILL_ADAPTATION_MAX_BYTES,
} from "@pikar/contracts/skill";
import { describe, expect, test } from "vitest";
import { adaptationBytes, skillAuthorLabel, skillStateLabel } from "./SkillAuthoringPanel";

const here = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(join(here, "SkillAuthoringPanel.tsx"), "utf8");
const page = readFileSync(join(here, "page.tsx"), "utf8");

// Comments stripped: every scan below is about the SHIPPED SURFACE, not about prose. Without this
// the file's own note explaining that there is no Activate control fails the no-Activate scan,
// and the only way to keep the test green would be to delete the explanation — which is how a
// guard ends up silently weakened to accommodate itself.
const panel = panelSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("SkillAuthoringPanel — the publish path exists and is candidate-only", () => {
  test("the scan actually read the panel, and stripping comments left real code", () => {
    expect(panelSource.length).toBeGreaterThan(4000);
    expect(panel.length).toBeGreaterThan(2000);
    // The stripper removed prose and kept code: the explanatory block is gone, the JSX is not.
    expect(panelSource).toContain("Capability is code-owned (ADR-007)");
    expect(panel).not.toContain("Capability is code-owned (ADR-007)");
    expect(panel).toContain("export function SkillAuthoringPanel");
    expect(page).toContain("SkillAuthoringPanel");
  });

  // A tested component with no call site is invisible to every green suite in this repo — the
  // whole panel could be dead code and every assertion below would still pass. THIS is the
  // assertion that the surface is reachable.
  test("the panel is mounted from the workspace, from the EXISTING Chat options menu", () => {
    expect(page).toContain('import { SkillAuthoringPanel } from "./SkillAuthoringPanel"');
    expect(page).toContain("<SkillAuthoringPanel");
    expect(page).toContain("Adapt a business skill");
    // Inside the menu that already exists — not a new route and not a new nav entry. The end
    // marker is searched FROM the menu's start: `PastChats` closes a HeaderMenu earlier in the
    // file, so a plain indexOf returns an empty slice and this whole assertion passes vacuously.
    const menuStart = page.indexOf('aria-label="Chat options"');
    expect(menuStart).toBeGreaterThan(-1);
    const menu = page.slice(menuStart, page.indexOf("</HeaderMenu>", menuStart));
    expect(menu.length).toBeGreaterThan(100);
    expect(menu).toContain("Adapt a business skill");
    expect(menu).toContain("+ New chat"); // the pre-existing item is still there
    expect(page).not.toContain('href="/dashboard/skills"');
  });

  test("publish sends the two allowed fields and NOTHING else", () => {
    expect(panel).toContain("api.skills.publishUserCandidate");
    expect(panel).toContain("api.skills.myUserSkills");
    // The exact call. A third argument here would be a field the server refuses anyway, but it
    // would also mean someone believed the client owned it.
    expect(panel).toContain("publish({ name, authoredBody: text })");
  });

  // Named mutations that turn this RED: add an Activate button, or import an activation API.
  test("there is NO activation control, API or word anywhere in the panel", () => {
    for (const forbidden of [
      "activateCandidate",
      "activateAgentCandidate",
      "activateTenantCandidate",
      "activateSkill",
      "candidatesForReview",
      "recordEvalEvidence",
      "getSkillVersion",
      "getEffectiveSkill",
      "Activate",
      "Go live",
      "Publish live",
    ]) {
      expect(panel, `the authoring panel references ${forbidden}`).not.toContain(forbidden);
    }
    // Positive witness on the same file: the ONE mutation it may call really is there.
    expect(panel).toContain("useMutation(api.skills.publishUserCandidate)");
  });

  // Raw registry bodies are an owner-only disclosure boundary (skills.ts candidatesForReview).
  // The user authors an ADDITION and is shown their OWN words back — never the base.
  test("no base/composed body, evidence, fixture, tool, schedule or trigger surface", () => {
    for (const forbidden of [
      ".body",
      "baseBody",
      "composeUserSkillBody",
      "evidence",
      // NOT a bare "eval": the honest status copy contains the word "Evaluation", and a scan that
      // forbids a substring of legitimate user-facing copy gets weakened the first time it fires.
      // These are the fixture/corpus tells that would mean held-out eval data reached the user.
      "fixture",
      "golden",
      "eval-case",
      "evalCase",
      "toolNames",
      "SPECIALIST_TOOLS",
      "cron",
      "schedule",
      "trigger",
      "recurrence",
      "routine",
    ]) {
      expect(panel.toLowerCase(), `the authoring panel exposes ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
    // Positive witness: it DOES render the user's own adaptation, which is the only body text a
    // user may see.
    expect(panel).toContain("s.authoredBody");
  });

  // The panel must not invent a state the server does not have, and must not read a raw
  // authorization/provenance field. `myUserSkills` does not return one; this catches a future
  // widening of that projection being consumed here.
  test("the UI reads no raw tenant / user / author / rollback field", () => {
    for (const forbidden of [
      "tenantId",
      "authorUserId",
      "rollbackEligible",
      "basedOnGlobalSkillId",
      "basedOnTenantSkillId",
      "_id",
      "owner",
    ]) {
      expect(panel, `the authoring panel reads ${forbidden}`).not.toContain(forbidden);
    }
    // …while the honest state it DOES read goes through the one labeller, whose input is exactly
    // the two fields the server derives.
    expect(panel).toContain("skillStateLabel(s)");
    expect(panel).toContain("skillAuthorLabel(s.author)");
    expect(panel).toContain("status: string");
    expect(panel).toContain("gatePassed: boolean");
  });

  // The closed set and the cap come from the ONE contract module. A retyped literal is how the UI
  // and the registry drift; named mutation that turns this red: hardcode the three names here.
  test("names, labels and the cap are imported, never re-listed", () => {
    expect(panel).toContain("USER_AUTHORABLE_SKILLS");
    expect(panel).toContain("USER_AUTHORABLE_SKILL_METADATA");
    expect(panel).toContain("USER_SKILL_ADAPTATION_MAX_BYTES");
    expect(USER_AUTHORABLE_SKILLS).toHaveLength(3);
    for (const n of USER_AUTHORABLE_SKILLS) {
      expect(USER_AUTHORABLE_SKILL_METADATA[n].label.length).toBeGreaterThan(0);
      // The registry NAME is never rendered as a literal — the label is what a user reads.
      expect(panel).not.toContain(`"${n}"`);
    }
  });

  test("real controls and tokens: no hardcoded hex a token covers, no colour-only state", () => {
    expect(panel).toContain("<select");
    expect(panel).toContain("<textarea");
    expect(panel).toContain('type="button"');
    expect(panel).toContain("aria-label=");
    expect(panel).toContain('role="alert"'); // the error is announced, not just coloured
    // BRAND §8.1. `--card`, `--rule`, `--ink`, `--ink-soft` all exist; a raw hex here would mean
    // the panel stops following a theme change.
    expect(panel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(panel).toContain("var(--card)");
    expect(panel).toContain("var(--rule)");
  });
});

// The two pure bits the panel does own. They are small, but they are the difference between a
// truthful status line and a UI that says "live" about a draft.
describe("skillStateLabel + adaptationBytes", () => {
  test("the closed author discriminant is rendered honestly without an identity", () => {
    expect(skillAuthorLabel("user")).toBe("Authored by you");
    expect(skillAuthorLabel("agent")).toBe("Authored with Executive");
  });
  test("a candidate NEVER reads as live, evaluated or approved", () => {
    const draft = skillStateLabel({ status: "candidate", gatePassed: false });
    expect(draft).toContain("Draft");
    expect(draft).toContain("Nothing has changed yet");
    expect(draft.toLowerCase()).not.toContain("live");
    expect(draft.toLowerCase()).not.toContain("approved");
  });

  test("a passing candidate says the gate passed but stops short of claiming activation", () => {
    const passed = skillStateLabel({ status: "candidate", gatePassed: true });
    expect(passed).toContain("Evaluation passed");
    expect(passed).toContain("waiting");
    expect(passed).not.toBe(skillStateLabel({ status: "candidate", gatePassed: false }));
    // Only an ACTIVE row may use the word "uses now".
    expect(passed).not.toContain("uses now");
    expect(skillStateLabel({ status: "active", gatePassed: true })).toContain("uses now");
  });

  test("every status the server can return has its own sentence", () => {
    const seen = new Set(
      ["active", "candidate", "archived", "rolled_back"].map((status) =>
        skillStateLabel({ status, gatePassed: false }),
      ),
    );
    expect(seen.size).toBe(4);
  });

  // BYTES, not characters — the same measure the server caps on. A character count would let a
  // multibyte paste sail past the button's disabled check and be refused by the server instead.
  test("adaptationBytes measures UTF-8 bytes of the TRIMMED text", () => {
    expect(adaptationBytes("  abc  ")).toBe(3);
    expect(adaptationBytes("あ")).toBe(3);
    expect(adaptationBytes("   ")).toBe(0);
    const atCap = "あ".repeat(Math.floor(USER_SKILL_ADAPTATION_MAX_BYTES / 3));
    expect(adaptationBytes(atCap)).toBeLessThanOrEqual(USER_SKILL_ADAPTATION_MAX_BYTES);
    expect(adaptationBytes(`${atCap}あ`)).toBeGreaterThan(USER_SKILL_ADAPTATION_MAX_BYTES);
  });
});
