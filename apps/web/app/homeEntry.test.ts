// Phase 25.2 item 10 (G16): the home page says what the beta is and sends strangers to the
// waitlist door that already exists, not to a mail client.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const hero = src.slice(src.indexOf('<header className="hero">'), src.indexOf("</header>"));

describe("the home page entry path", () => {
  test("the eyebrow names the private beta before the first button", () => {
    expect(hero).toMatch(/eyebrow">Private beta · by invitation/);
  });
  test("Request access is the /signup waitlist door, and no CTA is a mailto", () => {
    const ctas = hero.slice(
      hero.indexOf('<div className="cta-row">'),
      hero.indexOf("</div>", hero.indexOf('<div className="cta-row">')),
    );
    expect(ctas).toContain('href="/signup"');
    expect(ctas).not.toContain("mailto:");
    expect(ctas).toContain('href="/signin"');
    expect(ctas).toContain('href="#how"');
  });
  test("the footer contact mailto stays — it is contact, not admission", () => {
    expect(src.slice(src.indexOf("<footer"))).toContain("mailto:");
  });
});
