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
import type { api as backendApi } from "@pikar/backend/api";
import { type FunctionReturnType, getFunctionName } from "convex/server";
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

// THE FIXTURES ARE THE SERVER'S OWN RETURN TYPES, not hand-written twins. They used to be twins,
// and that is one of the mechanisms that hid the `state: "ran"` hole: `"ran"` existed in this repo
// only as a string in a literal below, never as a value any handler had been observed to return.
// Typed this way, dropping or renaming a state on the server fails this file's typecheck. It still
// does not prove the server ever PRODUCES one — that is the backend suite's job, and as of this
// round `pinnedWorkflows.test.ts` drives a completed turn that returns `"ran"` for real.
type PinRow = FunctionReturnType<typeof backendApi.pinnedWorkflows.listPins>[number];
type RunResult = FunctionReturnType<typeof backendApi.pinnedWorkflows.runAgain>;

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
  id: "pin_1" as PinRow["id"],
  templateId: "brand-review",
  title: "Brand review",
  createdAt: 1,
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
let runResults: RunResult[] = [];

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

const { PinnedWorkflowButton, actionLine } = await import("./PinnedWorkflowButton");
type PinAction = Parameters<typeof actionLine>[0];
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

  // A LOST REPLY IS NOT A FAILED REQUEST. The browser cannot tell a pin that never arrived from a
  // pin that was written and whose answer was lost, so the sentence claims neither.
  // MUTATION: restore "That did not go through." → red on the second assertion.
  test("a throw says what is true — nothing was confirmed — and does not claim it failed", async () => {
    pinWorkflow.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await mount();
    await click(button("Pin this workflow"));
    expect(text()).toContain(
      "Pikar could not confirm that. Reload the page to see whether it went through.",
    );
    expect(text()).not.toContain("did not go through.");
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
    runResults = [{ ok: true, threadId: "thread_new_1", state: "ran", outcome: "useful" }];
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
    const ok = (threadId: string): RunResult => ({
      ok: true,
      threadId,
      state: "ran",
      outcome: "useful",
    });
    runResults = [ok("thread_a"), ok("thread_b")];
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
  // matters. `$0` is provable ONLY here: the pack binding returns `costUsd: 0` on this path.
  // MUTATION: navigate whenever `res.ok` instead of on `res.state === "ran"` → red.
  test("a run stopped at the gate says nothing was spent, and does NOT navigate", async () => {
    server.pins = [PIN];
    runResults = [{ ok: true, threadId: "thread_blocked", state: "blocked", outcome: "blocked" }];
    await mount();
    await click(button("Run again"));

    expect(text()).toContain(
      "Pikar stopped this run before it started. Nothing ran and nothing was spent — try again shortly.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  // THE BLOCKER THIS ROUND FIXES. `state: "unknown"` is a turn that produced no outcome:
  // `cockpit.startWorkflowPack` reports a pack-binding refusal and every throw out of the pack loop
  // identically, and the loop rethrows from AFTER the model may have answered and spend may have
  // been recorded. The previous version collapsed this into the same `!res.ran` branch as the
  // governed stop and rendered "Nothing ran and nothing was spent" over a possibly-billed run.
  // MUTATION: `setAction(packId, { kind: "runBlocked" })` for every non-`ran` state → red on the
  // second assertion, which is the one that matters.
  test("a run that did not finish is NOT told it was free", async () => {
    server.pins = [PIN];
    runResults = [{ ok: true, threadId: "thread_half", state: "unknown", outcome: null }];
    await mount();
    await click(button("Run again"));

    expect(text()).toContain(
      "This run did not finish, and Pikar cannot tell whether it reached the model. It may have used part of today's budget — open your workspace to see what happened before running it again.",
    );
    expect(text()).not.toContain("nothing was spent");
    expect(text()).not.toContain("Nothing ran");
    // No navigation either: there may be no thread at all, and landing in a conversation would
    // hide the sentence the user needs.
    expect(push).not.toHaveBeenCalled();
  });

  // The same state, arriving without a thread at all — the throw happened before one existed.
  test("an unfinished run with no thread renders the same honest sentence", async () => {
    server.pins = [PIN];
    runResults = [{ ok: true, threadId: null, state: "unknown", outcome: null }];
    await mount();
    await click(button("Run again"));
    expect(text()).toContain("This run did not finish");
    expect(text()).not.toContain("nothing was spent");
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

  // `run_failed` USED TO LIVE HERE and it is deleted, not narrowed. It was reachable only from a
  // transport throw, which the `transport` state already covers, and its copy ("Nothing ran") made
  // the same unprovable promise as the blocked line. A failed run is `state: "unknown"` now.
  test("the refusal family cannot promise anything about a run that started", async () => {
    server.pins = [PIN];
    runResults = [{ ok: false, reason: "unknown_pin" }];
    await mount();
    await click(button("Run again"));
    expect(text()).toContain("That pin is no longer there. Pin the workflow again.");
    expect(text()).not.toContain("nothing was spent");
  });

  // A THROW OUT OF THE RUN CHANNEL IS THE UNKNOWN STATE, NOT A TRANSPORT FAILURE. `runAgain`'s own
  // audit write sits outside its try, so the action can reject after the turn ran and was billed;
  // and a dropped connection cannot tell a request that never arrived from an answer that was lost.
  // MUTATION: `setAction(packId, { kind: "transport" })` in `doRun`'s catch → red on both.
  test("a run whose reply never arrives is UNKNOWN, not 'that did not go through'", async () => {
    server.pins = [PIN];
    runAgain.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await mount();
    await click(button("Run again"));

    expect(text()).toContain(
      "This run did not finish, and Pikar cannot tell whether it reached the model. It may have used part of today's budget — open your workspace to see what happened before running it again.",
    );
    expect(text()).not.toContain("nothing was spent");
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
    runResults = [{ ok: true, threadId: null, state: "unknown", outcome: null }];
    await mount();
    await click(button("Run again"));

    const describedBy = button("Run again").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const status = document.getElementById(describedBy as string);
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe(
      "This run did not finish, and Pikar cannot tell whether it reached the model. It may have used part of today's budget — open your workspace to see what happened before running it again.",
    );
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
      release({ ok: true, threadId: null, state: "unknown", outcome: null });
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

  const BANNED = [
    "every",
    "daily",
    "weekly",
    "automatically",
    "runs on",
    "schedule",
    "recurring",
    "next run",
  ];
  const scan = (rendered: string, where: string) => {
    for (const banned of BANNED) {
      expect(rendered.toLowerCase(), `"${banned}" reached the screen in ${where}`).not.toContain(
        banned,
      );
    }
  };

  // NO RECURRING LANGUAGE, ANYWHERE. Asserted against the RENDERED text of every state this
  // surface can be in, not against the source — a comment explaining the ban would otherwise fail
  // its own scan, and the only way back to green would be deleting the explanation.
  test("no READINESS state of this surface implies anything runs by itself", async () => {
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

    for (const rendered of seen) scan(rendered, "a readiness state");
    // And the surface DOES say the true thing in its place.
    expect(seen[0]).toContain("Nothing starts by itself — you press Run again.");
  });

  // THE HALF THE SCAN ABOVE COULD NOT SEE, and a verifier proved it: the four readiness states are
  // all PRE-PRESS, so every sentence shown AFTER the button is pressed — the blocked line, the
  // unknown line, the refusals, the transport line — sat outside the phase's own absolute. Putting
  // "Pikar will retry this automatically every day" into `BLOCKED_RUN` left this file 30/30 green.
  //
  // `actionLine` is the one place every one of those sentences is produced, and its input is a
  // closed union. The `Record` below is TOTAL by type, so adding a `PinAction` kind and not listing
  // it here fails the typecheck rather than silently leaving the new sentence unscanned.
  test("no RUN-RESULT sentence this surface can announce implies anything runs by itself", () => {
    const cases: Record<PinAction["kind"], PinAction> = {
      idle: { kind: "idle" },
      pinning: { kind: "pinning" },
      unpinning: { kind: "unpinning" },
      running: { kind: "running" },
      pinRefused: { kind: "pinRefused", result: { ok: false, reason: "template_not_active" } },
      unpinMissing: { kind: "unpinMissing" },
      runRefused: {
        kind: "runRefused",
        result: { ok: false, reason: "not_ready", blockers: ["paused", "template_not_active"] },
      },
      runBlocked: { kind: "runBlocked" },
      runUnknown: { kind: "runUnknown" },
      transport: { kind: "transport" },
    };
    // Every OTHER shape of the two refusal families, so no arm of either switch is unscanned.
    const more: PinAction[] = [
      { kind: "pinRefused", result: { ok: false, reason: "unknown_template" } },
      { kind: "runRefused", result: { ok: false, reason: "unknown_pin" } },
    ];

    for (const action of [...Object.values(cases), ...more]) {
      scan(actionLine(action) ?? "", `actionLine(${action.kind})`);
    }
    // THE CONTROL: the scan is reading real sentences, not a pile of nulls. Every kind but `idle`
    // announces something.
    expect(Object.values(cases).filter((a) => actionLine(a) !== null)).toHaveLength(9);
  });

  // And the same three sentences again, this time as the DOM actually renders them after a real
  // press — mechanism coverage above, behaviour coverage here.
  test("no sentence a PRESS puts on screen implies anything runs by itself", async () => {
    const results: RunResult[] = [
      { ok: true, threadId: "t1", state: "blocked", outcome: "blocked" },
      { ok: true, threadId: "t2", state: "unknown", outcome: null },
      { ok: false, reason: "not_ready", blockers: ["paused"] },
      { ok: false, reason: "unknown_pin" },
    ];
    for (const result of results) {
      server.pins = [PIN];
      runResults = [result];
      await mount();
      await click(button("Run again"));
      scan(text(), `a pressed run returning ${JSON.stringify(result)}`);
    }
    // The transport arm too, which no result value can reach.
    server.pins = [PIN];
    runAgain.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await mount();
    await click(button("Run again"));
    scan(text(), "a run whose reply never arrived");
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
    // The set of functions this component may reach is NOT asserted here any more. It was, as a
    // sorted list of five names — and since `checkReadiness` was not on it, that assertion froze a
    // dropped plan requirement ("wire it to checkReadiness") as if it were the design. Deleted
    // rather than narrowed: the `convex/react` stub at the top of this file already enforces the
    // same closed set BEHAVIOURALLY and in every test, by throwing on any unexpected function path.
  });

  test("the page mounts this surface", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const page = readFileSync(join(here, "page.tsx"), "utf8");
    expect(page).toContain("<PinnedWorkflowButton />");
  });
});
