import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
// The cost-lever sentence is IMPORTED, not retyped. It read "about 40×" here while the tables said
// 66.7x and then 46.7x — a browser assertion pinning a literal is the same check-that-cannot-fail
// the unit tests had, one layer out. `mediaCanvasView.ts` derives it from the price tables.
import { CLIP_COST_LEVER_NOTE } from "../app/(app)/dashboard/workspace/mediaCanvasView";

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

/** `convex run`'s stdout for a function that returns a bare string — the id, unquoted. Convex
 *  prints the JSON value, so the whole of stdout is `"kh7…"` plus whatever the CLI logged around
 *  it; the last quoted token is the return value. */
function returnedId(out: string, fn: string): string {
  const ids = out.match(/"([a-z0-9]{20,})"/g);
  const last = ids?.at(-1);
  if (!last) throw new Error(`${fn} returned no id:\n${out.trim()}`);
  return last.slice(1, -1);
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
  // The stale block-contract line, gone.
  await expect(estimate).not.toContainText("per block");

  // ── WHAT A REFUSED ESTIMATE SHOWS, AS OF 33-06 ─────────────────────────────────────────────
  // This assertion used to read `toContainText("A 30-second reel of 4 scenes, priced per scene")`,
  // and it was written when `jobEstimate`'s four lines were ALWAYS open. 33-06 moved the priced-as
  // sentence inside the `<details>` breakdown, and the breakdown renders only when there are lines
  // to itemise — a REFUSED deck has none, so the sentence is genuinely absent here. Measured in a
  // browser (33-10), not inferred: the region reads "Cost $0.00 / Generate reel / Scene 4 doesn't
  // say what its picture is made from…".
  //
  // The refused state is pinned as what it IS, and the positive priced-as assertion moved to the
  // phase-33 test below, where the deck actually prices. Whether a refused deck ought to keep
  // saying what it would be pricing is a COPY question raised at 33-10's owner gate, not something
  // this spec should quietly decide by asserting either way.
  await expect(page.getByTestId("media-total")).toHaveText("$0.00");
  await expect(estimate).not.toContainText("What makes up");
  await expect(estimate).not.toContainText("priced per scene");

  // The deck names an upload with no document, so `hasAssetSource` refuses it — BEFORE the button
  // is live, which is the whole point of the estimate being a query. The refusal names the lever.
  await expect(estimate).toContainText("doesn't say what its picture is made from");
  await expect(estimate).not.toContainText("only VIDEO and IMAGE");
  await expect(page.getByTestId("media-generate")).toBeDisabled();
});

/* ═══ PHASE 33 — THE GUIDED-INTAKE CANVAS, END TO END, STILL FOR $0 ═══════════════════════════
 *
 * Everything above was ONE deck on a bare plan row. Phase 33 added four surfaces that no unit test
 * can see together: the brief the user can correct, TWO storyboards to choose between, a per-scene
 * citation that must name the VAULT's title rather than the model's, and the confirm gate that
 * holds the money door shut until the owner vouches for a figure the agent wrote.
 *
 * **Why a browser and not `mediaCanvas.test.ts`.** Those tests call the folds directly. The claim
 * here is the composition: that a flagged scene disables the button AND says how many, that the
 * SAME click that vouches for the figure opens the button, and that switching decks re-prices the
 * whole reel — three subscriptions, one layout, no reload.
 *
 * $0, and deliberately so. Every write below is a free mutation (`confirmClaim`, `switchDeck`,
 * `editBrief`) or an internal staging call. Generate is asserted ENABLED and never clicked: the
 * one thing on this page that spends is the one thing the owner does at the checkpoint.
 */

/** The vault row a verified citation points at. Its TITLE is the load-bearing part: the shot below
 *  cites it under a DIFFERENT, model-authored name, and the canvas must print this one. */
const CITED_DOC_TITLE = "Q3 support response times";
/** What the model wrote on the Source line. It must never reach the screen (`d69fc29`). */
const MODEL_AUTHORED_LABEL = "our internal numbers";

/** DECK A — 8 s clip + 12 s still + 10 s silent card = 30 s. Scene 0 cites a real document; scene 1
 *  states a figure the agent wrote and is flagged for confirmation; scene 2 claims nothing. */
const PICKED = (docId: string) => [
  {
    index: 0,
    visual: "generated_video",
    seconds: 8,
    windowStartMs: 0,
    description: "The support desk at 9am",
    prompt: "A support desk at opening time, warm morning light",
    narration: "Replies used to take us most of a day.",
    source: { docId, title: MODEL_AUTHORED_LABEL },
  },
  {
    index: 1,
    visual: "animated_image",
    seconds: 12,
    windowStartMs: 8_000,
    description: "The same queue, an hour later",
    prompt: "A clean support queue, teal accents, slow pan",
    narration: "Now the first reply lands in under an hour.",
    needsConfirmation: true,
  },
  {
    index: 2,
    visual: "text_card",
    seconds: 10,
    windowStartMs: 20_000,
    description: "The promise, held",
    overlay: "Under an hour.",
    prompt: "n/a",
    narration: "",
  },
];

/** DECK B — the genuinely different concept: four cheap scenes, no generated clip at all. Same 30
 *  seconds, and the price gap between the two is the cost lever the whole phase is about. */
const ALTERNATE = [
  {
    index: 0,
    visual: "animated_image",
    seconds: 9,
    windowStartMs: 0,
    description: "A hand-drawn clock, unwinding",
    prompt: "An illustrated clock unwinding, paper texture",
    narration: "A day of waiting, drawn one hour at a time.",
  },
  {
    index: 1,
    visual: "text_card",
    seconds: 6,
    windowStartMs: 9_000,
    description: "The old number",
    overlay: "A whole day.",
    prompt: "n/a",
    narration: "",
  },
  {
    index: 2,
    visual: "animated_image",
    seconds: 9,
    windowStartMs: 15_000,
    description: "The same clock, barely moved",
    prompt: "The same illustrated clock, barely moved",
    narration: "Now it is one hour.",
  },
  {
    index: 3,
    visual: "text_card",
    seconds: 6,
    windowStartMs: 24_000,
    description: "The new number",
    overlay: "One hour.",
    prompt: "n/a",
    narration: "",
  },
];

/** `$1.23` → `123`. The headline is the number a person decides on, so the deck comparison below
 *  asserts on its VALUE rather than on two strings being different. */
function cents(headline: string): number {
  const m = /\$([\d.]+)/.exec(headline);
  if (!m?.[1]) throw new Error(`Not a money headline: ${JSON.stringify(headline)}`);
  return Math.round(Number(m[1]) * 100);
}

test("the phase-33 canvas: brief chips, two storyboards, a grounded citation and the confirm gate", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await signIn(page);
  const cookie = (await page.context().cookies()).find((c) => c.name === "__convexAuthJWT");
  if (!cookie?.value) throw new Error("Signed in, but no Convex Auth JWT cookie was set.");
  const tenantId = tenantIdFrom(cookie.value);

  // ── STAGE EVERYTHING FIRST (the CLI ends the session — see `signIn`'s note) ─────────────────
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });

  // A real vault row for the citation to resolve against. `insertCreatedDoc` writes one WITHOUT
  // starting ingest — no rag entry, no graph nodes, no credits — which is all `sceneCitations`
  // needs: it asks `db.get` + tenant match, never search.
  const docId = returnedId(
    convexRun("vault:insertCreatedDoc", {
      tenantId,
      title: CITED_DOC_TITLE,
      form: "short",
      markdown: "First response time fell from 7h 40m to 52m across Q3.",
      contentHash: `e2e-${Date.now().toString(36)}`,
    }),
    "vault:insertCreatedDoc",
  );

  const threadId = `e2e-33-${Date.now().toString(36)}`;
  const staged = convexRun("plans:stageMediaPlan", {
    tenantId,
    threadId,
    subject: "A 30-second reel about response times",
  });
  const planId = /"planId":\s*"([^"]+)"/.exec(staged)?.[1];
  expect(planId, `stageMediaPlan returned no planId:\n${staged}`).toBeTruthy();

  convexRun("plans:persistDeck", {
    tenantId,
    planId,
    script: "A 30-second reel about answering faster.",
    artDirection: null,
    clipSeconds: 12,
    targetDurationSeconds: 30,
    shots: PICKED(docId),
    // The parked alternate — the whole reason the compare region exists.
    altShots: ALTERNATE,
    altTargetDurationSeconds: 30,
    // `audience` is the model's word, not the user's, and the chip must say so.
    brief: {
      topic: "Answering support in under an hour",
      durationSeconds: 30,
      audience: "Small business owners",
      tone: "Plain and direct",
      defaulted: ["audience"],
    },
  });

  await signIn(page);
  await page.goto(`/dashboard/workspace?thread=${threadId}&view=canvas`);
  const canvas = page.getByTestId("media-canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // ── THE BRIEF, AS CHIPS (33-07) ────────────────────────────────────────────────────────────
  const brief = page.getByTestId("media-brief");
  await expect(brief).toBeVisible();
  await expect(brief).toContainText("Answering support in under an hour");
  // Only two chips may block, and they say so in a WORD.
  await expect(brief).toContainText("Topic · required");
  await expect(brief).toContainText("Length · required");
  // The three Phase-11 blanks are present and NOT required — an idea-stage tenant is still admitted.
  await expect(brief).toContainText("Brand voice");
  await expect(brief).not.toContainText("Brand voice · required");
  // A model-filled value is marked as one. This is the provenance rule as a visible chip.
  await expect(brief).toContainText("from your profile");

  // Length is a PRESET, never a free-text field: exactly the three legal reel lengths, with the
  // current one pressed. A typed number is how an `illegal_duration` reaches the money gate.
  const presets = page.getByTestId("brief-duration-option");
  await expect(presets).toHaveCount(3);
  await expect(presets.nth(0)).toHaveText("15s");
  await expect(presets.nth(1)).toHaveText("30s");
  await expect(presets.nth(2)).toHaveText("60s");
  await expect(presets.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(presets.nth(0)).toHaveAttribute("aria-pressed", "false");

  // ── THE HERO SLOT EXISTS BEFORE THERE IS A REEL (33-06) ────────────────────────────────────
  // The slot is the layout's fixed point: the tracker lives in it now, the finished video lands in
  // the SAME box later. A surface that swapped one region for the other would jump the strip below
  // it down the page at the worst possible moment.
  const hero = page.getByTestId("media-hero");
  await expect(hero).toBeVisible();
  await expect(hero.getByTestId("media-tracker")).toBeVisible();
  for (const stage of ["Pictures", "Voice", "Assemble", "Captions"]) {
    await expect(hero).toContainText(stage);
  }
  // Nothing has been bought, so every stage is waiting and no player exists.
  await expect(page.getByTestId("media-final")).toHaveCount(0);

  // ── TWO STORYBOARDS, SIDE BY SIDE (33-07) ──────────────────────────────────────────────────
  const variations = page.getByTestId("media-variations");
  await expect(variations).toBeVisible();
  await expect(variations).toContainText("Two storyboards");
  await expect(variations).toContainText("Showing now");
  await expect(variations).toContainText("The other one");
  // Two genuinely different concepts, and the kind mix is what makes the difference legible —
  // three scenes with a generated clip against four cheap ones.
  await expect(variations).toContainText("3 scenes");
  await expect(variations).toContainText("4 scenes");
  await expect(variations).toContainText("1 × GENERATED CLIP");
  await expect(variations).toContainText("2 × TEXT CARD");

  // ── THE CITATION PLANE (33-08) ─────────────────────────────────────────────────────────────
  const tiles = page.getByTestId("media-block-tile");
  await expect(tiles).toHaveCount(3);
  const citations = page.getByTestId("scene-citation");
  // Two scenes claim something; the card claims nothing and gets NO provenance affordance — a chip
  // on creative copy trains the reader to ignore the ones that matter.
  await expect(citations).toHaveCount(2);

  // Scene 0: a VERIFIED citation renders the VAULT ROW'S OWN TITLE. The shot cites the same
  // document under a name the model invented, and that name must not reach the screen — a model
  // that can label a real document with its own words can launder a figure through the label.
  const citedDoc = page.getByTestId("scene-citation-doc");
  await expect(citedDoc).toHaveText(CITED_DOC_TITLE);
  await expect(canvas).not.toContainText(MODEL_AUTHORED_LABEL);
  await expect(citations.nth(0)).toContainText("Source:");

  // Scene 1: the agent's own figure, flagged, in words rather than a colour.
  await expect(citations.nth(1)).toContainText("Needs your confirmation:");
  await expect(citations.nth(1)).toContainText(
    "The agent wrote this figure. Confirm it to make it your word.",
  );

  // ── THE GATE IS SHUT, AND SAYS HOW MANY ────────────────────────────────────────────────────
  const estimate = page.getByTestId("media-estimate");
  const generate = page.getByTestId("media-generate");
  await expect(generate).toBeDisabled();
  await expect(page.getByTestId("media-confirm-block")).toHaveText(
    "Confirm 1 claim to enable Generate.",
  );

  // ── THE CITATION OPENS THE DOCUMENT, IN PLACE ──────────────────────────────────────────────
  // `api.vault.vaultDoc` answers `null` for a document that is not this tenant's, so the click-
  // through cannot be a cross-tenant read — and the dialog is what proves the chip is a control
  // rather than a decoration.
  await citedDoc.click();
  const preview = page.getByRole("dialog");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview).toContainText(CITED_DOC_TITLE);
  await page.getByRole("button", { name: "Close preview" }).first().click();
  await expect(preview).toHaveCount(0);

  // ── THE OWNER VOUCHES, AND ONLY THEN DOES THE DOOR OPEN ────────────────────────────────────
  await page.getByTestId("scene-citation-confirm").click();
  await expect(citations.nth(1)).toContainText("You confirmed this figure.", { timeout: 15_000 });
  await expect(page.getByTestId("media-confirm-block")).toHaveCount(0);
  // The confirm button is gone with the thing it confirmed — a control that can only answer
  // `not_a_claim` must not look like a control.
  await expect(page.getByTestId("scene-citation-confirm")).toHaveCount(0);
  await expect(generate).toBeEnabled({ timeout: 15_000 });

  // ── THE ESTIMATE, ONE HEADLINE OVER AN ITEMISED BREAKDOWN (33-06) ──────────────────────────
  const headline = page.getByTestId("media-total");
  const pickedHeadline = (await headline.innerText()).trim();
  expect(cents(pickedHeadline)).toBeGreaterThan(0);
  // The itemisation is inside a native `<details>`; Playwright reads through it, which is what
  // makes "demoted, not lost" checkable.
  await expect(estimate).toContainText("What makes up ");
  for (const line of ["clips", "stills", "voice", "captions", "render (incl. one retry)"]) {
    await expect(estimate).toContainText(line);
  }
  // The cost lever, on the line it applies to — the DERIVED sentence, whatever the tables say.
  await expect(estimate).toContainText(CLIP_COST_LEVER_NOTE);
  await expect(estimate).toContainText("A 30-second reel of 3 scenes, priced per scene");
  await expect(estimate).toContainText("of today's media budget remains.");
  await expect(estimate).not.toContainText("per block");

  // ── SWITCHING DECKS RE-PRICES THE REEL ─────────────────────────────────────────────────────
  await page.getByTestId("media-switch-deck").click();
  await expect(tiles).toHaveCount(4, { timeout: 15_000 });
  await expect(tiles.nth(0)).toContainText("ANIMATED STILL");
  await expect(tiles.nth(1)).toContainText("TEXT CARD");
  // The cheap concept costs less, and the whole page agrees about it: the strip, the compare card
  // and the headline all followed one `switchDeck` with no reload.
  const altHeadline = (await headline.innerText()).trim();
  expect(cents(altHeadline)).toBeLessThan(cents(pickedHeadline));
  await expect(estimate).toContainText("A 30-second reel of 4 scenes, priced per scene");
  // No generated clip in this deck, so there is no clips line to price. Asserted against the
  // DERIVED sentence: pinning the old "about 40×" literal here would have gone on passing for the
  // wrong reason once the ratio moved, because that exact string is no longer rendered at ANY
  // price — an absence assertion over a string nothing can produce is a check that cannot fail.
  await expect(estimate).not.toContainText(CLIP_COST_LEVER_NOTE);

  // ── AN EDITED CHIP MARKS THE DECK STALE AND FIRES NOTHING (33-07) ───────────────────────────
  // The badge is a statement, not a trigger: the re-propose beside it costs a model turn, and this
  // repo's rule is that a spend follows a click.
  await expect(page.getByTestId("media-brief-stale")).toHaveCount(0);
  await brief.getByTestId("brief-chip-edit").first().click();
  await brief
    .getByLabel("Topic", { exact: true })
    .fill("Answering support in under thirty minutes");
  await brief.getByRole("button", { name: "Save" }).click();
  const stale = page.getByTestId("media-brief-stale");
  await expect(stale).toBeVisible({ timeout: 15_000 });
  await expect(stale).toContainText("Brief changed — storyboards may be out of date.");
  // FREE, and it says so on the control itself.
  await expect(page.getByTestId("media-repropose")).toHaveText("Re-propose (free)");
  // The deck did not re-propose itself: the strip is still the one the user switched to.
  await expect(tiles).toHaveCount(4);
});
