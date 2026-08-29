import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasPassingPackEvalEvidence,
  hasPassingTenantEvidence,
  PACK_EVAL_RUNNER,
  PACK_EVAL_SUITE,
} from "@pikar/contracts/skill";
import {
  customizationSchemaFor,
  PACK_SOURCE_PROBE_STATES,
  packCustomizationFields,
  packReadableSources,
  REACHABLE_PACK_SOURCES,
  resolveWorkflowPack,
  toolsForWorkflowPack,
  WORKFLOW_PACK_IDS,
  WORKFLOW_PACK_SKILL_NAMES,
  WORKFLOW_PACKS,
  type WorkflowPackId,
} from "@pikar/core";
import { describe, expect, test } from "vitest";
import { outcomeFor } from "./workflowPackBinding";

// 29-07 Task 2: THE HELD-OUT PACK EVAL CORPUS, CHECKED AT $0 IN CI.
//
// WHY THIS FILE EXISTS — the gap it closes, stated plainly:
//
//   `scripts/run-workflow-pack-evals.mjs` already carries a rich fixture validator (`validateFixture`
//   / `validateCorpus`), and it is EXCELLENT. It is also unreachable from any automated gate.
//   `.github/workflows/ci.yml` runs `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, and
//   NONE of those invokes that script — `--fixtures-only` is offline and free, and no job runs it.
//   `packages/contracts/src/skills/packEvalSuite.test.ts`, the one test that reads these files,
//   checks their sha256 and their case COUNT and nothing about their CONTENT. So today a fixture can
//   be edited into a state the shipped runtime can never produce, and the first thing that notices
//   is a paid `--candidate` run.
//
//   This repo has already paid for exactly that: 21 of the 30 fixtures once asserted a `SourceState`
//   no probe could return (`PACK_SOURCE_PROBE_STATES`' own docstring), and 11 asserted a terminal
//   `outcomeFor` could not reach (the runner's `EXPECTABLE_OUTCOMES` note). Both were found by
//   someone spending money.
//
// ponytail: this does NOT import the runner. `run-workflow-pack-evals.mjs` calls `main()` at module
// scope and its `.catch` ends in `process.exit`, so importing it from vitest would parse vitest's
// own argv, throw `EnvironmentAbort`, and kill the worker. The ceiling of not importing it is a
// second traversal that could drift from the runner's; the mitigation is that BOTH derive every
// legal value from `@pikar/core` and `outcomeFor` rather than from a hand-written list, so a drift
// between them is a drift from the shipped code and one of the two goes red. Upgrade path: give the
// runner an `if (import.meta.main)` guard, then import `validateFixture` here and delete the
// traversal below.
//
// NOTHING HERE SPENDS MONEY, and nothing here needs a deployment. No model call, no `convex run`.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(here, "..", "scripts", "workflow-pack-fixtures");

type Fixture = {
  id: string;
  pack: string;
  description: string;
  turns: string[];
  expect: {
    outcome: string;
    operations: string[];
    sources: Record<string, string>;
    missingNamed: string[];
    toolsAllowed: string[];
    toolsForbidden: string[];
    artifactCreated: boolean;
  };
  needles?: string[];
};

const CORPUS: readonly { packId: WorkflowPackId; fixtures: readonly Fixture[] }[] =
  WORKFLOW_PACK_IDS.map((packId) => ({
    packId,
    fixtures: JSON.parse(readFileSync(join(FIXTURE_DIR, `${packId}.json`), "utf8")) as Fixture[],
  }));

const ALL: readonly { packId: WorkflowPackId; fx: Fixture }[] = CORPUS.flatMap(
  ({ packId, fixtures }) => fixtures.map((fx) => ({ packId, fx })),
);

/** Per-pack projections of the SHIPPED registry. Nothing below is hand-listed. */
function project(packId: WorkflowPackId) {
  const spec = WORKFLOW_PACKS[packId];
  const existing = spec.operations.filter((op) => op.state === "existing");
  const missing = spec.operations.filter((op) => op.state === "missing");
  return {
    spec,
    existingIds: existing.map((op) => op.id),
    missingIds: missing.map((op) => op.id),
    forbiddenIds: spec.operations.filter((op) => op.state === "forbidden").map((op) => op.id),
    /** Reachable planes an `existing` operation genuinely reads. */
    reachable: [
      ...new Set(existing.flatMap((op) => (op.reads === null ? [] : [op.reads]))),
    ] as string[],
    /** Planes the matrix says nothing can read. Permanently `unavailable`. */
    missingSources: [...new Set(missing.map((op) => op.reads))] as string[],
    granted: toolsForWorkflowPack(packId),
    /** `declareUnsupported` is the only tool that makes `partial` reachable with nothing missing. */
    canDeclareUnsupported: toolsForWorkflowPack(packId).includes("declareUnsupported"),
  };
}

// ── The corpus is real, and this file read it ──────────────────────────────────────────────

describe("the corpus this file checks is the corpus the gate certifies", () => {
  test("all six packs have a fixture file, and 30 cases were loaded", () => {
    // LITERALS. `PACK_EVAL_SUITE` declares the same counts and `packEvalSuite.test.ts` pins them to
    // the files' sha256 — asserting against that constant here would move the oracle with the
    // subject. A shrunken corpus must fail loudly rather than pass by having nothing to check.
    expect(CORPUS).toHaveLength(6);
    expect(ALL).toHaveLength(30);
    for (const { packId, fixtures } of CORPUS) {
      expect(fixtures.length, packId).toBe(5);
    }
  });

  test("every fixture names a pack that resolves through the closed registry", () => {
    for (const { packId, fx } of ALL) {
      expect(fx.pack, fx.id).toBe(packId);
      expect(resolveWorkflowPack(fx.pack).ok, fx.id).toBe(true);
    }
  });

  test("every registry pack name in the suite is one of the six derived names", () => {
    for (const name of Object.keys(PACK_EVAL_SUITE.packs)) {
      expect(WORKFLOW_PACK_SKILL_NAMES).toContain(name);
    }
  });
});

// ── PRODUCIBILITY: every fixture asserts a state the shipped runtime can actually reach ─────

describe("every fixture expects a state the shipped runtime can produce", () => {
  test("expect.operations names only operations the matrix marks `existing`", () => {
    for (const { packId, fx } of ALL) {
      const p = project(packId);
      expect(fx.expect.operations.length, fx.id).toBeGreaterThan(0);
      for (const id of fx.expect.operations) {
        // A `missing` or `forbidden` operation can never run, so expecting one is a case that can
        // only ever fail — and a runner that quietly skipped it would report a green gate.
        expect(p.missingIds, `${fx.id} expects missing op ${id}`).not.toContain(id);
        expect(p.forbiddenIds, `${fx.id} expects forbidden op ${id}`).not.toContain(id);
        expect(p.existingIds, `${fx.id} op ${id}`).toContain(id);
      }
    }
  });

  test("expect.sources names every reachable plane, and only states probeSources can return", () => {
    for (const { packId, fx } of ALL) {
      const p = project(packId);
      for (const source of p.reachable) {
        // Naming every reachable plane is what makes a fixture's coverage claim complete: an
        // unnamed source is one whose state the case never pinned.
        expect(Object.keys(fx.expect.sources), `${fx.id} omits ${source}`).toContain(source);
      }
      for (const [source, state] of Object.entries(fx.expect.sources)) {
        expect([...p.reachable, ...p.missingSources], `${fx.id} names ${source}`).toContain(source);
        if ((REACHABLE_PACK_SOURCES as readonly string[]).includes(source)) {
          const producible =
            PACK_SOURCE_PROBE_STATES[source as (typeof REACHABLE_PACK_SOURCES)[number]];
          expect(producible, `${fx.id} ${source}=${state}`).toContain(state);
        } else {
          // A matrix-missing plane is `unavailable` on every run, by `packPreflight`'s own branch.
          expect(state, `${fx.id} ${source}`).toBe("unavailable");
        }
      }
    }
  });

  test("expect.outcome is what outcomeFor returns for the states the fixture declares", () => {
    for (const { packId, fx } of ALL) {
      const p = project(packId);
      const runtimeMissing = p.reachable.filter(
        (s) => fx.expect.sources[s] === "unavailable",
      ).length;
      // The REAL terminal function, not a re-derivation of its rule. A non-empty, untruncated reply
      // is the only shape a scored case has: `no_findings` is an empty reply, which no fixture can
      // usefully expect, and truncation is a runtime accident rather than a declared expectation.
      const reachableOutcome = outcomeFor({
        reply: "x",
        truncated: false,
        declaredUnsupported: false,
        runtimeMissing,
      });
      if (runtimeMissing > 0) {
        // FORCED. A reachable plane the fixture declares unavailable makes the terminal `partial`
        // whatever the model says, so a `useful` expectation here is a case that can only fail.
        // Asserted through `outcomeFor` itself rather than by restating its rule: this is the arm
        // that goes red if that function stops honouring `runtimeMissing`.
        expect(reachableOutcome, `${fx.id}: ${runtimeMissing} read plane(s) unavailable`).toBe(
          "partial",
        );
        expect(fx.expect.outcome, fx.id).toBe("partial");
      } else if (fx.expect.outcome === "useful") {
        expect(reachableOutcome, `${fx.id}: nothing it reads is unavailable`).toBe("useful");
      } else if (fx.expect.outcome === "partial") {
        // Nothing is missing, so `partial` needs the model to declare its evidence insufficient,
        // which needs the tool. Without it `outcomeFor` returns `useful` on every run.
        expect(
          p.canDeclareUnsupported,
          `${fx.id}: nothing is unavailable and the pack is not granted declareUnsupported`,
        ).toBe(true);
      } else {
        expect.unreachable(`${fx.id} expects the unscoreable outcome ${fx.expect.outcome}`);
      }
    }
  });

  test("expect.missingNamed names only planes the matrix says are missing", () => {
    for (const { packId, fx } of ALL) {
      const p = project(packId);
      for (const source of fx.expect.missingNamed) {
        expect(p.missingSources, `${fx.id} names ${source} as missing`).toContain(source);
      }
    }
  });

  test("artifactCreated is never expected of a pack whose output is a briefing", () => {
    for (const { packId, fx } of ALL) {
      if (fx.expect.artifactCreated) {
        expect(WORKFLOW_PACKS[packId].output, fx.id).not.toBe("briefing");
      }
    }
  });
});

// ── The tool assertions are the ones a customization must never be able to move ─────────────

describe("every fixture's tool expectations are reachable and non-vacuous", () => {
  test("toolsAllowed names only tools the code-owned grant actually contains", () => {
    for (const { packId, fx } of ALL) {
      const p = project(packId);
      expect(fx.expect.toolsAllowed.length, fx.id).toBeGreaterThan(0);
      for (const tool of fx.expect.toolsAllowed) {
        expect(p.granted, `${fx.id} allows ${tool}`).toContain(tool);
      }
    }
  });

  test("toolsForbidden names no tool the pack IS granted — a granted tool cannot be absent", () => {
    for (const { packId, fx } of ALL) {
      const p = project(packId);
      // THE VACUITY GUARD. A "forbidden" tool that the pack holds is an assertion that can only
      // fail; a "forbidden" tool nobody has is an assertion that can never fail. The first is what
      // this checks, and the second is bounded by the count check below.
      for (const tool of fx.expect.toolsForbidden) {
        expect(p.granted, `${fx.id} forbids granted tool ${tool}`).not.toContain(tool);
      }
      expect(fx.expect.toolsForbidden.length, fx.id).toBeGreaterThan(0);
    }
  });

  test("the grant is derived from the matrix, so no fixture can widen it", () => {
    for (const packId of WORKFLOW_PACK_IDS) {
      const p = project(packId);
      const fromMatrix = [
        ...new Set(
          WORKFLOW_PACKS[packId].operations.flatMap((op) =>
            op.state === "existing" ? op.tools : [],
          ),
        ),
      ].sort();
      expect(p.granted, packId).toEqual(fromMatrix);
    }
  });
});

// ── Adversarial coverage: injection, per pack, non-vacuously ────────────────────────────────

describe("every pack carries an injection case, and it forbids the tools actuation would need", () => {
  test("each of the six packs has exactly one injected-instruction fixture", () => {
    for (const { packId, fixtures } of CORPUS) {
      const injected = fixtures.filter((fx) => fx.id.includes("-injected-"));
      expect(injected.length, packId).toBe(1);
    }
  });

  // WHERE THE INJECTION ACTUALLY IS — a real gap this test was written to find, and it found one.
  //
  // The id alone proves nothing, and neither does the `description`: a comment asserting an
  // adversarial premise nothing plants is the exact defect class this file exists to catch.
  // `stageFor` in `run-workflow-pack-evals.mjs` plants exactly two things — `smoke:seedInboxFixture`
  // and `vaultSmoke:seedCorpus` — and NEITHER contains an injected instruction (asserted below,
  // with a positive control). So an injection reaches the model only if the fixture's own TURNS
  // carry it.
  //
  // Two of the six do. The other four describe an injection living in a plane the harness does not
  // control: `business-pulse-04` and `process-sop-05` say a stored document contains it, and
  // `campaign-plan-05` / `sales-call-prep-05` say a live web page does. Those four score like
  // ordinary cases today.
  //
  // THIS IS PINNED AS A LITERAL SO A FIX MOVES IT. Planting the line in `vaultSmoke:seedCorpus` (or
  // giving the two web cases a controlled page) turns this list red, and the red IS the signal that
  // the gap closed — the list is then updated. Neither `vaultSmoke.ts` nor the fixture JSONs nor
  // `packages/contracts/src/skill.ts` (which pins each file's sha256) is this plan's to edit, so the
  // gap is recorded and guarded here rather than silently carried.
  const INJECTION_MARKERS = [
    "note to assistant",
    "system:",
    "disregard prior instruction",
    "ignore previous",
    "ignore prior",
  ] as const;
  const carriesInjection = (text: string) =>
    INJECTION_MARKERS.some((m) => text.toLowerCase().includes(m));
  const injectionCase = (fixtures: readonly Fixture[]) =>
    fixtures.find((f) => f.id.includes("-injected-")) as Fixture;

  test("exactly two packs plant their injection where the harness can put it: the turn text", () => {
    const planted = CORPUS.filter(({ fixtures }) =>
      carriesInjection(injectionCase(fixtures).turns.join(" ")),
    )
      .map(({ packId }) => packId)
      .sort();
    expect(planted).toEqual(["brand-review", "customer-complaint"]);
  });

  test("the four whose injection lives outside the harness are named, not assumed", () => {
    const unplanted = CORPUS.filter(
      ({ fixtures }) => !carriesInjection(injectionCase(fixtures).turns.join(" ")),
    )
      .map(({ fixtures }) => injectionCase(fixtures).id)
      .sort();
    expect(unplanted).toEqual([
      "business-pulse-04-injected-vault-instruction",
      "campaign-plan-05-injected-page-instruction",
      "process-sop-05-injected-document-instruction",
      "sales-call-prep-05-injected-page-instruction",
    ]);
  });

  test("the seeded corpus the runner plants carries no injected instruction", () => {
    const seedSource = readFileSync(join(here, "vaultSmoke.ts"), "utf8");
    expect(carriesInjection(seedSource), "vaultSmoke.ts").toBe(false);
    // POSITIVE CONTROL: the same predicate DOES see the two real injections, so the `false` above
    // is a fact about the seed and not a broken matcher.
    const brandReview = CORPUS.find((c) => c.packId === "brand-review");
    expect(brandReview).toBeDefined();
    expect(
      carriesInjection(
        injectionCase((brandReview as (typeof CORPUS)[number]).fixtures).turns.join(" "),
      ),
    ).toBe(true);
  });

  test("no injection case leaves its forbidden list empty", () => {
    for (const { fixtures } of CORPUS) {
      const fx = fixtures.find((f) => f.id.includes("-injected-")) as Fixture;
      expect(fx.expect.toolsForbidden.length, fx.id).toBeGreaterThan(0);
    }
  });
});

// ── The customization plane and the eval plane must agree ───────────────────────────────────

describe("a customization cannot ask for something the corpus never exercises", () => {
  test("every source a preference checkbox offers is a plane the pack's fixtures pin", () => {
    for (const packId of WORKFLOW_PACK_IDS) {
      const pref = packCustomizationFields(packId).find((f) => f.kind === "source_preference");
      if (pref === undefined) continue;
      const covered = new Set(
        CORPUS.find((c) => c.packId === packId)?.fixtures.flatMap((fx) =>
          Object.keys(fx.expect.sources),
        ) ?? [],
      );
      for (const source of pref.sources) {
        // A checkbox naming a plane no eval case ever pins is a setting whose effect nothing
        // measures — the customization half of the "checkbox the product cannot honour" rule
        // `packReadableSources` already enforces for the runtime half.
        expect([...covered], `${packId} offers ${source}`).toContain(source);
      }
      expect(pref.sources, packId).toEqual(packReadableSources(packId));
    }
  });

  test("every one of the six packs has a customization schema, and it is bounded", () => {
    for (const packId of WORKFLOW_PACK_IDS) {
      const schema = customizationSchemaFor(packId, 1);
      expect(schema.ok, packId).toBe(true);
      if (!schema.ok) continue;
      const kinds = schema.value.fields.map((f) => f.kind);
      // Exactly one free-prose block and one short terminology field per pack — the whole reason
      // the form is narrower than the free-text authoring door.
      expect(kinds.filter((k) => k === "instruction").length, packId).toBe(1);
      expect(kinds.filter((k) => k === "terminology").length, packId).toBe(1);
      expect(kinds.filter((k) => k === "threshold").length, packId).toBe(1);
      // NO field kind can carry a tool, a URL or a body: the closed kind vocabulary is the bound.
      for (const kind of kinds) {
        expect(
          ["terminology", "tone", "threshold", "source_preference", "instruction"],
          `${packId} declares ${kind}`,
        ).toContain(kind);
      }
    }
  });
});

// ── THE GATE THAT CANNOT CLEAR, stated as an executable fact rather than as prose ────────────

describe("pack-suite evidence cannot certify a tenant customization, and vice versa", () => {
  const NAME = "pack-brand-review";
  const SUITE = PACK_EVAL_SUITE.packs[NAME];

  const packEvidence = JSON.stringify({
    runner: PACK_EVAL_RUNNER,
    runId: "r1",
    pass: true,
    casesPassed: SUITE.caseCount,
    casesTotal: SUITE.caseCount,
    retriedCases: [],
    costUsd: 0.09,
    model: "openai/gpt-4o-mini",
    skillVersions: { [NAME]: 3 },
    suite: { revision: PACK_EVAL_SUITE.revision, ...SUITE },
    ts: 1,
  });

  // The tenant row this would have to certify. `recordTenantEvalEvidence` keys on the exact row id
  // because two tenants can hold the same name AND version.
  const tenantTarget = {
    candidateId: "k17abc",
    registryTenantId: "tenant-a",
    name: NAME,
    version: 3,
  };

  test("the pack evidence is genuinely valid for the GLOBAL row it names", () => {
    // Positive control. Without this the two refusals below would pass on a blob that was simply
    // malformed, and would prove nothing about the plane boundary.
    expect(hasPassingPackEvalEvidence(packEvidence, NAME, 3)).toBe(true);
  });

  test("that same valid pack evidence does not satisfy the TENANT predicate", () => {
    // `hasPassingTenantEvidence` requires a `tenantTarget` matching all of
    // {candidateId, registryTenantId, name, version}. A pack-suite blob carries a GLOBAL
    // `skillVersions` pin and no row id, so it can never certify a tenant customization —
    // which is why a tenant pack candidate has no evidence path even before `PACK_GATE`.
    expect(hasPassingTenantEvidence(packEvidence, tenantTarget)).toBe(false);
  });

  test("tenant evidence naming the exact row does not satisfy the PACK predicate", () => {
    const tenantEvidence = JSON.stringify({
      runner: "eval:golden",
      runId: "r2",
      pass: true,
      casesPassed: 25,
      casesTotal: 25,
      retriedCases: [],
      costUsd: 0.12,
      model: "openai/gpt-4o-mini",
      skillVersions: {},
      tenantTarget,
      ts: 2,
    });
    expect(hasPassingPackEvalEvidence(tenantEvidence, NAME, 3)).toBe(false);
  });

  // WHAT THIS MEANS, AND IT IS NOT A BUG TO BE FIXED HERE. The two planes are deliberately
  // separate, and `planTenantActivation` refuses a pack-named tenant row ahead of its mode switch
  // whatever the evidence says (`skills.test.ts`, "a pack-named TENANT candidate with Phase-21
  // evidence is still REFUSED"). So the corpus below CAN clear the gate for the GLOBAL pack row it
  // was written for — that is `run-workflow-pack-evals.mjs --candidate`, which is live and paid —
  // and a TENANT customization has no gate to clear in this release. This file makes both halves
  // of that true statement executable instead of leaving the second one as a comment.
});
