#!/usr/bin/env node
/** Owner-run, tenant-free browser image bake. Never runs during an application build or request.
 * Uses existing project-scoped Vercel OIDC, never a team administrative token.
 * SDK 2.9.2 node22 uses Amazon Linux 2023; verify that before invoking dnf. Upgrading to SDK3's
 * Ubuntu defaults needs a separately reviewed installer, not a silent platform substitution.
 * Reference: https://vercel.com/templates/next.js/hyperframes-on-vercel (Chromium dnf libraries).
 * Playwright downloads its own revision-matched Chromium from the official distribution.
 * Run from apps/web with a fresh project-scoped OIDC environment after authorizing compute usage.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Sandbox } from "@vercel/sandbox";

export const BROWSER_BAKE_TIMEOUT_MS = 10 * 60 * 1000;
export const BROWSER_SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PLAYWRIGHT_VERSION = "1.61.1";
const ROOT = "/opt/pikar-browser";
const env = { PLAYWRIGHT_BROWSERS_PATH: `${ROOT}/browsers` };

export async function bakePresenceBrowserSnapshot({ createSandbox, log = console.log }) {
  const sandbox = await createSandbox({ runtime: "node22", networkPolicy: "allow-all", persistent: false,
    resources: { vcpus: 2 }, timeout: BROWSER_BAKE_TIMEOUT_MS, snapshotExpiration: BROWSER_SNAPSHOT_TTL_MS });
  const step = async (label, cmd, args, options = {}) => {
    const result = await sandbox.runCommand({ cmd, args, ...options });
    if (result.exitCode !== 0) throw Error(`BROWSER_BAKE_FAILED:${label}`);
    log(`Completed: ${label}`);
  };
  try {
    await step("verify-platform", "node", ["-e", "const fs=require('fs');const os=fs.readFileSync('/etc/os-release','utf8');if(!/^ID=\"?amzn\"?$/m.test(os)||!/^VERSION_ID=\"?2023\"?$/m.test(os))process.exit(1)"]);
    await step("install-chromium-libraries", "dnf", ["install", "-y", "--setopt=install_weak_deps=False",
      "nss", "nspr", "atk", "at-spi2-atk", "cups-libs", "libdrm", "libxkbcommon", "libXcomposite",
      "libXdamage", "libXext", "libXfixes", "libXrandr", "mesa-libgbm", "alsa-lib", "pango",
      "dejavu-sans-fonts", "dejavu-serif-fonts"], { sudo: true });
    await step("create-browser-directory", "mkdir", ["-p", ROOT], { sudo: true });
    await step("write-package-manifest", "node", ["-e", `require('fs').writeFileSync('${ROOT}/package.json',JSON.stringify({private:true,dependencies:{playwright:'${PLAYWRIGHT_VERSION}'}}))`], { sudo: true });
    await step("install-pinned-playwright", "npm", ["install", "--prefix", ROOT, "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"], { sudo: true });
    // install-deps is apt-based; AL2023 dependencies above are installed explicitly instead.
    await step("install-pinned-chromium", "node", [`${ROOT}/node_modules/playwright/cli.js`, "install", "chromium"], { sudo: true, env });
    const smoke = `const {createRequire}=require('module');const req=createRequire('${ROOT}/package.json');if(req('playwright/package.json').version!=='${PLAYWRIGHT_VERSION}')throw Error('VERSION');(async()=>{const browser=await req('playwright').chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});await page.setContent('<!doctype html><html><body><h1>Browser image verification</h1></body></html>');if(await page.locator('h1').textContent()!=='Browser image verification')throw Error('DOM');if(!await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches))throw Error('MOTION');const image=await page.screenshot({type:'jpeg'});if(image.length<100)throw Error('SCREENSHOT')}finally{await browser.close()}})().catch(()=>process.exit(1));`;
    await step("verify-browser-launch-dom-and-screenshot", "node", ["-e", smoke], { env });
    const snapshot = await sandbox.snapshot({ expiration: BROWSER_SNAPSHOT_TTL_MS });
    return { snapshotId: snapshot.snapshotId, playwrightVersion: PLAYWRIGHT_VERSION, expiresAfterMs: BROWSER_SNAPSHOT_TTL_MS };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.VERCEL_OIDC_TOKEN) {
    console.error("A fresh project-scoped Vercel OIDC session is required. No snapshot was created.");
    process.exitCode = 1;
  } else {
    bakePresenceBrowserSnapshot({ createSandbox: (options) => Sandbox.create(options) })
      .then((result) => console.log(JSON.stringify({ ...result, setting: "PRESENCE_BROWSER_SNAPSHOT_ID" })))
      .catch(() => { console.error("Browser snapshot preparation failed. No usable snapshot was confirmed."); process.exitCode = 1; });
  }
}
