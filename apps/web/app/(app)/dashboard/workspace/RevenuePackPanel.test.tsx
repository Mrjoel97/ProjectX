import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

import {
  type RevenueWorkflowOffer,
  RevenuePackPanelView,
} from "./RevenuePackPanel";

const offer = (over: Partial<RevenueWorkflowOffer> = {}): RevenueWorkflowOffer => ({
  id: "lead-triage",
  provider: "hubspot",
  providerLabel: "HubSpot",
  title: "Lead triage",
  summary: "Rank the people who need attention from current CRM facts.",
  opener: "Review my HubSpot leads and rank who needs attention.",
  skill: { name: "revenue-lead-triage", version: 1 },
  runtimeSkill: { name: "revenue-specialist", version: 1 },
  ...over,
});

describe("RevenuePackPanelView", () => {
  test("keeps loading distinct from an empty passed-provider projection", () => {
    expect(renderToStaticMarkup(<RevenuePackPanelView offers={undefined} onStart={() => {}} />))
      .toContain("Checking revenue workflow availability");
    expect(renderToStaticMarkup(<RevenuePackPanelView offers={[]} onStart={() => {}} />)).toBe("");
  });

  test("renders one independently passed provider while absent providers stay absent", () => {
    const html = renderToStaticMarkup(
      <RevenuePackPanelView offers={[offer()]} onStart={() => {}} />,
    );

    expect(html).toContain("Lead triage");
    expect(html).toContain("HubSpot");
    expect(html).toContain("Start Lead triage");
    expect(html).not.toContain("QuickBooks");
    expect(html).not.toContain("Stripe");
    expect(html).not.toContain("PayPal");
  });

  test("renders only the exact active pins supplied by the server", () => {
    const html = renderToStaticMarkup(
      <RevenuePackPanelView
        offers={[
          offer(),
          offer({
            id: "call-list",
            title: "Call list",
            opener: "Build my HubSpot call list from current follow-ups.",
            skill: { name: "revenue-call-list", version: 1 },
          }),
        ]}
        onStart={() => {}}
      />,
    );

    expect(html).toContain("Lead triage");
    expect(html).toContain("Call list");
    expect(html).not.toContain("Pipeline review");
    expect(html).not.toContain("Cash flow");
    expect(html).not.toContain("Invoice reminder");
  });

  test("uses non-color-only provider and readiness copy", () => {
    const html = renderToStaticMarkup(<RevenuePackPanelView offers={[offer()]} onStart={() => {}} />);
    expect(html).toContain("HubSpot read-only");
    expect(html).toContain("Ready from passed live evidence");
  });
});
