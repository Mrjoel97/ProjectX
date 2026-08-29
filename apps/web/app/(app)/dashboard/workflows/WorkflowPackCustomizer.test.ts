// The workflow-pack customization surface (29-07, ROUT-01): what it may offer, what it must never
// offer, and — the part this repo has paid for getting wrong — what it is allowed to SAY.
//
// TWO KINDS OF ASSERTION, and the difference matters:
//
//   1. PURE COPY. `packTitle`, `draftStateLine`, `refusalMessage`, `fieldErrorMessage`,
//      `changeSummary` and `lineageLine` are the component's user-facing sentences. Every expected
//      value below is a LITERAL, never a re-import of the constant the implementation used — a test
//      that imports its own oracle moves with its subject and can never fail (29-01 round 2).
//
//   2. SOURCE-TEXT SCAN. `apps/web`'s vitest config is node-only: no jsdom, no testing-library, and
//      the config documents adding them as a deliberate choice rather than a side effect. So a
//      `.tsx` cannot be RENDERED here. This is the `skillAuthoring.test.ts` / `vaultSurface.test.ts`
//      idiom that config points at, and it is honest about its ceiling: it proves the SHIPPED SOURCE
//      contains (and does not contain) exact things. It does NOT prove pixels. The browser proof is
//      a Playwright spec that has NOT been run for this route.
//
// The scan is what ties the pure copy to the render: a sentence tested in isolation and then not
// rendered is decoration, so every copy function below is also asserted to be CALLED in the JSX.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CUSTOMIZATION_REJECTIONS, WORKFLOW_PACK_IDS } from "@pikar/core";
import { describe, expect, test } from "vitest";
import {
  ACTIVATION_NOTE,
  changeIdLine,
  changeSummary,
  draftStateLine,
  fieldErrorMessage,
  lineageLine,
  packTitle,
  refusalMessage,
  valueBytes,
} from "./WorkflowPackCustomizer";

const here = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(join(here, "WorkflowPackCustomizer.tsx"), "utf8");
const pageSource = readFileSync(join(here, "page.tsx"), "utf8");
const layoutSource = readFileSync(join(here, "..", "..", "layout.tsx"), "utf8");

/**
 * Comments stripped. Every scan below is about the SHIPPED SURFACE, not about prose: without this,
 * the header comment explaining that there is no activation control would itself fail the
 * no-activation scan, and the only way back to green would be deleting the explanation.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const component = stripComments(componentSource);
const page = stripComments(pageSource);

describe("the scan read real code", () => {
  test("the component is substantial and stripping comments left the JSX", () => {
    expect(componentSource.length).toBeGreaterThan(6000);
    expect(component.length).toBeGreaterThan(3000);
    // Positive control: the stripper removed prose and kept code.
    expect(componentSource).toContain("ponytail:");
    expect(component).not.toContain("ponytail:");
    expect(component).toContain("publishPackCustomization");
  });
});

describe("the copy says what is true — no implied activation path", () => {
  // THE POINT OF THIS PLAN. `planTenantActivation` refuses every name in
  // `WORKFLOW_PACK_SKILL_NAMES` (skills.ts, `PACK_GATE`), so a published customization cannot be
  // activated in this release; and `cockpit.ts`, the only production caller of `runWorkflowPack`,
  // passes `skillVersions` and never `tenantSkillIds`, so no run a user starts reads it. Copy that
  // says "pending approval" or "awaiting review" describes a queue that does not exist.
  test("the activation note is the literal sentence, not a review-queue promise", () => {
    expect(ACTIVATION_NOTE).toBe(
      "Pikar cannot make a workflow customization live in this release. Saving one records your settings; no workflow you start uses them yet.",
    );
  });

  test.each([
    "pending approval",
    "awaiting approval",
    "awaiting review",
    "under review",
    "waiting for Pikar",
    "will be reviewed",
    "once approved",
  ])("the surface never says %s", (phrase) => {
    expect(component.toLowerCase()).not.toContain(phrase.toLowerCase());
  });

  test("the activation note is rendered, not merely exported", () => {
    expect(component).toContain("{ACTIVATION_NOTE}");
  });

  test.each([
    ["candidate", "Version 3 is saved as a draft."],
    ["active", "Version 3 is the active one."],
    ["rolled_back", "Version 3 was rolled back."],
    ["archived", "Version 3 was replaced by a newer one."],
  ])("a %s row reads as %s", (status, expected) => {
    expect(draftStateLine({ version: 3, status })).toBe(expected);
  });

  test("an unrecognised status is not silently described as a draft", () => {
    expect(draftStateLine({ version: 3, status: "something_new" })).toBe(
      "Version 3 is in an unrecognised state.",
    );
  });
});

describe("lineage — which approved template, which version, what changed", () => {
  test("a first-time customization says so", () => {
    expect(lineageLine("business-pulse", 4, null)).toBe(
      "Based on the approved Business pulse template, version 4. You have not customized this workflow before.",
    );
  });

  test("a repeat edit names the draft it is based on", () => {
    expect(lineageLine("business-pulse", 4, 2)).toBe(
      "Based on the approved Business pulse template, version 4. Your latest saved version is 2.",
    );
  });

  test("every shipped pack has a real title, and no id leaks through as its own label", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      const title = packTitle(id);
      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toBe(id);
      expect(title).not.toContain("pack-");
    }
  });

  test("an unknown id is named as unknown rather than rendered as a title", () => {
    expect(packTitle("not-a-pack")).toBe("Unknown workflow");
  });
});

describe("the before/after diff is the real classifier, and states what kind of change it is", () => {
  const schema = {
    templateId: "business-pulse" as const,
    templateVersion: 4,
    fields: [
      {
        key: "business_terms",
        kind: "terminology" as const,
        label: "Words your business uses",
        maxBytes: 400,
      },
      {
        key: "tone",
        kind: "tone" as const,
        label: "Tone of the result",
        options: ["plain", "warm"],
      },
      {
        key: "priority_count",
        kind: "threshold" as const,
        label: "How many priorities to surface",
        min: 1,
        max: 5,
        integer: true,
      },
    ],
  };

  test("nothing changed reads as nothing changed", () => {
    expect(changeSummary(schema, {})).toBe("You have not changed anything yet.");
  });

  test("a tone-only edit is named as a wording change, not a behaviour change", () => {
    expect(changeSummary(schema, { tone: "warm" })).toBe(
      "You changed 1 of 3 settings: Tone of the result. This changes how the result reads, not what the workflow does.",
    );
  });

  test("a threshold edit is named as a behaviour change", () => {
    expect(changeSummary(schema, { priority_count: 2 })).toBe(
      "You changed 1 of 3 settings: How many priorities to surface. This changes what the workflow does.",
    );
  });

  test("two changes are both named, in schema order", () => {
    expect(changeSummary(schema, { tone: "warm", business_terms: "jobs" })).toBe(
      "You changed 2 of 3 settings: Words your business uses, Tone of the result. This changes how the result reads, not what the workflow does.",
    );
  });

  test("the change id is the server's hash, shortened and labelled as an id", () => {
    expect(changeIdLine("a".repeat(64))).toBe("Change id aaaaaaaaaaaa.");
  });
});

describe("refusals are rendered as instructions, and every one the server can return is covered", () => {
  test.each([
    [{ ok: false, reason: "unknown_template" } as const, "That workflow is not one Pikar offers."],
    [
      { ok: false, reason: "template_not_active" } as const,
      "That workflow is not switched on for your account yet, so it cannot be customized.",
    ],
    [
      { ok: false, reason: "stale_template_version", approvedVersion: 5 } as const,
      "Pikar updated this workflow while you were editing. Reload the page and make your changes against version 5.",
    ],
    [
      { ok: false, reason: "stale_base_version", currentBaseVersion: 7 } as const,
      "A newer draft of this workflow was saved (version 7). Reload the page before saving again.",
    ],
    [
      { ok: false, reason: "stale_base_version", currentBaseVersion: null } as const,
      "This workflow's drafts changed while you were editing. Reload the page before saving again.",
    ],
    [
      { ok: false, reason: "empty_customization" } as const,
      "Change at least one setting before saving.",
    ],
    [
      { ok: false, reason: "invalid_values", errors: [] } as const,
      "Some settings could not be saved. See the notes on each one.",
    ],
  ])("refusal %#", (res, expected) => {
    expect(refusalMessage(res)).toBe(expected);
  });

  // Every rejection the pure validator can produce reaches a distinct sentence. The MEMBERSHIP
  // comes from the closed list; the sentences are literals above and here, so widening the list
  // without writing copy fails rather than rendering an enum name at a user.
  test("every rejection has its own non-empty sentence", () => {
    const seen = CUSTOMIZATION_REJECTIONS.map((r) => fieldErrorMessage(r));
    expect(seen.length).toBe(9);
    expect(new Set(seen).size).toBe(9);
    for (const s of seen) {
      expect(s.length).toBeGreaterThan(10);
      expect(s).not.toContain("_");
    }
  });

  test.each([
    ["forbidden_content", "Remove any link, code or key from this text."],
    ["out_of_range", "That number is outside the range this setting allows."],
    ["too_large", "That is longer than this setting allows."],
  ] as const)("%s reads as %s", (reason, expected) => {
    expect(fieldErrorMessage(reason)).toBe(expected);
  });
});

describe("byte counting matches the server's cap, which is BYTES", () => {
  test("a multibyte character counts as its bytes, not as one character", () => {
    expect(valueBytes("abc")).toBe(3);
    // Three characters, nine bytes. A character count would under-report a paste by 3x.
    expect(valueBytes("日本語")).toBe(9);
  });

  test("leading and trailing whitespace is not charged, matching composeUserSkillBody's trim", () => {
    expect(valueBytes("  abc  ")).toBe(3);
  });
});

describe("the surface cannot offer capability authority", () => {
  test("the only mutation it holds is the closed pack-customization channel", () => {
    expect(component).toContain("api.skills.publishPackCustomization");
    expect(component.match(/useMutation\(/g)).toHaveLength(1);
  });

  test.each([
    "publishUserCandidate",
    "activateTenantCandidate",
    "activateAgentCandidate",
    "rollbackTenantSkill",
    "publishAgentCandidate",
    "deactivatePack",
    "recordTenantEvalEvidence",
  ])("it never names %s", (symbol) => {
    expect(component).not.toContain(symbol);
  });

  test.each([
    ["a URL input", 'type="url"'],
    ["an MCP setting", "mcp"],
    ["an api key field", "apiKey"],
    ["a tool selector", "toolNames"],
    ["a schedule", "nextRunAt"],
    ["a cron field", "cadence"],
  ])("it has no %s", (_label, needle) => {
    expect(component.toLowerCase()).not.toContain(needle.toLowerCase());
  });

  // `authoredBody` is READ — it is the tenant's own rendered settings coming back from
  // `myUserSkills`, and showing someone their own words back is the point of the saved list. What
  // must never exist is a WRITE of it: the whole safety story of this channel is that the body is
  // composed server-side from validated fields, so the mutation's argument object is the boundary.
  test("the publish call sends exactly the four closed-form arguments", () => {
    const call = component.match(/await publish\(\{([\s\S]*?)\}\);/);
    expect(call).not.toBeNull();
    const keys = ((call as RegExpMatchArray)[1] ?? "")
      .split("\n")
      .map((l) => l.trim().replace(/[:,].*$/, ""))
      .filter((l) => l.length > 0);
    expect(keys).toEqual(["templateId", "templateVersion", "baseCandidateVersion", "values"]);
  });

  test("no control is bound to a body, and no body is ever sent", () => {
    expect(component).not.toContain("authoredBody:");
    expect(component).not.toContain("value={r.authoredBody");
    expect(component).not.toContain("defaultValue={r.authoredBody");
    // Positive control: the saved list DOES read it, so the three bans above are about writes.
    expect(component).toContain("{r.authoredBody}");
  });

  // The ONE free-prose control is the schema's declared `instruction` field, bounded at its own
  // `maxBytes`. There is no second textarea, and in particular none bound to an assembled body.
  test("there is exactly one textarea and it is driven by the declared field's cap", () => {
    expect(component.match(/<textarea/g)).toHaveLength(1);
    expect(component).toContain('field.kind === "instruction"');
    expect(component).toContain("field.maxBytes");
  });

  // Controls are GENERATED from the closed schema. A hand-written control would be a field the
  // server never declared, and `validateCustomization` would reject it — a form that cannot save.
  test("every control comes from iterating the approved schema", () => {
    expect(component).toContain("packCustomizationFields");
    expect(component).toContain("schema.fields.map");
  });
});

describe("accessibility is built in, not bolted on", () => {
  test("controls are labelled and errors are announced", () => {
    expect(component).toContain("htmlFor=");
    expect(component).toContain('role="alert"');
    // The checkbox group is a real fieldset with a legend, not a bare list of inputs.
    expect(component).toContain("<fieldset");
    expect(component).toContain("<legend");
    // Byte counters and per-field errors are attached to their control for a screen reader.
    // The two ARIA attributes are declared ONCE, on the object every control spreads, so they
    // cannot be present on one control kind and missing from another — which is why this asserts
    // the declaration AND the spread rather than an inline attribute.
    expect(component).toContain("aria-describedby");
    expect(component).toContain('"aria-invalid": invalid');
    expect(component.match(/\{\.\.\.shared\}/g)).toHaveLength(4);
  });

  test("status is carried in words, and the save result is announced live", () => {
    expect(component).toContain('aria-live="polite"');
  });
});

describe("the route exists and stays out of the nav until its authenticated gate passes", () => {
  test("the page renders the customizer", () => {
    expect(page).toContain("<WorkflowPackCustomizer");
    expect(page).toContain('"use client"');
  });

  test("the shell's NAV does not link to it", () => {
    // Positive control: the scan can see a route that IS in the nav.
    expect(layoutSource).toContain('"/dashboard/vault"');
    expect(layoutSource).not.toContain("/dashboard/workflows");
  });
});
