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

  it("gives YouTube data shorter retention and deletion deadlines than general account data", () => {
    const text = renderToStaticMarkup(<Privacy />)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");
    expect(text).toContain("YouTube-specific limits override the general retention periods.");
    expect(text).toContain("metadata must be refreshed or deleted within 30 calendar days");
    expect(text).toContain("immediately request token revocation from Google");
    expect(text).toContain("deleted as soon as possible and within 7 calendar days");
    expect(text).toContain("same 7-calendar-day deadline applies when you request deletion");
    expect(text).toContain("or erase your Pikar account");
    expect(text).toContain("If you revoke through Google Account connections instead");
    expect(text).toContain("within 30 calendar days; authorisation must be periodically checked");
    expect(text).toContain("deadlines take precedence over the one-month response period");
  });

  it("distinguishes independent customer content and unverified historical YouTube deletion", () => {
    const text = renderToStaticMarkup(<Privacy />)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");
    expect(text).toContain("original drafts or media you supplied independently");
    expect(text).toContain("does not delete videos on YouTube");
    expect(text).toContain("data remains unavailable to agents");
    expect(text).toContain("restricted pending platform and retention checks");
    expect(text).toContain("not verified removal of every historical copy");
    expect(text).toContain("message alone does not confirm that verification");
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
