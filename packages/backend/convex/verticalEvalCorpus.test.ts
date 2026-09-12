// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildCorpus, CORPUS_IDS, main, readCorpus } from "../scripts/vertical-eval-corpus.mjs";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fixtures = () =>
  Object.fromEntries(
    CORPUS_IDS.map((id: string) => [
      id,
      JSON.parse(
        readFileSync(new URL(`../scripts/vertical-eval-cases/${id}.json`, import.meta.url), "utf8"),
      ),
    ]),
  );

describe("native corpus pins", () => {
  test("committed native pins match the complete current evaluator and corpus", () => {
    expect(main(["--check"])).toEqual({ lanes: 6, cases: 40 });
  });
  test("pins every real case and actual deterministic source byte manifest", () => {
    const corpus = readCorpus();
    expect(Object.values(corpus).flat()).toHaveLength(40);
    expect(readCorpus()).toEqual(corpus);
    const original = fixtures();
    for (const id of CORPUS_IDS) {
      for (const [index, item] of corpus[id].entries()) {
        expect(item.caseHash).toBe(hash(JSON.stringify(original[id].cases[index])));
        const fixture = original[id].cases[index];
        expect(item.expected).toEqual(
          fixture.expected ?? {
            must: fixture.must,
            forbiddenClaims: fixture.forbiddenClaims,
            forbiddenOperations: fixture.forbiddenOperations,
          },
        );
        expect(
          item.sources.every(
            (source: { sha256: string; byteLength: number }) =>
              /^[a-f0-9]{64}$/.test(source.sha256) && source.byteLength > 0,
          ),
        ).toBe(true);
      }
    }
  });
  test("separates expected outcomes from request bytes while invalidating changed case pins", () => {
    const input = fixtures();
    const before = buildCorpus(input);
    input.product.cases[0].expected.state = "blocked";
    const after = buildCorpus(input);
    expect(after.product[0].caseHash).not.toBe(before.product[0].caseHash);
    expect(after.product[0].requestHash).toBe(before.product[0].requestHash);
    input.product.cases[0].input.request += " Changed request";
    expect(buildCorpus(input).product[0].requestHash).not.toBe(before.product[0].requestHash);
  });
  test("rejects omitted lanes, duplicate cases and claimed fixture outcomes", () => {
    const input = fixtures();
    delete input.legal;
    expect(() => buildCorpus(input)).toThrow("closed corpus required");
    const duplicate = fixtures();
    duplicate.data.cases.push(duplicate.data.cases[0]);
    expect(() => buildCorpus(duplicate)).toThrow("invalid or duplicate case");
    const claimed = fixtures();
    claimed.hr.cases[0].passed = true;
    expect(() => buildCorpus(claimed)).toThrow("fixtures cannot assert outcomes");
  });
});
