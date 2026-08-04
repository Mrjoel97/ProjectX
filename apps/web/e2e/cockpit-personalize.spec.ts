import { expect, test } from "@playwright/test";

// CKPT-03 per-recipient personalization flow (SC1) — the whole chat→2 recipients→subject→body→
// personalize #1→PLAN→Approve→REPORT path end to end over the OFFLINE `SMOKE::agent::` grammar
// (mirrors cockpit-attachment/cockpit-resolve): the cockpit is the governed Executive Agent
// tool-loop (sendCockpitMessage → runCockpitAgent), and each message drives ONE governed tool call
// offline (no gateway). Personalization is the INVERSE of the 3.3 attachment fan-out: each recipient
// can carry a DISTINCT tailored body (recipientBodies[address]) while SHARING the subject — behind
// the SAME single plan Approve. The real 2-inbox distinct-wording send is the manual human-verify
// (CKPT-03, the sole live-only proof).
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). The body op AND the personalize
// instruction each carry the `SMOKE::route=direct_llm::` sentinel so draftCockpit returns a
// deterministic offline draft (no AI key). The shared body and the tailored body redact to DIFFERENT
// safeText, so their offline `Smoke draft for <hash>` drafts DIFFER — the PLAN card shows one
// "tailored" row (alice) and one "shared body" row (bob), two distinct bodies BEFORE the single
// Approve. The harness user has a stale Gmail token, so executePlan passes its gmail-connected
// pre-check but each send settles at `awaiting_reauth` (the automatable terminal).
//
// Assertions ride the plan-row-derived CARDS (stable), never the agent's reply prose (which varies).

test("chat → 2 recipients → subject → body → personalize #1 → PLAN(2 distinct bodies) → Approve → REPORT", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Each send clears the composer on success — waiting for empty sequences turns without asserting prose.
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
  };

  const workspace = page.getByTestId("workspace-pane");

  // Compose: TWO literal recipients + a shared subject + a shared base body (offline sentinel) +
  // individual mode (personalization requires individual sends), then tailor recipient #1 only.
  await say("SMOKE::agent::add=alice@example.com,bob@example.com");
  await say("SMOKE::agent::subject=Q3 sync");
  await say("SMOKE::agent::body=SMOKE::route=direct_llm:: the shared body for everyone");
  await say("SMOKE::agent::mode=individual");
  // personalize=<1-based index>:<intent> — the intent carries the SMOKE:: sentinel (split on the
  // FIRST colon after the index) so the tailored draft is deterministic offline AND differs from the
  // shared body (different safeText → different hash → different `Smoke draft for <hash>`).
  await say(
    "SMOKE::agent::personalize=1:SMOKE::route=direct_llm:: make Alice's note warmer and personal",
  );
  await say("SMOKE::agent::propose");

  // PLAN card: the PER-RECIPIENT BODY section shows BOTH recipients with DISTINCT bodies BEFORE the
  // single Approve — recipient #1 (alice) is "tailored", recipient #2 (bob) is "shared body". The two
  // tags co-existing is the plan-row-derived proof of two distinct bodies (the section renders only
  // when at least one recipient is tailored; a same-content plan shows nothing here).
  await expect(workspace.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByText("PER-RECIPIENT BODY", { exact: true })).toBeVisible();
  await expect(workspace.getByText("alice@example.com")).toBeVisible();
  await expect(workspace.getByText("bob@example.com")).toBeVisible();
  await expect(workspace.getByText("tailored", { exact: true })).toBeVisible(); // recipient #1 differs
  await expect(workspace.getByText("shared body", { exact: true })).toBeVisible(); // recipient #2 shared

  // Nothing is sent before Approve: exactly ONE Approve and NO REPORT card yet.
  const approve = page.getByRole("button", { name: /^approve$/i });
  await expect(approve).toHaveCount(1);
  await expect(workspace.getByText("REPORT", { exact: true })).toHaveCount(0);

  // ONE Approve → executePlan seeds each recipient's request with its OWN body under the shared
  // subject and fans out the governed send.
  await approve.click();

  // REPORT card: both recipient rows fill live (offline they settle at awaiting_reauth).
  await expect(workspace.getByText("REPORT", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByText("alice@example.com")).toBeVisible();
  await expect(workspace.getByText("bob@example.com")).toBeVisible();

  // Single-approve gate held: once delivering starts the PlanCard (with its Approve) unmounts.
  await expect(approve).toHaveCount(0);
});
