import { describe, expect, it } from "vitest";
import { markupText } from "./rawText";

describe("markupText — HTML/XML to text", () => {
  it("emits block elements on separate lines", () => {
    expect(markupText(`<p>Hi</p><p>There</p>`)).toBe("Hi\nThere");
  });

  it("drops the SCRIPT BODY, not just its tags", () => {
    const out = markupText(`<script>alert(1)</script><p>Safe</p>`);
    expect(out).toContain("Safe");
    expect(out).not.toContain("alert");
  });

  it("drops the STYLE BODY", () => {
    const out = markupText(`<style>.a{color:red}</style><p>Safe</p>`);
    expect(out).toContain("Safe");
    expect(out).not.toContain("color:red");
  });

  it("drops comment bodies", () => {
    const out = markupText(`<!-- secret --><p>Safe</p>`);
    expect(out).toContain("Safe");
    expect(out).not.toContain("secret");
  });

  it("decodes named, decimal and hex entities", () => {
    expect(markupText(`<p>&amp; &#65; &#x41;</p>`)).toBe("& A A");
  });

  it("never emits attribute values or tag fragments as text", () => {
    const out = markupText(`<p><img alt="x" src="y"> shown</p>`);
    expect(out).toBe("shown");
    expect(out).not.toContain("y");
    expect(out).not.toContain("<");
  });

  it("collapses whitespace runs and trims", () => {
    expect(markupText(`  <span>  a   b  </span>  `)).toBe("a b");
  });
});
