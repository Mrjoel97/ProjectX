import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import {
  OnlinePresenceCard,
  type OnlinePresenceCardData,
  OnlinePresenceCardView,
} from "./OnlinePresenceCard";

const artifact = {
  projectId: "project-one",
  version: 3,
  contentHash: "a".repeat(64),
  projectUrl: "/dashboard/sites?project=project-one",
  publicationRequiresExactVersionApproval: true,
  projectRevision: 4,
} as NonNullable<OnlinePresenceCardData["artifact"]>;
const render = (session: OnlinePresenceCardData | null | undefined) =>
  renderToStaticMarkup(<OnlinePresenceCardView session={session} />);

describe("OnlinePresenceCard", () => {
  test("identifies a storefront receipt as presentation only and keeps checkout authority in Sites", () => {
    const html = render({
      status: "awaiting_review",
      artifact: { ...artifact, kind: "storefront" },
      assessment: null,
    });
    expect(html).toContain("Your shop draft");
    expect(html).toContain("Shop draft version 3 · Draft");
    expect(html).toContain("Test checkout requires a verified merchant connection");
    expect(html).toContain("Review shop draft version 3");
    expect(html).toContain('href="/dashboard/sites?project=project-one&amp;version=3"');
    expect(html).not.toContain("finished draft");
    expect(html).not.toContain("<button");
    const published = render({
      status: "awaiting_review",
      artifact: { ...artifact, kind: "storefront", approvedVersion: 3, publishedVersion: 3 },
      assessment: null,
    });
    expect(published).toContain("Presentation published");
    expect(published).toContain("Test checkout requires a verified merchant connection");
    expect(published).not.toContain("working shop");
  });
  test("keeps absence and loading distinct and reads the current thread", () => {
    expect(render(null)).toBe("");
    expect(render(undefined)).toContain("Checking your online presence");
    vi.mocked(useQuery).mockReturnValue(null);
    expect(renderToStaticMarkup(<OnlinePresenceCard threadId="thread-one" />)).toBe("");
    expect(useQuery).toHaveBeenCalledWith(api.onlinePresence.sessionForThread, {
      threadId: "thread-one",
    });
  });

  test("shows missing business details and a ready brief without inventing an artifact", () => {
    const collecting = render({
      status: "collecting",
      artifact: null,
      assessment: {
        ok: false,
        warnings: [],
        missing: [
          {
            field: "headline",
            reason: "missing",
            question: "What should your website communicate?",
          },
        ],
      },
    });
    expect(collecting).toContain("Gathering business details");
    expect(collecting).toContain("What should your website communicate?");
    expect(collecting).not.toContain("Review website version");
    const ready = render({ status: "ready", artifact: null, assessment: null });
    expect(ready).toContain("Ready to build");
    expect(ready).not.toContain("Published");
  });

  test("links the exact built draft to human review and exposes no approval or publication action", () => {
    const html = render({ status: "awaiting_review", artifact, assessment: null });
    expect(html).toContain("Ready for your review");
    expect(html).toContain("Website version 3 · Draft");
    expect(html).toContain('href="/dashboard/sites?project=project-one&amp;version=3"');
    expect(html).toContain("Review website version 3");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Published");
    expect(html).not.toContain("aaaaaaaa");
  });

  test("claims approval and publication only for the matching server version", () => {
    const stale = render({
      status: "awaiting_review",
      artifact: { ...artifact, approvedVersion: 2, publishedVersion: 2 },
      assessment: null,
    });
    expect(stale).toContain("Website version 3 · Draft");
    expect(stale).not.toContain("Version 3 is published");
    const approved = render({
      status: "awaiting_review",
      artifact: { ...artifact, approvedVersion: 3 },
      assessment: null,
    });
    expect(approved).toContain("Version 3 is approved");
    expect(approved).not.toContain("Version 3 is published");
    const published = render({
      status: "awaiting_review",
      artifact: { ...artifact, approvedVersion: 3, publishedVersion: 3 },
      assessment: null,
    });
    expect(published).toContain("Version 3 is published");
  });

  test("states the unavailable shop boundary without implying a working shop exists", () => {
    const html = render({ status: "blocked", artifact: null, assessment: null });
    expect(html).toContain("Shop service unavailable");
    expect(html).toContain("Checkout, payments and fulfilment are not ready");
    expect(html).not.toContain("Review website version");
  });

  test("keeps missing and newer editor artifacts distinct from the version on the card", () => {
    const missing = render({ status: "awaiting_review", artifact: null, assessment: null });
    expect(missing).toContain("Checking the saved package");
    expect(missing).not.toContain("Ready for your review");
    const newer = render({
      status: "awaiting_review",
      artifact: { ...artifact, currentDraftVersion: 5 },
      assessment: null,
    });
    expect(newer).toContain("The editor now has version 5. This card refers to version 3.");
    expect(newer).toContain('href="/dashboard/sites?project=project-one&amp;version=3"');
  });
});
