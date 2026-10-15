"use client";

import { api } from "@pikar/backend/api";
import type { ProfileInput } from "@pikar/core";
import {
  FOUNDATION_SECTIONS,
  FOUNDATION_TITLES,
  type FoundationAnswer,
  type FoundationSection,
} from "@pikar/core/foundation";
import { VAULT_FILE_CAP_BYTES } from "@pikar/vault/constants";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useVoiceSession } from "../voice/useVoiceSession";

type Preview = NonNullable<FunctionReturnType<typeof api.foundation.review>>;
type DocId = FunctionArgs<typeof api.vault.vaultDocText>["vaultDocId"];
type StorageId = FunctionArgs<typeof api.vault.vaultUpload>["storageId"];
const card = {
  padding: "1.25rem",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  background: "var(--card)",
  display: "grid",
  gap: "1rem",
};
const button = {
  padding: "0.75rem 1rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--rule)",
  background: "var(--teal-600)",
  color: "white",
  cursor: "pointer",
};
const input = {
  width: "100%",
  padding: "0.7rem",
  border: "1px solid var(--rule)",
  borderRadius: "0.5rem",
  background: "var(--card)",
  color: "var(--ink)",
};

export default function FoundationOnboarding({
  voiceEnabled = true,
  readOnly = false,
}: {
  voiceEnabled?: boolean;
  readOnly?: boolean;
}) {
  const draft = useQuery(api.foundation.get, {});
  const review = useQuery(api.foundation.review, {});
  const published = useQuery(api.foundation.publication, {});
  const history = useQuery(api.foundation.history, {});
  const begin = useMutation(api.foundation.begin);
  const answer = useAction(api.foundation.answer);
  const edit = useMutation(api.foundation.edit);
  const publish = useMutation(api.foundation.publish);
  const discard = useMutation(api.foundation.discard);
  const checkpoint = useMutation(api.foundation.checkpoint);
  const uploadUrl = useMutation(api.requests.generateUploadUrl);
  const upload = useMutation(api.vault.vaultUpload);
  const [pendingDoc, setPendingDoc] = useState<DocId | null>(null);
  const [sourceDocId, setSourceDocId] = useState<DocId | null>(null);
  const extracted = useQuery(
    api.vault.vaultDocText,
    pendingDoc ? { vaultDocId: pendingDoc } : "skip",
  );
  const [section, setSection] = useState<FoundationSection>("essentials");
  const [intent, setIntent] = useState<"current" | "planned">("current");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState<{
    revision: number;
    profile: ProfileInput;
    answers: FoundationAnswer[];
  } | null>(null);
  const revisionRef = useRef(0);
  useEffect(() => {
    if (draft) revisionRef.current = Math.max(revisionRef.current, draft.revision);
  }, [draft]);
  const pending = useRef(false);
  const voice = useVoiceSession(undefined, {
    onboarding: true,
    onAnswer: async (args) => {
      if (readOnly) throw new Error("Business setup is temporarily read-only.");
      if (pending.current) throw new Error("An answer is already saving. Please retry.");
      pending.current = true;
      setBusy(true);
      try {
        const result = await answer({ ...args, revision: revisionRef.current });
        revisionRef.current = result.revision;
        setError(null);
        return result;
      } catch (err) {
        setError("That answer could not be saved. Review your draft, then retry by typing below.");
        throw err;
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
  });
  const voiceActive = ["live", "paused", "connecting"].includes(voice.status);
  const savedEvents = useRef(new Set<string>());
  useEffect(() => {
    if (readOnly && voiceActive) void voice.end();
  }, [readOnly, voiceActive, voice.end]);
  useEffect(() => {
    if (!pendingDoc || !extracted) return;
    if (extracted.text?.trim()) {
      setText(extracted.text.slice(0, 8000));
      setSourceDocId(pendingDoc);
      setPendingDoc(null);
      setBusy(false);
      if (extracted.text.length > 8000)
        setError(
          "The first 8,000 characters are loaded for review. The complete source remains in your Knowledge Vault.",
        );
    } else if (extracted.status === "failed") {
      setPendingDoc(null);
      setBusy(false);
      setError(
        "This document could not be read. Paste the relevant information or retry from the Knowledge Vault.",
      );
    }
  }, [pendingDoc, extracted]);

  async function attach(file: File) {
    if (busy || voiceActive) return;
    if (
      file.size > VAULT_FILE_CAP_BYTES ||
      file.type.startsWith("audio/") ||
      file.type.startsWith("video/")
    ) {
      setError(
        "Attach a supported business document within the Vault file limit. Live onboarding does not store audio recordings.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bytes = await file.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const mimeType = file.type || "application/octet-stream";
      const response = await fetch(await uploadUrl(), {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      if (!response.ok) throw new Error("UPLOAD_FAILED");
      const { storageId } = (await response.json()) as { storageId: StorageId };
      const textFile = /\.(txt|md|csv)$/i.test(file.name);
      const result = await upload({
        storageId,
        filename: file.name,
        mimeType,
        size: file.size,
        contentHash: hash,
        ...(textFile ? { text: await file.text() } : {}),
      });
      setPendingDoc(result.vaultDocId);
    } catch {
      setBusy(false);
      setError("Upload failed. Please retry or paste your answer.");
    }
  }
  useEffect(() => {
    if (readOnly) return;
    if (!draft) return;
    for (const turn of voice.transcript) {
      if (!turn.final || savedEvents.current.has(turn.id)) continue;
      savedEvents.current.add(turn.id);
      void checkpoint({
        eventId: turn.id,
        text: turn.text.slice(0, 8000),
        speaker: turn.speaker,
      }).catch(() => {
        savedEvents.current.delete(turn.id);
        setError(
          "A transcript checkpoint could not be saved. Your accepted answers remain in the draft.",
        );
      });
    }
  }, [voice.transcript, checkpoint, draft, readOnly]);

  async function initialize() {
    setBusy(true);
    setError(null);
    try {
      await begin();
    } catch {
      setError("Could not open your saved interview. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!draft || busy || !text.trim()) return;
    if (voiceActive) {
      voice.sendText(text);
      setText("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await answer({
        revision: draft.revision,
        eventId: crypto.randomUUID(),
        answer: text,
        section,
        intent,
        ...(sourceDocId ? { sourceDocId } : {}),
      });
      revisionRef.current = result.revision;
      setText("");
      setSourceDocId(null);
      setPreview(null);
    } catch {
      setError(
        "Could not save your answer. Another tab may have changed this interview. Review the latest draft and retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveEdits() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      revisionRef.current = await edit(editing);
      setEditing(null);
      setPreview(null);
    } catch {
      setError("Your edits were not saved. Reload the current draft and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!preview || !draft || preview.revision !== draft.revision || voiceActive) return;
    setBusy(true);
    setError(null);
    try {
      await publish({ revision: preview.revision, reviewHash: preview.reviewHash });
      setPreview(null);
    } catch {
      setError(
        "Publication did not finish. Check that the reviewed revision is current and previous documents have finished indexing, then retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (readOnly)
    return (
      <main style={card}>
        <h1>Your saved business foundation</h1>
        <p>
          Business setup is temporarily read-only. Your saved information and approved documents
          remain available.
        </p>
        {error && <p role="alert">{error}</p>}
        {draft && (
          <>
            <h2>Saved revision {draft.revision}</h2>
            <dl>
              {Object.entries(draft.profile).map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {{
                      name: "Business name",
                      oneLineDescription: "Business description",
                      stage: "Business stage",
                      offering: "Offering",
                      targetCustomer: "Target customer",
                      primaryGoals: "Goals",
                      knownConstraints: "Constraints",
                    }[key as keyof ProfileInput] ?? key}
                  </dt>
                  <dd>{Array.isArray(value) ? value.join(", ") : value || "Unknown"}</dd>
                </div>
              ))}
            </dl>
            {draft.answers.map((answer) => (
              <p key={answer.eventId}>{answer.text}</p>
            ))}
            {review?.documents.map((doc) => (
              <details key={doc.section}>
                <summary>{doc.title}</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{doc.text}</pre>
              </details>
            ))}
            <p>
              Discarding removes unpublished changes and temporary transcripts. Approved documents
              remain.
            </p>
            <button
              type="button"
              disabled={busy || voiceActive}
              onClick={async () => {
                setBusy(true);
                try {
                  await discard({ revision: draft.revision });
                  setError(null);
                } catch {
                  setError("Could not discard this revision. Reload and try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Discard unpublished progress
            </button>
          </>
        )}
        <Link href="/dashboard/vault">Open Knowledge Vault</Link>
        <Link href="/dashboard/profile">Open Business Blueprint</Link>
      </main>
    );

  return (
    <main
      style={{
        maxWidth: "54rem",
        margin: "0 auto",
        padding: "2rem 1rem",
        display: "grid",
        gap: "1.5rem",
        color: "var(--ink)",
      }}
    >
      <header>
        <p style={{ color: "var(--teal-600)" }}>YOUR BUSINESS FOUNDATION</p>
        <h1>Build your business reference with Pikar</h1>
        <p>
          Let the live voice agent lead the conversation, or answer by typing. Review six reference
          documents before publishing them to your Knowledge Vault and Business Blueprint.
        </p>
      </header>
      {error && <p role="alert">{error}</p>}
      {draft === undefined ? (
        <p>Loading your interview…</p>
      ) : !draft ? (
        <section style={card}>
          <p>Start with the essentials. You can pause and return on another device.</p>
          <button type="button" style={button} disabled={busy} onClick={() => void initialize()}>
            Begin business setup
          </button>
        </section>
      ) : (
        <>
          <section style={card} aria-label="Business interview">
            <p>
              {draft.phase === "essential"
                ? "Essential business facts"
                : "Enrich your operating reference"}{" "}
              · Saved revision {draft.revision}
            </p>
            <p>
              Voice is processed live by our voice provider. Pikar does not store onboarding audio.
              Transcript checkpoints expire after seven days; saved answers and approved documents
              remain until you remove them.
            </p>
            {!voiceActive ? (
              <button
                type="button"
                style={button}
                disabled={!voiceEnabled || busy || !!editing}
                onClick={() => void voice.start()}
              >
                Start voice onboarding
              </button>
            ) : (
              <div>
                <button type="button" style={button} onClick={() => void voice.end()}>
                  Pause voice and save progress
                </button>
                {voice.status === "paused" && (
                  <button type="button" style={button} onClick={() => void voice.reconnect()}>
                    Reconnect microphone
                  </button>
                )}
              </div>
            )}
            {!voiceEnabled && (
              <p>
                Live onboarding is currently unavailable. Continue with the same saved interview by
                typing.
              </p>
            )}
            {voice.error && (
              <p role="alert">
                Voice could not connect. Your interview is saved; you can continue by typing.
              </p>
            )}
            <p role="status" aria-live="polite">
              {busy
                ? "Saving your answer…"
                : voiceActive
                  ? `Voice ${voice.status}`
                  : draft.reply ||
                    "Tell me what your business does, or what you are planning to build."}
            </p>
            {voice.transcript.length > 0 && (
              <details>
                <summary>Live transcript</summary>
                <section aria-label="Conversation transcript">
                  {voice.transcript.map((turn) => (
                    <p key={turn.id}>
                      <strong>{turn.speaker === "user" ? "You" : "Pikar"}:</strong> {turn.text}
                    </p>
                  ))}
                </section>
              </details>
            )}
            <label>
              Reference section
              <select
                style={input}
                value={section}
                disabled={voiceActive}
                onChange={(e) => setSection(e.target.value as FoundationSection)}
              >
                {FOUNDATION_SECTIONS.map((key) => (
                  <option key={key} value={key}>
                    {FOUNDATION_TITLES[key]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Does this describe today or a future plan?
              <select
                style={input}
                value={intent}
                disabled={voiceActive}
                onChange={(e) => setIntent(e.target.value as "current" | "planned")}
              >
                <option value="current">Current information</option>
                <option value="planned">Intended future practice</option>
              </select>
            </label>
            <label>
              Your answer
              <textarea
                style={input}
                rows={4}
                maxLength={8000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Describe your business in your own words. Unknowns are welcome."
              />
            </label>
            <label>
              Attach a business document
              <input
                type="file"
                accept=".txt,.md,.csv,.pdf,.docx,.xlsx,.pptx,image/*"
                disabled={busy || voiceActive}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void attach(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              style={button}
              disabled={busy || !text.trim() || !!editing}
              onClick={() => void send()}
            >
              {voiceActive ? "Send typed answer to voice agent" : "Save answer and continue"}
            </button>
            <p>
              {draft.answers.length} saved statements. Missing information remains marked as
              unknown.
            </p>
          </section>
          <section style={card}>
            <h2>Review your foundation</h2>
            <p>
              You can publish an initial foundation once the essential facts are complete, then add
              operating details later.
            </p>
            <button
              type="button"
              style={button}
              disabled={busy || voiceActive}
              onClick={() => {
                setEditing({
                  revision: draft.revision,
                  profile: draft.profile,
                  answers: draft.answers,
                });
                setPreview(null);
              }}
            >
              Edit profile and saved statements
            </button>
            {editing && (
              <div style={{ display: "grid", gap: "1rem" }}>
                {(
                  ["name", "oneLineDescription", "stage", "offering", "targetCustomer"] as const
                ).map((key) => (
                  <label key={key}>
                    {
                      {
                        name: "Business name",
                        oneLineDescription: "Business description",
                        stage: "Business stage",
                        offering: "Offering",
                        targetCustomer: "Target customer",
                      }[key]
                    }
                    <textarea
                      style={input}
                      value={editing.profile[key]}
                      maxLength={4000}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          profile: { ...editing.profile, [key]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
                {(["primaryGoals", "knownConstraints"] as const).map((key) => (
                  <label key={key}>
                    {key === "primaryGoals" ? "Goals (one per line)" : "Constraints (one per line)"}
                    <textarea
                      style={input}
                      value={editing.profile[key].join("\n")}
                      maxLength={4000}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          profile: {
                            ...editing.profile,
                            [key]: e.target.value.split("\n").filter(Boolean),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                {editing.answers.map((a, i) => (
                  <label key={a.eventId}>
                    {FOUNDATION_TITLES[a.section]} —{" "}
                    {a.intent === "planned" ? "planned" : "user-stated"}
                    <textarea
                      style={input}
                      maxLength={8000}
                      value={a.text}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          answers: editing.answers.map((x, n) =>
                            n === i ? { ...x, text: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          answers: editing.answers.filter((_, n) => n !== i),
                        })
                      }
                    >
                      Remove statement
                    </button>
                  </label>
                ))}
                <button
                  type="button"
                  style={button}
                  disabled={busy}
                  onClick={() => void saveEdits()}
                >
                  Save edits
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel edits
                </button>
              </div>
            )}
            <button
              type="button"
              style={button}
              disabled={!review || busy || voiceActive || !!editing}
              onClick={() => setPreview(review ?? null)}
            >
              Review six documents
            </button>
            {!review && (
              <p>
                Continue the essential interview before publishing. Tell Pikar your business
                description, team size, paid staff, revenue stage, funding, and years operating.
              </p>
            )}
            {preview && (
              <div style={{ display: "grid", gap: "1rem" }}>
                <p>
                  Reviewing revision {preview.revision}. These are drafts until you approve below.
                </p>
                {preview.documents.map((doc) => (
                  <details key={doc.section} open>
                    <summary>{doc.title}</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        fontFamily: "inherit",
                      }}
                    >
                      {doc.text}
                    </pre>
                  </details>
                ))}
                <details open>
                  <summary>Business Blueprint update</summary>
                  {preview.previousBlueprint && (
                    <details>
                      <summary>Previously approved Blueprint</summary>
                      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                        {preview.previousBlueprint}
                      </pre>
                    </details>
                  )}
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                    {preview.blueprint}
                  </pre>
                </details>
                <button
                  type="button"
                  style={button}
                  disabled={busy || voiceActive || preview.revision !== draft.revision}
                  onClick={() => void approve()}
                >
                  Approve revision {preview.revision} and publish six documents
                </button>
                {preview.revision !== draft.revision && (
                  <p role="alert">
                    This draft changed. Open Review six documents again before approving.
                  </p>
                )}
              </div>
            )}
          </section>
          {!!published?.length && (
            <section style={card}>
              <h2>Published business foundation</h2>
              <p>
                Your approved documents and Blueprint are saved. Search indexing may still be
                processing.
              </p>
              {published.map((doc) => (
                <p key={doc.id}>
                  {doc.title}:{" "}
                  {doc.status === "failed"
                    ? "Indexing incomplete — open the Knowledge Vault to retry"
                    : doc.status}
                </p>
              ))}
              <Link href="/dashboard/vault">Open Knowledge Vault</Link>
              <Link href="/dashboard/profile">Open Business Blueprint</Link>
              <Link href="/dashboard/workspace">Enter your workspace</Link>
              <p>You can return here to continue business setup.</p>
            </section>
          )}
          {!!history?.length && (
            <details style={card}>
              <summary>Approved revision history</summary>
              {history.map((version) => (
                <details key={version._id}>
                  <summary>
                    Revision {version.revision} — {new Date(version.createdAt).toLocaleDateString()}
                  </summary>
                  {version.documents.map((doc) => (
                    <details key={doc.section}>
                      <summary>{doc.title}</summary>
                      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                        {doc.text}
                      </pre>
                    </details>
                  ))}
                </details>
              ))}
            </details>
          )}
          <details style={card}>
            <summary>Discard unpublished interview progress</summary>
            <p>
              Approved Vault documents remain. Your unpublished changes will be discarded and the
              last approved revision restored, if one exists. Temporary transcript checkpoints will
              be removed.
            </p>
            <button
              type="button"
              disabled={busy || voiceActive}
              onClick={async () => {
                setBusy(true);
                try {
                  await discard({ revision: draft.revision });
                  revisionRef.current = 0;
                  setPreview(null);
                  setEditing(null);
                } catch {
                  setError("Could not discard this revision. Refresh and try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Discard draft
            </button>
          </details>
        </>
      )}
    </main>
  );
}
