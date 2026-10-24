import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HAS_PLACEHOLDERS, LEGAL_REVIEW_DEFERRED, OWNER_REVIEWED_DATE } from "./legal";
import Privacy from "./privacy/page";
import Terms from "./terms/page";

describe("owner-confirmed facts do not complete legal review", () => {
  it.each([
    { label: "Privacy", Page: Privacy },
    { label: "Terms", Page: Terms },
  ])("keeps $label visibly draft after identity placeholders are removed", ({ Page }) => {
    // The prior placeholder-only condition hid the draft as soon as the last optional field went.
    expect(HAS_PLACEHOLDERS).toBe(false);
    expect(LEGAL_REVIEW_DEFERRED).toBe(true);
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain("Dar es Salaam, Tanzania");
    expect(html).toContain("Draft — not yet in force.");
    expect(html).toContain("Owner review only");
    expect(html).toContain(OWNER_REVIEWED_DATE);
    expect(html).toContain("has not been reviewed by a qualified lawyer");
  });
});
