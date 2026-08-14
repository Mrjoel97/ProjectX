// Routine v0 — the Pin / Run / Delete surface (21-05, SKILL-01).
//
// SOURCE-TEXT SCAN, deliberately. `apps/web`'s vitest config is node-only with no jsdom and no
// testing-library, and that config documents adding them as a deliberate upgrade rather than a side
// effect — so a `.tsx` cannot be rendered here. This is the `skillAuthoring.test.ts` /
// `crmCard.test.ts` idiom the config points at.
//
// WHAT THIS PROVES: the shipped source contains, and does not contain, exact things — that the Run
// control really is wired to the clock-bearing hook with no `threadId`, that the returned thread id
// is registered, that no component reconstructs the raw cockpit action, and that no scheduler word
// crept into the cockpit. WHAT IT DOES NOT PROVE: pixels, layout, focus order, whether the menu
// opens, or that anything renders at all. The browser proof is 21-06's Playwright spec and this file
// is not a substitute for it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { pinLabel } from "./ChatPane";

const here = dirname(fileURLToPath(import.meta.url));
const chatSource = readFileSync(join(here, "ChatPane.tsx"), "utf8");
const pageSource = readFileSync(join(here, "page.tsx"), "utf8");

// Comments stripped: every scan below is about the SHIPPED SURFACE, not about prose. Without this,
// the code's own notes explaining that it schedules nothing fail the no-scheduler scan, and the only
// way to keep the suite green would be to delete the explanation — which is how a guard ends up
// silently weakened to accommodate itself (21-02 wrote this rule down first).
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const chat = strip(chatSource);
const page = strip(pageSource);

describe("the scan actually read the two files", () => {
  test("stripping comments removed prose and kept code", () => {
    expect(chatSource.length).toBeGreaterThan(12_000);
    expect(pageSource.length).toBeGreaterThan(16_000);
    expect(chat.length).toBeGreaterThan(8_000);
    expect(page.length).toBeGreaterThan(10_000);
    // The stripper removed prose and kept code.
    expect(chatSource).toContain("BRAND.md §1");
    expect(chat).not.toContain("BRAND.md §1");
    expect(chat).toContain("export function ChatPane");
    expect(page).toContain("export default function WorkspacePage");
  });
});

describe("ChatPane — Pin sits on USER bubbles only", () => {
  test("the pin control exists and calls the saved-prompt mutation with the message text only", () => {
    expect(chat).toContain("useMutation(api.savedPrompts.save)");
    // The RENDERED text of that bubble, nothing else. No thread id, no plan, no role, no metadata.
    expect(chat).toContain("savePrompt({ text: body })");
  });

  // A control with no call site is invisible to every green suite in this repo. This is the
  // assertion that the Pin button is actually rendered, and rendered under the `mine` guard.
  test("`Pin prompt` appears EXACTLY once, and it is inside the `mine` branch beside Copy", () => {
    // One occurrence, and it is the label function's — not a stray literal on an assistant bubble.
    expect(chat.split("Pin prompt")).toHaveLength(2);

    const guard = chat.indexOf("{mine && (");
    expect(guard).toBeGreaterThan(-1);
    const actionsStart = chat.indexOf('className="bubble-actions"');
    expect(actionsStart).toBeGreaterThan(guard);
    // End marker searched FROM the guard, with a length floor: a plain `indexOf` from zero can
    // return an empty slice that "contains" nothing and passes vacuously (the 21-02 lesson).
    const actions = chat.slice(guard, chat.indexOf("</div>", actionsStart));
    expect(actions.length).toBeGreaterThan(300);
    expect(actions).toContain("Copy"); // the pre-existing control is still there
    expect(actions).toContain("pinLabel(");
    expect(actions).toContain("void pin(m.key, body)");

    // The assistant branch renders the agent name and avatar and NOTHING pin-shaped.
    const notMine = chat.slice(chat.indexOf("{!mine && <span"), guard);
    expect(notMine.length).toBeGreaterThan(20);
    expect(notMine).not.toContain("pinLabel");
    expect(notMine).not.toContain("savePrompt");
  });

  test("a failed pin never swallows the message or blocks the composer", () => {
    // The catch sets a state, it does not rethrow — a failed pin must not take the chat with it.
    const fn = chat.slice(chat.indexOf("async function pin("), chat.indexOf("const empty ="));
    expect(fn.length).toBeGreaterThan(150);
    expect(fn).toContain('"error"');
    expect(fn).not.toContain("throw");
    // …unlike `onSend`, which deliberately DOES rethrow after restoring the user's text.
    const send = chat.slice(
      chat.indexOf("async function onSend("),
      chat.indexOf("async function pin("),
    );
    expect(send).toContain("throw err;");
  });
});

describe("page.tsx — the Pinned prompts menu and the fresh-thread Run", () => {
  test("the menu is mounted in the EXISTING chat header, beside Past chats", () => {
    expect(page).toContain('import { useSendCockpitMessage } from "./useSendCockpitMessage"');
    expect(page).toContain("<PinnedPrompts");
    expect(page).toContain("<PastChats"); // the pre-existing control survived
    const icons = page.slice(
      page.indexOf('<div className="chat-head-icons">'),
      page.indexOf("</header>"),
    );
    expect(icons.length).toBeGreaterThan(200);
    expect(icons).toContain("<PinnedPrompts");
    // No new route and no nav entry — this is a header menu on the cockpit, per BRAND §4.
    expect(page).not.toContain('href="/dashboard/prompts"');
    expect(page).not.toContain('href="/dashboard/routines"');
  });

  test("Run goes through the trusted hook with NO threadId, and registers the id it returns", () => {
    expect(page).toContain("const send = useSendCockpitMessage();");
    // EVERY `send({...})` call in this file, with its exact argument object. A fresh ordinary
    // thread is the whole contract: one call, and its only argument is the text.
    const sendCalls = [...page.matchAll(/send\(\{([^}]*)\}\)/g)].map((m) => (m[1] ?? "").trim());
    expect(sendCalls).toEqual(["text"]);
    // The returned id is CONSUMED — a run that mints a thread nobody registers is a tab the user
    // cannot get back to.
    expect(page).toContain("registerThread(res.threadId, text)");
    // …and the shared in-flight signal is set, so the workspace trace surfaces light up for a
    // pinned run exactly as they do for a typed one.
    const run = page.slice(page.indexOf("const runPinned"), page.indexOf("const newChat"));
    expect(run.length).toBeGreaterThan(150);
    expect(run).toContain("setSending(true)");
    expect(run).toContain("setSending(false)");
    // Never the CURRENT thread, never a cloned plan, never a prefilled composer. The lookbehind
    // is what makes this precise rather than blunt: `res.threadId` is the id coming BACK from a
    // fresh thread and is exactly what must be here; any other `threadId` in this body would be
    // the page's open-conversation state being fed back in.
    expect(run).not.toMatch(/(?<!res\.)\bthreadId\b/);
    expect(run).not.toContain("setText");
    expect(run).not.toContain("api.plans");
  });

  test("NO component constructs the raw cockpit action", () => {
    // `useSendCockpitMessage` is the ONE browser send door: it supplies the trusted IANA timezone
    // and the call-time clock that every phase-17 calendar and phase-19 CRM tool refuses without.
    // Named mutation that turns this red: swap the hook for `useAction(api.cockpit.sendCockpitMessage)`.
    for (const source of [page, chat]) {
      expect(source).not.toContain("api.cockpit.sendCockpitMessage");
      expect(source).not.toContain("useAction(");
    }
    // Positive witnesses on the same two files: both really do call the hook.
    expect(page).toContain("useSendCockpitMessage()");
    expect(chat).toContain("useSendCockpitMessage()");
  });

  test("the menu has honest Loading, empty, running, deleting and error states", () => {
    const menu = page.slice(
      page.indexOf("function PinnedPrompts("),
      page.indexOf("function PinnedPromptsFallback("),
    );
    expect(menu.length).toBeGreaterThan(800);
    expect(menu).toContain("useQuery(api.savedPrompts.list)");
    expect(menu).toContain("useMutation(api.savedPrompts.remove)");
    expect(menu).toContain("Loading…");
    expect(menu).toContain("No pinned prompts yet");
    expect(menu).toContain("Running…");
    expect(menu).toContain("Deleting…");
    // Accessible names carry the VERB, so the two controls are distinguishable to a screen reader
    // reading a list of twenty rows that all look like prompt titles.
    expect(menu).toContain("`Run pinned prompt: $" + "{p.title}`");
    expect(menu).toContain("`Delete pinned prompt: $" + "{p.title}`");
    // Inline, announced, grey — never a window.alert/confirm, never a dialog, never amber
    // (BRAND §2 reserves `--held` for the approval gate alone).
    expect(menu).toContain('role="status"');
    for (const forbidden of ["window.alert", "window.confirm", "--held", "<dialog"]) {
      expect(menu, `the pinned-prompts menu uses ${forbidden}`).not.toContain(forbidden);
    }
    // Busy is not colour-only: the controls carry aria-busy and are disabled while a run is live.
    expect(menu).toContain("aria-busy=");
    expect(menu).toContain("disabled={disabled}");
  });

  test("Delete removes the saved row and touches NO chat, tab or thread", () => {
    const del = page.slice(page.indexOf("const del = async"), page.indexOf("const disabled ="));
    expect(del.length).toBeGreaterThan(120);
    expect(del).toContain("unpin({ id: p.id })");
    for (const forbidden of ["setThreadId", "setTabs", "closeTab", "openThread", "onRun"]) {
      expect(del, `deleting a pin calls ${forbidden}`).not.toContain(forbidden);
    }
  });

  test("the query is LOCAL and boundaried, so a failure degrades the menu and not the cockpit", () => {
    expect(page).toContain('<ErrorBoundary label="pinned-prompts"');
    expect(page).toContain("fallback={<PinnedPromptsFallback />}");
    expect(page).toContain("Pinned prompts unavailable.");
    // The pre-existing history boundary is untouched.
    expect(page).toContain('<ErrorBoundary label="past-chats"');
  });
});

describe("routine v0 contains no automation substrate", () => {
  test("neither cockpit file references a cron, schedule, trigger or routine API", () => {
    for (const forbidden of [
      "cron",
      "schedule",
      "recurrence",
      "routine",
      "trigger",
      "nextRunAt",
      "setInterval",
      "setTimeout",
      "api.savedPrompts.run",
      "scheduler",
    ]) {
      expect(page.toLowerCase(), `page.tsx references ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
      expect(chat.toLowerCase(), `ChatPane.tsx references ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
    // Positive witnesses: the THREE saved-prompt functions that do exist are the only ones.
    const called = [...pageSource.matchAll(/api\.savedPrompts\.(\w+)/g)].map((m) => m[1]);
    const calledInChat = [...chatSource.matchAll(/api\.savedPrompts\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set([...called, ...calledInChat])].sort()).toEqual(["list", "remove", "save"]);
  });

  test("no hardcoded hex a token covers, in either new surface", () => {
    // BRAND §8.1. The pin chip reuses `.msg-copy`; the menu reuses `.head-menu-*`. The only hexes
    // in these files predate this plan (the teal bubble shadows), so this is scoped to what the
    // pinned surface itself added.
    const menu = page.slice(
      page.indexOf("function PinnedPrompts("),
      page.indexOf("function PinnedPromptsFallback("),
    );
    expect(menu).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(menu).toContain("var(--ink-soft)");
  });
});

// The one pure bit this plan owns on the client. Small, but it is the difference between a truthful
// chip and a button that says "Pinned" about a save that threw.
describe("pinLabel", () => {
  test("the idle label is the affordance, and it is the ONLY state that reads as an invitation", () => {
    expect(pinLabel(undefined)).toBe("Pin prompt");
    expect(pinLabel("busy")).toContain("Pinning");
    expect(pinLabel("saved")).toContain("Pinned");
    expect(pinLabel("error")).toContain("failed");
  });

  test("a failure never reads as a save, and every state has its own sentence", () => {
    expect(pinLabel("error")).not.toContain("Pinned");
    expect(pinLabel("busy")).not.toBe(pinLabel("saved"));
    const seen = new Set([undefined, "busy", "saved", "error"].map((s) => pinLabel(s as never)));
    expect(seen.size).toBe(4);
    // State is carried by WORDS, not colour alone (BRAND §6) — every label is non-empty text.
    for (const label of seen) expect(label.length).toBeGreaterThan(5);
  });
});
