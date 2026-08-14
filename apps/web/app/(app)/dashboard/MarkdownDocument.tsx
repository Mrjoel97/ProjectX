// biome-ignore-all lint/suspicious/noArrayIndexKey: Markdown tokens are immutable display output;
// they are replaced as one document and never reordered or carry component state.
"use client";

import { inlineRuns, tokenizeMarkdown } from "@pikar/core";
import type { ReactNode } from "react";

function InlineMarkdown({ text }: { text: string }) {
  return inlineRuns(text).map((run, index) =>
    run.bold ? <strong key={index}>{run.text}</strong> : run.text,
  );
}

function tableCells(row: string[], count: number): string[] {
  return Array.from({ length: count }, (_, index) => row[index] ?? "");
}

/**
 * Safe renderer for agent-authored Markdown. It consumes the same portable tokenizer used by the
 * PDF/HTML document pipeline, so the workspace canvas, vault preview, and exported artifact agree
 * about headings, emphasis, lists, and tables. No model-authored HTML is ever evaluated.
 */
export function MarkdownDocument({
  markdown,
  compact = false,
}: {
  markdown: string;
  compact?: boolean;
}) {
  const tokens = tokenizeMarkdown(markdown);
  const blocks: ReactNode[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;

    if (token.kind === "bullet") {
      const items: { kind: "bullet"; text: string }[] = [];
      const start = index;
      while (index < tokens.length && tokens[index]?.kind === "bullet") {
        items.push(tokens[index] as { kind: "bullet"; text: string });
        index++;
      }
      index--;
      blocks.push(
        <ul key={`bullets-${start}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineMarkdown text={item.text} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (token.kind === "ordered") {
      const items: { kind: "ordered"; text: string; num: number }[] = [];
      const start = index;
      while (index < tokens.length && tokens[index]?.kind === "ordered") {
        items.push(tokens[index] as { kind: "ordered"; text: string; num: number });
        index++;
      }
      index--;
      blocks.push(
        <ol key={`ordered-${start}`} start={items[0]?.num ?? 1}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex} value={item.num}>
              <InlineMarkdown text={item.text} />
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (token.kind === "table") {
      const columnCount = Math.max(token.header.length, ...token.rows.map((row) => row.length));
      blocks.push(
        <div className="markdown-table-scroll" key={`table-${index}`}>
          <table>
            <thead>
              <tr>
                {tableCells(token.header, columnCount).map((cell, cellIndex) => (
                  <th key={cellIndex} scope="col">
                    <InlineMarkdown text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {token.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {tableCells(row, columnCount).map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <InlineMarkdown text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const content = <InlineMarkdown text={token.text} />;
    if (token.kind === "h1") blocks.push(<h1 key={index}>{content}</h1>);
    else if (token.kind === "h2") blocks.push(<h2 key={index}>{content}</h2>);
    else if (token.kind === "h3") blocks.push(<h3 key={index}>{content}</h3>);
    else blocks.push(<p key={index}>{content}</p>);
  }

  return (
    <article className={`markdown-document${compact ? " markdown-document--compact" : ""}`}>
      {blocks}
    </article>
  );
}
