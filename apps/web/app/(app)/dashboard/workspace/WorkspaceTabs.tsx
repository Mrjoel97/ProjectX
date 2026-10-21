// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the WAI-ARIA tabpanel is keyboard focusable so readers can enter preview content.
"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  FileDocIcon,
  GridIcon,
  ImageIcon,
  LayersIcon,
  SearchIcon,
  VideoIcon,
  XIcon,
} from "../vault/icons";
import styles from "./WorkspaceTabs.module.css";
import { WORK_TAB, type WorkspaceTabState } from "./workspaceTabState";

export type WorkspaceOutput = {
  key: string;
  title: string;
  kind: "document" | "attachment" | "media" | "campaign";
  format: string;
  status: string;
  createdAt: number;
};

function OutputIcon({ output }: { output?: WorkspaceOutput }) {
  if (!output) return <GridIcon size={16} />;
  if (output.kind === "campaign") return <LayersIcon size={16} />;
  if (output.format === "Image") return <ImageIcon size={16} />;
  if (output.format === "Video") return <VideoIcon size={16} />;
  return <FileDocIcon size={16} />;
}

export function WorkspaceTabs({
  outputs,
  state,
  onSelect,
  onClose,
  children,
  loading = false,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  toolbar,
}: {
  outputs: readonly WorkspaceOutput[];
  state: WorkspaceTabState;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  children: ReactNode;
  loading?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  toolbar?: ReactNode;
}) {
  const prefix = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [browse, setBrowse] = useState(false);
  const [filter, setFilter] = useState("");
  const all = new Map(outputs.map((output) => [output.key, output]));
  const open = state.open.flatMap((key) => {
    const item = all.get(key);
    return item ? [item] : [];
  });
  const keys = [WORK_TAB, ...open.map((output) => output.key)];
  const id = (key: string) => `${prefix}-${encodeURIComponent(key)}`;
  const matches = outputs.filter((output) =>
    `${output.title} ${output.format}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const unread = state.unread.filter((key) => all.has(key));

  useEffect(() => {
    void state.active;
    const active = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [state.active]);

  function tabKeys(event: KeyboardEvent, key: string) {
    const index = keys.indexOf(key);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % keys.length
        : event.key === "ArrowLeft"
          ? (index + keys.length - 1) % keys.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? keys.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      const nextKey = keys[next];
      if (nextKey) {
        onSelect(nextKey);
        document.getElementById(id(nextKey))?.focus();
      }
    } else if (event.key === "Delete" && key !== WORK_TAB) {
      event.preventDefault();
      onClose(key);
      const neighbor = keys[index + 1] ?? keys[index - 1] ?? WORK_TAB;
      document.getElementById(id(neighbor))?.focus();
    }
  }

  return (
    <div className={styles.workspace} data-testid="artifact-workspace">
      <div className={styles.tabBar}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Outputs in this conversation"
          ref={tabsRef}
        >
          {keys.map((key) => {
            const output = all.get(key);
            const label = key === WORK_TAB ? "Work" : (output?.title ?? "Output");
            return (
              <div
                key={key}
                className={`${styles.tab} ${state.active === key ? styles.active : ""}`}
                role="presentation"
              >
                <button
                  type="button"
                  id={id(key)}
                  role="tab"
                  aria-selected={state.active === key}
                  aria-controls={`${prefix}-panel`}
                  tabIndex={state.active === key ? 0 : -1}
                  title={`${label}${output ? ` · ${output.format}` : ""}`}
                  onKeyDown={(event) => tabKeys(event, key)}
                  onClick={() => onSelect(key)}
                >
                  <OutputIcon output={output} />
                  <span className={styles.tabTitle}>{label}</span>
                  {state.unread.includes(key) && (
                    <span className={styles.unread} role="img" aria-label="New output" />
                  )}
                </button>
                {key !== WORK_TAB && (
                  <button
                    type="button"
                    className={styles.close}
                    aria-label={`Close tab: ${label}`}
                    title="Close tab. The file stays in your outputs."
                    onClick={() => onClose(key)}
                  >
                    <XIcon size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className={styles.browseButton}
          aria-label="Browse conversation outputs"
          aria-expanded={browse}
          aria-controls={`${prefix}-outputs`}
          onClick={() => setBrowse((value) => !value)}
        >
          <LayersIcon size={16} />
          <span>Outputs</span>
          <span className={styles.count}>
            {outputs.length}
            {hasOlder ? "+" : ""}
          </span>
        </button>
        <div className={styles.tools}>{toolbar}</div>
      </div>
      {unread.length > 0 && (
        <div className={styles.notice} role="status">
          <span>
            {unread.length === 1
              ? "A new output is available"
              : `${unread.length} new outputs are available`}
          </span>
          <button
            type="button"
            onClick={() => {
              const newest = outputs.find((output) => unread.includes(output.key));
              if (newest) onSelect(newest.key);
            }}
          >
            Open latest
          </button>
        </div>
      )}
      <div className={styles.body}>
        {browse && (
          <aside
            className={styles.library}
            id={`${prefix}-outputs`}
            aria-label="All conversation outputs"
          >
            <div className={styles.libraryHeading}>
              <h3>Conversation outputs</h3>
              <button
                type="button"
                aria-label="Close output browser"
                onClick={() => setBrowse(false)}
              >
                <XIcon size={17} />
              </button>
            </div>
            <label className={styles.search}>
              <SearchIcon size={16} />
              <input
                aria-label="Find an output"
                placeholder="Find an output"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            <p className={styles.libraryHint}>Closing a tab keeps the file here.</p>
            <div className={styles.outputList}>
              {matches.map((output) => (
                <button
                  type="button"
                  key={output.key}
                  className={`${styles.output} ${state.active === output.key ? styles.selectedOutput : ""}`}
                  onClick={() => {
                    onSelect(output.key);
                    setBrowse(false);
                  }}
                >
                  <OutputIcon output={output} />
                  <span>
                    <strong>{output.title}</strong>
                    <small>
                      {output.format} · {output.status}
                    </small>
                  </span>
                  {state.unread.includes(output.key) && (
                    <span className={styles.unread} role="img" aria-label="New output" />
                  )}
                </button>
              ))}
              {!matches.length && (
                <p className={styles.empty}>
                  {loading
                    ? "Loading your outputs…"
                    : filter
                      ? "No matching output in the loaded history."
                      : "Your files will appear here as the agents create them."}
                </p>
              )}
              {hasOlder && (
                <button
                  type="button"
                  className={styles.loadMore}
                  disabled={loadingOlder}
                  onClick={onLoadOlder}
                >
                  {loadingOlder ? "Loading…" : "Load earlier outputs"}
                </button>
              )}
            </div>
          </aside>
        )}
        <div className={styles.content}>
          {state.active === WORK_TAB && (
            <div className={styles.outputHeader}>
              <div>
                <span className={styles.format}>Live workspace</span>
                <h3>Plans and activity</h3>
              </div>
            </div>
          )}
          <div
            id={`${prefix}-panel`}
            role="tabpanel"
            aria-labelledby={id(state.active)}
            tabIndex={0}
            className={styles.panel}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
