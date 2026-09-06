import { expect, test } from "@playwright/test";

// CKPT-02 attachment flow (V9) — the whole chat→attach→PLAN→Approve→REPORT path end to end over the
// OFFLINE `SMOKE::agent::` grammar (mirrors cockpit-resolve/cockpit-report): the cockpit is the
// governed Executive Agent tool-loop (sendCockpitMessage → runCockpitAgent), and each message drives
// ONE governed tool call offline (no gateway). A generated PDF rides an approved plan to the recipient
// via the governed fan-out, with a filename + download link on the PLAN card and a per-recipient
// re-download on the REPORT card. A real send + audit-refs-only check is the manual human-verify (V10).
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). The attach topic carries the
// `SMOKE::route=direct_llm::` sentinel so draftDocument returns deterministic offline markdown →
// markdownToPdf fixed bytes (no AI key). The harness user has a stale Gmail token, so executePlan
// passes its gmail-connected pre-check but each send settles at `awaiting_reauth` (the automatable
// terminal) — the REPORT still resolves the delivered attachment ref → the re-download chip.
//
// Assertions ride the plan-row-derived CARDS (stable), never the agent's reply prose (which varies).

// The attach topic: the SMOKE:: sentinel keeps draftDocument offline + pins the filename date.
const ATTACH = "SMOKE::agent::attach=SMOKE::route=direct_llm:: Quarterly proposal";

test("chat → attach → PLAN(filename+download) → Approve → REPORT(delivered-with-attachment)", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Each send clears the composer on success — waiting for empty sequences turns without asserting prose.
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
  };

  const workspace = page.getByTestId("workspace-pane");

  // Compose: a recipient + subject + body (offline sentinel) + a generated attachment, then propose.
  await say("SMOKE::agent::add=alice@example.com");
  await say("SMOKE::agent::subject=Quarterly update");
  await say("SMOKE::agent::body=SMOKE::route=direct_llm:: Share the quarterly numbers.");
  await say(ATTACH);
  await say("SMOKE::agent::propose");

  // PLAN card: the ATTACHMENTS section shows the generated filename as a download link, and NO
  // attachmentError note (a healthy attachment keeps the plan approvable, V7).
  await expect(workspace.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByText("ATTACHMENTS", { exact: true })).toBeVisible();
  const planPdfLink = workspace.getByRole("link", { name: /\.pdf$/i });
  await expect(planPdfLink.first()).toBeVisible();
  await expect(workspace.getByText(/couldn't generate the document/i)).toHaveCount(0);
  const approve = page.getByRole("button", { name: /^approve$/i });
  await expect(approve).toHaveCount(1);

  // ONE Approve → executePlan materializes the shared attachment + fans it to the recipient row.
  await approve.click();

  // REPORT card: the recipient row fills live and carries the delivered-with-attachment 📎 chip with a
  // re-download link (reportForPlan resolves the request's attachmentRefs → the exact sent bytes).
  await expect(workspace.getByText("REPORT", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByText("alice@example.com")).toBeVisible();
  const reportPdfLink = workspace.getByRole("link", { name: /\.pdf$/i });
  await expect(reportPdfLink.first()).toBeVisible({ timeout: 30_000 });

  // Single-approve gate held: once delivering starts the PlanCard (with its Approve) unmounts.
  await expect(approve).toHaveCount(0);
});

test("remove-attachment variant: the attachment row disappears pre-approval (regenerate/remove)", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
  };
  const workspace = page.getByTestId("workspace-pane");

  // Compose a plan WITH an attachment, then propose so the PLAN card (and its ATTACHMENTS row) renders.
  await say("SMOKE::agent::add=bob@example.com");
  await say("SMOKE::agent::subject=Draft with attachment");
  await say("SMOKE::agent::body=SMOKE::route=direct_llm:: Body text.");
  await say(ATTACH);
  await say("SMOKE::agent::propose");

  await expect(workspace.getByText("ATTACHMENTS", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(workspace.getByRole("link", { name: /\.pdf$/i }).first()).toBeVisible();

  // Remove the 1st attachment (pre-approval control) → the ATTACHMENTS section reactively disappears.
  await say("SMOKE::agent::removeAttachment=1");
  await expect(workspace.getByText("ATTACHMENTS", { exact: true })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(workspace.getByRole("link", { name: /\.pdf$/i })).toHaveCount(0);
});
