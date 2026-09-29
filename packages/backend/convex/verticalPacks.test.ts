import { VERTICAL_CANDIDATES } from "@pikar/contracts/skills/verticalCandidates";
import { VERTICAL_EVAL_MODELS } from "@pikar/contracts/verticalEval";
import {
  VERTICAL_CORPUS,
  VERTICAL_CORPUS_SHA256,
  VERTICAL_EVALUATOR_SHA256,
} from "@pikar/contracts/verticalEvalCorpus";
import { verticalSkillName } from "@pikar/core/verticalPacks";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { VERTICAL_EVAL_AUDIT_NAMESPACE } from "./audit";
import { contentHash } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("users", { owner: true });
    const b = await ctx.db.insert("users", { owner: true });
    for (const tenantId of [String(a), String(b)])
      await ctx.db.insert("tenantProfiles", {
        tenantId,
        tier: "sme",
        tierSource: "confirmed",
        derivedAt: 1,
      });
    const candidate = async (
      tenantId: string,
      name: string,
      version: number,
      status: "active" | "archived" | "candidate",
      rollbackEligible: boolean,
    ) =>
      ctx.db.insert("tenantSkills", {
        tenantId,
        name,
        version,
        status,
        rollbackEligible,
        body: "Private contract details",
        authoredBody: "",
        author: "system",
        basedOnScope: "global",
        basedOnName: name,
        basedOnVersion: 1,
        createdAt: 1,
      });
    const aOld = await candidate(String(a), verticalSkillName("legal"), 1, "archived", true);
    const aNew = await candidate(String(a), verticalSkillName("legal"), 2, "active", true);
    const aPending = await candidate(String(a), verticalSkillName("legal"), 3, "candidate", false);
    const aHr = await candidate(String(a), verticalSkillName("hr"), 1, "active", true);
    const bOld = await candidate(String(b), verticalSkillName("legal"), 1, "archived", true);
    await candidate(String(b), verticalSkillName("legal"), 2, "active", true);
    const artifact = await ctx.db.insert("vaultDocuments", {
      tenantId: String(a),
      title: "Private contract details",
      kind: "document",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 12,
      contentHash: "h",
      text: "Keep this artifact",
      status: "ready",
      createdAt: 1,
    });
    return { a, b, aOld, aNew, aPending, aHr, bOld, artifact };
  });
  return {
    t,
    ...ids,
    asA: t.withIdentity({ subject: ids.a }),
    asB: t.withIdentity({ subject: ids.b }),
  };
}

describe("vertical controls use native tenant/version state", () => {
  test("only the exact released active row exposes bounded refs, never a foreign overlay or stale planes", async () => {
    const { t, asA, asB, a, b } = await setup();
    const name = "vertical-product" as const;
    const body = VERTICAL_CANDIDATES[name].body;
    const browserEvidence = JSON.stringify({
      runner: "playwright:pack",
      runId: "browser-product-1",
      pass: true,
      skillVersions: { [name]: 1 },
      authenticated: true,
      viewports: 2,
      casesPassed: 2,
      casesTotal: 2,
      deploymentRef: "private deployment details",
      ts: 1,
    });
    const globalId = await t.run(async (ctx) => {
      const candidateId = await ctx.db.insert("skills", {
        name,
        version: 1,
        body,
        provenance: JSON.stringify(VERTICAL_CANDIDATES[name].provenance),
        browserEvidence,
        status: "active",
        createdAt: 1,
      });
      const core = {
        schemaVersion: 1,
        kind: "native-owner-reviewed-vertical",
        name,
        version: 1,
        candidateId,
        bodyHash: await contentHash(body),
        runId: "123e4567-e89b-42d3-a456-426614174000",
        corpusHash: VERTICAL_CORPUS_SHA256,
        evaluatorHash: VERTICAL_EVALUATOR_SHA256,
        caseHashes: VERTICAL_CORPUS.product.map((item) => item.caseHash),
        caseReceiptIds: VERTICAL_CORPUS.product.map((_, i) => `case-${i}`),
        reviewReceiptIds: VERTICAL_CORPUS.product.map((_, i) => `review-${i}`),
        modelIds: [VERTICAL_EVAL_MODELS[0]],
        budgetId: "budget-1",
        passed: true,
      };
      const issuanceId = await ctx.db.insert("audit", {
        tenantId: VERTICAL_EVAL_AUDIT_NAMESPACE,
        correlationId: `verticalissuance:${core.runId}:${name}:1`,
        eventType: "vertical_evidence.issuance",
        actor: "system",
        ts: 1,
        payload: {
          evidenceHash: await contentHash(JSON.stringify(core)),
          candidateId,
          bodyHash: core.bodyHash,
        },
      });
      await ctx.db.patch(candidateId, { evidence: JSON.stringify({ ...core, issuanceId }) });
      return candidateId;
    });
    const workloadIds = await t.run(async (ctx) =>
      Promise.all(
        [1, 2].map((i) =>
          ctx.db.insert("vaultDocuments", {
            tenantId: String(b),
            title: `Prior product draft ${i}`,
            kind: "document",
            category: "workspace-docs",
            source: "agent",
            mimeType: "text/markdown",
            size: 12,
            contentHash: `h-${i}`,
            text: "Owned product source",
            status: "ready",
            createdAt: i,
          }),
        ),
      ),
    );
    await asB.mutation(api.verticalPacks.configure, {
      needs: ["product"],
      reviewReady: ["product"],
      confirmWorkload: { verticalId: "product", artifactIds: workloadIds },
    });
    const released = await asB.query(api.verticalPacks.discover, {});
    expect(released.recommendations).toMatchObject([{ id: "product", state: "available" }]);
    expect(released.controls.find((row) => row.id === "product")?.activeEvidenceRefs).toEqual({
      provenance: {
        sourceCommit: VERTICAL_CANDIDATES[name].provenance.sourceCommit,
        bodySha256: VERTICAL_CANDIDATES[name].provenance.bodySha256,
      },
      eval: { runId: "123e4567-e89b-42d3-a456-426614174000", issuanceId: expect.any(String) },
      uat: { runId: "browser-product-1", evidenceSha256: await contentHash(browserEvidence) },
    });
    expect(JSON.stringify(released)).not.toContain("private deployment details");
    expect(JSON.stringify(released)).not.toContain(body);

    const overlayId = await t.run((ctx) =>
      ctx.db.insert("tenantSkills", {
        tenantId: String(a),
        name,
        version: 1,
        status: "active",
        rollbackEligible: false,
        body: "Private overlay",
        authoredBody: "",
        author: "system",
        basedOnScope: "global",
        basedOnName: name,
        basedOnVersion: 1,
        createdAt: 1,
      }),
    );
    const shadowed = await asA.query(api.verticalPacks.discover, {});
    expect(shadowed.controls.find((row) => row.id === "product")).toMatchObject({
      candidateId: overlayId,
      activeVersion: null,
      activeEvidenceRefs: null,
    });
    expect(JSON.stringify(shadowed)).not.toContain(globalId);
    expect(JSON.stringify(shadowed)).not.toContain("Private overlay");
    expect(shadowed.recommendations).toEqual([]);
    expect(String(a)).not.toBe(String(b));

    await t.run((ctx) => ctx.db.patch(globalId, { browserEvidence: undefined }));
    expect(
      (await asB.query(api.verticalPacks.discover, {})).controls.find((row) => row.id === "product")
        ?.activeEvidenceRefs,
    ).toBeNull();
    await t.run((ctx) => ctx.db.patch(globalId, { browserEvidence, evidence: undefined }));
    expect(
      (await asB.query(api.verticalPacks.discover, {})).controls.find((row) => row.id === "product")
        ?.activeEvidenceRefs,
    ).toBeNull();
    await t.run((ctx) =>
      ctx.db.patch(globalId, {
        browserEvidence: browserEvidence.replace('"vertical-product":1', '"vertical-product":2'),
      }),
    );
    expect(
      (await asB.query(api.verticalPacks.discover, {})).controls.find((row) => row.id === "product")
        ?.activeEvidenceRefs,
    ).toBeNull();
  });
  test("workload picker paginates past sealed sources without exposing content or another tenant", async () => {
    const { t, asA, asB, a, b, artifact } = await setup();
    const foreign = await t.run(async (ctx) => {
      const base = {
        title: "Prior draft",
        kind: "document" as const,
        category: "workspace-docs" as const,
        source: "agent" as const,
        mimeType: "text/markdown",
        size: 12,
        contentHash: "h",
        text: "Private source contents",
        status: "ready" as const,
        createdAt: 1,
      };
      const foreign = await ctx.db.insert("vaultDocuments", { ...base, tenantId: String(b) });
      await ctx.db.insert("vaultDocuments", {
        ...base,
        tenantId: String(a),
        status: "pending_extraction",
      });
      const folderId = await ctx.db.insert("vaultFolders", {
        tenantId: String(a),
        name: "Still processing",
        source: "upload",
        status: "ingesting",
        memberCount: 6,
        terminalCount: 5,
        failedCount: 0,
        reservedCents: 0,
        spentCents: 0,
        createdAt: 1,
      });
      for (let i = 0; i < 5; i++)
        await ctx.db.insert("vaultDocuments", { ...base, tenantId: String(a), folderId });
      return foreign;
    });
    const first = await asA.query(api.verticalPacks.workloadSources, {});
    expect(first.docs).toEqual([]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await asA.query(api.verticalPacks.workloadSources, {
      cursor: first.nextCursor!,
    });
    expect(second).toEqual({
      docs: [{ docId: artifact, title: "Private contract details" }],
      nextCursor: null,
    });
    expect(JSON.stringify([first, second])).not.toContain("Private source contents");
    expect(JSON.stringify(second)).not.toContain(foreign);
    expect((await asB.query(api.verticalPacks.workloadSources, {})).docs).toEqual([
      { docId: foreign, title: "Prior draft" },
    ]);
    await expect(t.query(api.verticalPacks.workloadSources, {})).rejects.toThrow();
  });

  test("unregistered or unevaluated rows cannot become recommendations or new activations", async () => {
    const { t, asA, a, aPending, bOld } = await setup();
    await asA.mutation(api.verticalPacks.configure, { needs: ["legal"], reviewReady: ["legal"] });
    const result = await asA.query(api.verticalPacks.discover, {});
    expect(result.recommendations).toEqual([]);
    expect(result.controls).toHaveLength(6);
    expect(result.controls.find((row) => row.id === "legal")?.candidateId).toBe(aPending);
    expect(result.controls.every((row) => row.prerequisite === "native_evidence")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Private contract details");
    expect(JSON.stringify(result)).not.toContain(bOld);
    await expect(
      t.mutation(internal.skills.activateSkill, { name: verticalSkillName("legal"), version: 1 }),
    ).rejects.toThrow("NO_SUCH_SKILL_VERSION");
    await expect(
      asA.mutation(api.verticalPacks.recordShown, { verticalIds: ["legal"] }),
    ).rejects.toThrow("RECOMMENDATION_STALE");
    await expect(
      asA.mutation(api.verticalPacks.recordAccepted, { verticalId: "legal" }),
    ).rejects.toThrow("RECOMMENDATION_STALE");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("audit")
          .withIndex("by_tenant_event_ts", (q) =>
            q.eq("tenantId", String(a)).eq("eventType", "vertical_pack.outcome"),
          )
          .collect(),
      ),
    ).toEqual([]);
  });

  test("disable blocks effective loading before global fallback, affects one tenant and preserves artifacts", async () => {
    const { t, asA, a, b, artifact } = await setup();
    const load = (tenantId: string, id: "legal" | "hr" | "design") =>
      t.query(internal.skills.getEffectiveSkill, { tenantId, name: verticalSkillName(id) });
    expect((await load(String(a), "legal")).version).toBe(2);
    await asA.mutation(api.verticalPacks.setDisabled, { verticalId: "legal", disabled: true });
    await expect(load(String(a), "legal")).rejects.toThrow("VERTICAL_DISABLED");
    expect((await load(String(a), "hr")).version).toBe(1);
    expect((await load(String(b), "legal")).version).toBe(2);
    expect((await asA.query(api.vault.vaultDocText, { vaultDocId: artifact }))?.text).toBe(
      "Keep this artifact",
    );
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: verticalSkillName("design"),
        version: 1,
        body: "Global baseline",
        status: "active",
        createdAt: 1,
      }),
    );
    expect((await load(String(a), "design")).scope).toBe("global");
    await asA.mutation(api.verticalPacks.setDisabled, { verticalId: "design", disabled: true });
    await expect(load(String(a), "design")).rejects.toThrow("VERTICAL_DISABLED");
    expect((await load(String(b), "design")).scope).toBe("global");
    await asA.mutation(api.verticalPacks.setDisabled, { verticalId: "legal", disabled: false });
    expect((await load(String(a), "legal")).version).toBe(2);
  });

  test("rollback requires a same-tenant previously-active exact version; disable still wins", async () => {
    const { t, asA, a, aOld, aNew, aPending, aHr, bOld } = await setup();
    await expect(
      asA.mutation(api.verticalPacks.rollback, { verticalId: "legal", targetId: bOld }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      asA.mutation(api.verticalPacks.rollback, { verticalId: "legal", targetId: aPending }),
    ).rejects.toThrow("ROLLBACK_NOT_ELIGIBLE");
    await expect(
      asA.mutation(api.verticalPacks.rollback, { verticalId: "hr", targetId: aOld }),
    ).rejects.toThrow("NOT_FOUND");
    await asA.mutation(api.verticalPacks.setDisabled, { verticalId: "legal", disabled: true });
    expect(
      await asA.mutation(api.verticalPacks.rollback, { verticalId: "legal", targetId: aOld }),
    ).toEqual({ changed: true, version: 1 });
    expect((await t.run((ctx) => ctx.db.get(aNew)))?.status).toBe("archived");
    expect((await t.run((ctx) => ctx.db.get(aHr)))?.status).toBe("active");
    await expect(
      t.query(internal.skills.getEffectiveSkill, {
        tenantId: String(a),
        name: verticalSkillName("legal"),
      }),
    ).rejects.toThrow("VERTICAL_DISABLED");
  });

  test("foreign playbook refs and client-supplied scope/evidence are refused", async () => {
    const { asA, asB, artifact } = await setup();
    await expect(
      asB.mutation(api.verticalPacks.configure, {
        needs: ["legal"],
        reviewReady: ["legal"],
        legalPlaybookDocId: artifact,
      }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      asA.mutation(api.verticalPacks.setDisabled, {
        verticalId: "legal",
        disabled: true,
        tenantId: "foreign",
      } as never),
    ).rejects.toThrow();
    await expect(
      asA.query(api.verticalPacks.discover, { released: ["legal"] } as never),
    ).rejects.toThrow();
  });

  test("updating workload choices without a playbook argument preserves the confirmed playbook", async () => {
    const { t, asA, a, artifact } = await setup();
    await asA.mutation(api.verticalPacks.configure, {
      needs: ["legal"],
      reviewReady: ["legal"],
      legalPlaybookDocId: artifact,
    });
    await asA.mutation(api.verticalPacks.configure, {
      needs: ["legal", "data"],
      reviewReady: ["legal"],
    });
    const profile = await t.run((ctx) =>
      ctx.db
        .query("tenantProfiles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", String(a)))
        .unique(),
    );
    expect(profile?.verticalPreferences?.legalPlaybookDocId).toBe(artifact);
    expect(profile?.verticalPreferences?.needs).toEqual(["legal", "data"]);
  });

  test("a confirmed data source remains reachable beyond the five-row discovery window", async () => {
    const { t, asA, a } = await setup();
    await t.mutation(internal.skills.seedVerticalCandidates, {});
    const dataDocs = await t.run(async (ctx) => {
      const base = {
        tenantId: String(a),
        title: "Prior work",
        kind: "document" as const,
        category: "workspace-docs" as const,
        source: "agent" as const,
        size: 10,
        contentHash: "h",
        status: "ready" as const,
        createdAt: 1,
      };
      for (let i = 0; i < 5; i++)
        await ctx.db.insert("vaultDocuments", {
          ...base,
          title: `Unrelated text ${i}`,
          mimeType: "text/markdown",
          text: "Unrelated source",
        });
      const storageId = await ctx.storage.store(
        new Blob(["name,value\na,1\n"], { type: "text/csv" }),
      );
      const first = await ctx.db.insert("vaultDocuments", {
        ...base,
        title: "Confirmed data one",
        mimeType: "text/csv",
        storageId,
      });
      const second = await ctx.db.insert("vaultDocuments", {
        ...base,
        title: "Confirmed data two",
        mimeType: "text/csv",
        storageId,
      });
      return [first, second] as const;
    });
    await asA.mutation(api.verticalPacks.configure, {
      needs: ["data"],
      reviewReady: ["data"],
      confirmWorkload: { verticalId: "data", artifactIds: [...dataDocs] },
    });
    const prepare = () =>
      t.query(internal.verticalPacks.prepare, {
        tenantId: String(a),
        verticalId: "data",
        previewVersion: 1,
      });
    expect(await prepare()).toMatchObject({ ok: true, dataSourceId: dataDocs[0] });
    await t.run(async (ctx) => {
      const first = await ctx.db.get(dataDocs[0]);
      if (!first?.storageId) throw new Error("missing test storage");
      await ctx.storage.delete(first.storageId);
    });
    expect(await prepare()).toMatchObject({ ok: false, reason: "validator-unavailable" });
    await t.run(async (ctx) => {
      await ctx.db.delete(dataDocs[0]);
      await ctx.db.delete(dataDocs[1]);
    });
    expect(await prepare()).toMatchObject({ ok: false, reason: "validator-unavailable" });
  });
});
