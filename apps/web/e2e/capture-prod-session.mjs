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

import { spawn } from "node:child_process";
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

/** Is a CDP endpoint answering yet? */
const cdpUp = async (url) => {
  try {
    const r = await fetch(new URL("/json/version", url), { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
};

// SELF-LAUNCH, because the two-step version was the fragile part. Previously this needed Chrome
// started by hand with the right flags first, and the failure mode of getting that wrong looked
// identical to a failed sign-in.
//
// It launches REAL CHROME and merely ATTACHES, rather than letting Playwright launch a browser
// itself: Google can refuse OAuth in an automation-controlled browser, and this is the one step
// that must survive a Google sign-in.
//
// A SEPARATE `--user-data-dir` IS MANDATORY, not a preference. Since Chrome 136 the
// `--remote-debugging-port` flag is SILENTLY IGNORED on the default profile — no error, no port,
// Chrome just starts. Three attempts were spent on that before checking the version.
// The profile PERSISTS, so the sign-in is once per machine, not once per run.
if (CDP && !(await cdpUp(CDP))) {
  const port = new URL(CDP).port || "9222";
  const profile =
    process.env.PIKAR_E2E_CHROME_PROFILE ??
    resolve(dirname(fileURLToPath(import.meta.url)), ".auth/chrome-profile");
  mkdirSync(profile, { recursive: true });
  const exe = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  console.log(`[capture] no CDP on ${CDP} — launching Chrome with profile ${profile}`);
  spawn(
    exe,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      `${APP}/dashboard/workspace`,
    ],
    { detached: true, stdio: "ignore" },
  ).unref();

  const deadline = Date.now() + 30_000;
  while (!(await cdpUp(CDP))) {
    if (Date.now() > deadline) throw new Error(`Chrome never opened a CDP port on ${CDP}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (CDP) {
  console.log(`[capture] attaching to Chrome at ${CDP}`);
  console.log(
    "[capture] IF THE PAGE IS NOT SIGNED IN, SIGN IN NOW — this profile is separate from",
  );
  console.log("[capture] your everyday Chrome and does not inherit its session.");
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
// WAIT FOR THE PROOF, NOT FOR THE PAINT. Waiting on the pane and THEN asserting the token would
// fail instantly against a browser nobody has signed into yet — which is the normal starting state
// of a fresh profile, and the exact case this script exists to serve. Polling the real signal gives
// the human the whole window to sign in, and cannot succeed early for the wrong reason.
const deadlineAt = Date.now() + SIGN_IN_TIMEOUT_MS;
let signedIn = false;
while (Date.now() < deadlineAt) {
  signedIn = await page
    .evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("__convexAuthJWT_")))
    .catch(() => false);
  if (signedIn) break;
  await new Promise((r) => setTimeout(r, 1500));
}
if (!signedIn) {
  throw new Error(
    "no __convexAuthJWT_* appeared before the timeout — nobody completed sign-in in that window",
  );
}
// RE-NAVIGATE, because the tab is no longer where we left it. The first `goto` happens BEFORE
// sign-in, so an unauthenticated visit bounces through the auth flow and lands on `/dashboard` —
// not the workspace route, and `workspace-pane` exists only on the latter. Waiting on the pane
// without coming back here just times out against a perfectly healthy signed-in app.
await page.goto(`${APP}/dashboard/workspace`, { waitUntil: "domcontentloaded" });

// Only now is waiting on the pane meaningful: the session exists and we are on the right route, so
// this waits for the app to finish rendering rather than standing in for authentication.
await page.getByTestId("workspace-pane").waitFor({ timeout: 60_000 });

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
