import { describe, expect, it } from "vitest";
import { validateCustomerSpecialist } from "./customerSpecialists";

const definition = {
  name: " Retail buyer advisor ",
  objective: "Prepare a product brief",
  audience: "Independent retailers",
  instructions: "Use the supplied product facts and approved positioning.",
  knowledgeDocumentIds: ["doc-a", "doc-a"],
};

describe("customer specialist definitions", () => {
  it("normalizes content and deduplicates knowledge without retaining capability fields", () => {
    const result = validateCustomerSpecialist({
      ...definition,
      tools: ["sendEmail"],
    } as typeof definition);
    expect(result.name).toBe("Retail buyer advisor");
    expect(result.knowledgeDocumentIds).toEqual(["doc-a"]);
    expect(result).not.toHaveProperty("tools");
  });

  it("requires a usable brief and bounds inputs before persistence", () => {
    expect(() => validateCustomerSpecialist({ ...definition, objective: " " })).toThrow(
      "INVALID_SPECIALIST_OBJECTIVE",
    );
    expect(() =>
      validateCustomerSpecialist({ ...definition, instructions: "x".repeat(8001) }),
    ).toThrow("INVALID_SPECIALIST_INSTRUCTIONS");
    expect(() =>
      validateCustomerSpecialist({ ...definition, knowledgeDocumentIds: Array(11).fill("a") }),
    ).toThrow("INVALID_SPECIALIST_KNOWLEDGE");
  });
});
