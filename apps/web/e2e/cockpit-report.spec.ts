import { expect, test } from "@playwright/test";

// SC4/SC5 integration proof — the whole cockpit end to end over the OFFLINE `SMOKE::` path:
// chat → the `SMOKE::agent::` ops (the guided slot-filling FSM this spec was written against retired
// at 3.2.1 — the Executive Agent replaced it, and a plain first turn now goes to the REAL model) →
// PLAN card → ONE Approve → live per-recipient REPORT.
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

  // One deterministic turn = fill the composer + Enter (ChatPane onKeyDown → sendCockpitMessage).
  // The composer clears the moment a turn is SENT (03.9-04), not when it settles, and a second Enter
  // while the turn is still busy is dropped by onSend — so each turn waits for "Working…" to end.
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Working…" })).toHaveCount(0, {
      timeout: 90_000,
    });
  };

  // recipients → subject → body intent (the offline sentinel → deterministic draft, no model call)
  // → mode (individual: one REPORT row per recipient) → propose.
  await say("SMOKE::agent::add=alice@example.com,bob@example.com");
  await say("SMOKE::agent::subject=Quarterly update");
  await say(
    "SMOKE::agent::body=SMOKE::route=direct_llm:: Share the quarterly numbers with the team.",
  );
  await say("SMOKE::agent::mode=individual");
  await say("SMOKE::agent::propose");

  // PLAN card: recipient chips + mode + user-provided subject + body preview + exactly ONE Approve.
  const workspace = page.getByTestId("workspace-pane");
  // `.first()` on addresses/subject below: each renders in more than one place (recipient chip,
  // per-recipient body or REPORT row, transcript echo), which is a strict-mode violation otherwise.
  await expect(workspace.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByText("alice@example.com").first()).toBeVisible();
  await expect(workspace.getByText("bob@example.com").first()).toBeVisible();
  await expect(workspace.getByText(/Mode: individual/)).toBeVisible();
  await expect(workspace.getByText(/Quarterly update/).first()).toBeVisible(); // subject is user-provided, not model-derived
  const approve = page.getByRole("button", { name: /approve/i });
  await expect(approve).toHaveCount(1);

  // ONE Approve → seeds a requests row per recipient + starts the fan-out (SC4 zero-sends-before-Approve).
  await approve.click();

  // REPORT card appears and fills LIVE per recipient via Convex reactivity (no polling). With the
  // stale-token harness user both rows settle at `awaiting_reauth` (the automatable terminal),
  // which the REPORT renders as its label ("Waiting for you to reconnect Gmail"), not the raw status.
  // Locally that needs a synthetic `gmailTokens` row for the harness tenant, staged BEFORE the browser
  // session (`gmailAuth:store` from the CLI — pipeline-uat.spec.ts does the same); without one
  // `executePlan` refuses at its gmail-connected pre-check and no REPORT appears.
  await expect(workspace.getByText("REPORT", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByText("Waiting for you to reconnect Gmail")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(workspace.getByText("alice@example.com").first()).toBeVisible();
  await expect(workspace.getByText("bob@example.com").first()).toBeVisible();
  // Each recipient row surfaces its own audit ref (refs-only, CLAUDE.md §4).
  await expect(workspace.getByText(/^audit:/)).toHaveCount(2);

  // Idempotent single-approve (SC4): once delivering starts, the plan leaves "proposed" and the
  // PlanCard (with its Approve) unmounts — a second approve is structurally impossible from the UI,
  // layered over the server-side proposed→approved CAS that makes a double-approve send exactly once.
  await expect(approve).toHaveCount(0);
});
