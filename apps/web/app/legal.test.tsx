import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_REVIEWED_DATE } from "./legal";
import Privacy from "./privacy/page";
import Terms from "./terms/page";

const publication = vi.hoisted(() => ({ approved: true, deferred: false, unresolved: false }));
vi.mock("./legal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./legal")>()),
  get OWNER_APPROVED_PUBLICATION() {
    return publication.approved;
  },
  get LEGAL_REVIEW_DEFERRED() {
    return publication.deferred;
  },
  get HAS_PLACEHOLDERS() {
    return publication.unresolved;
  },
}));
beforeEach(async () => {
  // Start from the real publication decision; only the negative-path cases override it.
  const actual = await vi.importActual<typeof import("./legal")>("./legal");
  publication.approved = actual.OWNER_APPROVED_PUBLICATION;
  publication.deferred = actual.LEGAL_REVIEW_DEFERRED;
  publication.unresolved = actual.HAS_PLACEHOLDERS;
});
const pages = [
  { label: "Privacy", Page: Privacy },
  { label: "Terms", Page: Terms },
];

describe("explicit owner-approved policy publication", () => {
  it.each(pages)("publishes $label with owner approval and the effective date", ({ Page }) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain("Dar es Salaam, Tanzania");
    expect(html).toContain("Effective 24 October 2026");
    expect(html).toContain(`Published with owner approval on ${OWNER_REVIEWED_DATE}`);
    expect(html).not.toContain("Draft — not yet in force.");
    expect(html).not.toContain("qualified lawyer");
    expect(html).not.toContain("legal certification");
  });

  it.each(pages)("keeps $label draft when identifying facts are genuinely unresolved", ({
    Page,
  }) => {
    publication.unresolved = true;
    expect(renderToStaticMarkup(<Page />)).toContain("Draft — not yet in force.");
  });

  it.each(pages)("keeps $label draft when publication is explicitly deferred", ({ Page }) => {
    publication.deferred = true;
    expect(renderToStaticMarkup(<Page />)).toContain("Draft — not yet in force.");
  });

  it.each(pages)("does not infer $label publication approval from filled fields", ({ Page }) => {
    publication.approved = false;
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain("Draft — not yet in force.");
    expect(html).not.toContain("Published with owner approval");
  });
});
