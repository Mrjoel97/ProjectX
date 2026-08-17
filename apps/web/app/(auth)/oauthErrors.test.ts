// A SOURCE-LEVEL guard, and deliberately labelled as one: it reads the two auth pages as text and
// asserts a shape. It is NOT behavioural evidence — it does not render, click, or observe a
// message reaching a user. The repository's DOM-free runner renders to static markup, which never
// executes an onClick handler, so a real assertion would need the browser (`e2e/`), and the thing
// being guarded here is worth less than a Playwright run.
//
// WHAT IT GUARDS, AND WHY THAT IS WORTH A FILE: both pages used
// `onClick={() => void signIn(…)}`. `void` discards the promise, so a rejected sign-in produced
// no redirect, no message and no console entry — a button that did nothing, which a user cannot
// distinguish from a dead page. That shape is a one-character edit away at all times and reads as
// perfectly idiomatic in review, which is exactly why it needs a mechanical check rather than
// vigilance.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pages = {
  signin: readFileSync(join(here, "signin/page.tsx"), "utf8"),
  signup: readFileSync(join(here, "signup/page.tsx"), "utf8"),
};

describe("OAuth sign-in failures are surfaced, never swallowed", () => {
  for (const [name, src] of Object.entries(pages)) {
    // Strip block comments first: both files DESCRIBE the old `void signIn(` shape in prose, and a
    // naive scan would match its own explanation and pass forever.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "");

    test(`${name}: no OAuth call site discards its promise`, () => {
      expect(code).not.toMatch(/void\s+signIn\(/);
    });

    test(`${name}: every signIn is awaited inside a try that reports on catch`, () => {
      // Each `signIn(` in code (not comments) must be awaited...
      const calls = code.match(/signIn\(/g) ?? [];
      const awaited = code.match(/await\s+signIn\(/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      expect(awaited.length).toBe(calls.length);

      // ...and every catch block in these pages must put something on screen rather than
      // swallowing. `setError` is the pages' only user-visible error channel.
      const catches = code.match(/catch\s*\{/g) ?? [];
      const setErrorCalls = code.match(/setError\(/g) ?? [];
      expect(catches.length).toBeGreaterThan(0);
      expect(setErrorCalls.length).toBeGreaterThanOrEqual(catches.length);
    });

    test(`${name}: the OAuth handler exists and is the one wired to the buttons`, () => {
      expect(code).toMatch(/async function onOAuth\(/);
      expect(code).toMatch(/onClick=\{\(\) => void onOAuth\(/);
    });
  }
});
