"use node";

import { assessWebBrowserQuality, type WebBrowserPageReport } from "@pikar/core/webBrowserQuality";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { artifactHashes, canonicalArtifactHashes } from "./lib/presencePublication";
import { reviewPresenceScreenshots } from "./lib/presenceVisionReview";
import { internalAction, lifecycleActionContext } from "./lib/tenantLifecycle";

type Capture = {
  pageSlug: string;
  viewportWidth: number;
  reducedMotion: boolean;
  sha256: string;
  mimeType: string;
  base64: string;
};
const digest = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`presenceBrowserReview:${name}`);

async function readLimited(response: Response, max: number): Promise<string> {
  if (!response.body) throw Error("PRESENCE_CAPTURE_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw Error("PRESENCE_CAPTURE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** One bounded capture and exact-model visual review; incomplete or uncertain work stays private. */
export const run = internalAction({
  args: { tenantId: v.string(), projectId: v.id("webProjects"), version: v.number() },
  handler: async (rawCtx, args): Promise<{ status: string; reason?: string }> => {
    const ctx = { ...rawCtx, ...lifecycleActionContext(rawCtx, args.tenantId) };
    const endpoint = process.env.PRESENCE_BROWSER_REVIEW_URL;
    const secret = process.env.PRESENCE_BROWSER_REVIEW_SECRET;
    if (!endpoint || !secret || secret.length < 32)
      return { status: "pending", reason: "browser_worker_unconfigured" };
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".vercel.app") ||
      url.pathname !== "/api/presence/review" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return { status: "pending", reason: "browser_worker_configuration_invalid" };
    const read = () => ctx.runQuery(internal.presenceBrowserReview.runtimeInputs, args);
    const source = await read();
    if (!source) return { status: "stopped", reason: "review_context_changed" };
    if (source.review?.status === "passed") return { status: "passed" };
    if (!(await ctx.runMutation(internal.guardrails.preCall, { tenantId: args.tenantId })).ok)
      return { status: "pending", reason: "review_budget_or_service_paused" };
    const baseRunRef = digest({
      versionId: source.versionId,
      contentHash: source.contentHash,
      receipt: source.providerReceiptHash,
    }).slice(0, 16);
    const retrying = source.job?.state === "failed" && !source.job.preProviderRetry;
    const runRef = retrying
      ? digest({ priorRunRef: source.job!.runRef, attempt: 1 }).slice(0, 16)
      : baseRunRef;
    let retryEvidence:
      | {
          reportStorageId: NonNullable<typeof source.reportStorageId>;
          capture: Record<string, unknown>;
        }
      | undefined;
    if (retrying) {
      // Read only the existing owned capture; claim atomically validates its identity,
      // ownership, hard checks and conservative no-spend proof before a new attempt.
      if (!source.reportStorageId)
        return { status: "pending", reason: "retry_capture_unavailable" };
      try {
        const blob = await ctx.storage.get(source.reportStorageId);
        if (!blob || blob.size > 3_000_000)
          return { status: "pending", reason: "retry_capture_unavailable" };
        const capture = JSON.parse(await blob.text());
        retryEvidence = {
          reportStorageId: source.reportStorageId,
          capture: {
            status: capture.status,
            contentHash: capture.contentHash,
            providerReceiptHash: capture.providerReceiptHash,
            artifactHashes: capture.artifactHashes,
            reports: capture.reports,
            screenshots: Array.isArray(capture.screenshots)
              ? capture.screenshots.map(
                  ({ pageSlug, viewportWidth, reducedMotion, sha256, mimeType }: Capture) => ({
                    pageSlug,
                    viewportWidth,
                    reducedMotion,
                    sha256,
                    mimeType,
                  }),
                )
              : null,
          },
        };
      } catch {
        return { status: "pending", reason: "retry_capture_unavailable" };
      }
    }
    const scope = { tenantId: args.tenantId, versionId: source.versionId, runRef };
    const beforeCall = async () => {
      const current = await read();
      if (
        !current ||
        current.contentHash !== source.contentHash ||
        current.providerReceiptHash !== source.providerReceiptHash ||
        current.revision !== source.revision ||
        current.planId !== source.planId
      )
        throw Error("PRESENCE_REVIEW_CONTEXT_CHANGED");
      const qualified = await ctx.runMutation(internal.onlinePresence.designSnapshot, {
        tenantId: args.tenantId,
        planId: source.planId,
        expectedRevision: source.revision,
      });
      if (
        !qualified.ok ||
        !("artifact" in qualified) ||
        !qualified.artifact ||
        qualified.artifact.contentHash !== source.contentHash
      )
        throw Error("PRESENCE_REVIEW_SOURCES_CHANGED");
    };
    if (
      !(await ctx.runMutation(mutation("claim"), {
        ...scope,
        contentHash: source.contentHash,
        providerReceiptHash: source.providerReceiptHash,
        ...(retryEvidence ? { retryEvidence } : {}),
      }))
    )
      return { status: "pending", reason: "review_already_attempted" };
    try {
      await beforeCall();
      const expectedHashes = artifactHashes(source.artifacts);
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(260000),
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          contentHash: source.contentHash,
          providerReceiptHash: source.providerReceiptHash,
          routeSlug: source.routeSlug,
          artifacts: source.artifacts.map((artifact, index) => ({
            ...artifact,
            contentHash: expectedHashes[index]!.contentHash,
          })),
          assets: source.assets,
        }),
      });
      if (!response.ok) throw Error("PRESENCE_BROWSER_CAPTURE_FAILED");
      const raw = await readLimited(response, 3_200_000);
      const capture = JSON.parse(raw) as {
        status: string;
        contentHash: string;
        providerReceiptHash: string;
        artifactHashes: { pageSlug: string; contentHash: string }[];
        reports: WebBrowserPageReport[];
        screenshots: Capture[];
      };
      if (
        capture.status !== "captured" ||
        capture.contentHash !== source.contentHash ||
        capture.providerReceiptHash !== source.providerReceiptHash ||
        canonicalArtifactHashes(capture.artifactHashes) !==
          canonicalArtifactHashes(expectedHashes) ||
        !Array.isArray(capture.reports) ||
        !Array.isArray(capture.screenshots) ||
        capture.screenshots.length !== expectedHashes.length * 3
      )
        throw Error("PRESENCE_CAPTURE_BINDING_INVALID");
      const seen = new Set<string>();
      const screenshots = capture.screenshots.map((image) => {
        const mode = `${image.pageSlug}:${image.viewportWidth}:${image.reducedMotion}`;
        if (
          seen.has(mode) ||
          !expectedHashes.some((page) => page.pageSlug === image.pageSlug) ||
          !(
            (image.viewportWidth === 1440 && image.reducedMotion === false) ||
            (image.viewportWidth === 390 && typeof image.reducedMotion === "boolean")
          ) ||
          image.mimeType !== "image/jpeg" ||
          typeof image.base64 !== "string"
        )
          throw Error("PRESENCE_SCREENSHOT_INVALID");
        seen.add(mode);
        const bytes = new Uint8Array(Buffer.from(image.base64, "base64"));
        if (
          bytes.byteLength > 262144 ||
          bytes[0] !== 0xff ||
          bytes[1] !== 0xd8 ||
          sha256Bytes(bytes) !== image.sha256
        )
          throw Error("PRESENCE_SCREENSHOT_INTEGRITY");
        return {
          pageSlug: image.pageSlug,
          viewportWidth: image.viewportWidth,
          reducedMotion: image.reducedMotion,
          sha256: image.sha256,
          mimeType: image.mimeType,
          bytes,
        };
      });
      const reportStorageId = await ctx.storage.store(
        new Blob([raw], { type: "application/json" }),
      );
      const stored = [];
      for (const image of screenshots) {
        const { bytes, ...metadata } = image;
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array(bytes).buffer], { type: image.mimeType }),
        );
        stored.push({ ...metadata, storageId });
      }
      await ctx.runMutation(mutation("recordCapture"), {
        ...scope,
        reportStorageId,
        screenshots: stored,
      });
      await beforeCall();
      const assessment = assessWebBrowserQuality({
        pageSlugs: expectedHashes.map((page) => page.pageSlug),
        reports: capture.reports,
      });
      let fidelity = { matched: false, evidenceHash: digest(capture.reports) };
      let visualContrast = { passed: false, evidenceHash: digest(capture.reports) };
      if (assessment.status !== "fail") {
        const referenceId = source.providerReceipt.stitchImageStorageId;
        const reference = referenceId ? await ctx.storage.get(referenceId) : null;
        if (!reference || reference.size > 8_000_000) throw Error("PRESENCE_REFERENCE_UNAVAILABLE");
        const vision = await reviewPresenceScreenshots({
          ctx,
          tenantId: args.tenantId,
          planId: source.planId,
          revision: source.revision,
          runRef,
          beforeCall,
          referenceImage: {
            bytes: new Uint8Array(await reference.arrayBuffer()),
            mimeType: reference.type,
          },
          screenshots,
          pageSlugs: expectedHashes.map((page) => page.pageSlug),
          layoutPlan: source.layoutPlan,
          authoritativeDocument: source.document,
        });
        fidelity = vision.fidelity;
        visualContrast = vision.visualContrast;
        const visionStorageId = await ctx.storage.store(
          new Blob(
            [
              JSON.stringify({
                ...vision,
                contentHash: source.contentHash,
                providerReceiptHash: source.providerReceiptHash,
                screenshotHashes: screenshots.map((image) => image.sha256),
              }),
            ],
            { type: "application/json" },
          ),
        );
        await ctx.runMutation(mutation("recordVision"), { ...scope, storageId: visionStorageId });
      }
      await beforeCall();
      const result = await ctx.runMutation(internal.presenceBrowserReview.complete, {
        tenantId: args.tenantId,
        versionId: source.versionId,
        contentHash: source.contentHash,
        providerReceiptHash: source.providerReceiptHash,
        artifactHashes: expectedHashes,
        reports: capture.reports,
        fidelity,
        visualContrast,
      });
      await ctx.runMutation(mutation("finishJob"), {
        ...scope,
        state: "completed",
        ...(result.status !== "passed" ? { reason: "visual_quality_requires_repair" } : {}),
      });
      if (result.status !== "passed") {
        const repair = (await ctx.runAction(
          makeFunctionReference<"action">("presenceBrowserRepair:run"),
          args,
        )) as { status: string };
        if (repair.status === "repaired") return { status: "repairing" };
      }
      return { status: result.status };
    } catch {
      await ctx.runMutation(mutation("finishJob"), {
        ...scope,
        state: "failed",
        reason: "browser_review_incomplete",
      });
      return { status: "failed", reason: "browser_review_incomplete" };
    }
  },
});
