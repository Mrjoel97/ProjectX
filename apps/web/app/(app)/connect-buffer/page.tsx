"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

const button: CSSProperties = {
  minHeight: 44,
  padding: "10px 18px",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  background: "var(--card)",
  color: "var(--ink)",
  cursor: "pointer",
};
const input: CSSProperties = {
  display: "block",
  minHeight: 44,
  width: "100%",
  marginTop: 8,
  padding: 10,
  background: "var(--card)",
  color: "var(--ink)",
  border: "1px solid var(--rule)",
  borderRadius: 8,
};

export default function ConnectBufferPage() {
  const status = useQuery(api.buffer.status, {});
  const start = useAction(api.bufferActions.startConnect);
  const complete = useMutation(api.buffer.completeConnect);
  const organizations = useAction(api.bufferActions.organizations);
  const loadChannels = useAction(api.bufferActions.loadChannels);
  const save = useMutation(api.buffer.selectChannels);
  const completed = useRef(false);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [daily, setDaily] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedKey = status?.selectedChannelIds.join(",");
  const dailySaved = status?.dailyReports;
  const reportsAvailable = status?.reportsAvailable;
  useEffect(() => {
    setSelected(selectedKey ? selectedKey.split(",") : []);
    setDaily(!!reportsAvailable && !!dailySaved);
  }, [selectedKey, dailySaved, reportsAvailable]);
  useEffect(() => {
    if (completed.current) return;
    completed.current = true;
    const params = new URLSearchParams(window.location.search);
    const receipt = params.get("complete");
    if (receipt) {
      window.history.replaceState(window.history.state, "", "/connect-buffer");
      setBusy(true);
      void complete({ receipt })
        .then(
          () => setNotice("Buffer connected. Choose the organization and channels Pikar can use."),
          () =>
            setNotice(
              "This connection could not be completed for your signed-in Pikar account. Start a new connection.",
            ),
        )
        .finally(() => setBusy(false));
    } else if (params.has("result"))
      setNotice(
        params.get("result") === "cancelled"
          ? "Buffer connection cancelled."
          : "Buffer connection failed. You can try again.",
      );
  }, [complete]);
  async function listOrganizations() {
    setBusy(true);
    try {
      const list = await organizations({});
      setOrgs(list);
      if (list.length === 1) setOrgId(list[0]!.id);
    } catch {
      setNotice("Organizations could not load. Reconnect Buffer if access has expired.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ maxWidth: 760, display: "grid", gap: 20, padding: 24 }}>
      <h1>Connect your social accounts through Buffer</h1>
      <p>
        Pikar can prepare and schedule approved posts and track publishing for the channels you
        select.
      </p>
      <p>
        Buffer asks for account and post publishing access, plus background access to keep your
        connection current. You approve each post in Pikar before it is submitted.
      </p>
      <p>
        Buffer does not currently allow engagement reports through third-party app connections. You
        can view analytics in Buffer.
      </p>
      {status === undefined ? (
        <p>Checking connection…</p>
      ) : !status.configured ? (
        <p role="status">Buffer connection is not configured on this deployment yet.</p>
      ) : (
        <>
          <button
            type="button"
            style={button}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await start({});
                const url = new URL(result.url);
                if (url.origin !== "https://auth.buffer.com") throw new Error();
                window.location.assign(url.toString());
              } catch {
                setNotice("Buffer could not start the connection. Try again later.");
                setBusy(false);
              }
            }}
          >
            {status.connected ? "Reconnect Buffer" : "Connect Buffer"}
          </button>
          {status.connected && (
            <>
              <h2>Choose your organization</h2>
              <button
                type="button"
                style={button}
                disabled={busy}
                onClick={() => void listOrganizations()}
              >
                Load Buffer organizations
              </button>
              {orgs.length > 0 && (
                <>
                  <label>
                    Organization
                    <select
                      style={input}
                      value={orgId}
                      onChange={(event) => setOrgId(event.target.value)}
                    >
                      <option value="">Select an organization</option>
                      {orgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    style={button}
                    disabled={busy || !orgId}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await loadChannels({ organizationId: orgId });
                        setNotice("Choose which channels Pikar can use.");
                      } catch {
                        setNotice(
                          "Channels could not load. Check the Buffer organization and connection.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Load channels
                  </button>
                </>
              )}
              {status.organizationId && (
                <fieldset
                  style={{ padding: 20, border: "1px solid var(--rule)", borderRadius: 16 }}
                >
                  <legend>{status.organizationName} channels</legend>
                  {!status.channels.length && (
                    <p>
                      No connected channels were found. Connect social accounts in Buffer, then load
                      channels again.
                    </p>
                  )}
                  {status.channels.map((channel) => (
                    <label key={channel.id} style={{ display: "block", padding: "12px 0" }}>
                      <input
                        type="checkbox"
                        checked={selected.includes(channel.id)}
                        disabled={!channel.available || busy}
                        onChange={(event) =>
                          setSelected((ids) =>
                            event.target.checked
                              ? [...ids, channel.id]
                              : ids.filter((id) => id !== channel.id),
                          )
                        }
                      />{" "}
                      {channel.name} · {channel.service}
                      {!channel.available ? " — reconnect or unlock this channel in Buffer" : ""}
                    </label>
                  ))}
                  <label style={{ display: "block", padding: "16px 0" }}>
                    <input
                      type="checkbox"
                      checked={daily}
                      disabled={busy || !status.reportsAvailable}
                      onChange={(event) => setDaily(event.target.checked)}
                    />{" "}
                    Daily engagement reports (unavailable for Buffer app connections)
                  </label>
                  <button
                    type="button"
                    style={button}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await save({ channelIds: selected, dailyReports: daily });
                        setNotice("Channel selection saved. Your marketing workspace is ready.");
                      } catch {
                        setNotice(
                          "The selection could not be saved. Reload channels and try again.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Save channel selection
                  </button>
                </fieldset>
              )}
            </>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      <a href="/dashboard/marketing">Open social marketing</a>
      <a href="/dashboard/profile?tab=connections">Back to connections</a>
    </section>
  );
}
