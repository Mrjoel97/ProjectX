"use client";

import { api } from "@pikar/backend/api";
import {
  FUNNEL_RAW_COUNT_CAVEAT,
  formatFunnelCount,
  MARKETING_CHANNEL_CATALOG,
  marketingChannelState,
  normalizeFunnelSource,
} from "@pikar/core/marketing";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Component, type CSSProperties, type ReactNode, useState } from "react";
import { ManagedServicesPanel } from "../skills-workflows/ManagedServicesPanel";
import { BufferMarketing } from "./BufferPanel";
import { SocialConnections } from "./SocialPanel";
import { ZernioMarketing } from "./ZernioPanel";

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 20,
  padding: 24,
  minWidth: 0,
};
const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
  gap: 16,
};
const control: CSSProperties = {
  minHeight: 44,
  width: "100%",
  minWidth: 0,
  padding: 10,
  border: "1px solid var(--rule)",
  borderRadius: 8,
  background: "var(--card)",
  color: "var(--ink)",
};
class SectionBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section style={card}>
        <h2>{this.props.name}</h2>
        <p role="alert">This section could not load. Reload the page to try again.</p>
      </section>
    ) : (
      this.props.children
    );
  }
}
export function ChannelsView({
  connected,
  configured,
}: {
  connected?: boolean;
  configured?: boolean;
}) {
  return (
    <section style={card}>
      <h2>Direct channel connections</h2>
      <p>
        Manage Buffer channels under Publishing. These rows describe separate direct connections.
      </p>
      <div style={grid}>
        {MARKETING_CHANNEL_CATALOG.filter(
          (channel) => channel.id === "gmail" || channel.id === "linkedin",
        ).map((channel) => {
          const state = marketingChannelState(channel.id, { connected, configured });
          return (
            <article key={channel.id} style={card}>
              <h3>{channel.name}</h3>
              {!state ? (
                <p role="status">Checking connection…</p>
              ) : state.status === "connected" ? (
                <p>Connected</p>
              ) : state.status === "connectable" ? (
                <a href={state.cta.href}>{state.cta.label}</a>
              ) : (
                <p>{state.reason}</p>
              )}
              <a href={`/dashboard/workspace?intent=marketing&channel=${channel.id}`}>
                Ask the Executive Agent
              </a>
              <p style={{ fontSize: 13 }}>Opens an unsent draft for your review.</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
function Channels() {
  const status = useQuery(api.gmailAuth.gmailStatus, {});
  const config = useQuery(api.gmailAuth.gmailConnectUrl, {});
  return <ChannelsView connected={status?.connected} configured={config?.configured} />;
}
type FunnelList = FunctionReturnType<typeof api.funnels.list>;
type Created = FunctionReturnType<typeof api.funnels.create>;
export function FunnelRows({
  data,
  onDeactivate,
  pending,
}: {
  data?: FunnelList;
  onDeactivate: (id: FunnelList["items"][number]["id"]) => void;
  pending: boolean;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!data) return <p role="status">Loading tracked links…</p>;
  return (
    <>
      <p>{FUNNEL_RAW_COUNT_CAVEAT}</p>
      {data.items.length === 0 && <p>No tracked links yet.</p>}
      {data.items.map((row) => (
        <article key={row.id} style={{ ...card, marginTop: 12 }}>
          <h3>{row.title}</h3>
          <p>
            Source: {row.source} · {row.status}
          </p>
          <p>
            Visits: {formatFunnelCount(row.counters?.visits)} · Claims:{" "}
            {formatFunnelCount(row.counters?.claims)} · Downloads:{" "}
            {formatFunnelCount(row.counters?.downloads)}
          </p>
          {row.status === "active" &&
            (confirm === row.id ? (
              <div>
                <p>Deactivate this link? Previously obtained files remain accessible.</p>
                <button
                  style={{ minHeight: 44, padding: "8px 12px" }}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    onDeactivate(row.id);
                    setConfirm(null);
                  }}
                >
                  Confirm deactivation
                </button>{" "}
                <button
                  style={{ minHeight: 44, padding: "8px 12px" }}
                  type="button"
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                style={{ minHeight: 44, padding: "8px 12px" }}
                type="button"
                onClick={() => setConfirm(row.id)}
              >
                Deactivate
              </button>
            ))}
        </article>
      ))}
      {data.hasMore && <p>Showing the newest 100 links. Older links are not shown.</p>}
    </>
  );
}
function TrackedLinks() {
  const data = useQuery(api.funnels.list, {});
  const artifacts = usePaginatedQuery(
    api.funnels.downloadableArtifacts,
    {},
    { initialNumItems: 25 },
  );
  const create = useMutation(api.funnels.create);
  const deactivate = useMutation(api.funnels.deactivate);
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <section style={card}>
      <h2>Tracked links</h2>
      <p>
        One source per link. Anyone with a link can access the original file. Replacing or deleting
        the original file can invalidate its links. Deactivation cannot revoke an already obtained
        storage URL or downloaded bytes.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const artifact = artifacts.results.find((row) => row.id === selected);
          if (busy || !artifact || !normalizeFunnelSource(source) || !title.trim()) {
            setNotice(
              "Choose a file, title and valid source (letters, numbers, spaces, hyphens or underscores).",
            );
            return;
          }
          setBusy(true);
          setNotice("");
          setCreated(null);
          try {
            setCreated(await create({ vaultDocId: artifact.id, title, source }));
          } catch {
            setNotice(
              "Creation could not be confirmed. Check the list before creating another link; a lost token cannot be recovered.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div style={grid}>
          <label>
            Original Vault file
            <select
              style={control}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              required
            >
              <option value="">Select a downloadable file</option>
              {artifacts.results.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title} ({row.mimeType})
                </option>
              ))}
            </select>
          </label>
          <label>
            Link title
            <input
              style={control}
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Source
            <input
              style={control}
              required
              maxLength={64}
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="newsletter"
            />
          </label>
        </div>
        {artifacts.status === "LoadingFirstPage" && <p role="status">Loading files…</p>}
        {artifacts.results.length === 0 && artifacts.status !== "LoadingFirstPage" && (
          <p>No downloadable files in the pages checked.</p>
        )}
        {artifacts.status === "CanLoadMore" && (
          <button
            style={{ minHeight: 44, padding: "8px 12px" }}
            type="button"
            onClick={() => artifacts.loadMore(25)}
          >
            Load more files
          </button>
        )}
        {artifacts.status === "LoadingMore" && <p role="status">Loading more files…</p>}
        <button style={{ minHeight: 44, marginTop: 16 }} type="submit" disabled={busy || !selected}>
          Create tracked link
        </button>
      </form>
      {created && (
        <div style={{ ...card, marginTop: 16 }}>
          <h3>Copy these links now</h3>
          <p>
            Shown only in this panel. Closing it or leaving the page loses the token. Links are not
            recovered from the list.
          </p>
          {(["visit", "claim", "download"] as const).map((stage) => (
            <div key={stage}>
              <label>
                {stage}
                <input style={control} readOnly value={created.urls[stage]} />
              </label>
              <button
                style={{ minHeight: 44, padding: "8px 12px" }}
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(created.urls[stage]);
                    setNotice(`${stage} link copied.`);
                  } catch {
                    setNotice("Copy failed. Select and copy the link manually.");
                  }
                }}
              >
                Copy {stage} link
              </button>
            </div>
          ))}
          <button
            style={{ minHeight: 44, padding: "8px 12px" }}
            type="button"
            onClick={() => setCreated(null)}
          >
            Close links
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <FunnelRows
        data={data}
        pending={busy}
        onDeactivate={async (id) => {
          if (busy) return;
          setBusy(true);
          setNotice("");
          try {
            await deactivate({ id });
            setCreated((current) => (current?.id === id ? null : current));
            setNotice("Link deactivated. Previously obtained files remain accessible.");
          } catch {
            setNotice("Deactivation could not be confirmed. Reload and check the link status.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}
export const LEAD_REASON_COPY = {
  suppressed: "Suppressed: outbound email remains blocked.",
  consent_missing: "Consent missing: outbound email remains blocked.",
  approval_required:
    "Consent available. A separate approval is required before any outbound email.",
} as const;
function CapturedLeads() {
  const record = useMutation(api.contacts.recordMarketingLead);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <section style={card}>
      <h2>Captured leads</h2>
      <p>
        Record a contact you obtained directly. This form does not send email.{" "}
        <a href="/dashboard/pipeline">View contacts in Pipeline</a>
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const form = event.currentTarget;
          const values = new FormData(form);
          setBusy(true);
          setNotice("");
          try {
            const result = await record({
              email: String(values.get("email")),
              name: String(values.get("name") || "") || undefined,
              company: String(values.get("company") || "") || undefined,
              ...(consent
                ? {
                    consent: {
                      wording: String(values.get("wording")),
                      context: String(values.get("context") || "") || undefined,
                    },
                  }
                : {}),
            });
            setNotice(LEAD_REASON_COPY[result.reason]);
            form.reset();
            setConsent(false);
          } catch {
            setNotice(
              "Contact could not be confirmed. Review the entered details and check Pipeline before trying again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div style={grid}>
          <label>
            Email
            <input style={control} name="email" type="email" maxLength={320} required />
          </label>
          <label>
            Name
            <input style={control} name="name" maxLength={160} />
          </label>
          <label>
            Company
            <input style={control} name="company" maxLength={200} />
          </label>
        </div>
        <label style={{ display: "block", padding: "16px 0" }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />{" "}
          I have explicit email consent to record
        </label>
        {consent && (
          <div style={grid}>
            <label>
              Exact consent wording
              <textarea style={control} name="wording" maxLength={4000} required />
            </label>
            <label>
              Consent context
              <input style={control} name="context" maxLength={1000} />
            </label>
          </div>
        )}
        <button type="submit" style={{ minHeight: 44 }} disabled={busy}>
          Record lead
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
const marketingTabs = [
  {
    id: "services",
    label: "Services",
    description: "Set up social marketing work, review progress and manage schedules.",
  },
  {
    id: "publishing",
    label: "Publishing",
    description: "Review drafts and approve exactly what goes to your selected channels.",
  },
  {
    id: "reports",
    label: "Reports",
    description: "Review engagement, source dates and the limits of your available insights.",
  },
  {
    id: "leads",
    label: "Leads & links",
    description: "Track shared files and capture leads with clear consent.",
  },
  {
    id: "accounts",
    label: "Connections",
    description: "Manage direct social access and other marketing channels.",
  },
] as const;
type MarketingTab = (typeof marketingTabs)[number]["id"];
export function MarketingView() {
  const [section, setSection] = useState<MarketingTab>("services");
  const [visited, setVisited] = useState<MarketingTab[]>(["services"]);
  const select = (id: MarketingTab) => {
    setSection(id);
    setVisited((current) => (current.includes(id) ? current : [...current, id]));
  };
  return (
    <main
      style={{
        display: "grid",
        gap: 24,
        minWidth: 0,
        maxWidth: "72rem",
        margin: "0 auto",
        padding: "clamp(1rem, 3vw, 2rem)",
      }}
    >
      <header>
        <h1 style={{ margin: "0 0 8px", fontSize: "1.75rem" }}>Marketing</h1>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          Plan your social work, review content and see what is working.
        </p>
      </header>
      <div
        role="tablist"
        aria-label="Marketing sections"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          borderBottom: "1px solid var(--rule)",
          paddingBottom: 12,
        }}
      >
        {marketingTabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`marketing-${tab.id}-tab`}
            aria-controls={`marketing-${tab.id}-panel`}
            aria-selected={section === tab.id}
            tabIndex={section === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next =
                marketingTabs[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? marketingTabs.length - 1
                      : (index + (event.key === "ArrowRight" ? 1 : marketingTabs.length - 1)) %
                        marketingTabs.length
                ];
              if (!next) return;
              select(next.id);
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`#marketing-${next.id}-tab`)
                ?.focus();
            }}
            style={{
              minHeight: 44,
              padding: "10px 16px",
              border: "1px solid var(--rule)",
              borderRadius: 8,
              background: section === tab.id ? "var(--canvas)" : "var(--card)",
              color: "var(--ink)",
              font: "inherit",
              fontWeight: section === tab.id ? 700 : 400,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {marketingTabs.map((tab) => (
        <section
          key={tab.id}
          role="tabpanel"
          id={`marketing-${tab.id}-panel`}
          aria-labelledby={`marketing-${tab.id}-tab`}
          hidden={section !== tab.id}
        >
          {visited.includes(tab.id) && (
            <div style={{ display: "grid", gap: 20, minWidth: 0 }}>
              <p style={{ margin: 0, color: "var(--ink-soft)" }}>{tab.description}</p>
              {tab.id === "services" && (
                <SectionBoundary name="Social marketing services">
                  <ManagedServicesPanel />
                </SectionBoundary>
              )}
              {tab.id === "publishing" && (
                <SectionBoundary name="Publishing">
                  <BufferMarketing />
                </SectionBoundary>
              )}
              {tab.id === "reports" && (
                <SectionBoundary name="Reports">
                  <ZernioMarketing />
                </SectionBoundary>
              )}
              {tab.id === "leads" && (
                <>
                  <SectionBoundary name="Tracked links">
                    <TrackedLinks />
                  </SectionBoundary>
                  <SectionBoundary name="Captured leads">
                    <CapturedLeads />
                  </SectionBoundary>
                </>
              )}
              {tab.id === "accounts" && (
                <>
                  <SectionBoundary name="Direct social accounts">
                    <SocialConnections />
                  </SectionBoundary>
                  <SectionBoundary name="Other channels">
                    <Channels />
                  </SectionBoundary>
                </>
              )}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
