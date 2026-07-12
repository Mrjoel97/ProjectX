import { expect, test } from "@playwright/test";

// SC2 inbox-reading proof — the whole name-resolution loop end to end over the OFFLINE `SMOKE::`
// gmail.search fixture: chat → a NAME recipient → resolution card (contact chips + hints) → pick a
// contact → guided slot-fill continues → PLAN card. NOTHING is sent (this phase is about READING —
// the send E2E is cockpit-report).
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). The recipients answer mixes a
// `SMOKE::` NAME with a valid address: the cockpit runs internal.gmail.search on the name, which
// returns the deterministic offline fixture (Sarah Smoke <sarah@example.com> / Sara Test
// <sara@example.org>) with NO live mailbox, while the valid address is held as pendingValid (the
// "already valid" row). Two recipients means the mode question fires. The body intent carries the
// `SMOKE::route=direct_llm::` sentinel so draftCockpit returns a deterministic offline draft — which
// now honors the resolved greeting ("Hi Sarah Smoke,") so the greeting personalization (SC3) is
// verifiable offline.

test("name → resolution card → pick → PLAN (offline SMOKE:: path, nothing sent)", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
  };

  const workspace = page.getByTestId("workspace-pane");

  // 1. recipients: a NAME (resolved via the SMOKE fixture) + a valid address (held as pendingValid).
  await say("SMOKE::Sarah, bob@example.com");

  // Resolution card: a section for the name with a chip carrying sarah@example.com + a msg-count hint,
  // and the "already valid" pendingValid row for bob@example.com.
  await expect(workspace.getByText("PICK A CONTACT", { exact: true })).toBeVisible({ timeout: 15_000 });
  const sarahChip = workspace.getByRole("button", { name: /sarah@example\.com/i });
  await expect(sarahChip).toBeVisible();
  await expect(sarahChip).toContainText(/1 msg/i); // header-level hint (count)
  await expect(workspace.getByText("bob@example.com")).toBeVisible(); // pendingValid pre-selected row

  // 2. pick the contact + confirm → the conversation advances to the subject question.
  await sarahChip.click();
  await workspace.getByRole("button", { name: /use these contacts/i }).click();
  await expect(page.getByText(/subject line/i)).toBeVisible({ timeout: 15_000 });

  // 3. subject → body intent (offline sentinel) → mode (fires for the 2 recipients).
  await say("Quarterly update");
  await expect(page.getByText(/what do you want the email to say/i)).toBeVisible({ timeout: 15_000 });
  await say("SMOKE::route=direct_llm:: Share the quarterly numbers.");
  await expect(page.getByText(/individually, or as one group thread/i)).toBeVisible({ timeout: 15_000 });

  // 4. mode → ready → offline draft → PLAN proposed.
  await say("individual");

  // PLAN card: the resolved recipient is shown, exactly ONE Approve, and the body preview opens with
  // the personalized greeting from the resolved display name (SC3).
  await expect(workspace.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByText("sarah@example.com")).toBeVisible();
  await expect(workspace.getByText(/Hi Sarah/)).toBeVisible();
  await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(1);

  // READING phase: nothing sends. Do NOT click Approve. No REPORT card appears.
  await expect(workspace.getByText("REPORT", { exact: true })).toHaveCount(0);
});
