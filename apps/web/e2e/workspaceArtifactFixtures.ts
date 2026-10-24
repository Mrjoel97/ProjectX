import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkspaceArtifactKey } from "@pikar/core/workspaceArtifacts";

export const ARTIFACT_QA_APP = "http://127.0.0.1:3342";
export const ARTIFACT_QA_BACKEND = "http://127.0.0.1:3340";
export const ARTIFACT_QA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const ARTIFACT_QA_PRIVATE = resolve(ARTIFACT_QA_ROOT, ".tmp/phase53-auth");
export type ArtifactType =
  | "pdf"
  | "presentation"
  | "workbook"
  | "image"
  | "video"
  | "campaign"
  | "attachment"
  | "document";
export interface ArtifactFixture {
  key: string;
  title: string;
  type?: ArtifactType;
  kind?: string;
  mimeType?: string;
  sha256?: string;
  bytes?: number;
  pages?: number;
  slides?: number;
  sheets?: number;
  items?: {
    label: string;
    kind: string;
    type?: "image" | "video";
    mediaKind?: "image" | "video";
    sha256?: string;
    bytes?: number;
  }[];
}
export interface ArtifactChatFixture {
  threadId: string;
  planId?: string;
  artifacts: ArtifactFixture[];
}
export interface ArtifactFixtures {
  provenance: string;
  appOrigin: string;
  target: string;
  users: {
    A: { userId: string; chats: { primary: ArtifactChatFixture; secondary: ArtifactChatFixture } };
    B: { userId: string; chats: { primary: ArtifactChatFixture } };
  };
  deleted: { threadId: string; key: string };
  attachmentCandidates?: {
    ownedKey: string;
    wrongThreadKey: string;
    foreignKey: string;
    unattachedStorageId: string;
  };
  arrival: {
    threadId: string;
    ready: boolean;
    key?: string;
    title?: string;
    sha256?: string;
    bytes?: number;
  };
}
export interface ArtifactIdentity {
  role: "A" | "B";
  email: string;
  password: string;
  userId: string;
  verified: boolean;
  onboardedFixture: boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length < 600;
function fail(field: string): never {
  throw new Error(`PHASE53_LOCAL_FIXTURE_INVALID_${field}`);
}

/** Deliberately closed to this disposable stack; never accepts a production/qualification target. */
export function validateArtifactFixtures(value: unknown): ArtifactFixtures {
  if (
    !record(value) ||
    value.appOrigin !== ARTIFACT_QA_APP ||
    value.target !== ARTIFACT_QA_BACKEND ||
    !nonempty(value.provenance)
  )
    fail("TARGET");
  if (!record(value.users)) fail("USERS");
  const users = value.users;
  for (const role of ["A", "B"]) {
    const user = users[role];
    if (!record(user) || !nonempty(user.userId) || !record(user.chats)) fail("IDENTITY");
    for (const chatName of role === "A" ? ["primary", "secondary"] : ["primary"]) {
      const chat = user.chats[chatName];
      if (
        !record(chat) ||
        !nonempty(chat.threadId) ||
        !Array.isArray(chat.artifacts) ||
        !chat.artifacts.length
      )
        fail("CHAT");
      for (const artifact of chat.artifacts) {
        if (
          !record(artifact) ||
          !nonempty(artifact.key) ||
          !parseWorkspaceArtifactKey(artifact.key) ||
          !nonempty(artifact.title)
        )
          fail("ARTIFACT");
        if (
          artifact.sha256 !== undefined &&
          (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(artifact.sha256))
        )
          fail("HASH");
        if (
          artifact.bytes !== undefined &&
          (!Number.isSafeInteger(artifact.bytes) || Number(artifact.bytes) < 1)
        )
          fail("BYTES");
      }
    }
  }
  const a = users.A as Record<string, unknown>,
    b = users.B as Record<string, unknown>;
  if (a.userId === b.userId) fail("DISTINCT_USERS");
  if (
    !record(value.deleted) ||
    !nonempty(value.deleted.key) ||
    !parseWorkspaceArtifactKey(value.deleted.key) ||
    !nonempty(value.deleted.threadId)
  )
    fail("DELETED");
  if (
    !record(value.arrival) ||
    !nonempty(value.arrival.threadId) ||
    typeof value.arrival.ready !== "boolean"
  )
    fail("ARRIVAL");
  return value as unknown as ArtifactFixtures;
}

export function loadArtifactFixtures(): ArtifactFixtures {
  try {
    return validateArtifactFixtures(
      JSON.parse(readFileSync(resolve(ARTIFACT_QA_PRIVATE, "fixtures.private.json"), "utf8")),
    );
  } catch {
    return fail("FILE");
  }
}

export function loadArtifactIdentities(
  fixtures: ArtifactFixtures,
): Record<"A" | "B", ArtifactIdentity> {
  try {
    const value: unknown = JSON.parse(
      readFileSync(resolve(ARTIFACT_QA_PRIVATE, "identities.private.json"), "utf8"),
    );
    if (
      !record(value) ||
      value.appOrigin !== ARTIFACT_QA_APP ||
      value.target !== ARTIFACT_QA_BACKEND ||
      !Array.isArray(value.identities)
    )
      fail("AUTH_TARGET");
    const result = {} as Record<"A" | "B", ArtifactIdentity>;
    for (const role of ["A", "B"] as const) {
      const identity = value.identities.find(
        (entry: unknown) => record(entry) && entry.role === role,
      );
      if (
        !record(identity) ||
        !nonempty(identity.email) ||
        !nonempty(identity.password) ||
        identity.userId !== fixtures.users[role].userId ||
        identity.verified !== true ||
        identity.onboardedFixture !== true
      )
        fail("AUTH_IDENTITY");
      result[role] = identity as unknown as ArtifactIdentity;
    }
    return result;
  } catch {
    return fail("AUTH_FILE");
  }
}

export function artifactType(artifact: ArtifactFixture): ArtifactType {
  if (artifact.type) return artifact.type;
  if (artifact.key.startsWith("campaign:")) return "campaign";
  if (artifact.key.startsWith("attachment:")) return "attachment";
  const mime = artifact.mimeType ?? "";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("presentation")) return "presentation";
  if (mime.includes("spreadsheet") || mime.includes("ms-excel")) return "workbook";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
