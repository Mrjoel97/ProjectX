// @vitest-environment jsdom
//
// THE CONTAINER, DRIVEN AS AN INTERACTION. `WorkflowPackCustomizer.test.ts` renders `CustomizerView`
// with `react-dom/server` and asserts the sentences a user reads; it fires no event, so it says
// nothing about whether the container is WIRED to that view. It was not being asked to: four
// mutations that make /dashboard/workflows functionally inert — `onChoose`, `onSet` and `onSubmit`
// cut to no-ops, and `setBaseline(values)` deleted from the save's success arm — all left that
// suite at 109/109 green. A user could open the route, click a workflow, type, press save, and
// nothing would happen, with every gate reporting pass.
//
// So this file mounts the REAL container into a real DOM with `createRoot`, dispatches real click
// and input events, and reads the resulting text back out of the document. `convex/react` is the
// only thing stubbed — `useQuery` answers by the function reference's OWN path
// (`getFunctionName`, not a hand-kept map), and `useMutation` returns a spy whose queued results
// are the exact shapes `publishPackCustomization` returns.
//
// ponytail: jsdom + `createRoot` + `act`, no testing-library. `react` and `react-dom` were already
// here; jsdom is the one dependency this needed, and `apps/web/vitest.config.mts` named it as the
// upgrade path for exactly this case. Ceiling: no layout, no real focus ring, no CSS — an
// accessibility claim that depends on painted geometry still belongs in the Playwright spec.
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ── The Convex seam ─────────────────────────────────────────────────────────────────────────

type Listing = {
  packId: string;
  title: string;
  blurb: string;
  opener: string;
  output: string;
  version: number;
  sources: readonly { source: string; label: string; state: string; unlock: string | null }[];
  missingKnownCount: number;
  missingRuntimeCount: number;
  myBaseVersion: number | null;
  myCustomizationValues: string | null;
};

const PACK: Listing = {
  packId: "business-pulse",
  title: "Business pulse",
  blurb: "One honest read on where the business stands.",
  opener: "Give me today's pulse.",
  output: "briefing",
  version: 4,
  sources: [{ source: "vault", label: "your knowledge vault", state: "available", unlock: null }],
  missingKnownCount: 0,
  missingRuntimeCount: 0,
  myBaseVersion: null,
  myCustomizationValues: null,
};

/** What the two `useQuery` calls currently answer. Mutated between renders to model a live query. */
const server: { packs: readonly Listing[] | undefined; mine: readonly unknown[] | undefined } = {
  packs: [PACK],
  mine: [],
};

/** Results `publish` hands back, in order. */
let publishResults: unknown[] = [];
const publish = vi.fn(async (_args: Record<string, unknown>) => {
  const next = publishResults.shift();
  if (next === undefined) throw new Error("the component called publish more times than expected");
  return next;
});

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (ref: unknown) => {
      // Answered by the reference's OWN path, so a rename of either query breaks this file rather
      // than silently feeding the wrong rows into the wrong hook.
      switch (name(ref as never)) {
        case "workflowPackDiscovery:listPacks":
          return server.packs;
        case "skills:myUserSkills":
          return server.mine;
        default:
          throw new Error(`unexpected useQuery: ${name(ref as never)}`);
      }
    },
    useMutation: (ref: unknown) => {
      if (name(ref as never) !== "skills:publishPackCustomization") {
        throw new Error(`unexpected useMutation: ${name(ref as never)}`);
      }
      return publish;
    },
  };
});

const { WorkflowPackCustomizer } = await import("./WorkflowPackCustomizer");
const { api } = await import("@pikar/backend/api");

/** The seam really is the two queries and the one mutation this file claims it is. */
test("the stub answers the exact function paths the component asks for", () => {
  expect(getFunctionName(api.workflowPackDiscovery.listPacks)).toBe(
    "workflowPackDiscovery:listPacks",
  );
  expect(getFunctionName(api.skills.myUserSkills)).toBe("skills:myUserSkills");
  expect(getFunctionName(api.skills.publishPackCustomization)).toBe(
    "skills:publishPackCustomization",
  );
});

// ── Driving the DOM ─────────────────────────────────────────────────────────────────────────

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  server.packs = [PACK];
  server.mine = [];
  publishResults = [];
  publish.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const mount = async () => {
  await act(async () => {
    root.render(createElement(WorkflowPackCustomizer));
  });
};

const text = () => (container.textContent ?? "").replace(/\s+/g, " ");

const byText = (label: string): HTMLElement => {
  const el = [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
  if (el === undefined) throw new Error(`no button containing ${JSON.stringify(label)}`);
  return el;
};

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
};

/** Type into a controlled input the way React hears it: native setter, then a bubbling `input`. */
const type = async (id: string, value: string) => {
  // `getElementById`, not a selector: React 19's `useId` produces ids containing «» which are not
  // valid in a CSS selector without escaping.
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el === null) throw new Error(`no control with id ${id}`);
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter === undefined) throw new Error("no value setter on the control");
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};

/** The one text control every pack declares. `useId` makes the prefix unpredictable. */
const termsFieldId = (): string => {
  const el = container.querySelector('input[type="text"]');
  if (el === null) throw new Error("the terminology control is not on the page");
  return el.id;
};

const SAVED = {
  ok: true as const,
  version: 3,
  status: "candidate",
  customizationHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  gatePassed: false,
};

// ── The path a user actually walks ──────────────────────────────────────────────────────────

describe("open → edit → save", () => {
  test("nothing is offered until a workflow is chosen, and choosing one opens its form", async () => {
    await mount();
    expect(text()).toContain("Business pulse");
    expect(text()).not.toContain("Words your business uses");

    await click(byText("Business pulse"));

    // MUTATION `onChoose={choose}` → `() => {}`: this line is where it goes red. No form ever opens.
    expect(text()).toContain("Words your business uses");
    expect(text()).toContain("You have not customized this workflow before.");
  });

  test("a repeat edit opens with the settings the server holds, from the row it holds them on", async () => {
    server.packs = [
      { ...PACK, myBaseVersion: 3, myCustomizationValues: '{"business_terms":"jobs"}' },
    ];
    await mount();
    await click(byText("Business pulse"));

    expect((container.querySelector('input[type="text"]') as HTMLInputElement | null)?.value).toBe(
      "jobs",
    );
    expect(text()).toContain("This edit is based on your saved version 3.");
    expect(text()).toContain(
      "These are the settings you saved in version 3. Saving replaces all of them with what is on this form.",
    );
    expect(text()).toContain("You have not changed anything yet.");
  });

  test("typing moves the value, and the change summary follows it", async () => {
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");

    // MUTATION `onSet={setValue}` → `() => {}`: red here. The control stays empty and the summary
    // keeps saying nothing changed.
    expect((container.querySelector('input[type="text"]') as HTMLInputElement | null)?.value).toBe(
      "callouts",
    );
    expect(text()).toContain(
      "You changed 1 of 5 settings: Words your business uses. This changes how the result reads, not what the workflow does.",
    );
  });

  test("save sends the four closed-form arguments, and announces what came back", async () => {
    server.packs = [{ ...PACK, myBaseVersion: 2, myCustomizationValues: null }];
    publishResults = [SAVED];
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");
    await click(byText("Save these settings"));

    // MUTATION `onSubmit={() => void submit()}` → `() => {}`: red here. Nothing is ever sent.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toEqual({
      templateId: "business-pulse",
      templateVersion: 4,
      baseCandidateVersion: 2,
      values: { business_terms: "callouts" },
    });
    expect(text()).toContain("Version 3 is saved as a draft. Change id abcdef012345.");
  });

  test("a landed save SAYS SO, in a live region, naming the version", async () => {
    // THE GAP THIS CLOSES, found by the 29-10 browser gate on 2026-08-30. `setOutcome({kind:
    // "saved"})` was set and NOTHING RENDERED IT: success and still-in-flight were
    // indistinguishable in the DOM. That is not cosmetic — navigating straight after Save aborts
    // the in-flight mutation, so a user who clicks and leaves loses the write with no signal that
    // anything was pending.
    server.packs = [{ ...PACK, myBaseVersion: 2, myCustomizationValues: null }];
    publishResults = [SAVED];
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");

    // Nothing claims success BEFORE the save — otherwise the assertion below would pass on copy
    // that is always present, which is the vacuity this phase kept shipping.
    expect(text()).not.toContain("Saved. Your settings are version");

    await click(byText("Save these settings"));

    expect(text()).toContain("Saved. Your settings are version 3.");
    // POLITE, not assertive: a success is not an interruption, and `role="alert"` here would
    // interrupt a screen-reader user mid-sentence for good news.
    const live = container.querySelector('[role="status"]');
    expect(live?.textContent).toContain("Saved. Your settings are version 3.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  test("a REFUSED save never renders the success line", async () => {
    // The pairing that stops "Saved." becoming decoration that appears on every submit.
    server.packs = [{ ...PACK, myBaseVersion: 2, myCustomizationValues: null }];
    publishResults = [{ ok: false, reason: "empty_customization" }];
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");
    await click(byText("Save these settings"));

    expect(text()).not.toContain("Saved. Your settings are version");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Change at least one setting before saving.",
    );
  });

  test("after a save the form is level with what was saved — no stale diff, no stale version", async () => {
    publishResults = [SAVED];
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");
    expect(text()).toContain("You changed 1 of 5 settings");

    await click(byText("Save these settings"));

    // MUTATION: delete `setBaseline(values)` from the success arm → red here, the summary keeps
    // reporting the pre-save diff for settings that ARE now saved.
    expect(text()).toContain("You have not changed anything yet.");
    // MUTATION: delete `setBaseVersion(res.version)` → red here, the surface keeps naming the
    // version the form opened from after that version has been superseded by the one it just wrote.
    expect(text()).toContain("This edit is based on your saved version 3.");
  });

  test("a second save from the same open form carries the version the first one wrote", async () => {
    publishResults = [SAVED, { ...SAVED, version: 4 }];
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");
    await click(byText("Save these settings"));
    await type(termsFieldId(), "callouts and jobs");
    await click(byText("Save these settings"));

    expect(publish).toHaveBeenCalledTimes(2);
    // The pack had never been customized, so the first save is based on nothing…
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ baseCandidateVersion: null });
    // …and the second is based on the row the first one wrote.
    expect(publish.mock.calls[1]?.[0]).toMatchObject({ baseCandidateVersion: 3 });
  });
});

// ── The race the refusal exists for ─────────────────────────────────────────────────────────

describe("a concurrent publish is refused, and the retry can win", () => {
  test("the save carries the version the form OPENED from, not the row's current one", async () => {
    server.packs = [
      { ...PACK, myBaseVersion: 3, myCustomizationValues: '{"business_terms":"jobs"}' },
    ];
    publishResults = [
      { ok: false, reason: "stale_base_version", currentBaseVersion: 7 },
      { ...SAVED, version: 8 },
    ];
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");

    // Someone else publishes version 7 while this form is open. The live query pushes the new row.
    server.packs = [
      { ...PACK, myBaseVersion: 7, myCustomizationValues: '{"business_terms":"THEIRS"}' },
    ];
    // The live query pushes the new row in — same component, new props.
    await mount();

    // The controls still hold what the form opened with — so the version the save carries must be
    // the one those settings came from. MUTATION: send `selected.myBaseVersion` instead of the
    // snapshotted `baseVersion` → this is red, the save carries 7, the server accepts it, and the
    // refusal below never happens.
    expect((container.querySelector('input[type="text"]') as HTMLInputElement | null)?.value).toBe(
      "callouts",
    );
    expect(text()).toContain("This edit is based on your saved version 3.");
    expect(text()).not.toContain("THEIRS");

    await click(byText("Save these settings"));
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ baseCandidateVersion: 3 });

    // The refusal is RENDERED as an instruction the user can act on.
    expect(text()).toContain(
      "A newer draft of this workflow was saved (version 7). Pikar has caught up — press save again.",
    );

    // And pressing save again sends the version the server said it holds.
    await click(byText("Save these settings"));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toMatchObject({ baseCandidateVersion: 7 });
    expect(text()).toContain("Version 8 is saved as a draft.");
  });

  test("a refusal that carries no version still asks for a retry the client can win", async () => {
    server.packs = [{ ...PACK, myBaseVersion: 3, myCustomizationValues: null }];
    publishResults = [
      { ok: false, reason: "stale_base_version", currentBaseVersion: null },
      { ...SAVED, version: 1 },
    ];
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");
    await click(byText("Save these settings"));

    expect(text()).toContain(
      "Another draft of this workflow changed while you were editing. Pikar has caught up — press save again.",
    );
    await click(byText("Save these settings"));
    expect(publish.mock.calls[1]?.[0]).toMatchObject({ baseCandidateVersion: null });
  });
});

// ── Refusals a user can act on ──────────────────────────────────────────────────────────────

describe("what a refusal does to the form", () => {
  test("an invalid value is announced on that field's own note, and clears when it is retyped", async () => {
    publishResults = [
      {
        ok: false,
        reason: "invalid_values",
        errors: [{ key: "business_terms", reason: "too_large" }],
      },
    ];
    await mount();
    await click(byText("Business pulse"));
    const id = termsFieldId();
    await type(id, "callouts");
    await click(byText("Save these settings"));

    expect(text()).toContain("Some settings could not be saved. See the notes on each one.");
    expect(text()).toContain("That is longer than this setting allows.");
    const control = document.getElementById(id) as HTMLInputElement;
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const note = document.getElementById(`${id}-note`) as HTMLElement;
    expect(note.getAttribute("role")).toBe("alert");

    await type(id, "shorter");
    expect(text()).not.toContain("That is longer than this setting allows.");
    expect((document.getElementById(id) as HTMLInputElement).getAttribute("aria-invalid")).toBe(
      "false",
    );
  });

  test("a throw is reported as a transport failure, and the form stays usable", async () => {
    publish.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");
    await click(byText("Save these settings"));

    expect(text()).toContain("That could not be saved. Check your connection and try again.");
    // `busy` is released in `finally`, so the button is pressable again.
    expect((byText("Save these settings") as HTMLButtonElement).disabled).toBe(false);
  });

  test("choosing a different workflow clears the previous one's refusal and its values", async () => {
    server.packs = [PACK, { ...PACK, packId: "brand-review", title: "Brand review" }];
    publishResults = [{ ok: false, reason: "empty_customization" }];
    await mount();
    await click(byText("Business pulse"));
    await type(termsFieldId(), "callouts");
    await click(byText("Save these settings"));
    expect(text()).toContain("Change at least one setting before saving.");

    await click(byText("Brand review"));
    expect(text()).not.toContain("Change at least one setting before saving.");
    expect((container.querySelector('input[type="text"]') as HTMLInputElement | null)?.value).toBe(
      "",
    );
  });
});
