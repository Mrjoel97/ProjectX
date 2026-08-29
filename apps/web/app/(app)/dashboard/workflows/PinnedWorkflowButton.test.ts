// @vitest-environment jsdom
//
// THE PIN / RUN AGAIN CONTROLS, DRIVEN AS AN INTERACTION (29-08, ROUT-02).
//
// This file mounts the REAL container into a real DOM with `createRoot`, dispatches real click and
// keyboard events, and reads the sentences back out of the document. It is a `.test.ts` and NOT the
// `.test.tsx` the plan named: `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only, so a
// `.test.tsx` here would never execute — which is the exact "a test file here is decoration" gap
// that config was written to close, and which 29-07 already tripped over once.
//
// `convex/react` and `next/navigation` are the only things stubbed. `useQuery` answers by the
// function reference's OWN path (`getFunctionName`, not a hand-kept map), so renaming either query
// breaks this file instead of silently feeding the wrong rows to the wrong hook; `useMutation` and
// `useAction` return spies whose queued results are the exact shapes the server returns.
//
// WHAT IT DOES NOT PROVE: pixels, focus rings, and a model answering. No browser has loaded
// `/dashboard/workflows`, and every backend drive behind these shapes is a $0 governed stop.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ── The seam ────────────────────────────────────────────────────────────────────────────────

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

type PinRow = {
  id: string;
  templateId: string;
  title: string;
  createdAt: number;
  sourcePreferences: readonly string[];
  runnable: boolean;
  blockers: readonly string[];
  notices: readonly string[];
  templateVersion: number;
  activeVersion: number | null;
  sourceUnavailableCount: number;
  customizationPinned: boolean;
};

const PACK: Listing = {
  packId: "brand-review",
  title: "Brand review",
  blurb: "One honest read on a piece of copy.",
  opener: "Review a piece of my copy.",
  output: "briefing",
  version: 4,
  sources: [{ source: "vault", label: "your knowledge vault", state: "available", unlock: null }],
  missingKnownCount: 0,
  missingRuntimeCount: 0,
  myBaseVersion: null,
  myCustomizationValues: null,
};

const PIN: PinRow = {
  id: "pin_1",
  templateId: "brand-review",
  title: "Brand review",
  createdAt: 1,
  sourcePreferences: [],
  runnable: true,
  blockers: [],
  notices: [],
  templateVersion: 4,
  activeVersion: 4,
  sourceUnavailableCount: 0,
  customizationPinned: false,
};

/** What the two `useQuery` calls currently answer. Mutated between renders to model a live query. */
const server: { packs: readonly Listing[] | undefined; pins: readonly PinRow[] | undefined } = {
  packs: [PACK],
  pins: [],
};

let pinResults: unknown[] = [];
let unpinResults: unknown[] = [];
let runResults: unknown[] = [];

const nextOf = (queue: unknown[], name: string) => {
  const next = queue.shift();
  if (next === undefined) throw new Error(`the component called ${name} more times than expected`);
  return next;
};

const pinWorkflow = vi.fn(async (_args: Record<string, unknown>) => nextOf(pinResults, "pin"));
const unpinWorkflow = vi.fn(async (_args: Record<string, unknown>) =>
  nextOf(unpinResults, "unpin"),
);
const runAgain = vi.fn(async (_args: Record<string, unknown>) => nextOf(runResults, "runAgain"));
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (ref: unknown) => {
      switch (name(ref as never)) {
        case "workflowPackDiscovery:listPacks":
          return server.packs;
        case "pinnedWorkflows:listPins":
          return server.pins;
        default:
          throw new Error(`unexpected useQuery: ${name(ref as never)}`);
      }
    },
    useMutation: (ref: unknown) => {
      switch (name(ref as never)) {
        case "pinnedWorkflows:pinWorkflow":
          return pinWorkflow;
        case "pinnedWorkflows:unpinWorkflow":
          return unpinWorkflow;
        default:
          throw new Error(`unexpected useMutation: ${name(ref as never)}`);
      }
    },
    useAction: (ref: unknown) => {
      if (name(ref as never) !== "pinnedWorkflows:runAgain") {
        throw new Error(`unexpected useAction: ${name(ref as never)}`);
      }
      return runAgain;
    },
  };
});

const { PinnedWorkflowButton } = await import("./PinnedWorkflowButton");
const { api } = await import("@pikar/backend/api");

test("the stub answers the exact function paths the component asks for", () => {
  expect(getFunctionName(api.workflowPackDiscovery.listPacks)).toBe(
    "workflowPackDiscovery:listPacks",
  );
  expect(getFunctionName(api.pinnedWorkflows.listPins)).toBe("pinnedWorkflows:listPins");
  expect(getFunctionName(api.pinnedWorkflows.pinWorkflow)).toBe("pinnedWorkflows:pinWorkflow");
  expect(getFunctionName(api.pinnedWorkflows.unpinWorkflow)).toBe("pinnedWorkflows:unpinWorkflow");
  expect(getFunctionName(api.pinnedWorkflows.runAgain)).toBe("pinnedWorkflows:runAgain");
});

// ── Driving the DOM ─────────────────────────────────────────────────────────────────────────

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  server.packs = [PACK];
  server.pins = [];
  pinResults = [];
  unpinResults = [];
  runResults = [];
  pinWorkflow.mockClear();
  unpinWorkflow.mockClear();
  runAgain.mockClear();
  push.mockClear();
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
    root.render(createElement(PinnedWorkflowButton));
  });
};

const text = () => (container.textContent ?? "").replace(/\s+/g, " ");

const button = (label: string): HTMLButtonElement => {
  const el = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === label,
  );
  if (el === undefined) throw new Error(`no button labelled ${JSON.stringify(label)}`);
  return el as HTMLButtonElement;
};

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
};

// ── Pinning ─────────────────────────────────────────────────────────────────────────────────

describe("pin", () => {
  test("an unpinned pack offers Pin, names its approved version, and offers no Run", async () => {
    await mount();
    expect(text()).toContain("Brand review");
    expect(text()).toContain("Approved version 4.");
    expect(button("Pin this workflow").disabled).toBe(false);
    expect(() => button("Run again")).toThrow();
  });

  // MUTATION `onClick={() => onPin(pack.packId)}` → `() => {}`: red here. Nothing is ever sent.
  test("pressing Pin sends the pack id and nothing else", async () => {
    pinResults = [{ ok: true, id: "pin_1", inserted: true }];
    await mount();
    await click(button("Pin this workflow"));
    expect(pinWorkflow).toHaveBeenCalledTimes(1);
    expect(pinWorkflow.mock.calls[0]?.[0]).toEqual({ templateId: "brand-review" });
  });

  test("a refusal is rendered as a sentence, and the control stays usable", async () => {
    pinResults = [{ ok: false, reason: "template_not_active" }];
    await mount();
    await click(button("Pin this workflow"));
    expect(text()).toContain(
      "That workflow is not approved right now, so there is nothing to pin.",
    );
    expect(button("Pin this workflow").disabled).toBe(false);
  });

  test("a throw is reported as a transport failure, not as a refusal", async () => {
    pinWorkflow.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await mount();
    await click(button("Pin this workflow"));
    expect(text()).toContain("That did not go through. Check your connection and try again.");
  });
});

// ── What a pinned row says ──────────────────────────────────────────────────────────────────

describe("a pinned workflow says what will actually run", () => {
  test("the pinned VERSION is named, and Run again is offered", async () => {
    server.pins = [{ ...PIN, templateVersion: 7, activeVersion: 7 }];
    await mount();
    expect(text()).toContain("Pinned at version 7.");
    expect(button("Run again").disabled).toBe(false);
    expect(button("Remove pin").disabled).toBe(false);
  });

  // THE HONESTY CONSTRAINT. `PACK_GATE` refuses to activate a pack-named tenant candidate and
  // `cockpit.ts` passes no `tenantSkillIds`, so a pinned run takes the approved global template.
  // MUTATION: drop the `customization_not_applied` arm from `noticeLine` → red.
  test("a pinned customization is announced as NOT used", async () => {
    server.pins = [{ ...PIN, notices: ["customization_not_applied"], customizationPinned: true }];
    await mount();
    expect(text()).toContain(
      "Your saved settings for this workflow are not used. Pikar cannot make a customization live in this release, so Run again uses the approved workflow.",
    );
    // And it is NOT a refusal: the run still happens.
    expect(button("Run again").disabled).toBe(false);
  });

  test("a republished template names BOTH versions and says which one runs", async () => {
    server.pins = [
      { ...PIN, notices: ["template_republished"], templateVersion: 4, activeVersion: 9 },
    ];
    await mount();
    expect(text()).toContain(
      "This pin remembers version 4. Version 9 is the approved one now, and that is what Run again uses.",
    );
  });

  test("a missing customization row reads differently from one that exists", async () => {
    server.pins = [{ ...PIN, notices: ["customization_missing"], customizationPinned: true }];
    await mount();
    expect(text()).toContain(
      "The settings this pin remembered are no longer there. Run again uses the approved workflow.",
    );
    expect(text()).not.toContain("Your saved settings for this workflow are not used.");
  });

  test("one unconnected source and several read differently, and neither refuses the run", async () => {
    server.pins = [{ ...PIN, notices: ["sources_unavailable"], sourceUnavailableCount: 1 }];
    await mount();
    expect(text()).toContain(
      "One of this workflow's sources is not connected. It will run without it.",
    );

    server.pins = [{ ...PIN, notices: ["sources_unavailable"], sourceUnavailableCount: 2 }];
    await mount();
    expect(text()).toContain(
      "2 of this workflow's sources are not connected. It will run without them.",
    );
    expect(button("Run again").disabled).toBe(false);
  });

  // MUTATION: `disabled={busy}` instead of `disabled={busy || !pin.runnable}` → red. The button
  // becomes pressable for a run the server will refuse.
  test("a BLOCKED pin cannot be run, and says why", async () => {
    server.pins = [{ ...PIN, runnable: false, blockers: ["paused"] }];
    await mount();
    expect(text()).toContain("Pikar is paused right now, so nothing can be run.");
    expect(button("Run again").disabled).toBe(true);
  });

  test("an unapproved template blocks the run with its own sentence", async () => {
    server.pins = [{ ...PIN, runnable: false, blockers: ["template_not_active"] }];
    await mount();
    expect(text()).toContain("This workflow is not approved right now, so nothing can be run.");
    expect(button("Run again").disabled).toBe(true);
  });
});

// ── Running ─────────────────────────────────────────────────────────────────────────────────

describe("run again", () => {
  // MUTATION `onClick={() => onRun(pack.packId)}` → `() => {}`: red here. Nothing is ever sent.
  test("pressing Run again sends the PIN id, and lands on the fresh conversation", async () => {
    server.pins = [PIN];
    runResults = [
      {
        ok: true,
        threadId: "thread_new_1",
        correlationId: "pin:pin_1:abc",
        ordinal: 1,
        ran: true,
        outcome: "useful",
      },
    ];
    await mount();
    await click(button("Run again"));

    expect(runAgain).toHaveBeenCalledTimes(1);
    expect(runAgain.mock.calls[0]?.[0]).toEqual({ id: "pin_1" });
    // MUTATION: delete the `router.push(...)` line → red. The run happens and the user is left
    // looking at a button.
    expect(push).toHaveBeenCalledWith("/dashboard/workspace?thread=thread_new_1");
  });

  test("two presses send two requests — nothing is cached, reused or replayed on the client", async () => {
    server.pins = [PIN];
    const ok = (threadId: string, ordinal: number) => ({
      ok: true,
      threadId,
      correlationId: `pin:pin_1:${threadId}`,
      ordinal,
      ran: true,
      outcome: "useful",
    });
    runResults = [ok("thread_a", 1), ok("thread_b", 2)];
    await mount();
    await click(button("Run again"));
    await click(button("Run again"));

    expect(runAgain).toHaveBeenCalledTimes(2);
    expect(push.mock.calls).toEqual([
      ["/dashboard/workspace?thread=thread_a"],
      ["/dashboard/workspace?thread=thread_b"],
    ]);
  });

  // The governed stop. There IS a thread, and navigating to it would hide the one fact that
  // matters. MUTATION: navigate on `res.ok` instead of on `res.ran` → red.
  test("a run stopped at the gate says nothing was spent, and does NOT navigate", async () => {
    server.pins = [PIN];
    runResults = [
      {
        ok: true,
        threadId: "thread_blocked",
        correlationId: "pin:pin_1:xyz",
        ordinal: 1,
        ran: false,
        outcome: "blocked",
      },
    ];
    await mount();
    await click(button("Run again"));

    expect(text()).toContain(
      "Pikar stopped this run before it started. Nothing ran and nothing was spent — try again shortly.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  test("a readiness refusal names the blocker that caused it", async () => {
    server.pins = [PIN];
    runResults = [{ ok: false, reason: "not_ready", blockers: ["paused"] }];
    await mount();
    await click(button("Run again"));
    expect(text()).toContain(
      "That cannot run right now. Pikar is paused right now, so nothing can be run.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  test("a pin that has vanished tells the user to pin it again", async () => {
    server.pins = [PIN];
    runResults = [{ ok: false, reason: "unknown_pin" }];
    await mount();
    await click(button("Run again"));
    expect(text()).toContain("That pin is no longer there. Pin the workflow again.");
  });

  test("a failed start says nothing ran", async () => {
    server.pins = [PIN];
    runResults = [{ ok: false, reason: "run_failed" }];
    await mount();
    await click(button("Run again"));
    expect(text()).toContain("That could not be started. Nothing ran — try again.");
    expect(push).not.toHaveBeenCalled();
  });
});

// ── Unpinning, and the focus that must not be lost ──────────────────────────────────────────

describe("remove pin", () => {
  // MUTATION `onClick={() => onUnpin(pack.packId)}` → `() => {}`: red here.
  test("pressing Remove pin sends the pin id", async () => {
    server.pins = [PIN];
    unpinResults = [{ removed: true }];
    await mount();
    await click(button("Remove pin"));
    expect(unpinWorkflow).toHaveBeenCalledTimes(1);
    expect(unpinWorkflow.mock.calls[0]?.[0]).toEqual({ id: "pin_1" });
  });

  // A keyboard user whose focused button unmounts is returned to the top of the document with no
  // idea what happened. TWO mutations observed RED here: deleting `setFocusPack(packId)` from the
  // unpin success arm, and deleting the `focusPack === packId` branch from `registerPinButton`. The
  // second is the one that matters — the request is made while the row is STILL the pinned one, so
  // anything that looks for the replacement button before it mounts finds nothing and gives up.
  test("focus lands on the Pin control that replaced the button the user pressed", async () => {
    server.pins = [PIN];
    unpinResults = [{ removed: true }];
    await mount();
    button("Remove pin").focus();
    await click(button("Remove pin"));

    // The live query pushes the removal through — the row is now unpinned.
    server.pins = [];
    await mount();
    expect(document.activeElement).toBe(button("Pin this workflow"));
  });

  test("a pin that was already gone says so rather than failing silently", async () => {
    server.pins = [PIN];
    unpinResults = [{ removed: false }];
    await mount();
    await click(button("Remove pin"));
    expect(text()).toContain("That pin was already gone.");
  });
});

// ── Accessibility and the copy this surface may never use ───────────────────────────────────

describe("what a screen reader hears, and what nobody may read", () => {
  test("every control is a real button, so it is reachable and pressable from the keyboard", async () => {
    server.pins = [PIN];
    await mount();
    for (const label of ["Run again", "Remove pin"]) {
      const el = button(label);
      expect(el.tagName).toBe("BUTTON");
      // `type="button"` matters: inside a form a bare button submits it.
      expect(el.getAttribute("type")).toBe("button");
      expect(el.hasAttribute("disabled")).toBe(false);
    }
  });

  test("the outcome is announced in a live region tied to the control that produced it", async () => {
    server.pins = [PIN];
    runResults = [{ ok: false, reason: "run_failed" }];
    await mount();
    await click(button("Run again"));

    const describedBy = button("Run again").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const status = document.getElementById(describedBy as string);
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("That could not be started. Nothing ran — try again.");
  });

  test("a pending press is announced as busy, not just visually disabled", async () => {
    server.pins = [PIN];
    let release: (v: Record<string, unknown>) => void = () => {};
    runAgain.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          release = resolve;
        }),
    );
    await mount();
    await click(button("Run again"));

    expect(button("Run again").getAttribute("aria-busy")).toBe("true");
    expect(button("Run again").disabled).toBe(true);
    expect(text()).toContain("Starting a new run…");

    await act(async () => {
      release({ ok: false, reason: "run_failed" });
    });
    expect(button("Run again").disabled).toBe(false);
  });

  test("the section has a heading its region is labelled by", async () => {
    await mount();
    const section = container.querySelector("section");
    const labelledBy = section?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe(
      "Workflows you run more than once",
    );
  });

  // NO RECURRING LANGUAGE, ANYWHERE. Asserted against the RENDERED text of every state this
  // surface can be in, not against the source — a comment explaining the ban would otherwise fail
  // its own scan, and the only way back to green would be deleting the explanation.
  test("no state of this surface implies anything runs by itself", async () => {
    const states: PinRow[] = [
      PIN,
      { ...PIN, notices: ["customization_not_applied", "sources_unavailable"] },
      { ...PIN, notices: ["template_republished", "customization_missing"], activeVersion: 9 },
      { ...PIN, runnable: false, blockers: ["paused", "template_not_active"] },
    ];
    const seen: string[] = [];
    for (const pin of states) {
      server.pins = [pin];
      await mount();
      seen.push(text());
    }
    server.pins = [];
    await mount();
    seen.push(text());

    for (const rendered of seen) {
      for (const banned of [
        "every",
        "daily",
        "weekly",
        "automatically",
        "runs on",
        "schedule",
        "recurring",
        "next run",
      ]) {
        expect(rendered.toLowerCase(), `"${banned}" reached the screen`).not.toContain(banned);
      }
    }
    // And the surface DOES say the true thing in its place.
    expect(seen[0]).toContain("Nothing starts by itself — you press Run again.");
  });

  // A control that could activate, approve or roll back a candidate is impossible from here —
  // both mutations are `ownerMutation`s. This is a claim about the SHIPPED SOURCE, and says so.
  test("there is no activation, approval or rollback control in the shipped file", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "PinnedWorkflowButton.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "activateTenantCandidate",
      "activateAgentCandidate",
      "rollbackTenantSkill",
      "activateCandidate",
      "previewVersion",
    ]) {
      expect(source, `${forbidden} is reachable from this surface`).not.toContain(forbidden);
    }
    // The four functions it MAY reach, and no fifth.
    const calls = [...source.matchAll(/api\.[a-zA-Z]+\.[a-zA-Z]+/g)].map((m) => m[0]).sort();
    expect([...new Set(calls)]).toEqual([
      "api.pinnedWorkflows.listPins",
      "api.pinnedWorkflows.pinWorkflow",
      "api.pinnedWorkflows.runAgain",
      "api.pinnedWorkflows.unpinWorkflow",
      "api.workflowPackDiscovery.listPacks",
    ]);
  });

  test("the page mounts this surface", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const page = readFileSync(join(here, "page.tsx"), "utf8");
    expect(page).toContain("<PinnedWorkflowButton />");
  });
});
