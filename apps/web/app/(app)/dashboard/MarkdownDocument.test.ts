import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownDocument } from "./MarkdownDocument";

const PLAN = `## Objectives

1. **Establish Clear Communication Channels:** Foster transparent communication.
2. **Streamline Processes:** Improve efficiency.

### Week 1: Assessment
- **Conduct Team Meetings:** Assess current workflows.
- **Review Company Policies:** Identify improvements.

| Goal | Key Actions | Timeline |
|------|-------------|----------|
| Clear Communication | Team meetings | Week 1 |
| Streamlined Processes | SOP development | Weeks 2-3 |`;

describe("MarkdownDocument", () => {
  it("renders agent markdown as semantic content without exposing formatting markers", () => {
    const html = renderToStaticMarkup(createElement(MarkdownDocument, { markdown: PLAN }));

    expect(html).toContain("<h2>Objectives</h2>");
    expect(html).toContain("<h3>Week 1: Assessment</h3>");
    expect(html).toContain("<strong>Establish Clear Communication Channels:</strong>");
    expect(html).toContain("<ol");
    expect(html).toContain("<ul>");
    expect(html).toContain('<div class="markdown-table-scroll"');
    expect(html).toContain("<table>");
    expect(html).toContain("<th scope=\"col\">Goal</th>");
    expect(html).not.toContain("## Objectives");
    expect(html).not.toContain("**Establish");
    expect(html).not.toContain("| Goal |");
  });

  it("never evaluates model-authored HTML", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownDocument, {
        markdown: '## Safe\n\n<script>alert("unsafe")</script>',
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
