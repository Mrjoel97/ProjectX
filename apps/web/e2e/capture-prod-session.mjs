// Capture a SIGNED-IN session against a deployment this harness cannot sign into by itself.
//
// WHY THIS EXISTS. The pack browser-evidence plane needs a real signed-in session, and evidence
// lives on ONE deployment's skills row — so a dev browser run certifies nothing on production.
// But production cannot be provisioned the way local is: `provision-owner.setup.ts` hard-refuses
// any non-local deployment, prod carries the invite gate so there is no open signup, and the one
// human account on it is a GOOGLE identity that no password form and no fixture can drive.
//
// So the human signs in, and this only WATCHES. It types nothing, reads no credential, and knows
// no password. It opens a browser, waits for you to arrive at the workspace under your own
// authentication, and writes the resulting session state to a gitignored file.
//
// THIS IS DELIBERATELY NOT AUTOMATED FURTHER. The alternative considered was creating a dedicated
// owner-privileged password account on live production and revoking it afterwards. That means
// relaxing a guard added on purpose and putting a second owner on a live system, however briefly.
// Watching a human sign in costs two minutes and risks nothing.
//
//   node e2e/capture-prod-session.mjs
//   PIKAR_E2E_BASE_URL=https://www.pikar-ai.com node e2e/capture-prod-session.mjs
//
// The output file IS A LIVE SESSION — treat it as a credential. `/e2e/.auth/` is gitignored;
// delete it when the run is done.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const APP = process.env.PIKAR_E2E_BASE_URL ?? "https://www.pikar-ai.com";
const OUT =
  process.env.PIKAR_E2E_STORAGE_STATE ??
  resolve(dirname(fileURLToPath(import.meta.url)), ".auth/prod-owner.json");

// Generous: a real human is doing an OAuth round trip, possibly with 2FA, possibly on a phone.
// Failing at 30s would just mean running it again.
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

// TWO WAYS IN, because signing in again is the thing worth avoiding.
//
// ATTACH (preferred): connect to a Chrome you ALREADY have open and signed in, started with
// `--remote-debugging-port`. Nothing is typed, no OAuth round trip happens, and the session that
// gets captured is the one you are already using. Playwright still runs the evidence spec
// afterwards, so the run remains a real `playwright:pack` run — the gate's `runner` claim stays
// true, which is the whole reason we are not just driving the browser by hand.
//
// LAUNCH (fallback): open a fresh browser and wait for you to sign in inside it. Google can refuse
// OAuth in an automation-controlled browser, which is exactly why ATTACH exists.
const CDP = process.env.PIKAR_E2E_CDP; // e.g. http://127.0.0.1:9222

let browser;
let context;
let page;

if (CDP) {
  console.log(`[capture] attaching to your open Chrome at ${CDP}`);
  browser = await chromium.connectOverCDP(CDP);
  // An attached Chrome always has its real profile as context[0]. A NEW context would be a fresh
  // incognito-like profile with none of your cookies — the one thing we came here for.
  context = browser.contexts()[0];
  if (!context) throw new Error("attached Chrome exposed no browser context");
  page = context.pages()[0] ?? (await context.newPage());
} else {
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext();
  page = await context.newPage();
}

console.log(`[capture] opening ${APP}`);
if (!CDP) console.log("[capture] SIGN IN in the browser window that just opened.");
console.log("[capture] waiting for the workspace to load, then saving the session…");

await page.goto(`${APP}/dashboard/workspace`, { waitUntil: "domcontentloaded" });

// The pane is a WAIT, NOT A PROOF — an earlier version of this comment claimed it "only renders for
// an authenticated tenant" and that was WRONG. The shell paints before auth resolves, so the pane
// appeared in a browser that had never completed sign-in, the capture reported success, and every
// spec then failed at its first assertion looking exactly like an expired session.
// Better than the URL (which bounces through sign-in and back), but the ONLY proof of a session is
// the `__convexAuthJWT_*` key asserted after the harvest below. Do not restore this to a proof.
await page.getByTestId("workspace-pane").waitFor({ timeout: SIGN_IN_TIMEOUT_MS });

// HARVEST localStorage FROM THE PAGE, do not trust `storageState()` alone.
//
// On a CDP-ATTACHED persistent context, `context.storageState()` returns the cookies but does NOT
// reliably serialize localStorage: a capture of a demonstrably signed-in page came back with the
// app's own keys and WITHOUT `__convexAuthJWT_*` / `__convexAuthRefreshToken_*`. Convex Auth keeps
// the session in localStorage, so that file authenticated nothing and every spec failed at the
// first `workspace-pane` assertion — a failure that reads exactly like an expired session.
//
// Reading it from the page is the source of truth: this is the same tab that just rendered the
// workspace, so whatever is here IS the live session.
mkdirSync(dirname(OUT), { recursive: true });
const state = await context.storageState();
const harvested = await page.evaluate(() =>
  Object.entries(localStorage).map(([name, value]) => ({ name, value: String(value) })),
);
const originUrl = new URL(page.url()).origin;
const existing = state.origins.find((o) => o.origin === originUrl);
if (existing) existing.localStorage = harvested;
else state.origins.push({ origin: originUrl, localStorage: harvested });
writeFileSync(OUT, JSON.stringify(state, null, 2));

// Fail loudly rather than write a file that silently authenticates nothing.
const authKeys = harvested.filter((kv) => kv.name.startsWith("__convexAuthJWT_"));
if (authKeys.length === 0) {
  throw new Error(
    "captured no __convexAuthJWT_* key — the page is not signed in, or storage was unreadable",
  );
}

console.log(`[capture] session saved -> ${OUT}`);
console.log("[capture] this file is a live credential. Delete it when the evidence run is done.");

// An ATTACHED browser is YOURS — closing it would shut the windows you are working in. Only a
// browser this script launched is a browser this script may close.
if (!CDP) await browser.close();
