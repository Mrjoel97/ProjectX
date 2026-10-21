"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@pikar/backend/api";
import { parseWorkspaceArtifactKey, type WorkspaceArtifact } from "@pikar/core/workspaceArtifacts";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { GenericId } from "convex/values";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArtifactViewer, ArtifactViewerBody } from "../artifacts/ArtifactViewer";
import { downloadOwnedOriginal } from "../artifacts/originalDownload";
import { CampaignCollection } from "./CampaignCollection";
import { CardList } from "./cards";
import { ErrorBoundary } from "./ErrorBoundary";
import { CanvasPane } from "./MediaCanvas";
import { type WorkspaceOutput, WorkspaceTabs } from "./WorkspaceTabs";
import {
  closeWorkspaceTab,
  emptyWorkspaceTabs,
  reconcileWorkspaceTabs,
  restoreWorkspaceTabs,
  selectWorkspaceTab,
  WORK_TAB,
  type WorkspaceTabState,
  workspaceStorageOwner,
} from "./workspaceTabState";

type Resolution = NonNullable<FunctionReturnType<typeof api.workspaceArtifacts.resolve>>;
const format = (item: WorkspaceArtifact): string => {
  if (item.kind === "campaign") return "Media batch";
  if (item.kind === "media") return item.mimeType?.startsWith("image/") ? "Image" : "Video";
  const mime = item.mimeType ?? "";
  if (mime.includes("presentation")) return "Slides";
  if (mime.includes("spreadsheet") || mime.includes("ms-excel")) return "Spreadsheet";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  return item.kind === "source" ? "Reference" : "Document";
};
const stateCopy: Record<string, string> = {
  ready: "Ready",
  complete: "Ready",
  succeeded: "Ready",
  rendered: "Ready",
  ready_for_approval: "Review",
  proposed: "Review",
  proposal: "Planning",
  draft: "Review",
  collecting: "Planning",
  running: "Producing",
  delivering: "Producing",
  partial: "Partly ready",
  failed: "Needs attention",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  reference: "Reference",
  needs_reconciliation: "Checking outcome",
};

export function ArtifactWorkspace({
  threadId,
  sending,
  planId,
  preferCanvas,
  onExitPlan,
}: {
  threadId?: string;
  sending: boolean;
  planId?: string;
  preferCanvas?: boolean;
  onExitPlan?: () => void;
}) {
  const owner = workspaceStorageOwner(useAuthToken());
  if (planId !== undefined && !parseWorkspaceArtifactKey(`plan:${planId}`))
    return (
      <div style={{ padding: 24 }}>
        <p role="alert">This production plan link is invalid.</p>
        <button type="button" onClick={onExitPlan}>
          Return to Work
        </button>
      </div>
    );
  if (!threadId)
    return (
      <div style={{ overflow: "auto", flex: 1 }}>
        <CardList sending={sending} hideArtifacts />
      </div>
    );
  return (
    <ErrorBoundary
      key={`${owner}:${threadId}`}
      label="artifact-workspace"
      fallback={
        <p role="alert">
          Your outputs could not be loaded. The chat is still available. Refresh to try again.
        </p>
      }
    >
      <ConversationWorkspace
        key={`${owner}:${threadId}`}
        threadId={threadId}
        owner={owner}
        sending={sending}
        planId={planId}
        preferCanvas={preferCanvas}
        onExitPlan={onExitPlan}
      />
    </ErrorBoundary>
  );
}

function ConversationWorkspace({
  threadId,
  owner,
  sending,
  planId,
  preferCanvas,
  onExitPlan,
}: {
  threadId: string;
  owner: string;
  sending: boolean;
  planId?: string;
  preferCanvas?: boolean;
  onExitPlan?: () => void;
}) {
  const storageKey = `pikar.artifact-tabs.v1:${owner}:${threadId}`;
  const [state, setState] = useState<WorkspaceTabState>(emptyWorkspaceTabs);
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState<WorkspaceArtifact[]>([]);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const expandedRoot = useRef<HTMLDivElement>(null);
  const legacyOpened = useRef(false);
  const emptyHistoryReads = useRef(0);
  const documents = usePaginatedQuery(
    api.workspaceArtifacts.list,
    { threadId, stream: "documents" },
    { initialNumItems: 8 },
  );
  const plans = usePaginatedQuery(
    api.workspaceArtifacts.list,
    { threadId, stream: "plans" },
    { initialNumItems: 1 },
  );
  const campaigns = usePaginatedQuery(
    api.workspaceArtifacts.list,
    { threadId, stream: "campaigns" },
    { initialNumItems: 8 },
  );
  const sources = usePaginatedQuery(
    api.workspaceArtifacts.list,
    { threadId, stream: "sources" },
    { initialNumItems: 1 },
  );
  const streams = [documents, plans, campaigns, sources];
  const loading = streams.some((stream) => stream.status === "LoadingFirstPage");
  const inventory = useMemo(() => {
    const map = new Map<string, WorkspaceArtifact>();
    const docIds = new Set<string>();
    for (const item of [
      ...documents.results,
      ...plans.results,
      ...campaigns.results,
      ...sources.results,
    ]) {
      if (item.docId && docIds.has(item.docId)) continue;
      if (item.docId) docIds.add(item.docId);
      map.set(item.key, item);
    }
    return [...map.values()];
  }, [documents.results, plans.results, campaigns.results, sources.results]);
  const pendingKeys = state.open
    .filter((key) => !inventory.some((item) => item.key === key) && !checkedKeys.includes(key))
    .slice(0, 4);
  const pendingKey = pendingKeys.join("|");
  const reopened = useQuery(
    api.workspaceArtifacts.resolveKeys,
    hydrated && pendingKeys.length ? { threadId, keys: pendingKeys } : "skip",
  );
  const resolution = useQuery(
    api.workspaceArtifacts.resolve,
    hydrated && state.active !== WORK_TAB ? { threadId, key: state.active } : "skip",
  );
  const all = useMemo(() => {
    const map = new Map(
      [...restored, ...inventory, ...(resolution ? [resolution.item] : [])].map((item) => [
        item.key,
        item,
      ]),
    );
    const byDocument = new Map<string, WorkspaceArtifact>();
    const others: WorkspaceArtifact[] = [];
    for (const item of map.values()) {
      if (!item.docId) {
        others.push(item);
        continue;
      }
      const prior = byDocument.get(item.docId);
      if (
        !prior ||
        item.key === state.active ||
        (prior.key !== state.active && item.key.startsWith("doc:"))
      )
        byDocument.set(item.docId, item);
    }
    return [...others, ...byDocument.values()].sort(
      (a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key),
    );
  }, [restored, inventory, resolution, state.active]);

  // Skip a bounded number of ordinary plan-only pages. Native Convex cursors preserve
  // reactive windows; the explicit Load earlier control remains available beyond this budget.
  useEffect(() => {
    if (plans.results.length || plans.status !== "CanLoadMore" || emptyHistoryReads.current >= 8)
      return;
    emptyHistoryReads.current += 1;
    plans.loadMore(2);
  }, [plans.results.length, plans.status, plans.loadMore]);

  useEffect(() => {
    let next = emptyWorkspaceTabs();
    try {
      next = restoreWorkspaceTabs(window.sessionStorage.getItem(storageKey));
    } catch {
      /* Disabled browser storage keeps live tabs. */
    }
    setState(next);
    setHydrated(true);
  }, [storageKey]);
  useEffect(() => {
    if (!hydrated || reopened === undefined || !pendingKey) return;
    setRestored((previous) => [
      ...new Map([...previous, ...reopened].map((item) => [item.key, item])).values(),
    ]);
    setCheckedKeys((previous) => [...new Set([...previous, ...pendingKey.split("|")])]);
  }, [hydrated, reopened, pendingKey]);
  useEffect(() => {
    if (!hydrated || loading || pendingKeys.length) return;
    setState((previous) => {
      const reconciled = reconcileWorkspaceTabs(previous, all);
      const next =
        planId === undefined ? reconciled : selectWorkspaceTab(reconciled, `plan:${planId}`);
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
    });
  }, [hydrated, loading, all, pendingKeys.length, planId]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* Private mode. */
    }
  }, [hydrated, storageKey, state]);
  useEffect(() => {
    if (hydrated && planId !== undefined)
      setState((previous) => selectWorkspaceTab(previous, `plan:${planId}`));
  }, [hydrated, planId]);
  useEffect(() => {
    if (!hydrated || loading || !preferCanvas || planId !== undefined || legacyOpened.current)
      return;
    const media = all.find((item) => item.kind === "media");
    if (media) {
      legacyOpened.current = true;
      setState((previous) => selectWorkspaceTab(previous, media.key));
    }
  }, [hydrated, loading, preferCanvas, planId, all.find]);
  useEffect(() => {
    if (!expanded) return;
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    expandedRoot.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const dialog =
        event.target instanceof HTMLElement ? event.target.closest('[role="dialog"]') : null;
      if (dialog && dialog !== expandedRoot.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        expandedRoot.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ) ?? [],
      ).filter((node) => !node.closest("[hidden]") && node.getAttribute("tabindex") !== "-1");
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", onKey);
      if (prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, [expanded]);

  function select(key: string) {
    setState((previous) => selectWorkspaceTab(previous, key));
    if (
      (planId !== undefined && key !== `plan:${planId}`) ||
      (preferCanvas && planId === undefined)
    )
      onExitPlan?.();
  }
  function close(key: string) {
    setState((previous) => closeWorkspaceTab(previous, key));
    if (planId !== undefined && key === `plan:${planId}`) onExitPlan?.();
  }
  const outputs: WorkspaceOutput[] = all.map((item) => ({
    ...item,
    kind: item.kind === "source" ? "document" : item.kind,
    format: format(item),
    status: stateCopy[item.status] ?? "In progress",
  }));
  if (state.active !== WORK_TAB && !outputs.some((item) => item.key === state.active)) {
    outputs.push({
      key: state.active,
      title: resolution === null ? "Unavailable output" : "Opening output…",
      kind: "media",
      format: "Output",
      status: "Unavailable",
      createdAt: 0,
    });
  }
  const style = expanded
    ? {
        position: "fixed" as const,
        inset: 0,
        zIndex: 100,
        display: "flex",
        background: "var(--card)",
      }
    : { display: "flex", minHeight: 0, minWidth: 0, flex: 1 };
  if (!hydrated) return <p role="status">Opening your workspace…</p>;
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is supplied only with the dialog role while expanded.
    <div
      ref={expandedRoot}
      style={style}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? "Expanded artifact workspace" : undefined}
    >
      <WorkspaceTabs
        outputs={outputs}
        state={state}
        onSelect={select}
        onClose={close}
        loading={loading}
        hasOlder={streams.some((stream) => stream.status !== "Exhausted")}
        loadingOlder={streams.some((stream) => stream.status === "LoadingMore")}
        onLoadOlder={() => {
          for (const stream of streams)
            if (stream.status === "CanLoadMore")
              stream.loadMore(stream === plans || stream === sources ? 2 : 8);
        }}
        toolbar={
          <button
            type="button"
            className="artifact-expand"
            aria-label={expanded ? "Restore workspace size" : "Expand workspace"}
            aria-pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Restore" : "Expand"}
          </button>
        }
      >
        {state.active === WORK_TAB ? (
          <div style={{ padding: 18 }}>
            <CardList threadId={threadId} sending={sending} hideArtifacts onOpenOutput={select} />
          </div>
        ) : resolution === undefined ? (
          <p style={{ padding: 24 }} role="status">
            Opening output…
          </p>
        ) : resolution === null ? (
          <p style={{ padding: 24 }} role="alert">
            This output is unavailable in this conversation. Choose another output or return to
            Work.
          </p>
        ) : (
          <ErrorBoundary
            key={state.active}
            label="selected-output"
            fallback={
              <p role="alert" style={{ padding: 24 }}>
                This preview could not be opened. Your other outputs and chat are available.
              </p>
            }
          >
            <SelectedOutput
              item={resolution}
              threadId={threadId}
              onOpenPlan={(id) => select(`plan:${id}`)}
            />
          </ErrorBoundary>
        )}
      </WorkspaceTabs>
    </div>
  );
}

function SelectedOutput({
  item,
  threadId,
  onOpenPlan,
}: {
  item: Resolution;
  threadId: string;
  onOpenPlan: (id: string) => void;
}) {
  if (item.kind === "document") return <ArtifactViewer doc={item.doc} />;
  if (item.kind === "media") return <MediaOutput planId={item.planId} threadId={threadId} />;
  if (item.kind === "campaign")
    return (
      <CampaignCollection
        campaignId={item.campaignId as GenericId<"mediaCampaigns">}
        threadId={threadId}
        onOpenPlan={onOpenPlan}
      />
    );
  return <AttachmentOutput item={item} threadId={threadId} />;
}

function AttachmentOutput({
  item,
  threadId,
}: {
  item: Extract<Resolution, { kind: "attachment" }>;
  threadId: string;
}) {
  const bytes = useQuery(api.workspaceArtifacts.download, { threadId, key: item.item.key });
  const mime = item.attachment.mimeType;
  if (bytes === undefined)
    return (
      <p style={{ padding: 24 }} role="status">
        Opening attachment…
      </p>
    );
  if (!bytes)
    return (
      <p style={{ padding: 24 }} role="alert">
        The original attachment is unavailable.
      </p>
    );
  return (
    <ArtifactViewerBody
      artifact={{
        id: item.item.key,
        title: item.attachment.filename,
        mimeType: mime,
        url: bytes.url,
        hasOriginal: true,
        status: "ready",
      }}
      onDownload={(signal) => downloadFile(bytes.url, item.attachment.filename, signal)}
    />
  );
}

export function downloadFile(url: string, filename: string, signal?: AbortSignal) {
  return downloadOwnedOriginal(url, filename, signal ?? new AbortController().signal);
}

function MediaOutput({ planId, threadId }: { planId: GenericId<"plans">; threadId: string }) {
  const plan = useQuery(api.plans.byId, { planId });
  const [storyboard, setStoryboard] = useState(false);
  const image = plan?.mediaMode === "image";
  const assets = useQuery(api.media.assetUrls, image && !storyboard ? { planId } : "skip");
  const reel = useQuery(api.media.reel, plan && !image && !storyboard ? { planId } : "skip");
  const result = image
    ? assets?.find((asset) => asset.kind === "image" && asset.status === "succeeded" && asset.url)
    : null;
  const url = image ? result?.url : reel?.url;
  const mime = image ? (result?.mimeType ?? "image/png") : "video/mp4";
  if (plan === undefined)
    return (
      <p style={{ padding: 24 }} role="status">
        Opening media…
      </p>
    );
  if (!plan || plan.threadId !== threadId)
    return (
      <p role="alert" style={{ padding: 24 }}>
        This media is unavailable in this conversation.
      </p>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="artifact-media-switch">
        <button
          type="button"
          aria-pressed={!storyboard}
          disabled={!url && !storyboard}
          onClick={() => setStoryboard(false)}
        >
          Preview
        </button>
        <button type="button" aria-pressed={storyboard || !url} onClick={() => setStoryboard(true)}>
          {image ? "Prompt and generation" : "Storyboard and generation"}
        </button>
        {url && !image && reel?.status !== "rendered" && (
          <span>Previous completed reel · current generation {reel?.status ?? "pending"}</span>
        )}
      </div>
      {storyboard || !url ? (
        <div style={{ padding: 18, overflow: "auto", minHeight: 0 }}>
          <CanvasPane threadId={threadId} planId={planId} />
        </div>
      ) : (
        <ArtifactViewerBody
          artifact={{
            id: `plan:${planId}`,
            title: plan.subject ?? (image ? "Generated image" : "Finished video"),
            mimeType: mime,
            url,
            hasOriginal: true,
          }}
          onDownload={(signal) =>
            downloadFile(url, image ? "generated-image.png" : "finished-video.mp4", signal)
          }
        />
      )}
    </div>
  );
}
