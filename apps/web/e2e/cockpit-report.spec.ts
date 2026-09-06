import { expect, test } from "@playwright/test";

// SC4/SC5 integration proof — the whole cockpit end to end over the OFFLINE `SMOKE::` path:
// chat → guided slot-filling questions → PLAN card → ONE Approve → live per-recipient REPORT.
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). The body intent carries the
// `SMOKE::route=direct_llm::` sentinel so draftCockpit returns a deterministic offline draft with
// NO AI_GATEWAY_API_KEY (llm.ts:draftCockpit). The E2E user has a Gmail token row (so executePlan
// passes its gmail-connected pre-check) but a stale/Testing-mode one, so gmail.send's refresh fails
// and every recipient row settles at `awaiting_reauth` — the automatable half of DLVR-01. A REAL
// send to real addresses is the manual human-verify checkpoint (03.1-VALIDATION Manual-Only).

test("chat → plan → one approve → live per-recipient report (offline SMOKE:: path)", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  // The chat pane only renders once Gmail is connected (workspace/page.tsx gate). If the harness
  // user has no mailbox this fails fast with a clear locator error rather than hanging.
  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // One deterministic guided turn = fill the composer + Enter (ChatPane onKeyDown → sendCockpitMessage).
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
  };

  // 1. recipients (2 valid → no re-ask) → next question: subject. Comma-separated: the parseAnswer
  // tokenizer now segments recipients on comma/"and" only (a multi-word NAME stays whole), so a
  // space-separated pair parses as one malformed segment → a re-ask. Comma keeps this green.
  await say("alice@example.com, bob@example.com");
  await expect(page.getByText(/subject line/i)).toBeVisible({ timeout: 15_000 });

  // 2. subject → next: body intent.
  await say("Quarterly update");
  await expect(page.getByText(/what do you want the email to say/i)).toBeVisible({
    timeout: 15_000,
  });

  // 3. body intent WITH the offline sentinel → next: mode (fires only for >1 recipient).
  await say("SMOKE::route=direct_llm:: Share the quarterly numbers with the team.");
  await expect(page.getByText(/individually, or as one group thread/i)).toBeVisible({
    timeout: 15_000,
  });

  // 4. mode → ready → offline draft (no AI key) → PLAN proposed.
  await say("individual");

  // PLAN card: recipient chips + mode + user-provided subject + body preview + exactly ONE Approve.
  const workspace = page.getByTestId("workspace-pane");
  await expect(workspace.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByText("alice@example.com")).toBeVisible();
  await expect(workspace.getByText("bob@example.com")).toBeVisible();
  await expect(workspace.getByText(/Mode: individual/)).toBeVisible();
  await expect(workspace.getByText(/Quarterly update/)).toBeVisible(); // subject is user-provided, not model-derived
  const approve = page.getByRole("button", { name: /approve/i });
  await expect(approve).toHaveCount(1);

  // ONE Approve → seeds a requests row per recipient + starts the fan-out (SC4 zero-sends-before-Approve).
  await approve.click();

  // REPORT card appears and fills LIVE per recipient via Convex reactivity (no polling). With the
  // stale-token harness user both rows settle at `awaiting_reauth` (the automatable terminal).
  await expect(workspace.getByText("REPORT", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByText("awaiting_reauth")).toHaveCount(2, { timeout: 30_000 });
  await expect(workspace.getByText("alice@example.com")).toBeVisible();
  await expect(workspace.getByText("bob@example.com")).toBeVisible();
  // Each recipient row surfaces its own audit ref (refs-only, CLAUDE.md §4).
  await expect(workspace.getByText(/^audit:/)).toHaveCount(2);

  // Idempotent single-approve (SC4): once delivering starts, the plan leaves "proposed" and the
  // PlanCard (with its Approve) unmounts — a second approve is structurally impossible from the UI,
  // layered over the server-side proposed→approved CAS that makes a double-approve send exactly once.
  await expect(approve).toHaveCount(0);
});
