import { expect, test } from "@playwright/test";

// ACTN-04 SC#6 (PARTIAL) — a created artifact is SEEN in the conversation, not only stored as a
// silent vault row. One offline `createDocument` turn must render the Output card
// (`data-testid="output-card"`, cards.tsx OutputCard) carrying the artifact's title.
//
// ⚠ THIS IS THE AUTOMATED HALF OF SC#6 AND NOTHING MORE. A spec can prove the card MOUNTS and
// names the artifact. It cannot judge whether the card looks like BRAND §5's Output card or reads
// well — that judgement is human, is a Manual-Only row in 18-VALIDATION.md, and is executed at
// plan 18-09's gate. Do not read a green run here as SC#6 closed.
//
// ⚠ RUNNING IT IS PLAN 18-09's PRECONDITION, NOT THIS PLAN'S GATE. playwright.config.ts pins
// baseURL 127.0.0.1:3111 and has NO webServer block — it drives an ALREADY-RUNNING stack: a live
// `convex dev` (NOT --once, the SMOKE path needs the local backend) plus the web app ON :3111
// (`next start` defaults to :3000 — pin it: `pnpm --filter @pikar/web start -- -p 3111`), and
// E2E_USER_EMAIL / E2E_USER_PASSWORD for a user seeded in that deployment (auth.setup.ts throws
// without them). Signed in via storageState from auth.setup.ts, exactly like cockpit-attachment.
//
// Assertions ride the vaultSources-derived CARD (stable), never the agent's reply prose.

// ⚠ VERBATIM, NESTED PREFIX INCLUDED — do NOT "clean this up".
// `SMOKE::agent::create=` only selects the tool; it does NOT keep the model out of the loop.
// draftDocument calls generateObject unless the safeText it receives ITSELF starts with
// `SMOKE::route=…::` (parseSmoke is ^-anchored), so the route sentinel lives INSIDE the topic.
// e2e runs with no OPENAI_API_KEY: without it the real call throws, createDocument returns a
// failure sentence, NO vaultDocuments/vaultSources row is written, and the Output card can never
// render. Same shape as cockpit-attachment.spec.ts's ATTACH constant.
const CREATE = "SMOKE::agent::create=long:SMOKE::route=direct_llm:: Quarterly one-pager";

// draftDocument's offline return (llm.ts) — the title the card must show.
const SMOKE_TITLE = "Smoke Document";

test("chat → createDocument → the Output card names the artifact", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // The composer clears on success — waiting for empty sequences the turn without asserting prose.
  await composer.fill(CREATE);
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 20_000 });

  const workspace = page.getByTestId("workspace-pane");
  const card = workspace.getByTestId("output-card");

  await expect(card).toBeVisible({ timeout: 20_000 });
  // The title, not just the testid — a testid-only assertion is vacuous: an empty card would pass it.
  await expect(card).toContainText(SMOKE_TITLE);
  // `form: "long"` ⇒ the DOCUMENT badge, read off the row's own `form` field (18-04/18-06 write it
  // on every create and every revise). A POST here would mean the badge stopped reading the row.
  await expect(card.getByText("DOCUMENT", { exact: true })).toBeVisible();
  // createDocument SAVES; it never sends. A plan/PLAN card here would be a different tool firing.
  await expect(card).toContainText(/nothing was sent/i);
});

test("a turn that creates nothing renders no Output card", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // A recipient-only turn: a governed tool call that writes no vaultSources `created` row. The card
  // must stay absent (OutputCard returns null, like SourceCard) — this is what makes the assertion
  // above non-vacuous, since a card that rendered on every turn would pass it too.
  await composer.fill("SMOKE::agent::add=alice@example.com");
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 20_000 });

  await expect(page.getByTestId("workspace-pane").getByTestId("output-card")).toHaveCount(0);
});
