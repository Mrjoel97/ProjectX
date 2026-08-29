// The workflow-pack customization surface (29-07, ROUT-01): what it may offer, what it must never
// offer, and — the part this repo has paid for getting wrong — what it is allowed to SAY.
//
// THIS FILE RENDERS THE COMPONENT. The previous revision asserted every user-facing sentence by
// calling an exported copy function; a verifier stripped SIX of those functions out of the JSX at
// once (including replacing `refusalMessage(res)` with the raw enum) and all 59 tests stayed green.
// So `CustomizerView` is now the whole surface, it takes its state as props, and every sentence
// below is read out of the HTML `renderToStaticMarkup` produces. None of the copy functions is
// exported any more — there is nothing here to call instead of rendering.
//
// WHAT SSR CAN AND CANNOT PROVE. `apps/web`'s vitest config is node-only: no jsdom, no
// testing-library, so there is no click and no typing here. `react-dom/server` gives the real first
// paint for a given state, which is enough for the two things that kept going wrong — the SENTENCE
// a user reads and the ARIA a screen reader announces, both on the rendered node. Interaction is
// the Playwright spec's job and that spec has NOT been run for this route.
//
// THREE KINDS OF ASSERTION, and the difference matters:
//   1. RENDERED TEXT. Expected values are LITERALS, never a re-import of the constant the
//      implementation used — a test that imports its own oracle moves with its subject.
//   2. RENDERED ATTRIBUTES. `aria-*`/`for` are asserted as the exact id pair on the exact control,
//      not as a bare `toContain("aria-describedby")` that any other element in the file satisfies.
//   3. SOURCE-TEXT SCAN, for absences a render cannot show: a control that does not exist, a
//      mutation that is not imported. Those are claims about the shipped source, and they say so.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUSTOMIZATION_REJECTIONS,
  type CustomizationValues,
  packCustomizationFields,
  WORKFLOW_PACK_IDS,
} from "@pikar/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CustomizerView, type CustomizerViewProps, prefillFrom } from "./WorkflowPackCustomizer";

const here = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(join(here, "WorkflowPackCustomizer.tsx"), "utf8");
const pageSource = readFileSync(join(here, "page.tsx"), "utf8");
const layoutSource = readFileSync(join(here, "..", "..", "layout.tsx"), "utf8");
/** Six levels up is the repo root: workflows → dashboard → (app) → app → web → apps → root. */
const repoRoot = join(here, "..", "..", "..", "..", "..", "..");
const cockpitSource = readFileSync(
  join(repoRoot, "packages", "backend", "convex", "cockpit.ts"),
  "utf8",
);

/**
 * Comments stripped. Every SCAN below is about the SHIPPED SURFACE, not about prose: without this,
 * the header comment explaining that there is no activation control would itself fail the
 * no-activation scan, and the only way back to green would be deleting the explanation.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const component = stripComments(componentSource);
const page = stripComments(pageSource);

// ── Rendering ───────────────────────────────────────────────────────────────────────────────

const decodeEntities = (h: string) =>
  h
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Everything a sighted user reads, tags removed. */
const visible = (html: string) =>
  decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");

/** The opening tag of the element carrying `id="<id>"`, so ARIA is asserted on THAT node. */
const tagWithId = (html: string, id: string): string => {
  const m = html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
  expect(m, `no element with id="${id}" in the render`).not.toBeNull();
  return (m as RegExpMatchArray)[0];
};

type PackListing = NonNullable<CustomizerViewProps["packs"]>[number];
type SavedRow = NonNullable<CustomizerViewProps["mine"]>[number];

const PACK: PackListing = {
  packId: "business-pulse",
  title: "Business pulse",
  blurb: "One honest read on where the business stands.",
  opener: "Give me today's pulse.",
  output: "briefing",
  version: 4,
  sources: [
    { source: "vault", label: "your knowledge vault", state: "available", unlock: null },
    {
      source: "finance-inputs",
      label: "the figures you have entered",
      state: "unavailable",
      unlock: null,
    },
    {
      source: "connector-financials",
      label: "your connected sales and accounting systems",
      state: "unavailable",
      unlock: "Connect a sales or accounting system.",
    },
  ],
  missingKnownCount: 1,
  missingRuntimeCount: 1,
  myBaseVersion: null,
  myCustomizationValues: null,
};
const BUSINESS_PULSE: readonly PackListing[] = [PACK];

const BASE: CustomizerViewProps = {
  idPrefix: "p",
  packs: BUSINESS_PULSE,
  mine: [],
  selectedPackId: "business-pulse",
  baseline: {},
  values: {},
  busy: false,
  outcome: { kind: "none" },
  fieldErrors: {},
  onChoose: () => {},
  onSet: () => {},
  onClear: () => {},
  onSubmit: () => {},
};

const render = (over: Partial<CustomizerViewProps> = {}): string =>
  renderToStaticMarkup(createElement(CustomizerView, { ...BASE, ...over }));

/** The same pack with a saved customization on the server. */
const withSaved = (
  myBaseVersion: number,
  myCustomizationValues: string | null,
): readonly PackListing[] => [{ ...PACK, myBaseVersion, myCustomizationValues }];

describe("the render is real", () => {
  test("the selected pack's form is on the page, with its schema-generated controls", () => {
    const html = render();
    // Positive control for every "not rendered" assertion below: this IS the whole surface.
    expect(visible(html)).toContain("Business pulse");
    expect(html).toContain("<textarea");
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(visible(html)).toContain("Save these settings");
  });

  test("nothing is offered before a pack is chosen", () => {
    const html = render({ selectedPackId: null });
    expect(visible(html)).toContain("Choose a workflow");
    expect(html).not.toContain("<textarea");
    expect(visible(html)).not.toContain("Save these settings");
  });
});

describe("the copy says what is true — no implied activation path", () => {
  // THE POINT OF THIS PLAN. `planTenantActivation` refuses every name in
  // `WORKFLOW_PACK_SKILL_NAMES` (skills.ts, `PACK_GATE`), so a published customization cannot be
  // activated in this release; and `cockpit.ts`, the only production caller of `runWorkflowPack`,
  // does not pass `tenantSkillIds`, so no run a user starts reads it. Copy that says "pending
  // approval" or "awaiting review" describes a queue that does not exist.
  test("the activation note is rendered as its literal sentence", () => {
    expect(visible(render())).toContain(
      "Pikar cannot make a workflow customization live in this release. Saving one records your settings; no workflow you start uses them yet.",
    );
  });

  test("the note is on the page before a pack is chosen, so it cannot be missed", () => {
    expect(visible(render({ selectedPackId: null }))).toContain(
      "Pikar cannot make a workflow customization live in this release.",
    );
  });

  // CITE-OR-DELETE. The rendered sentence "no workflow you start uses them yet" is an absolute
  // about ANOTHER module. This is the citation: adding the pin to cockpit.ts turns the sentence
  // into a lie, and this test is what goes red when it does.
  test("cockpit.ts still does not pin a tenant skill row on the run it starts", () => {
    const call = cockpitSource.match(
      /runAction\(internal\.workflowPackBinding\.runWorkflowPack,\s*\{[\s\S]*?\n {6}\}\)/,
    );
    expect(
      call,
      "the runWorkflowPack call in cockpit.ts moved — re-anchor this scan",
    ).not.toBeNull();
    const args = (call as RegExpMatchArray)[0];
    // Positive control: the scan really is looking at that call site.
    expect(args).toContain("packId,");
    expect(args).not.toContain("tenantSkillIds");
  });

  test.each([
    "pending approval",
    "awaiting approval",
    "awaiting review",
    "under review",
    "waiting for Pikar",
    "will be reviewed",
    "once approved",
  ])("neither the render nor the source says %s", (phrase) => {
    expect(visible(render()).toLowerCase()).not.toContain(phrase.toLowerCase());
    expect(component.toLowerCase()).not.toContain(phrase.toLowerCase());
  });
});

describe("a saved row renders its status, its eval state and the user's own words", () => {
  // `status` is a closed union on the wire, so the "unrecognised" case below is cast in
  // deliberately: `draftStateLine`'s default arm is the RUNTIME fallback for a row whose status a
  // later migration adds, and this is the only way to reach it from a typed fixture.
  const row = (over: Partial<SavedRow>): SavedRow =>
    ({
      name: "pack-business-pulse",
      label: "pack-business-pulse",
      authoredBody: "We call them jobs, not tickets.",
      author: "user" as const,
      version: 3,
      status: "candidate",
      baseScope: "global" as const,
      baseVersion: 4,
      gatePassed: false,
      ...over,
    }) as SavedRow;

  test.each([
    ["candidate", "Version 3 is saved as a draft."],
    ["active", "Version 3 is the active one."],
    ["rolled_back", "Version 3 was rolled back."],
    ["archived", "Version 3 was replaced by a newer one."],
  ])("a %s row reads as %s", (status, expected) => {
    expect(visible(render({ mine: [row({ status: status as SavedRow["status"] })] }))).toContain(
      expected,
    );
  });

  test("an unrecognised status is not silently described as a draft", () => {
    const html = visible(
      render({ mine: [row({ status: "something_new" as SavedRow["status"] })] }),
    );
    expect(html).toContain("Version 3 is in an unrecognised state.");
    expect(html).not.toContain("saved as a draft");
  });

  test("the eval state comes from the row's own gatePassed, both ways", () => {
    expect(visible(render({ mine: [row({ gatePassed: false })] }))).toContain(
      "No evaluation has certified this version.",
    );
    expect(visible(render({ mine: [row({ gatePassed: true })] }))).toContain(
      "An evaluation has certified this version.",
    );
  });

  test("the user's own adaptation is shown back to them", () => {
    expect(visible(render({ mine: [row({})] }))).toContain("We call them jobs, not tickets.");
  });
});

describe("lineage — which approved template, which version, what the server holds", () => {
  test("a first-time customization says so", () => {
    expect(visible(render())).toContain(
      "Based on the approved Business pulse template, version 4. You have not customized this workflow before.",
    );
  });

  test("a repeat edit names the version the SERVER holds for this exact pack", () => {
    expect(visible(render({ packs: withSaved(7, null) }))).toContain(
      "Based on the approved Business pulse template, version 4. Your latest saved version is 7.",
    );
  });

  // THE 50-ROW TRUNCATION DEFECT. `myUserSkills` returns the tenant's 50 most recent rows across
  // ALL skill names, so a busy account's pack row can be missing from it while the server holds
  // one. The base version now comes from `listPacks.myBaseVersion` — the same per-name
  // `by_tenant_name_version` take(1) the mutation compares against — and the saved list says which
  // of the two it is looking at instead of contradicting the lineage line above it.
  test("an empty recent list does not claim nothing is saved when the server holds a version", () => {
    const html = visible(render({ packs: withSaved(51, null), mine: [] }));
    expect(html).toContain(
      "Version 51 is saved for this workflow, but it is outside the recent list this page shows.",
    );
    expect(html).not.toContain("You have not customized this workflow yet.");
    expect(html).toContain("Your latest saved version is 51.");
  });

  test("an empty recent list AND no server version reads as never customized", () => {
    expect(visible(render({ mine: [] }))).toContain("You have not customized this workflow yet.");
  });

  test("every shipped pack has a real title, and no id leaks through as its own label", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      const html = visible(
        render({
          packs: [{ ...PACK, packId: id, title: "SHOULD NOT BE THE LINEAGE NAME" }],
          selectedPackId: id,
        }),
      );
      // The lineage sentence uses the CODE-OWNED title, never the row's own `title` field and never
      // the id — a server that echoed an attacker-chosen title cannot rename a template here.
      expect(html).toContain("Based on the approved ");
      expect(html).not.toContain(`Based on the approved ${id} template`);
      expect(html).not.toContain("Based on the approved SHOULD NOT BE THE LINEAGE NAME template");
    }
  });

  // An id `resolveWorkflowPack` refuses has no schema, so there is no form to render and nothing
  // to save. What must NOT happen is the row's own `title` being rendered as if it named an
  // approved template — the fail-closed door is the whole reason `templateId` is `v.string()`.
  test("an unresolvable id offers no form at all, and no lineage claim about it", () => {
    // Cast in deliberately: `listPacks` returns a closed pack id, so an unresolvable one is a
    // RUNTIME possibility only (a server ahead of this client). `resolveWorkflowPack` is the door.
    const unknown = "not-a-pack" as PackListing["packId"];
    const html = visible(
      render({
        packs: [{ ...PACK, packId: unknown, title: "Definitely approved" }],
        selectedPackId: unknown,
      }),
    );
    expect(html).not.toContain("Based on the approved");
    expect(html).not.toContain("Save these settings");
    // Positive control: the chooser still lists it, so the absence above is about the FORM.
    expect(html).toContain("Definitely approved");
  });
});

describe("a repeat customization opens with what was saved, and says it replaces all of it", () => {
  const prior: CustomizationValues = { business_terms: "jobs", tone: "warm" };

  test("the replacement is stated, naming the version the form opened from", () => {
    expect(
      visible(render({ packs: withSaved(2, null), baseline: prior, values: prior })),
    ).toContain(
      "These are the settings you saved in version 2. Saving replaces all of them with what is on this form.",
    );
  });

  test("the prefilled values are in the controls, not just in the copy", () => {
    const html = render({ packs: withSaved(2, null), baseline: prior, values: prior });
    expect(tagWithId(html, "p-business_terms")).toContain('value="jobs"');
    expect(html).toContain('<option value="warm" selected="">warm</option>');
  });

  test("a form that opened with prior settings and changed nothing says nothing changed", () => {
    expect(
      visible(render({ packs: withSaved(2, null), baseline: prior, values: prior })),
    ).toContain("You have not changed anything yet.");
  });

  test("the diff is against what the form OPENED with, not against the empty set", () => {
    // Only the tone moved. Against `{}` this would read "2 of 5" and name the terminology field
    // the user never touched — which is exactly what the blank-form revision rendered.
    expect(
      visible(
        render({
          packs: withSaved(2, null),
          baseline: prior,
          values: { ...prior, tone: "formal" },
        }),
      ),
    ).toContain(
      "You changed 1 of 5 settings: Tone of the result. This changes how the result reads, not what the workflow does.",
    );
  });

  test("no replacement warning when there was nothing to replace", () => {
    expect(visible(render())).not.toContain("Saving replaces all of them");
  });
});

describe("the before/after diff names what changed and what kind of change it is", () => {
  test("nothing changed reads as nothing changed", () => {
    expect(visible(render())).toContain("You have not changed anything yet.");
  });

  test("a tone-only edit is named as a wording change, not a behaviour change", () => {
    expect(visible(render({ values: { tone: "warm" } }))).toContain(
      "You changed 1 of 5 settings: Tone of the result. This changes how the result reads, not what the workflow does.",
    );
  });

  test("a threshold edit is named as a behaviour change", () => {
    expect(visible(render({ values: { priority_count: 2 } }))).toContain(
      "You changed 1 of 5 settings: How many priorities to surface. This changes what the workflow does.",
    );
  });

  test("two changes are both named, in schema order", () => {
    expect(visible(render({ values: { tone: "warm", business_terms: "jobs" } }))).toContain(
      "You changed 2 of 5 settings: Words your business uses, Tone of the result. This changes how the result reads, not what the workflow does.",
    );
  });
});

describe("a successful save is announced with its state and its change id", () => {
  test("the saved row's status and the shortened hash are both rendered", () => {
    const html = visible(
      render({
        outcome: {
          kind: "saved",
          saved: {
            ok: true,
            name: "pack-business-pulse",
            version: 3,
            status: "candidate",
            inserted: true,
            tenantSkillId: "k17abc" as never,
            customizationHash: "a".repeat(64),
          },
        },
      }),
    );
    expect(html).toContain("Version 3 is saved as a draft. Change id aaaaaaaaaaaa.");
    // The full digest is not on the screen; only the labelled prefix is.
    expect(html).not.toContain("a".repeat(20));
  });

  test("nothing is announced before a save happens", () => {
    expect(visible(render())).not.toContain("Change id");
  });
});

describe("refusals are RENDERED as instructions, and every one the server can return is covered", () => {
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
      "A newer draft of this workflow was saved (version 7). Pikar has caught up — press save again.",
    ],
    [
      { ok: false, reason: "stale_base_version", currentBaseVersion: null } as const,
      "Another draft of this workflow changed while you were editing. Pikar has caught up — press save again.",
    ],
    [
      { ok: false, reason: "empty_customization" } as const,
      "Change at least one setting before saving.",
    ],
    [
      { ok: false, reason: "invalid_values", errors: [] } as const,
      "Some settings could not be saved. See the notes on each one.",
    ],
  ])("refusal %# renders its sentence, never its enum", (refusal, expected) => {
    const html = render({ outcome: { kind: "refused", refusal } });
    expect(visible(html)).toContain(expected);
    // The enum name itself must never reach the screen.
    expect(visible(html)).not.toContain(refusal.reason);
    // And it is announced, not merely printed.
    expect(html).toMatch(new RegExp(`<p role="alert"[^>]*>${expected.slice(0, 20)}`));
  });

  // 29-07 FIX. The old copy said "Reload the page before saving again" for `stale_base_version`,
  // while the version it would reload came from a truncated 50-row window — so the reload
  // reproduced the same wrong value and the user could never save. The handler now adopts the
  // server's `currentBaseVersion`, and the sentence asks for the retry that can actually win.
  test("a stale base version never tells the user to reload", () => {
    for (const currentBaseVersion of [7, null]) {
      const html = visible(
        render({
          outcome: {
            kind: "refused",
            refusal: { ok: false, reason: "stale_base_version", currentBaseVersion },
          },
        }),
      );
      expect(html).not.toContain("Reload the page before saving again");
      expect(html).toContain("press save again");
    }
  });

  test("a transport failure is a different sentence from any refusal", () => {
    expect(visible(render({ outcome: { kind: "transport" } }))).toContain(
      "That could not be saved. Check your connection and try again.",
    );
  });

  test.each(CUSTOMIZATION_REJECTIONS)("the %s rejection renders a sentence, not the enum", (r) => {
    const html = visible(render({ fieldErrors: { business_terms: r } }));
    expect(html).not.toContain(r);
    expect(html).not.toContain("_");
  });

  test.each([
    ["forbidden_content", "Remove any link, code or key from this text."],
    ["out_of_range", "That number is outside the range this setting allows."],
    ["too_large", "That is longer than this setting allows."],
    ["unknown_option", "That is not one of the choices offered."],
  ] as const)("%s reads as %s", (reason, expected) => {
    expect(visible(render({ fieldErrors: { business_terms: reason } }))).toContain(expected);
  });

  test("every rejection has its own sentence — no two share one", () => {
    const seen = CUSTOMIZATION_REJECTIONS.map((r) => {
      const html = visible(render({ fieldErrors: { business_terms: r } }));
      const m = html.match(/Words your business uses\s*(.*?)\s*Tone of the result/);
      expect(m, `no note rendered for ${r}`).not.toBeNull();
      return (m as RegExpMatchArray)[1];
    });
    expect(new Set(seen).size).toBe(CUSTOMIZATION_REJECTIONS.length);
  });
});

describe("the byte counter says BYTES, because that is what the server counts", () => {
  const hint = (html: string) => {
    const m = visible(html).match(/(\d+ of 400 bytes used\.(?: Shorten this before saving\.)?)/);
    expect(m, "no byte counter rendered").not.toBeNull();
    return ((m as RegExpMatchArray)[1] ?? "").trim();
  };

  test("a multibyte value is counted as its bytes, on the screen", () => {
    // Three characters, nine bytes. A character count would under-report a paste by 3x, which is
    // what "9 of 400 characters used" would have claimed here.
    expect(hint(render({ values: { business_terms: "日本語" } }))).toBe("9 of 400 bytes used.");
  });

  test("surrounding whitespace is not charged, matching composeUserSkillBody's trim", () => {
    expect(hint(render({ values: { business_terms: "  abc  " } }))).toBe("3 of 400 bytes used.");
  });

  test("the word 'characters' never appears beside a byte cap", () => {
    expect(visible(render({ values: { business_terms: "abc" } }))).not.toContain("characters used");
  });

  test("over the cap, the user is told before the server refuses", () => {
    expect(hint(render({ values: { business_terms: "ボ".repeat(200) } }))).toBe(
      "600 of 400 bytes used. Shorten this before saving.",
    );
  });

  // The wrong-unit ceiling: `maxLength` counts UTF-16 code units, so a 400-byte field accepted 400
  // CJK characters (1200 bytes) and the counter beside it read past its own limit.
  test("no control carries a maxLength in the schema's byte unit", () => {
    expect(component).not.toContain("maxLength");
  });
});

describe("accessibility is on the rendered node, not merely present somewhere in the file", () => {
  test("every text control is labelled by its own <label for>, and describes its own note", () => {
    const html = render();
    for (const key of ["business_terms", "priority_count", "tone", "extra_guidance"]) {
      expect(html, key).toContain(`<label for="p-${key}"`);
      expect(tagWithId(html, `p-${key}`), key).toContain(`aria-describedby="p-${key}-note"`);
      // The described element must actually exist, or the reference announces nothing.
      expect(tagWithId(html, `p-${key}-note`), key).toContain(`id="p-${key}-note"`);
    }
  });

  test("the checkbox group is a fieldset that describes its own note too", () => {
    const html = render();
    const fs = html.match(/<fieldset[^>]*>/);
    expect(fs).not.toBeNull();
    expect((fs as RegExpMatchArray)[0]).toContain('aria-describedby="p-preferred_sources-note"');
    expect(html).toContain('<legend style="font-size:0.8rem;font-weight:600;padding:0">');
    // Each box is labelled by its own control id, not by the group's.
    expect(html).toContain('<label for="p-preferred_sources-vault"');
    expect(html).toContain('<input id="p-preferred_sources-vault"');
  });

  test.each([
    "business_terms",
    "priority_count",
    "tone",
    "extra_guidance",
    "preferred_sources",
  ])("%s carries aria-invalid on the RENDERED control when its value is rejected", (key) => {
    const clean = render();
    const bad = render({ fieldErrors: { [key]: "wrong_type" } });
    const target = key === "preferred_sources" ? /<fieldset[^>]*>/ : null;
    const cleanTag =
      target === null ? tagWithId(clean, `p-${key}`) : (clean.match(target) as RegExpMatchArray)[0];
    const badTag =
      target === null ? tagWithId(bad, `p-${key}`) : (bad.match(target) as RegExpMatchArray)[0];
    expect(cleanTag, `${key} clean`).not.toContain('aria-invalid="true"');
    expect(badTag, `${key} rejected`).toContain('aria-invalid="true"');
  });

  test("a field's rejection is announced on that field's own note element", () => {
    const html = render({ fieldErrors: { business_terms: "too_large" } });
    expect(html).toMatch(
      /<p id="p-business_terms-note"[^>]*role="alert"[^>]*>That is longer than this setting allows\./,
    );
    // The OTHER fields' notes are not alerts — a blanket role would announce four hints as errors.
    expect(tagWithId(html, "p-tone-note")).not.toContain('role="alert"');
  });

  test("the change summary and the save result are live regions", () => {
    const html = render({ values: { tone: "warm" } });
    expect(html).toMatch(
      /<p[^>]*aria-live="polite"[^>]*>You changed 1 of 5 settings: Tone of the result\./,
    );
    expect(html.match(/aria-live="polite"/g) ?? []).toHaveLength(2);
  });

  test("every control is disabled together while a save is in flight", () => {
    const html = render({ busy: true });
    expect(visible(html)).toContain("Saving…");
    for (const key of ["business_terms", "priority_count", "tone", "extra_guidance"]) {
      expect(tagWithId(html, `p-${key}`), key).toContain("disabled");
    }
    expect(html).toContain('<input id="p-preferred_sources-vault" type="checkbox" disabled=""');
  });
});

describe("the preflight is the workspace's component, fed the server's own rows", () => {
  test("each source's state is carried in WORDS, not only in a colour", () => {
    const html = visible(render());
    expect(html).toContain("your knowledge vault — can read");
    expect(html).toContain("the figures you have entered — cannot read");
  });

  test("a matrix gap's unlock is shown so the limit comes with a next step", () => {
    expect(visible(render())).toContain("Connect a sales or accounting system.");
  });
});

describe("the surface cannot offer capability authority", () => {
  // SOURCE SCANS, and they say so: these are absences a render cannot demonstrate.
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
    const call = component.match(/await publish\(\{([\s\S]*?)\n {6}\}\);/);
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

  // The ONE free-prose control is the schema's declared `instruction` field. There is no second
  // textarea, and in particular none bound to an assembled body.
  test("there is exactly one textarea, and it is the declared instruction field", () => {
    expect(render().match(/<textarea/g)).toHaveLength(1);
    expect(component).toContain('field.kind === "instruction"');
  });

  // Controls are GENERATED from the closed schema. A hand-written control would be a field the
  // server never declared, and `validateCustomization` would reject it — a form that cannot save.
  test("every control comes from iterating the approved schema", () => {
    expect(component).toContain("packCustomizationFields");
    expect(component).toContain("schema.fields.map");
  });

  test("no copy function is exported for a test to assert instead of the render", () => {
    for (const name of [
      "lineageLine",
      "draftStateLine",
      "refusalMessage",
      "changeSummary",
      "changeIdLine",
      "fieldHint",
      "fieldErrorMessage",
      "packTitle",
      "prefillLine",
      "evaluationLine",
      "ACTIVATION_NOTE",
    ]) {
      expect(component, name).toContain(
        `function ${name}`.replace("function ACTIVATION_NOTE", "ACTIVATION_NOTE ="),
      );
      expect(component, name).not.toContain(`export function ${name}`);
      expect(component, name).not.toContain(`export const ${name}`);
    }
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

describe("the prior settings a repeat edit opens with", () => {
  const schema = {
    templateId: "business-pulse" as const,
    templateVersion: 4,
    fields: packCustomizationFields("business-pulse"),
  };

  test("a row written by this build round-trips", () => {
    expect(
      prefillFrom(
        JSON.stringify({
          business_terms: "jobs",
          tone: "warm",
          priority_count: 3,
          preferred_sources: ["vault"],
        }),
        schema,
      ),
    ).toEqual({
      business_terms: "jobs",
      tone: "warm",
      priority_count: 3,
      preferred_sources: ["vault"],
    });
  });

  // A row written against an OLDER template. Sending a dropped key straight back would be refused
  // as `unknown_field` and a re-kinded value as `wrong_type` — i.e. the form would open in a state
  // it cannot save from, which is the failure this narrowing exists to prevent.
  test.each([
    ["a key this schema no longer declares", '{"business_terms":"jobs","gone_field":"x"}'],
    ["a value whose kind changed", '{"business_terms":"jobs","priority_count":"three"}'],
    ["a list where a string is declared", '{"business_terms":"jobs","tone":["warm"]}'],
    ["a non-string inside a source list", '{"business_terms":"jobs","preferred_sources":[1]}'],
  ])("%s is dropped, and the rest survives", (_label, json) => {
    expect(prefillFrom(json, schema)).toEqual({ business_terms: "jobs" });
  });

  test.each([
    ["no row at all", null],
    ["unparseable text", "{not json"],
    ["a JSON array", "[1,2,3]"],
    ["JSON null", "null"],
    ["a JSON string", '"business_terms"'],
  ])("%s opens an empty form rather than throwing", (_label, json) => {
    expect(prefillFrom(json, schema)).toEqual({});
  });

  test("no schema means nothing to narrow against, so nothing is prefilled", () => {
    expect(prefillFrom('{"business_terms":"jobs"}', null)).toEqual({});
  });

  // MECHANISM, NOT BEHAVIOUR, and it is labelled as such. `apps/web` has no DOM runner, so the
  // container's handlers cannot be driven here: choosing a pack, saving, and adopting the server's
  // base version are proved only by these three scans plus `workflowPackDiscovery.test.ts`'s
  // server-side assertions. A live interaction is the Playwright spec's job and it has NOT run.
  test("the container wires the three things a render cannot reach", () => {
    // 1. Choosing a pack prefills from the row the server returned.
    expect(component).toContain("prefillFrom(pack?.myCustomizationValues ?? null, packSchema)");
    // 2. The publish sends the server's per-name version unless a refusal has moved it.
    expect(component).toContain(
      "baseCandidateVersion: adoptedBase === undefined ? selected.myBaseVersion : adoptedBase",
    );
    // 3. A stale-base refusal adopts what the server says it holds, so the retry can win.
    expect(component).toContain(
      'if (res.reason === "stale_base_version") setAdoptedBase(res.currentBaseVersion);',
    );
  });
});
