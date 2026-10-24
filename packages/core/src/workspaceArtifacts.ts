/** Stable, content-free references. Labels and URLs never belong in persisted tab state. */
export type WorkspaceArtifactKind = "document" | "attachment" | "media" | "campaign" | "source";
export type WorkspaceArtifact = {
  key: string;
  kind: WorkspaceArtifactKind;
  title: string;
  createdAt: number;
  status: string;
  docId?: string;
  planId?: string;
  campaignId?: string;
  storageId?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type WorkspaceArtifactReference =
  | { kind: "document"; id: string }
  | { kind: "media"; id: string }
  | { kind: "campaign"; id: string }
  | { kind: "attachment"; id: string; storageId: string }
  | { kind: "source"; id: string; docId: string };

export function parseWorkspaceArtifactKey(key: string): WorkspaceArtifactReference | null {
  if (typeof key !== "string" || key.length > 512) return null;
  const parts = key.split(":");
  if (parts.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) return null;
  const [prefix, id, extra] = parts;
  if (parts.length === 2 && id) {
    if (prefix === "doc") return { kind: "document", id };
    if (prefix === "plan") return { kind: "media", id };
    if (prefix === "campaign") return { kind: "campaign", id };
  }
  if (parts.length === 3 && id && extra) {
    if (prefix === "attachment") return { kind: "attachment", id, storageId: extra };
    if (prefix === "source") return { kind: "source", id, docId: extra };
  }
  return null;
}
