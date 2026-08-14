import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

/**
 * 20.2 wave 6 — THE MEDIA CANVAS, IN A REAL BROWSER, ON A REAL SCENE DECK.
 *
 * **Why this spec exists and the unit tests are not enough.** This repo has a named defect from
 * exactly this gap: a cockpit tool parameter that passed every unit test, every SMOKE run and the
 * paid eval, and was dead in production because it was never threaded through the web caller
 * (`clock-plane-dead-in-production`). The canvas's own version of that failure is silent — a scene
 * deck reaching a surface that still reads `type`, `clipSeconds` and `blockCount` renders a
 * plausible-looking card with the wrong windows and a status line about a job that will never
 * exist. Nothing in `apps/web`'s DOM-less runner can see it.
 *
 * The load-bearing assertion here is the RIBBON'S MEASURED WIDTHS. `ribbonShares` is unit-tested,
 * but "the numbers are right" and "the strip is proportional on screen" are different claims — the
 * second needs a layout engine, and it is the one the wave promised.
 *
 * $0: it stages a deck through the two internal mutations the specialist's own terminal uses and
 * NEVER presses Generate. No provider is called, no sandbox is started, and the estimate is a
 * query that cannot spend.
 *
 * PREREQUISITES (e2e/README.md): `convex dev` and a web server on :3111, both live. The deck is
 * staged through the Convex CLI, so `PIKAR_E2E_BACKEND_DIR` must point at `packages/backend` if
 * this is run from somewhere else.
 */

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;

/** `convex run`, with the CLI's own failure prose treated as a failure — it exits 0 on some of
 *  them, which is how a spec ends up asserting against a deck that was never written. */
function convexRun(fn: string, args: Record<string, unknown>): string {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`spawn failed for ${fn}: ${result.error.message}`);
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (CLI_FAILURE.test(result.stderr ?? "")) throw new Error(`${fn} failed:\n${out.trim()}`);
  return out;
}

/** The tenant is the stable user id from the session's own JWT — `requireTenant`'s rule (the
 *  subject before `|`), so the staged deck belongs to the signed-in user and not to a fixture
 *  tenant the canvas would never read. */
function tenantIdFrom(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT (no payload segment).");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  const userId = claims.sub?.split("|")[0];
  if (!userId) throw new Error("Convex Auth JWT carries no stable user id.");
  return userId;
}

/** 8 s generated clip · 6 s animated still · 4 s SILENT text card · 12 s of the tenant's own
 *  footage = 30 s. One of every kind, no two the same length, and a silent scene — the deck the
 *  block contract could not express at all. */
const SCENES = [
  {
    index: 0,
    visual: "generated_video",
    seconds: 8,
    windowStartMs: 0,
    description: "The founder, mid-sentence",
    prompt: "A founder talking to camera in a bright studio",
    narration: "We built this because the old way was costing us a day a week.",
  },
  {
    index: 1,
    visual: "animated_image",
    seconds: 6,
    windowStartMs: 8_000,
    description: "The dashboard, panned",
    prompt: "A clean analytics dashboard, teal accents",
    narration: "Everything lands in one place.",
  },
  {
    index: 2,
    visual: "text_card",
    seconds: 4,
    windowStartMs: 14_000,
    description: "The claim, held",
    overlay: "One day a week, back.",
    prompt: "n/a",
    narration: "",
  },
  {
    index: 3,
    visual: "uploaded_video",
    seconds: 12,
    windowStartMs: 18_000,
    description: "The customer's own recording",
    prompt: "n/a",
    narration: "Here is what it looks like when it is running.",
  },
];

/**
 * Sign in through the real form, exactly as `auth.setup.ts` does.
 *
 * **Why this spec signs in itself instead of trusting `storageState`.** Every `convex run` against
 * a LOCAL (anonymous) deployment invalidates the browser's session — measured, not guessed: a
 * signed-in context that reaches `/dashboard` before the CLI call lands on `/signin` after it, with
 * the CLI exiting 0. The deck has to be staged through internal mutations (nothing public writes
 * `plans.shots`), so the only stable order is STAGE FIRST, THEN AUTHENTICATE.
 */
async function signIn(page: Page): Promise<void> {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL / E2E_USER_PASSWORD must be set to a seeded test user (see e2e/README.md).",
    );
  }
  await page.goto("/signin");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: /sign ?out/i })).toBeVisible({ timeout: 30_000 });
}

test("a scene deck renders as a proportional timeline, per-kind tiles and a priced gate", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // The tenant id, read from the SESSION rather than invented: `requireTenant` derives it from the
  // JWT subject (the part before `|`), so a fixture tenant would stage a deck the canvas never
  // reads. One sign-in to learn it, because the staging below then ends this session.
  await signIn(page);
  const cookie = (await page.context().cookies()).find((c) => c.name === "__convexAuthJWT");
  if (!cookie?.value) throw new Error("Signed in, but no Convex Auth JWT cookie was set.");
  const tenantId = tenantIdFrom(cookie.value);

  // A tenant with no committed business profile is force-redirected to onboarding by the (app)
  // layout and cannot reach the workspace at all. The repo's own seeder is the sanctioned way past
  // it — idempotent, offline, and no credits (see its header: browsable, not retrievable).
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });

  const threadId = `e2e-scene-${Date.now().toString(36)}`;
  const staged = convexRun("plans:stageMediaPlan", {
    tenantId,
    threadId,
    subject: "A 30-second reel",
  });
  const planId = /"planId":\s*"([^"]+)"/.exec(staged)?.[1];
  expect(
    planId,
    `stageMediaPlan returned no planId:
${staged}`,
  ).toBeTruthy();

  convexRun("plans:persistDeck", {
    tenantId,
    planId,
    script: "A 30-second reel about getting a day a week back.",
    artDirection: null,
    // The longest scene, as `persistSceneDeck` writes it — inert for scene rows, and deliberately
    // NOT the thing the canvas sizes anything from. If a tile were still reading it, the windows
    // below would all be 12 seconds long.
    clipSeconds: 12,
    targetDurationSeconds: 30,
    shots: SCENES,
  });

  // The staging above ended the session (see `signIn`'s note). Back in.
  await signIn(page);

  await page.goto(`/dashboard/workspace?thread=${threadId}&view=canvas`);
  const canvas = page.getByTestId("media-canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // ── THE RIBBON, MEASURED ───────────────────────────────────────────────────────────────────
  const segments = page.getByTestId("media-timeline").locator("li");
  await expect(segments).toHaveCount(4);
  const widths: number[] = [];
  for (let i = 0; i < 4; i++) {
    const box = await segments.nth(i).boundingBox();
    expect(box, `scene ${i} has no layout box`).toBeTruthy();
    widths.push(box?.width ?? 0);
  }
  // 8 / 6 / 4 / 12 — the ORDER of the widths is the claim. The 12 s scene is the widest, the 4 s
  // card the narrowest, and the 8 s scene beats the 6 s one. Under the uniform contract every one
  // of these would have been equal, which is exactly what a proportional strip must not be.
  expect(widths[3]).toBeGreaterThan(widths[0] as number);
  expect(widths[0]).toBeGreaterThan(widths[1] as number);
  expect(widths[1]).toBeGreaterThan(widths[2] as number);
  // …and proportional, not merely ordered: 12 s is ~3x the 4 s card once the readability floor is
  // accounted for. A layout that merely sorted them would pass the three lines above.
  expect((widths[3] as number) / (widths[2] as number)).toBeGreaterThan(2);
  await expect(page.getByTestId("media-timeline")).toContainText("30s · 4 scenes");

  // ── THE TILES: four kinds, four windows, four honest status lines ──────────────────────────
  const tiles = page.getByTestId("media-block-tile");
  await expect(tiles).toHaveCount(4);

  // Each scene's window comes off its OWN offset. `index x clipSeconds` would have produced
  // 0:00–0:12, 0:12–0:24, 0:24–0:36, 0:36–0:48 — a 48-second grid for a 30-second reel.
  await expect(tiles.nth(0)).toContainText("0:00–0:08");
  await expect(tiles.nth(1)).toContainText("0:08–0:14");
  await expect(tiles.nth(2)).toContainText("0:14–0:18");
  await expect(tiles.nth(3)).toContainText("0:18–0:30");

  await expect(tiles.nth(0)).toContainText("GENERATED CLIP");
  await expect(tiles.nth(1)).toContainText("ANIMATED STILL");
  await expect(tiles.nth(2)).toContainText("TEXT CARD");
  await expect(tiles.nth(3)).toContainText("YOUR FOOTAGE");

  // The card is DRAWN, not awaited — the shipped canvas said "Clip: not requested yet" here, for
  // a picture no provider will ever be asked for.
  await expect(tiles.nth(2)).toContainText("drawn when the reel is assembled");
  await expect(tiles.nth(2)).not.toContainText("Clip: not requested yet");
  // A silent scene is silent on purpose.
  await expect(tiles.nth(2)).toContainText("silent scene");
  // …and it has nothing to re-buy, so it offers no control that would spend.
  await expect(tiles.nth(2)).toContainText("Nothing to buy for this scene");
  await expect(tiles.nth(2)).not.toContainText("Regenerate this scene");
  // The paid scenes do offer one, and say what it buys.
  await expect(tiles.nth(1)).toContainText("Buys one new still");

  // ── THE VAULT PICKER ───────────────────────────────────────────────────────────────────────
  // Present only on the upload scene, and honest when the vault holds no video: the cure is in
  // another route, so it is named. (A seeded video would mean a real vault upload, and a video
  // upload starts a PAID transcription — out of scope for a $0 wave. `media.test.ts` covers the
  // accept/refuse rules on the mutation itself.)
  const picker = page.getByTestId("scene-asset-picker");
  await expect(picker).toHaveCount(1);
  await expect(tiles.nth(3)).toContainText("Your footage for this scene");
  await expect(tiles.nth(3)).toContainText("Footage: none chosen");

  // ── THE ESTIMATE GATE ──────────────────────────────────────────────────────────────────────
  const estimate = page.getByTestId("media-estimate");
  await expect(estimate).toContainText("A 30-second reel of 4 scenes, priced per scene");
  // The stale block-contract line, gone.
  await expect(estimate).not.toContainText("per block");

  // The deck names an upload with no document, so `hasAssetSource` refuses it — BEFORE the button
  // is live, which is the whole point of the estimate being a query. The refusal names the lever.
  await expect(estimate).toContainText("doesn't say what its picture is made from");
  await expect(estimate).not.toContainText("only VIDEO and IMAGE");
  await expect(page.getByTestId("media-generate")).toBeDisabled();
});
