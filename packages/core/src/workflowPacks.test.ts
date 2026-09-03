import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { WORKFLOW_EVENT_STREAM_IDS } from "./workflowPackMetrics";
import {
  hasPassingPackBrowserEvidence,
  hasValidPackProvenance,
  isWorkflowPackSkill,
  LEAF_FORBIDDEN_OPERATIONS,
  MISSING_PACK_SOURCES,
  MISSING_SOURCE_MENTIONS,
  MISSING_SOURCE_UNLOCK,
  PACK_SOURCE_LABEL,
  PACK_SOURCE_PROBE_STATES,
  PACK_UNREACHABLE_TOOLS,
  packPreflight,
  REACHABLE_PACK_SOURCES,
  resolveWorkflowPack,
  toolsForWorkflowPack,
  WORKFLOW_PACK_IDS,
  WORKFLOW_PACK_SKILL_NAMES,
  WORKFLOW_PACKS,
  type WorkflowPackId,
} from "./workflowPacks";

// 27-02 Task 1 (PACK-02/PACK-03). The pack registry is the CAPABILITY half of ADR-007: the skill
// body is a DB row a candidate can change, the tool grant is code. Everything asserted here is
// asserted over the WHOLE registry, deliberately — a per-pack spot check lets the seventh pack
// (or a widened sixth) slip in without reddening anything.
//
// The three-word vocabulary (`existing` / `missing` / `forbidden`) is what 27-04/05/06 author their
// bodies against, so its totality is a phase-level contract, not a local nicety.

const llmSource = (): string =>
  readFileSync(new URL("../../backend/convex/llm.ts", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );

/** Every `<name>: tool(` key in buildCockpitTools — the cockpitTools.test.ts idiom, one package up. */
function runtimeToolNames(): Set<string> {
  const names = [...llmSource().matchAll(/\n {4}([A-Za-z_]\w*): tool\(/g)].map(
    (m) => m[1] as string,
  );
  // Non-vacuity floor: a restructured record must fail LOUDLY here, not pass on an empty set —
  // the exact way a cross-package source scan rots into decoration.
  expect(
    names.length,
    "found no `<name>: tool(` keys in llm.ts — did buildCockpitTools move?", //
  ).toBeGreaterThan(20);
  // `webResearch` and `declareUnsupported` are built by `buildWebResearchTool()` at module scope
  // (llm.ts:382), not inside the record literal, so the indent-anchored scan cannot see them.
  // They ARE keys of the returned record — spread in at the `grantWebResearch` branch.
  // `saveAsDocument` is the same shape one flag over: `buildSaveAsDocumentTool()` at module scope,
  // spread in at the `documentIsDeliverable` branch. Both are conditional for the same reason —
  // `runAgentLoop` returns the FULL record when `toolNames === undefined`, so a tool built inside
  // the literal is one the EXECUTIVE agent silently acquires.
  return new Set([...names, "webResearch", "declareUnsupported", "saveAsDocument"]);
}

describe("the workflow-pack registry is total", () => {
  test("every declared id has a spec and the registry has no id that is not declared", () => {
    expect(Object.keys(WORKFLOW_PACKS).sort()).toEqual([...WORKFLOW_PACK_IDS].sort());
    // The pilot is SIX packs (owner decision A, 2026-08-23: all six ship, three of them starved).
    expect(WORKFLOW_PACK_IDS).toEqual([
      "business-pulse",
      "campaign-plan",
      "customer-complaint",
      "sales-call-prep",
      "process-sop",
      "brand-review",
    ]);
  });

  // The fail-closed lookup, mirroring resolveSpecialist. `Object.hasOwn`, never a truthiness test:
  // a bare index signature resolves "__proto__"/"constructor" to Object.prototype members, which
  // are truthy, so a truthiness guard would happily "resolve" them into a tool grant.
  test("an unknown id is refused — including the prototype names", () => {
    for (const id of [
      "",
      "business_pulse",
      "Business-Pulse",
      "__proto__",
      "constructor",
      "toString",
    ]) {
      expect(resolveWorkflowPack(id), `"${id}" resolved`).toEqual({
        ok: false,
        reason: "unknown_pack",
      });
    }
    for (const id of WORKFLOW_PACK_IDS) {
      const r = resolveWorkflowPack(id);
      expect(r.ok && r.packId).toBe(id);
      expect(r.ok && r.spec).toBe(WORKFLOW_PACKS[id]);
    }
  });

  test("the skill name of every pack is derived from its id, not hand-typed", () => {
    // 27-04/05/06 add the matching `@pikar/contracts` constants and the canonical `.md` bodies.
    // Until then this derivation IS the contract those plans must satisfy; the body-parity test
    // at the bottom of this file starts biting the moment the first body lands.
    for (const id of WORKFLOW_PACK_IDS) {
      expect(WORKFLOW_PACKS[id].skillName).toBe(`pack-${id}`);
    }
  });

  test("operation ids are stable, kebab-case and unique within a pack (fixtures key off them)", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      const ids = WORKFLOW_PACKS[id].operations.map((op) => op.id);
      expect(new Set(ids).size, `${id} repeats an operation id`).toBe(ids.length);
      for (const opId of ids) {
        expect(opId, `${id}/${opId} is not stable kebab-case`).toMatch(
          /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        );
      }
    }
  });

  // 27-08 Task 1. TOTAL STATIC PARITY: every operation id maps to EXACTLY ONE of the three classes.
  // The per-pack check below is the local half; the cross-registry check is the one that matters,
  // because the fixture corpus and the eval runner key on the BARE id — `expect.operations:
  // ["ground-in-vault"]` is written once and means the same thing in six files. An id that were
  // `existing` in one pack and `missing` in another would make that assertion silently pack-dependent:
  // the same fixture line would certify a real read in one place and an apology in another.
  test("every operation id maps to exactly one class, within a pack and across the registry", () => {
    const globalState = new Map<string, { state: string; tools: string; packId: string }>();

    for (const id of WORKFLOW_PACK_IDS) {
      const ops = WORKFLOW_PACKS[id].operations;
      const byClass = {
        existing: ops.filter((op) => op.state === "existing").map((op) => op.id),
        missing: ops.filter((op) => op.state === "missing").map((op) => op.id),
        forbidden: ops.filter((op) => op.state === "forbidden").map((op) => op.id),
      };
      // TOTALITY: the three classes cover every operation and nothing else. A fourth state, or an
      // operation the union misses, would leave an id the fixture validator can neither accept nor
      // reject by class — it would fall through to "not an operation of this pack".
      const covered = [...byClass.existing, ...byClass.missing, ...byClass.forbidden].sort();
      expect(covered, `${id}: the three classes do not cover its operations exactly`).toEqual(
        ops.map((op) => op.id).sort(),
      );
      // DISJOINTNESS. `covered.length` counts an id once per class it appears in, so an id listed
      // twice under different states makes this length exceed the distinct count.
      expect(new Set(covered).size, `${id}: an operation id appears in two classes`).toBe(
        covered.length,
      );

      for (const op of ops) {
        // The tool set is part of the identity: `research-the-web` granting a different pair in a
        // second pack would make `expect.toolsAllowed` mean something else there too.
        const tools = op.state === "existing" ? [...op.tools].sort().join(",") : "";
        const seen = globalState.get(op.id);
        if (seen === undefined) {
          globalState.set(op.id, { state: op.state, tools, packId: id });
          continue;
        }
        expect(
          `${op.state}|${tools}`,
          `operation "${op.id}" is ${op.state} in ${id} but ${seen.state} in ${seen.packId}`,
        ).toBe(`${seen.state}|${seen.tools}`);
      }
    }

    // Non-vacuity floor: the loop above passes trivially over an empty registry.
    expect(globalState.size).toBeGreaterThan(10);
  });

  // 27-09: the discovery surface renders these. Code-owned so the quick start, the preflight
  // paragraph and the body cannot each name the same workflow differently.
  test("every pack has a title and a blurb, and no blurb promises orchestration", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      const { title, blurb } = WORKFLOW_PACKS[id];
      expect(title.length, `${id} title`).toBeGreaterThan(4);
      expect(blurb.length, `${id} blurb`).toBeGreaterThan(30);
      // Packs are LEAF AGENTS. A quick start that implies a pack hands work to another agent is a
      // promise `runAgentLoop` structurally cannot keep — `grantDispatch` is never built for one.
      expect(blurb.toLowerCase(), `${id} blurb implies dispatch`).not.toMatch(
        /specialist|another agent|hands off|delegat/,
      );
    }
    // The opener is sent AS THE USER's first message, so it must read like something a person
    // would say — never an instruction addressed to a model, which would put a second prompt
    // outside the registry (CLAUDE.md section 5).
    for (const id of WORKFLOW_PACK_IDS) {
      const { opener } = WORKFLOW_PACKS[id];
      expect(opener.length, `${id} opener`).toBeGreaterThan(15);
      expect(opener.toLowerCase(), `${id} opener addresses the model`).not.toMatch(
        /you are|your task|system:|instruction/,
      );
    }
    // Titles are what a user picks between, so two packs sharing one is a real defect.
    const titles = WORKFLOW_PACK_IDS.map((id) => WORKFLOW_PACKS[id].title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test("the source vocabulary is disjoint, fully used, and fully described", () => {
    const missing = new Set<string>(MISSING_PACK_SOURCES);
    for (const source of REACHABLE_PACK_SOURCES) {
      expect(missing.has(source), `${source} is both reachable and missing`).toBe(false);
    }
    const all = [...REACHABLE_PACK_SOURCES, ...MISSING_PACK_SOURCES];
    // Every source is described for the user…
    for (const source of all)
      expect(PACK_SOURCE_LABEL[source], `${source} has no label`).toBeTruthy();
    // …and every MISSING one also names what would unlock it. A missing source with no unlock is a
    // dead end the pack cannot honestly explain, which is the defect owner decision A exists to avoid.
    for (const source of MISSING_PACK_SOURCES)
      expect(MISSING_SOURCE_UNLOCK[source], `${source} has no unlock`).toBeTruthy();
    // …and no source is dead vocabulary: each is read by at least one operation somewhere.
    const used = new Set(
      WORKFLOW_PACK_IDS.flatMap((id) =>
        WORKFLOW_PACKS[id].operations.flatMap((op) =>
          op.state === "forbidden" || op.reads === null ? [] : [op.reads as string],
        ),
      ),
    );
    expect(
      [...all].filter((s) => !used.has(s)),
      "declared but never read by any pack",
    ).toEqual([]);
  });
});

describe("the grant is code-owned and exact", () => {
  // Equality over the WHOLE registry. A tool added to ANY pack fails here — a tool-set is a
  // CAPABILITY grant (ADR-007), so widening one must never be a quiet one-line edit.
  // MUTATION that must turn this RED: add "proposePlan" to any pack's operations.
  test("every pack's tool set is EXACTLY its grant", () => {
    expect(WORKFLOW_PACK_IDS.map((id) => [id, [...toolsForWorkflowPack(id)]])).toEqual([
      // No artifact tool: the pulse answers in the thread. Its two nominal headline sources
      // (Phase 26 summaries, the content shelf) are MISSING and stay missing — decision A.
      ["business-pulse", ["readFinance", "searchVault"]],
      // `declareUnsupported` rides `webResearch` — see the pairing test below.
      ["campaign-plan", ["declareUnsupported", "saveAsDocument", "searchVault", "webResearch"]],
      // `replyToMessage` resolves the message and the recipient SERVER-SIDE; the model never sees
      // an address. Nothing here sends: the plan still stops at the one human Approve gate.
      [
        "customer-complaint",
        ["briefInbox", "listInbox", "proposePlan", "replyToMessage", "searchVault"],
      ],
      [
        "sales-call-prep",
        [
          "declareUnsupported",
          "listManagedCalendarEvents",
          "saveAsDocument",
          "searchVault",
          "webResearch",
        ],
      ],
      ["process-sop", ["findInDrive", "listDriveFolders", "saveAsDocument", "searchVault"]],
      ["brand-review", ["saveAsDocument", "searchVault"]],
    ]);
  });

  // The derivation, not a second hand-typed list: the grant IS the union of the `existing`
  // operations' tools. A tool nobody's matrix row asks for cannot be granted at all.
  // MUTATION that must turn this RED: add a tool name to a spec without an operation naming it.
  test("the grant is derived from the existing operations — nothing else can add a tool", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      const fromOps = [
        ...new Set(
          WORKFLOW_PACKS[id].operations.flatMap((op) => (op.state === "existing" ? op.tools : [])),
        ),
      ].sort();
      expect(toolsForWorkflowPack(id), `${id}`).toEqual(fromOps);
    }
  });

  // The registry may only name tools that EXIST. A grant for a tool that was renamed or deleted is
  // silently withheld by the filter at llm.ts:4353 — the pack loses a capability and nothing errors.
  test("every granted tool name is a real key of buildCockpitTools", () => {
    const real = runtimeToolNames();
    const unknown = WORKFLOW_PACK_IDS.flatMap((id) =>
      toolsForWorkflowPack(id)
        .filter((name) => !real.has(name))
        .map((name) => `${id}:${name}`),
    );
    expect(unknown, "granted tool names that do not exist in llm.ts").toEqual([]);
  });

  // llm.ts builds `webResearch` and `declareUnsupported` together under ONE flag, then FILTERS the
  // record by name — so listing `webResearch` alone silently drops the structured refusal channel
  // and the pack can only answer or confabulate. The pairing is an invariant, not a preference.
  test("a pack granted webResearch is also granted declareUnsupported", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      const tools = toolsForWorkflowPack(id);
      expect(tools.includes("webResearch"), `${id}`).toBe(tools.includes("declareUnsupported"));
    }
    // Non-vacuity: at least one pack actually researches, or the rule above asserts nothing.
    expect(
      WORKFLOW_PACK_IDS.filter((id) => toolsForWorkflowPack(id).includes("webResearch")),
    ).toEqual(["campaign-plan", "sales-call-prep"]);
  });

  // The output contract is BOUND to the grant. A pack that promises a durable document without the
  // tool that writes one produces prose and loses it; a pack that promises no artifact but holds
  // `saveAsDocument` writes vault rows nobody asked for.
  test("each output contract is backed by exactly the tool that can honour it", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      const tools = toolsForWorkflowPack(id);
      const { output } = WORKFLOW_PACKS[id];
      expect(tools.includes("saveAsDocument"), `${id} output=${output}`).toBe(
        output === "document",
      );
      // And NO pack holds `createDocument` — the model would have to re-type the whole deliverable
      // into `topic`, which is the transcription failure `saveDocument` in the registry records.
      expect(tools.includes("createDocument"), `${id} must not hold createDocument`).toBe(false);
      // BOTH halves, because either alone is a broken contract: `replyToMessage` without
      // `proposePlan` drafts something nobody can approve, and `proposePlan` without a drafter
      // would stage an empty plan.
      expect(tools.includes("replyToMessage"), `${id} output=${output}`).toBe(
        output === "draft_reply",
      );
      expect(tools.includes("proposePlan"), `${id} output=${output}`).toBe(
        output === "draft_reply",
      );
    }
    expect(WORKFLOW_PACK_IDS.map((id) => WORKFLOW_PACKS[id].output)).toEqual([
      "briefing",
      "document",
      "draft_reply",
      "document",
      "document",
      "document",
    ]);
  });

  // The deny-list states the containment explicitly, so the intent survives a refactor of the
  // equality above. Nothing that sends, spends, or mutates external state is reachable from a pack.
  test("no pack grants a send, spend, or external-mutation tool", () => {
    const forbidden = [
      "addRecipients",
      "setRecipients",
      "removeRecipient",
      "setSendTime",
      "setSubject",
      "setMode",
      "draftBody",
      "personalizeRecipient",
      "generateAttachment",
      "regenerateAttachment",
      "removeAttachment",
      "proposeImage",
      "stageCrmWrite",
      "stageFinanceWrite",
      "proposeCalendarEvent",
      "proposeCalendarChange",
      "checkAvailability",
      // A write and a re-entrancy hazard wearing a read's clothes: it PERSISTS an `evaluations`
      // row plus an audit row on every call. specialists.ts refuses it for the same reason.
      "evaluateBusiness",
      "recordScorecardAnswer",
      "resetPlan",
      "resolveContacts",
    ];
    for (const id of WORKFLOW_PACK_IDS) {
      const granted = toolsForWorkflowPack(id);
      expect(
        forbidden.filter((f) => granted.includes(f)),
        `${id}`,
      ).toEqual([]);
    }
  });

  // `proposePlan` is NOT on the list above, and its absence there is a decision rather than an
  // oversight — so it is pinned BY NAME instead. It is the only tool on the email path that writes
  // `status: "proposed"`, and that status is the only state in which the Approve control renders,
  // so a pack that drafts a reply and cannot stage it produces something approvable by nobody.
  // It STAGES; `executePlan`'s human compare-and-swap is still the only sender.
  // MUTATION that must turn this RED: grant proposePlan to a second pack.
  test("exactly one pack may stage a plan for approval", () => {
    expect(
      WORKFLOW_PACK_IDS.filter((id) => toolsForWorkflowPack(id).includes("proposePlan")),
    ).toEqual(["customer-complaint"]);
  });
});

describe("packs are leaf agents — structurally, not by wording", () => {
  // Owner decision B. `runAgentLoop` derives BOTH executive-only grants from `toolNames ===
  // undefined`, and a pack always supplies an array — so dispatch and skill authoring are not
  // "withheld", they are never built. This scan is what stops that from silently becoming untrue.
  test("llm.ts still derives dispatch and skill authoring from `toolNames === undefined`", () => {
    const src = llmSource();
    expect(src, "grantDispatch is no longer derived from the absence of an allow-list").toContain(
      "grantDispatch: toolNames === undefined",
    );
    expect(
      src,
      "grantSkillAuthoring is no longer derived from the absence of an allow-list",
    ).toContain("grantSkillAuthoring: toolNames === undefined");
    // …and the filter must stay an EXACT-NAME filter over the built record. A truthiness test would
    // hand a zero-tool pack the full set; an `activeTools`-style filter would leave the withheld
    // tool's execute closure reachable.
    expect(src).toContain("Object.entries(built).filter(([n]) => toolNames.includes(n))");
  });

  test("no pack names a tool an allow-listed agent can never receive", () => {
    expect([...PACK_UNREACHABLE_TOOLS]).toEqual([
      "authorSkillCandidate",
      "dispatchMedia",
      "dispatchResearch",
      "proposeImage",
    ]);
    for (const id of WORKFLOW_PACK_IDS) {
      const granted = toolsForWorkflowPack(id);
      expect(
        PACK_UNREACHABLE_TOOLS.filter((t) => granted.includes(t)),
        `${id}`,
      ).toEqual([]);
    }
  });

  // The rows are shared BY IDENTITY, not by equal copy — object identity, since spreading the
  // shared list into each spec necessarily makes a new ARRAY. There is no per-pack forbidden row to
  // widen: editing one edits all six. A stronger statement than "every pack's list happens to match".
  // MUTATION that must turn this RED: give any pack its own inline forbidden row.
  test("every pack carries the same forbidden operations, by identity", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      const forbidden = WORKFLOW_PACKS[id].operations.filter((op) => op.state === "forbidden");
      expect(forbidden.length, `${id}`).toBe(LEAF_FORBIDDEN_OPERATIONS.length);
      forbidden.forEach((op, i) => {
        expect(op, `${id} forbidden row ${i} is a copy, not the shared row`).toBe(
          LEAF_FORBIDDEN_OPERATIONS[i],
        );
      });
    }
    expect(LEAF_FORBIDDEN_OPERATIONS.map((op) => op.refusal)).toEqual([
      "specialist_dispatch",
      "skill_authoring",
      "paid_generation",
      "external_send",
      "external_write",
    ]);
  });

  // Campaign Plan's contract output is a PLAN DOCUMENT. The withdrawn brief ("composes research,
  // content and media preparation") is structurally impossible for an allow-listed agent, and this
  // is where that stays recorded in code rather than in a corrected planning file.
  test("campaign-plan produces a document and orchestrates nothing", () => {
    expect(WORKFLOW_PACKS["campaign-plan"].output).toBe("document");
    const granted = toolsForWorkflowPack("campaign-plan");
    expect(granted.filter((t) => t.startsWith("dispatch"))).toEqual([]);
  });
});

describe("the honest-partial contract is in the matrix, not in prose", () => {
  // Owner decision A: the three starved packs name their missing sources rather than quietly
  // omitting them. A pack whose starvation is real but UNRECORDED is the defect this asserts against.
  test("every pack's missing sources are exactly the ones the owner decision names", () => {
    const missingByPack = WORKFLOW_PACK_IDS.map((id) => [
      id,
      WORKFLOW_PACKS[id].operations.flatMap((op) => (op.state === "missing" ? [op.reads] : [])),
    ]);
    expect(missingByPack).toEqual([
      // reportsBusiness.ts business/operations/sentMail are `tenantQuery` — UI reads, not tools;
      // content.ts is `tenantQuery`-only by construction.
      ["business-pulse", ["phase26-summaries", "content-shelf"]],
      ["campaign-plan", ["crm-facts", "connector-financials", "content-shelf"]],
      ["customer-complaint", ["crm-facts", "connector-financials"]],
      // The only contact-shaped tools are `resolveContacts` (labels, never addresses) and
      // `stageCrmWrite`. Neither is a CRM read.
      ["sales-call-prep", ["crm-facts"]],
      // No filesystem, task-system, Canva or publishing tool, and no org-chart/role source.
      ["process-sop", ["org-roles", "task-system"]],
      // There is no tenant brand store: `brandVoice` is a per-plan optional string (schema.ts:757).
      ["brand-review", ["tenant-brand-guidance", "content-shelf"]],
    ]);
  });

  test("no pack is silently optimistic — every one declares at least one missing source", () => {
    for (const id of WORKFLOW_PACK_IDS) {
      expect(
        WORKFLOW_PACKS[id].operations.some((op) => op.state === "missing"),
        `${id} claims to see everything it was specified against`,
      ).toBe(true);
    }
  });
});

// 27-08. `PACK_SOURCE_PROBE_STATES` is a hand-written record of what `probeSources` returns, and a
// hand-written record of another module's behaviour is a claim, not a fact — the "verify
// cross-module claims" class. So it is checked against the probe's own `return` block: every state
// literal the probe can yield for a key must be declared, and nothing else may be.
test("the declared probe states are exactly what probeSources returns", () => {
  const src = readFileSync(
    new URL("../../backend/convex/workflowPackDiscovery.ts", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  // The probe's single `return { ... };` — anchored on the function so an unrelated object
  // literal elsewhere in the file cannot be scanned by accident.
  const probe = /async function probeSources[\s\S]*?\n {2}return \{\n([\s\S]*?)\n {2}\};/.exec(src);
  expect(probe, "probeSources' return block was not found — did it move or change shape?").not.toBe(
    null,
  );

  const found = new Map<string, Set<string>>();
  for (const line of (probe?.[1] ?? "").split("\n")) {
    const key = /^\s*"?([a-z-]+)"?:/.exec(line);
    if (key === null) continue;
    const states = [...line.matchAll(/"(available|partial|unavailable)"/g)].map((m) => m[1] ?? "");
    found.set(key[1] ?? "", new Set(states));
  }

  // Non-vacuity floor: an unparsed block yields an empty map, and every comparison below would
  // then be against nothing at all.
  expect([...found.keys()].sort()).toEqual([...REACHABLE_PACK_SOURCES].sort());
  for (const source of REACHABLE_PACK_SOURCES) {
    expect([...(found.get(source) ?? [])].sort(), `${source} probe states`).toEqual(
      [...PACK_SOURCE_PROBE_STATES[source]].sort(),
    );
  }
});

describe("preflight is computed in code, before the model call", () => {
  const allAvailable = (id: WorkflowPackId) =>
    Object.fromEntries(
      WORKFLOW_PACKS[id].operations.flatMap((op) =>
        op.state === "existing" && op.reads !== null ? [[op.reads, "available" as const]] : [],
      ),
    );

  test("a matrix-missing source is announced BEFORE the run and is never a surprise", () => {
    const pre = packPreflight("brand-review", allAvailable("brand-review"));
    expect(pre.missingKnown).toEqual(["tenant-brand-guidance", "content-shelf"]);
    expect(pre.missingRuntime).toEqual([]);
    // Every source the pack touches is resolved — reachable and missing alike.
    expect(pre.sources.map((s) => s.source)).toEqual([
      "vault",
      "tenant-brand-guidance",
      "content-shelf",
    ]);
    expect(pre.sources.find((s) => s.source === "tenant-brand-guidance")?.state).toBe(
      "unavailable",
    );
  });

  test("a source the pack CAN reach but did not get is a runtime miss, not a known one", () => {
    const pre = packPreflight("sales-call-prep", {
      ...allAvailable("sales-call-prep"),
      calendar: "unavailable",
    });
    expect(pre.missingKnown).toEqual(["crm-facts"]);
    expect(pre.missingRuntime).toEqual(["calendar"]);
  });

  test("an unreported reachable source counts as unavailable, never as available", () => {
    // Fail closed: absence of a state is not evidence of a working source.
    const pre = packPreflight("process-sop", { vault: "available" });
    expect(pre.missingRuntime).toEqual(["drive"]);
  });

  test("a partial source is degraded, not missing", () => {
    const pre = packPreflight("business-pulse", {
      vault: "partial",
      "finance-inputs": "available",
    });
    expect(pre.missingRuntime).toEqual([]);
    expect(pre.sources.find((s) => s.source === "vault")?.state).toBe("partial");
  });

  test("preflight refuses an unknown pack rather than guessing one", () => {
    expect(() => packPreflight("business_pulse" as WorkflowPackId, {})).toThrow(/unknown_pack/);
  });
});

// 27-04/05/06 author the six canonical `.md` bodies. Until the first one lands this asserts the
// corpus is EMPTY; the moment a body appears, all six must be present and every granted tool must
// be TAUGHT in its own body — a granted-but-unnamed tool errors nowhere and is simply never called
// (the `dispatchResearch` class: built, wired, scheduled, and mentioned zero times in the body).
test("every granted tool is taught in its pack's canonical body, for each body that exists", () => {
  const bodyFor = (id: WorkflowPackId) =>
    new URL(`../../contracts/skills/pack-${id}.md`, import.meta.url);
  const present = WORKFLOW_PACK_IDS.filter((id) => existsSync(bodyFor(id)));
  // CORRECTED 2026-08-23 (27-04). This was `present.length === 0 || === 6` — "never a half corpus".
  // That was wrong about how the phase actually lands: 27-04/05/06 are three INDEPENDENT lanes that
  // write TWO bodies each, so the rule reddened the moment the first lane committed and made wave 2
  // unlandable. The completeness requirement belongs where it is already enforced and where it can
  // actually be satisfied — 27-01's manifest refuses a HALF-populated adapted-body set, checked by
  // both `verify-knowledge-work-provenance.mjs` and `knowledgeWorkProvenance.test.ts`. What belongs
  // HERE is the per-body property, which bites the instant a body lands rather than waiting for six.
  expect(present.length).toBeLessThanOrEqual(WORKFLOW_PACK_IDS.length);
  for (const id of present) {
    const body = readFileSync(bodyFor(id), "utf8");
    for (const tool of toolsForWorkflowPack(id)) {
      expect(
        body.includes(tool),
        `pack-${id}.md never mentions \`${tool}\`, which it is granted — a withheld tool by omission`,
      ).toBe(true);
    }
  }
});

// THE PHRASE TABLE MUST SPEAK EACH BODY'S OWN LANGUAGE (2026-08-25).
//
// `MISSING_SOURCE_MENTIONS` is the ONLY prose-shaped assertion in the pack eval gate, and it is
// matched as a case-insensitive SUBSTRING against what the model wrote. The model's vocabulary comes
// from its body. So if a body teaches one wording for a gap and this table lists another, the eval
// fails a run that did exactly what it was told — which is what happened: `missingNamed:crm-facts`
// reddened 3 of 5 customer-complaint cases on TWO unrelated models before the table was widened.
//
// This test closes that loop by construction. It asserts the pack's own body contains at least one
// accepted phrase for each source the matrix calls missing for that pack — so a body edit that
// rephrases a gap, or a new pack whose author writes naturally, reddens HERE rather than as a
// mystery eval failure that reads like a model defect.
//
// It checks the BODY, not a model reply: the body is the thing under our control, and a body that
// cannot express its own gaps in accepted words cannot be rescued by a better model.
test("every pack body can name its missing sources in words the eval accepts", () => {
  const bodyFor = (id: WorkflowPackId) =>
    new URL(`../../contracts/skills/pack-${id}.md`, import.meta.url);
  // SCOPED TO THE GAP SECTION, NOT THE WHOLE BODY — and this correction is the point of the test.
  // The first version matched the whole file and was VACUOUS: pack-customer-complaint.md contains
  // "a CRM" (describing what a human rep can do) and "the contact record" (in "Never write to the
  // contact record"), so it passed on two mentions that are not the gap statement at all, while the
  // gap statement itself used none of the accepted words. Proven by mutation: removing the widened
  // phrases left the whole-body version GREEN.
  //
  // The section that teaches the model how to WORD a gap is the one that must contain the wording.
  const gapSection = (body: string): string | null => {
    const start = body.search(/^## what you cannot (read|do)/im);
    if (start === -1) return null;
    const rest = body.slice(start);
    const next = rest.slice(1).search(/^## /m);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };
  for (const id of WORKFLOW_PACK_IDS.filter((p) => existsSync(bodyFor(p)))) {
    const raw = readFileSync(bodyFor(id), "utf8");
    const section = gapSection(raw);
    const missing = WORKFLOW_PACKS[id].operations
      .filter((op) => op.state === "missing" && op.reads !== null)
      .map((op) => op.reads as keyof typeof MISSING_SOURCE_MENTIONS);
    if (missing.length > 0)
      expect(
        section !== null,
        `pack-${id}.md has no "## What you CANNOT read/do, and must say so" section, but the matrix ` +
          `says ${[...new Set(missing)].join(", ")} is missing for this pack. The model is never ` +
          `taught to name the gap, so \`missingNamed\` can only fail.`,
      ).toBe(true);
    const body = (section ?? "").toLowerCase();
    for (const source of new Set(missing)) {
      const phrases = MISSING_SOURCE_MENTIONS[source] ?? [];
      expect(
        phrases.some((phrase) => body.includes(phrase.toLowerCase())),
        `pack-${id}.md's gap section never uses ANY phrase MISSING_SOURCE_MENTIONS accepts for ` +
          `"${source}" ` +
          `(${phrases.join(" | ")}). The body teaches the model how to word this gap, so the eval ` +
          `will fail a run that followed its instructions. Widen the phrase list to the body's own ` +
          `wording — never narrow the body to the list, and never add a phrase the body FORBIDS.`,
      ).toBe(true);
    }
  }
});

describe("the pack activation gate's two extra evidence planes fail closed", () => {
  const browser = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      runner: "playwright:pack",
      runId: "r1",
      pass: true,
      skillVersions: { "pack-brand-review": 3 },
      authenticated: true,
      viewports: 2,
      casesPassed: 8,
      casesTotal: 8,
      deploymentRef: "dev",
      ts: 1,
      ...over,
    });

  const provenance = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      sourceRepo: "https://github.com/anthropics/knowledge-work-plugins",
      sourceCommit: "5267cf7000000000000000000000000000000000",
      sourcePaths: ["small-business/skills/brand-review/SKILL.md"],
      bodySha256: "a".repeat(64),
      license: "Apache-2.0",
      modificationNotice: "rewritten for Pikar; see NOTICE",
      skillVersions: { "pack-brand-review": 3 },
      ts: 1,
      ...over,
    });

  test("browser evidence passes only when it is passing, authenticated, multi-viewport and exactly pinned", () => {
    expect(hasPassingPackBrowserEvidence(browser(), "pack-brand-review", 3)).toBe(true);
    // Every one of these is a way a green-looking gate could open on the wrong thing.
    expect(hasPassingPackBrowserEvidence(undefined, "pack-brand-review", 3)).toBe(false);
    expect(hasPassingPackBrowserEvidence("{not json", "pack-brand-review", 3)).toBe(false);
    expect(hasPassingPackBrowserEvidence(browser({ pass: false }), "pack-brand-review", 3)).toBe(
      false,
    );
    expect(
      hasPassingPackBrowserEvidence(browser({ authenticated: false }), "pack-brand-review", 3),
    ).toBe(false);
    // Desktop only is not the UAT matrix.
    expect(hasPassingPackBrowserEvidence(browser({ viewports: 1 }), "pack-brand-review", 3)).toBe(
      false,
    );
    // The version pin is the whole point: evidence for v3 must never activate v4.
    expect(hasPassingPackBrowserEvidence(browser(), "pack-brand-review", 4)).toBe(false);
    // …nor may evidence for one pack activate another.
    expect(hasPassingPackBrowserEvidence(browser(), "pack-business-pulse", 3)).toBe(false);
  });

  test("provenance passes only when it is complete, licensed and exactly pinned", () => {
    expect(hasValidPackProvenance(provenance(), "pack-brand-review", 3)).toBe(true);
    expect(hasValidPackProvenance(undefined, "pack-brand-review", 3)).toBe(false);
    expect(hasValidPackProvenance("{not json", "pack-brand-review", 3)).toBe(false);
    expect(hasValidPackProvenance(provenance({ license: "MIT" }), "pack-brand-review", 3)).toBe(
      false,
    );
    // A branch or a tag is not provenance — only an exact commit is reproducible.
    expect(
      hasValidPackProvenance(provenance({ sourceCommit: "main" }), "pack-brand-review", 3),
    ).toBe(false);
    expect(hasValidPackProvenance(provenance({ sourcePaths: [] }), "pack-brand-review", 3)).toBe(
      false,
    );
    expect(
      hasValidPackProvenance(provenance({ bodySha256: "short" }), "pack-brand-review", 3),
    ).toBe(false);
    expect(
      hasValidPackProvenance(provenance({ modificationNotice: "" }), "pack-brand-review", 3),
    ).toBe(false);
    expect(hasValidPackProvenance(provenance(), "pack-brand-review", 4)).toBe(false);
  });

  // The six pack names are NOT gated skills, deliberately — `run-eval-golden.mjs` derives its
  // --skill list from GATED_SKILLS and drives runCockpitAgent over TEXT fixtures. Gating a name
  // that runner cannot drive mints candidates no eval run could certify (the document-analyst
  // deadlock). This is the assertion that keeps the two lists from being "tidied" together.
  test("pack skill names are derived and are absent from GATED_SKILLS", () => {
    expect([...WORKFLOW_PACK_SKILL_NAMES]).toEqual(WORKFLOW_PACK_IDS.map((id) => `pack-${id}`));
    for (const name of WORKFLOW_PACK_SKILL_NAMES) expect(isWorkflowPackSkill(name)).toBe(true);
    for (const name of ["cockpit-agent", "pack-", "pack-unknown", "", "toString"])
      expect(isWorkflowPackSkill(name), name).toBe(false);

    const src = readFileSync(new URL("../../contracts/src/skill.ts", import.meta.url), "utf8");
    const block = /export const GATED_SKILLS[^=]*=\s*\[([\s\S]*?)\];/.exec(src)?.[1];
    expect(block, "GATED_SKILLS not found in packages/contracts/src/skill.ts").toBeTruthy();
    for (const name of WORKFLOW_PACK_SKILL_NAMES)
      expect(
        (block ?? "").includes(name),
        `${name} entered GATED_SKILLS — run-eval-golden.mjs will now try to drive it`,
      ).toBe(false);
  });
});

// THE CLOSED-UNION TRAP, one plane over. `workflowPackEvents.packId` is a closed `v.literal` union
// and the pack ids live here. A pack id with no literal there makes the insert throw
// `ArgumentValidationError` — which, from inside a tool callback, the AI SDK SWALLOWS, so the event
// vanishes in prod while the whole suite stays green. That has now happened to `agentSteps.tool`
// five times (searchVault, evaluateBusiness, recordScorecardAnswer, resetPlan, stageCrmWrite).
// MUTATION that must turn this RED: delete one `v.literal` from the packId union in schema.ts.
test("every pack id has a workflowPackEvents.packId literal (the swallowed-event trap)", () => {
  const schemaSrc = readFileSync(
    new URL("../../backend/convex/schema.ts", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const table = schemaSrc.slice(schemaSrc.indexOf("workflowPackEvents: defineTable"));
  expect(table.length, "workflowPackEvents not found in schema.ts").toBeGreaterThan(0);
  const packIdUnion = table.slice(table.indexOf("packId: v.union("), table.indexOf("runId:"));
  const literals = [...packIdUnion.matchAll(/v\.literal\("([^"]+)"\)/g)].map((m) => m[1] as string);
  // Equality both ways: the six discoverable packs plus the measurement-only revenue stream.
  expect(literals.sort()).toEqual([...WORKFLOW_EVENT_STREAM_IDS].sort());
});
