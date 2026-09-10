import type { VerticalRecommendation } from "@pikar/core/verticalPacks";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { VerticalRecommendationCards } from "./VerticalPackRecommendations";

vi.mock("convex/react", () => ({ useQuery: vi.fn(), useMutation: vi.fn(), useAction: vi.fn() }));

const available: VerticalRecommendation = {
  id: "engineering",
  workflowId: "engineering-runbook-review",
  state: "available",
  reason: "confirmed-repeat-workflow",
  missingSources: [],
};
const render = (
  recommendations: readonly VerticalRecommendation[] | undefined,
  starting: "engineering" | null = null,
) =>
  renderToStaticMarkup(
    createElement(VerticalRecommendationCards, {
      recommendations,
      starting,
      notice: null,
      onStart: vi.fn(),
      onDisable: vi.fn(),
    }),
  );

describe("contextual vertical recommendations", () => {
  test("loading, no evidence and hidden candidates expose no catalogue", () => {
    expect(render(undefined)).toBe("");
    expect(render([])).toBe("");
    expect(render([{ ...available, state: "hidden", reason: "not-released" }])).toBe("");
  });
  test("renders at most two server-selected cards and keeps review wording", () => {
    const html = render([
      available,
      { ...available, id: "legal", workflowId: "legal-contract-issues" },
      { ...available, id: "hr", workflowId: "hr-onboarding-materials" },
    ]);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain("qualified counsel review");
    expect(html).toContain("no tests or deployments run");
    expect(html).not.toContain("Prepare onboarding materials");
    expect(html).not.toContain("vertical-engineering");
  });
  test("blocked and disabled states cannot start and explain the required source", () => {
    const blocked = render([
      { ...available, state: "blocked", reason: "missing-source", missingSources: ["vault"] },
    ]);
    expect(blocked).toContain('href="/dashboard/vault"');
    expect(blocked).not.toContain("Start workflow");
    const disabled = render([{ ...available, state: "disabled", reason: "disabled" }]);
    expect(disabled).toContain("Your saved documents remain available");
    expect(disabled).not.toContain("<button");
  });
  test("busy state disables actions across both recommendations", () => {
    const html = render(
      [available, { ...available, id: "product", workflowId: "product-prd-brief" }],
      "engineering",
    );
    expect(html).toContain("Starting…");
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });
});
