import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

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

test("agent path: resolve → card → pick → edit → PLAN (offline SMOKE::agent::, nothing sent)", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
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
  await expect(workspace.getByText("PICK A CONTACT", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const sarahChip = workspace.getByRole("button", { name: /sarah@example\.com/i });
  await expect(sarahChip).toBeVisible();
  await expect(sarahChip).toContainText(/1 msg/i); // header-level hint (count)

  // 2. pick the contact + confirm → resolveRecipients folds the address in and wipes candidates
  //    (the card disappears — the model never saw the address, §2-D).
  const msgsBeforePick = await page.getByTestId("chat-message").count();
  await sarahChip.click();
  await workspace.getByRole("button", { name: /use these contacts/i }).click();
  await expect(workspace.getByText("PICK A CONTACT", { exact: true })).toHaveCount(0, {
    timeout: 15_000,
  });

  // A pick is an agent TURN, not a dead-end (regression guard for the blank-workspace/hanging-reply
  // bug): resolveRecipients re-enters the tool-loop and saves exactly ONE new assistant reply —
  // WITHOUT the user sending another message. Content varies (real reply vs offline error turn), so
  // assert on the count, not the prose. Before the fix this stayed flat and the conversation hung.
  await expect(page.getByTestId("chat-message")).toHaveCount(msgsBeforePick + 1, {
    timeout: 20_000,
  });

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

// ── UAT-A demotion-order regression lock (03.10-02) ──────────────────────────────────────────
//
// UAT 2026-07-19: a tall BriefingCard pinned first buried the ResolutionCard ("where is the
// list") and the pick stalled. PlanCards now demotes the brief BELOW the plan cards the moment
// composition is active (candidates parked / subject / body / recipients / status past
// collecting) and keeps it primary in the brief-only flow. This test locks BOTH orders on one
// thread: brief=today (brief primary) → resolve (picker first, brief demoted — never destroyed).
//
// Seeding plumbing mirrors cockpit-briefing.spec.ts verbatim (JWT-sub tenantId + the
// smokeRun.mjs no-shell convention — the tenantId contains a `|` cmd.exe would read as a pipe;
// success from OUTPUT, not exit code).

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");

// llm.ts SMOKE_NOW_MS (2020-01-01T12:00:00Z) — seeding at the agent's pinned clock keeps buckets deterministic.
const SMOKE_NOW_MS = 1577880000000;

const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
function convexRun(fn: string, args: Record<string, unknown>): string {
  const res = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (res.error) throw new Error(`spawn failed for ${fn}: ${res.error.message}`);
  const err = res.stderr ?? "";
  if (CLI_FAILURE.test(err)) throw new Error(`${fn} failed:\n${err.trim()}`);
  return res.stdout ?? "";
}

/** The signed-in session's tenantId (`identity.subject`), decoded from the Convex Auth JWT's `sub`. */
async function resolveTenantId(page: Page): Promise<string> {
  const jwt = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? window.localStorage.getItem(key) : null;
  });
  if (!jwt)
    throw new Error(
      "No Convex Auth JWT in localStorage — is the storageState session still valid?",
    );
  const payload = jwt.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT (no payload segment).");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  if (!claims.sub)
    throw new Error("Convex Auth JWT carries no `sub` claim — cannot resolve the tenant.");
  return claims.sub;
}

test("demotion: brief primary → candidates park → picker precedes the demoted brief (UAT-A)", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Seed the fixture mailbox for THIS session's tenant (idempotent — re-runs never double it).
  const tenantId = await resolveTenantId(page);
  convexRun("smoke:seedInboxFixture", { tenantId, offlineDigest: true, baseMs: SMOKE_NOW_MS });

  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
  };

  const workspace = page.getByTestId("workspace-pane");
  const briefCard = workspace.getByTestId("briefing-card");

  // 1. Brief-only state: fresh thread, plan at `collecting`, nothing composed → the brief is
  //    primary and fully rendered (cockpit-briefing.spec.ts owns the full SC-1/SC-4 detail).
  await say("SMOKE::agent::brief=today");
  await expect(briefCard).toBeVisible({ timeout: 20_000 });

  // 2. Resolve a name → candidates park on the plan row → composition is ACTIVE: the
  //    ResolutionCard is the top card of the PlanCards grid, above the demoted brief.
  await say("SMOKE::agent::resolve=SMOKE::Sarah");
  const picker = workspace.getByText("PICK A CONTACT", { exact: true });
  await expect(picker).toBeVisible({ timeout: 15_000 });

  // Demoted, NOT destroyed: the briefing card (its masthead) is still attached below the work.
  await expect(briefCard).toBeVisible();

  // DOM order, not layout: the briefing card FOLLOWS the picker (compareDocumentPosition).
  const pickerHandle = await picker.elementHandle();
  const briefHandle = await briefCard.elementHandle();
  if (!pickerHandle || !briefHandle) throw new Error("picker/brief element handle missing");
  const briefFollowsPicker = await pickerHandle.evaluate(
    (pickerEl, briefEl) =>
      Boolean(pickerEl.compareDocumentPosition(briefEl) & Node.DOCUMENT_POSITION_FOLLOWING),
    briefHandle,
  );
  expect(briefFollowsPicker).toBe(true);

  // UAT-C (03.10-04): the demoted brief mounts COLLAPSED to its masthead — the content region
  // (briefing-body) is not rendered, only the masthead + its toggle. The masthead toggle expands it
  // to full content and collapses it again (local useState, no plan field — ADR-004).
  const briefBody = briefCard.getByTestId("briefing-body");
  await expect(briefBody).toHaveCount(0); // collapsed at mount: the content is hidden
  await briefCard.getByRole("button", { name: /expand briefing/i }).click();
  await expect(briefBody).toBeVisible(); // toggle expands to the full report
  await briefCard.getByRole("button", { name: /collapse briefing/i }).click();
  await expect(briefBody).toHaveCount(0); // and collapses back to the masthead

  // SC-4 re-assert, RESCOPED to the CONTENT region (03.10-04): zero actionable controls INSIDE
  // briefing-body — the masthead toggle is allowed view chrome OUTSIDE it. Assert while expanded.
  await briefCard.getByRole("button", { name: /expand briefing/i }).click();
  await expect(briefBody).toBeVisible();
  await expect(briefBody.locator("button")).toHaveCount(0);
  await expect(briefBody.locator("a")).toHaveCount(0);
});

// ── UAT-C proposed-while-pending picker-survival regression (03.10-04) ────────────────────────
//
// The transcript deadlock: a plan reached `proposed` with a contact pick STILL parked, so the
// picker vanished (`status !== "proposed"` suppressed `resolving`) AND an unpickable "#1 (no name)"
// PlanCard showed — a dead end. The BACKEND guard (proposePlan refuses over a parked pick) makes
// this state unreachable through the agent — so we reach it out of band: the composer creates a REAL
// agent thread and parks a pick (`resolve`), THEN `cockpit.proposeEmailPlan` flips status → proposed
// WITHOUT clearing candidates (the exact bad ROW). The planId rides the `data-plan-id` hook the
// PlanCards grid renders (present the moment the picker mounts). The frontend guards are defense-in-
// depth for ANY reader: the picker MUST survive and NO "#1 (no name)" PlanCard may show. Like every
// spec here, the LIVE paint is owed to the connected human-verify session (composer gated on
// `gmailAuth.status.connected`); the automated gate is typecheck + Playwright discovery.

test("proposed + parked candidates: the picker survives, no '#1 (no name)' PlanCard (UAT-C)", async ({
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

  // 1. Park a real pick via the composer (agent thread + candidates on the plan row).
  await say("SMOKE::agent::resolve=SMOKE::Sarah");
  const picker = workspace.getByText("PICK A CONTACT", { exact: true });
  await expect(picker).toBeVisible({ timeout: 15_000 });

  // 2. Read the plan id from the PlanCards grid hook, then flip status → proposed WITHOUT picking
  //    (proposeEmailPlan keeps candidates) — the deadlock ROW the backend guard now prevents live.
  const planId = await workspace.locator("[data-plan-id]").first().getAttribute("data-plan-id");
  if (!planId)
    throw new Error("no data-plan-id on the PlanCards grid — cannot force the proposed state");
  convexRun("cockpit:proposeEmailPlan", {
    planId,
    recipients: ["bob@example.com"],
    mode: "individual",
    subject: "Quarterly update",
    body: "Hi, sharing the quarterly numbers.",
  });

  // 3. Reactive re-render at status 'proposed' with a pick STILL parked: the picker SURVIVES (the
  //    dropped `status !== "proposed"` clause) and NO unpickable "#1 (no name)" PLAN card renders.
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByText("PLAN", { exact: true })).toHaveCount(0);
});
