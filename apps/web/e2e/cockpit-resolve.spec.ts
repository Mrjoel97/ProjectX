import { expect, test } from "@playwright/test";

// SC2 agent-path proof — the whole name-resolution + edit loop end to end over the OFFLINE
// `SMOKE::agent::` sentinel grammar (Plan 04/05): the cockpit conversation engine is the governed
// Executive Agent tool-loop (sendCockpitMessage → runCockpitAgent), NOT the retired FSM. Each
// message drives ONE governed tool call offline (no gateway): resolve a NAME → the ResolutionCard
// renders → pick a contact → a conversational EDIT (add a recipient) → subject → body → propose →
// the PLAN card. NOTHING is sent — this phase is READING/composing; the send E2E is cockpit-report.
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). `SMOKE::agent::resolve=SMOKE::…`
// hits the deterministic offline gmail.search fixture (Sarah Smoke <sarah@example.com> / Sara Test
// <sara@example.org>) with NO live mailbox. The body op carries the `SMOKE::route=direct_llm::`
// sentinel so draftCockpit returns a deterministic offline draft — which honors the resolved
// greeting ("Hi Sarah Smoke,") so the greeting personalization (SC3) is verifiable offline.
//
// Assertions ride the plan-row-derived CARDS (stable), never the agent's reply prose (which varies).

test("agent path: resolve → card → pick → edit → PLAN (offline SMOKE::agent::, nothing sent)", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Each send clears the composer on success (ChatPane sets text="" after the action resolves), so
  // waiting for an empty value sequences the turns without asserting on model prose.
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 15_000 });
  };

  const workspace = page.getByTestId("workspace-pane");

  // 1. resolve a NAME → resolveContacts tool → offline gmail.search fixture → ResolutionCard.
  await say("SMOKE::agent::resolve=SMOKE::Sarah");
  await expect(workspace.getByText("PICK A CONTACT", { exact: true })).toBeVisible({ timeout: 15_000 });
  const sarahChip = workspace.getByRole("button", { name: /sarah@example\.com/i });
  await expect(sarahChip).toBeVisible();
  await expect(sarahChip).toContainText(/1 msg/i); // header-level hint (count)

  // 2. pick the contact + confirm → resolveRecipients folds the address in and wipes candidates
  //    (the card disappears — the model never saw the address, §2-D).
  await sarahChip.click();
  await workspace.getByRole("button", { name: /use these contacts/i }).click();
  await expect(workspace.getByText("PICK A CONTACT", { exact: true })).toHaveCount(0, { timeout: 15_000 });

  // 3. a conversational EDIT: add a second recipient (addRecipients tool — validated, deduped).
  await say("SMOKE::agent::add=bob@example.com");

  // 4. subject → body (offline sentinel, honors the resolved greeting) → mode (2 recipients) → propose.
  await say("SMOKE::agent::subject=Quarterly update");
  await say("SMOKE::agent::body=SMOKE::route=direct_llm:: Share the quarterly numbers.");
  await say("SMOKE::agent::mode=individual");
  await say("SMOKE::agent::propose");

  // PLAN card: the resolved recipient is shown, exactly ONE Approve, and the body opens with the
  // personalized greeting from the resolved display name (SC3).
  await expect(workspace.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByText("sarah@example.com")).toBeVisible();
  await expect(workspace.getByText(/Hi Sarah/)).toBeVisible();
  await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(1);

  // READING/composing phase: nothing sends. Do NOT click Approve. No REPORT card appears.
  await expect(workspace.getByText("REPORT", { exact: true })).toHaveCount(0);
});
