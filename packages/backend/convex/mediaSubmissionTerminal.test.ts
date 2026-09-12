// @vitest-environment node
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
function requiredJob(ids: Id<"mediaJobs">[], index: number) {
  const id = ids[index];
  if (!id) throw new Error("missing fixture job");
  return id;
}
async function fixture(statuses: Doc<"mediaJobs">["status"][]) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const planId = await ctx.db.insert("plans", {
      tenantId: "media-terminal-test",
      threadId: "synthetic",
      status: "delivering",
      kind: "media",
      renderStatus: "pending",
      createdAt: Date.now(),
    });
    const jobIds = [];
    for (const [blockIndex, status] of statuses.entries()) {
      jobIds.push(
        await ctx.db.insert("mediaJobs", {
          tenantId: "media-terminal-test",
          planId,
          batchId: "batch",
          blockIndex,
          provider: "openai",
          kind: "tts",
          model: "openai/gpt-audio-mini",
          spec: { kind: "tts", characters: 20, voice: "alloy", sampleRateHertz: 24000 },
          promptHash: "synthetic-hash",
          status,
          estUsd: 0.01,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    }
    return { planId, jobIds };
  });
  return { t, ...ids };
}

test("a final TTS refusal terminalizes the pending reel without a provider verdict or render", async () => {
  const { t, planId, jobIds } = await fixture(["succeeded", "submitted"]);
  await t.mutation(internal.media.recordSubmission, {
    jobId: requiredJob(jobIds, 1),
    result: { ok: false, blocked: true, code: "tts_not_verbatim" },
  });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(planId)).toMatchObject({
      renderStatus: "failed",
      renderReason: "incomplete_batch",
    });
    const job = await ctx.db.get(requiredJob(jobIds, 1));
    expect(job).toMatchObject({ status: "blocked", failureReason: "tts_not_verbatim" });
    expect(job?.verdict).toBeUndefined();
    expect(await ctx.db.system.query("_scheduled_functions").collect()).toHaveLength(0);
  });
});

test("an early refusal waits for in-flight siblings and the final failure closes the wait", async () => {
  const { t, planId, jobIds } = await fixture(["submitted", "submitted"]);
  for (const [index, jobId] of jobIds.entries()) {
    await t.mutation(internal.media.recordSubmission, {
      jobId,
      result: { ok: false, blocked: false, code: "provider_error" },
    });
    expect(await t.run(async (ctx) => (await ctx.db.get(planId))?.renderStatus)).toBe(
      index === 0 ? "pending" : "failed",
    );
  }
});

test("late submission callbacks cannot overwrite a terminal job", async () => {
  const { t, jobIds } = await fixture(["succeeded"]);
  const jobId = requiredJob(jobIds, 0);
  const before = await t.run(async (ctx) => ctx.db.get(jobId));
  await t.mutation(internal.media.recordSubmission, {
    jobId,
    result: { ok: false, blocked: true, code: "tts_not_verbatim" },
  });
  expect(await t.run(async (ctx) => ctx.db.get(jobId))).toEqual(before);
});

test("old refused batches and late callbacks cannot fail a newer pending generation", async () => {
  const { t, planId, jobIds } = await fixture(["submitted"]);
  const oldId = requiredJob(jobIds, 0);
  await t.run(async (ctx) => {
    const old = await ctx.db.get(oldId);
    if (!old) throw new Error("missing fixture");
    const { _id, _creationTime, ...fields } = old;
    await ctx.db.insert("mediaJobs", {
      ...fields,
      batchId: "new-batch",
      createdAt: old.createdAt + 1,
    });
  });
  await t.mutation(internal.media.recordSubmission, {
    jobId: oldId,
    result: { ok: false, blocked: true, code: "tts_not_verbatim" },
  });
  expect(
    await t.mutation(internal.media.reconcileSubmissionFailure, {
      tenantId: "media-terminal-test",
      planId,
      batchId: "batch",
    }),
  ).toBe(false);
  expect(await t.run(async (ctx) => (await ctx.db.get(planId))?.renderStatus)).toBe("pending");
});

test("the final refused voice also terminates reserved captions without purchasing STT", async () => {
  const { t, planId, jobIds } = await fixture(["submitted"]);
  await t.run(async (ctx) => {
    await ctx.db.insert("mediaJobs", {
      tenantId: "media-terminal-test",
      planId,
      batchId: "batch",
      blockIndex: -1,
      provider: "openai",
      kind: "stt",
      model: "whisper-1",
      spec: { kind: "stt", audioMinutes: 1 },
      promptHash: "synthetic",
      status: "queued",
      estUsd: 0.01,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  await t.mutation(internal.media.recordSubmission, {
    jobId: requiredJob(jobIds, 0),
    result: { ok: false, blocked: true, code: "tts_not_verbatim" },
  });
  expect(await t.run(async (ctx) => ctx.db.get(planId))).toMatchObject({
    renderStatus: "failed",
    captionStatus: "failed",
    captionReason: "incomplete_takes",
  });
  expect(
    await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(0);
});

test("historical refusal reconciliation is tenant-bound, idempotent, and never starts healthy work", async () => {
  for (const status of ["blocked", "succeeded", "submitted"] as const) {
    const { t, planId } = await fixture([status]);
    const args = { tenantId: "media-terminal-test", planId, batchId: "batch" };
    expect(
      await t.mutation(internal.media.reconcileSubmissionFailure, { ...args, tenantId: "other" }),
    ).toBe(false);
    expect(await t.mutation(internal.media.reconcileSubmissionFailure, args)).toBe(
      status === "blocked",
    );
    expect(await t.mutation(internal.media.reconcileSubmissionFailure, args)).toBe(false);
    expect(
      await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect()),
    ).toHaveLength(0);
  }
});
