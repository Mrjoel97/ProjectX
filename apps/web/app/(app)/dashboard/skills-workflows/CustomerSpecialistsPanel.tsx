"use client";

import { api } from "@pikar/backend/api";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { GenericId as Id } from "convex/values";
import { type FormEvent, useState } from "react";
import styles from "./customerLibrary.module.css";

type Specialist = FunctionReturnType<typeof api.customerSpecialists.list>["specialists"][number];

export function CustomerSpecialistsPanel() {
  const data = useQuery(api.customerSpecialists.list);
  const {
    results: choices,
    status: knowledgeStatus,
    loadMore,
  } = usePaginatedQuery(api.customerSpecialists.knowledgeChoices, data?.enabled ? {} : "skip", {
    initialNumItems: 12,
  });
  const create = useMutation(api.customerSpecialists.create);
  const update = useMutation(api.customerSpecialists.update);
  const archive = useMutation(api.customerSpecialists.archive);
  const [editing, setEditing] = useState<Specialist | "new" | null>(null);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <p role="status">Loading your specialists…</p>;
  if (!data.enabled)
    return (
      <section className={styles.library} aria-label="My specialists">
        <h2>My specialists</h2>
        <p className={styles.hint}>Custom specialists are available to workspaces in the pilot.</p>
      </section>
    );

  const selected = editing && editing !== "new" ? editing : undefined;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const fields = {
      name: String(values.get("name") ?? "").trim(),
      objective: String(values.get("objective") ?? "").trim(),
      audience: String(values.get("audience") ?? "").trim(),
      instructions: String(values.get("instructions") ?? "").trim(),
      knowledgeDocumentIds: values.getAll("knowledge").map(String) as Id<"vaultDocuments">[],
    };
    if (fields.knowledgeDocumentIds.length > 10) {
      setError("Choose up to 10 source documents for this specialist.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (selected)
        await update({
          specialistId: selected._id,
          expectedRevision: selected.revision,
          ...fields,
        });
      else await create(fields);
      setEditing(null);
      setNotice(`${fields.name} is saved. Choose this specialist when creating a workflow.`);
    } catch {
      setError(
        "The specialist could not be saved. Your entries are still here. If it was changed in another tab, cancel and reopen the latest version.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function archiveSpecialist(specialist: Specialist) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await archive({ specialistId: specialist._id, expectedRevision: specialist.revision });
      if (selected?._id === specialist._id) setEditing(null);
      setNotice(`${specialist.name} is archived.`);
    } catch {
      setError("The specialist could not be archived. Refresh to check its current version.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.library} aria-labelledby="my-specialists-title">
      <div className={styles.heading}>
        <div>
          <h2 id="my-specialists-title">My specialists</h2>
          <p className={styles.hint}>
            Build a specialist around your audience, knowledge and way of working.
          </p>
        </div>
        <button
          className={styles.primary}
          type="button"
          disabled={busy || editing !== null}
          onClick={() => {
            setEditing("new");
            setKnowledgeIds([]);
            setError(null);
            setNotice(null);
          }}
        >
          Create specialist
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {editing !== null && (
        <form
          key={selected?._id ?? "new"}
          className={styles.form}
          onSubmit={(event) => void save(event)}
          aria-label={selected ? "Edit specialist" : "Create specialist"}
        >
          <h3>{selected ? "Edit specialist" : "Create specialist"}</h3>
          <div className={styles.fields}>
            <label>
              Name
              <input
                name="name"
                required
                maxLength={80}
                defaultValue={selected?.name}
                placeholder="Retail buyer specialist"
                disabled={busy}
              />
            </label>
            <label>
              Audience
              <input
                name="audience"
                required
                maxLength={1000}
                defaultValue={selected?.audience}
                placeholder="Independent clothing retailers"
                disabled={busy}
              />
            </label>
          </div>
          <label>
            What should this specialist help you achieve?
            <textarea
              name="objective"
              required
              maxLength={1000}
              rows={2}
              defaultValue={selected?.objective}
              disabled={busy}
            />
          </label>
          <label>
            How should it work?
            <textarea
              name="instructions"
              required
              maxLength={8000}
              rows={4}
              defaultValue={selected?.instructions}
              placeholder="Describe the expertise, tone and standards you want."
              disabled={busy}
            />
          </label>
          <fieldset className={styles.knowledge} disabled={busy}>
            <legend>Knowledge from your Vault</legend>
            <p className={styles.hint}>Select up to 10 source documents for this specialist.</p>
            <div className={styles.knowledgeChoices}>
              {knowledgeStatus === "LoadingFirstPage" ? (
                <p role="status">Loading source documents…</p>
              ) : choices.length === 0 ? (
                <p className={styles.hint}>
                  {knowledgeStatus === "CanLoadMore"
                    ? "Load more documents to find available sources."
                    : "Add source documents to your Knowledge Vault to select them here."}
                </p>
              ) : (
                choices.map((doc) => (
                  <label key={doc._id}>
                    <input
                      type="checkbox"
                      name="knowledge"
                      value={doc._id}
                      checked={knowledgeIds.includes(doc._id)}
                      onChange={(event) =>
                        setKnowledgeIds((ids) =>
                          event.target.checked
                            ? [...ids, doc._id]
                            : ids.filter((id) => id !== doc._id),
                        )
                      }
                    />
                    {doc.title}
                  </label>
                ))
              )}
              {knowledgeIds
                .filter((id) => !choices.some((doc) => doc._id === id))
                .map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      name="knowledge"
                      value={id}
                      checked
                      onChange={() => setKnowledgeIds((ids) => ids.filter((value) => value !== id))}
                    />
                    Previously selected source (load more documents to see its name)
                  </label>
                ))}
            </div>
            {knowledgeStatus === "CanLoadMore" && (
              <button type="button" onClick={() => loadMore(12)}>
                Load more source documents
              </button>
            )}
            {knowledgeStatus === "LoadingMore" && <p role="status">Loading more sources…</p>}
          </fieldset>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="submit"
              disabled={busy || knowledgeStatus === "LoadingFirstPage"}
            >
              {busy ? "Saving…" : "Save specialist"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {data.specialists
        .filter((specialist) => !specialist.archived)
        .map((specialist) => (
          <article className={styles.item} key={specialist._id}>
            <div className={styles.heading}>
              <h3>{specialist.name}</h3>
              <span className={styles.hint}>Version {specialist.revision}</span>
            </div>
            <p>{specialist.objective}</p>
            <p className={styles.hint}>For {specialist.audience}</p>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy || editing !== null}
                onClick={() => {
                  setEditing(specialist);
                  setKnowledgeIds(specialist.knowledgeDocumentIds);
                  setError(null);
                  setNotice(null);
                }}
              >
                Edit {specialist.name}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void archiveSpecialist(specialist)}
              >
                Archive {specialist.name}
              </button>
            </div>
          </article>
        ))}
      {data.specialists.filter((specialist) => !specialist.archived).length === 0 &&
        editing === null && (
          <p className={styles.hint}>
            Create your first specialist, then choose it in My workflows.
          </p>
        )}
    </section>
  );
}
