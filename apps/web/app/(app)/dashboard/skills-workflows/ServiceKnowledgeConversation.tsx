"use client";

import { api } from "@pikar/backend/api";
import type { ServiceKnowledgeKey } from "@pikar/core/serviceKnowledge";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { type CSSProperties, useState } from "react";

type Conversation = NonNullable<FunctionReturnType<typeof api.serviceConversations.read>>;
const names: Record<ServiceKnowledgeKey, string> = {
  offering: "Your offer",
  targetCustomer: "Your customers",
  brandVoice: "Your voice",
  publishingBoundaries: "Content boundaries",
};
const control: CSSProperties = {
  minHeight: 44,
  padding: "0.5rem 0.8rem",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  background: "var(--paper)",
  color: "var(--ink)",
  font: "inherit",
  cursor: "pointer",
};
const muted: CSSProperties = { margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" };

/** The same durable conversation appears beside setup and in the workspace. No writes on render. */
export function ServiceKnowledgeConversation({
  serviceId = "social-marketing",
  disabled = false,
  budgetLimitCents,
  inbox = false,
}: {
  serviceId?: string;
  disabled?: boolean;
  budgetLimitCents?: number;
  inbox?: boolean;
}) {
  const view = useQuery(api.serviceConversations.read, { serviceId });
  if (view === undefined)
    return (
      <p role="status" style={muted}>
        Checking what Pikar needs…
      </p>
    );
  if (!view) return null;
  if (!view.nextQuestion && view.answers.length === 0 && view.conversationRevision === 0)
    return null;
  if (
    inbox &&
    (view.conversationRevision === 0 || view.state === "ready" || view.state === "deferred")
  )
    return null;
  return (
    <Conversation
      key={`${view.revision}:${view.controlRevision}`}
      view={view}
      disabled={disabled}
      budgetLimitCents={budgetLimitCents ?? view.budgetLimitCents}
      inbox={inbox}
    />
  );
}

function Conversation({
  view,
  disabled,
  budgetLimitCents,
  inbox,
}: {
  view: Conversation;
  disabled: boolean;
  budgetLimitCents?: number;
  inbox: boolean;
}) {
  const begin = useMutation(api.serviceConversations.begin);
  const save = useMutation(api.serviceConversations.save);
  const defer = useMutation(api.serviceConversations.defer);
  const confirm = useMutation(api.serviceConversations.confirm);
  const continueWork = useAction(api.serviceConversations.confirmAndContinue);
  const [editing, setEditing] = useState<ServiceKnowledgeKey | null>(null);
  const [draftQuestion, setDraftQuestion] = useState<Conversation["nextQuestion"]>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const question = draftQuestion ?? view.nextQuestion;
  const key = editing ?? question?.key;
  const blocked = busy || disabled;
  const cas = (snapshot = view) => ({
    serviceId: snapshot.serviceId,
    expectedRevision: snapshot.revision,
    expectedControlRevision: snapshot.controlRevision,
    expectedConversationRevision: snapshot.conversationRevision,
  });
  const act = async (work: () => Promise<void>) => {
    if (blocked) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await work();
    } catch {
      setError(
        "This step could not be saved. Your answer is kept here. Check the latest setup and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const ensureConversation = async () =>
    view.conversationRevision === 0 || view.needsRebind || view.state === "deferred"
      ? await begin(cas())
      : view;
  const submit = () =>
    act(async () => {
      if (!key || !value.trim()) return;
      const current = await ensureConversation();
      await save({ ...cas(current), key, value: value.trim() });
      setValue("");
      setEditing(null);
      setDraftQuestion(null);
      setNotice("Answer saved for review.");
    });
  const accept = (run: boolean) =>
    act(async () => {
      if (!view.reviewHash || !view.canConfirm) return;
      if (run) {
        const result = await continueWork({ ...cas(), reviewHash: view.reviewHash });
        setNotice(
          result.launch.state === "started"
            ? "Your business information is confirmed. Pikar is preparing the work."
            : result.launch.state === "already_completed"
              ? "Your information is confirmed. The original run has already finished; review its results in the service."
              : "Your information is confirmed. Work has not been confirmed as started; review the service status before continuing.",
        );
      } else {
        await confirm({ ...cas(), reviewHash: view.reviewHash });
        setNotice("Business information confirmed for your social service.");
      }
    });
  return (
    <section
      aria-label="Business conversation"
      style={{
        display: "grid",
        gap: 12,
        minWidth: 0,
        borderTop: "1px solid var(--rule)",
        padding: inbox ? "1rem" : "1rem 0 0",
        background: "var(--paper)",
      }}
    >
      <div>
        <h4 style={{ margin: "0 0 4px", fontSize: "1rem" }}>
          {view.state === "ready"
            ? "What Pikar knows for this work"
            : "A few details so Pikar can get to work"}
        </h4>
        <p style={muted}>
          Your answers stay with your business. Pikar asks again when a source changes or
          information conflicts.
        </p>
        <p style={{ ...muted, marginTop: 8, overflowWrap: "anywhere" }}>
          For your social goal: {view.goal}
        </p>
      </div>
      {view.needsRebind && (
        <div>
          <p style={muted}>
            Your service setup changed. Review it before continuing this conversation.
          </p>
          <button
            type="button"
            style={control}
            disabled={blocked}
            onClick={() =>
              void act(async () => {
                await begin(cas());
              })
            }
          >
            Review changed setup
          </button>
        </div>
      )}
      {view.state === "deferred" && !editing ? (
        <>
          <p style={muted}>
            This conversation is saved for later. Preparation waits for the essential details.
          </p>
          <button
            type="button"
            style={control}
            disabled={blocked}
            onClick={() =>
              void act(async () => {
                await begin(cas());
              })
            }
          >
            Continue the conversation
          </button>
        </>
      ) : (
        <>
          {view.answers.length > 0 && (
            <details open={view.state === "review"}>
              <summary style={{ cursor: "pointer", minHeight: 32 }}>
                Review your business information
              </summary>
              <dl style={{ margin: "8px 0", display: "grid", gap: 12 }}>
                {view.answers.map((answer, index) => (
                  <div key={`${answer.key}:${answer.sourceRef ?? index}`} style={{ minWidth: 0 }}>
                    <dt style={{ fontWeight: 600 }}>{names[answer.key]}</dt>
                    <dd
                      style={{ margin: "4px 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    >
                      {answer.value}
                    </dd>
                    <p style={muted}>
                      {answer.origin === "draft"
                        ? "Awaiting your confirmation"
                        : answer.sourceState !== "current"
                          ? "Saved source changed or needs confirmation"
                          : answer.confirmedAt === null
                            ? "Saved information · needs your confirmation"
                            : "Previously confirmed information"}
                    </p>
                    <button
                      type="button"
                      style={control}
                      disabled={blocked}
                      onClick={() => {
                        setEditing(answer.key);
                        setDraftQuestion(null);
                        setValue(answer.value);
                        setNotice("");
                      }}
                    >
                      Change {names[answer.key].toLowerCase()}
                    </button>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {key && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              style={{ display: "grid", gap: 8 }}
            >
              <label htmlFor={`service-answer-${view.serviceId}`} style={{ fontWeight: 600 }}>
                {editing ? `Update ${names[editing].toLowerCase()}` : question?.question}
              </label>
              {!editing && <p style={muted}>{question?.why}</p>}
              <textarea
                id={`service-answer-${view.serviceId}`}
                aria-label="Your business answer"
                maxLength={4000}
                rows={3}
                value={value}
                disabled={blocked}
                onChange={(event) => {
                  if (!editing) setDraftQuestion((current) => current ?? view.nextQuestion);
                  setValue(event.target.value);
                }}
                style={{
                  ...control,
                  cursor: "text",
                  width: "100%",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="submit"
                  style={{
                    ...control,
                    ...(blocked || !value.trim() ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                  }}
                  disabled={blocked || !value.trim()}
                >
                  {busy ? "Saving…" : "Continue"}
                </button>
                {(editing || draftQuestion) && (
                  <button
                    type="button"
                    style={control}
                    disabled={blocked}
                    onClick={() => {
                      setEditing(null);
                      setValue("");
                      setDraftQuestion(null);
                    }}
                  >
                    {editing ? "Cancel change" : "Cancel answer"}
                  </button>
                )}
              </div>
              <p style={muted}>
                You can also answer with voice or documents in{" "}
                <Link href="/dashboard/workspace">My Workspace</Link>. Review voice transcription
                before sending.
              </p>
            </form>
          )}
          {view.canConfirm &&
            (view.state !== "ready" || view.launchState === "resume_required") &&
            !editing &&
            !value.trim() && (
              <div style={{ display: "grid", gap: 8 }}>
                <p style={muted}>
                  Confirm the information above before Pikar uses it. Posts still require a separate
                  review before scheduling.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    style={control}
                    disabled={blocked}
                    onClick={() => void accept(false)}
                  >
                    Confirm business information
                  </button>
                  {budgetLimitCents !== undefined && (
                    <button
                      type="button"
                      style={{ ...control, background: "var(--teal-900)", color: "var(--card)" }}
                      disabled={blocked}
                      onClick={() => void accept(true)}
                    >
                      Confirm and let Pikar prepare
                    </button>
                  )}
                </div>
                {budgetLimitCents !== undefined && (
                  <p style={muted}>
                    Continuing starts one run using your saved accounts and a maximum of $
                    {(budgetLimitCents / 100).toFixed(2)}.
                  </p>
                )}
              </div>
            )}
          {view.state !== "ready" && (
            <button
              type="button"
              style={{ ...control, justifySelf: "start" }}
              disabled={blocked}
              onClick={() =>
                void act(async () => {
                  const current = await ensureConversation();
                  await defer(cas(current));
                  setNotice("Saved for later. No work was started.");
                })
              }
            >
              Finish this later
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={muted}>
          {notice}
        </p>
      )}
    </section>
  );
}
