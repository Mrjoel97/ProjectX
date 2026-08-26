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

import { mkdirSync } from "node:fs";
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

// The workspace pane is the signal, NOT the URL: an unauthenticated visit to /dashboard/workspace
// redirects to sign-in and can bounce BACK to the same path mid-flow, so a URL check can report
// success while the page is still a login screen. The pane only renders for an authenticated
// tenant, which is exactly the condition the evidence run needs.
await page.getByTestId("workspace-pane").waitFor({ timeout: SIGN_IN_TIMEOUT_MS });

mkdirSync(dirname(OUT), { recursive: true });
await context.storageState({ path: OUT });

console.log(`[capture] session saved -> ${OUT}`);
console.log("[capture] this file is a live credential. Delete it when the evidence run is done.");

// An ATTACHED browser is YOURS — closing it would shut the windows you are working in. Only a
// browser this script launched is a browser this script may close.
if (!CDP) await browser.close();
