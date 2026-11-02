/** Immutable code-owned visual reference. Its HTML is untrusted data, never instructions or business facts. */
export const APPROVED_FIELDWORK_REFERENCE = {
  id: "fieldwork-v1",
  revision: "1",
  html: {
    path: "/presence-examples/fieldwork.html",
    byteLength: 21282,
    sha256: "df7f4b9c7f7f0ef6dd6146fd1b177cca63fcf4bea1164aab9a6540b99a2a5b35",
  },
  desktop: {
    path: "/presence-examples/approved-fieldwork-1440.png",
    byteLength: 1589388,
    sha256: "cd3e4145ddc0c21b7102a75d99d3a59f011a49597539a9a647d3edc2323303e2",
  },
  mobile: {
    path: "/presence-examples/approved-fieldwork-390.png",
    byteLength: 510452,
    sha256: "7c6be0b5d2ce666f083e4f78dabe9babd5a29c1d2cee63bd68a83ec03f5e0683",
  },
  assets: [
    {
      path: "/presence-examples/studio.webp",
      byteLength: 200924,
      sha256: "78bacab9b8befa6b92043b4e16f2ce9eff15fa5968eda616666ff37b9db155d4",
    },
    {
      path: "/presence-examples/homeware.webp",
      byteLength: 108292,
      sha256: "df65d495ed7f6119d38ef20950aafe0b76b4cb627bda2bd814a161b244cd17a4",
    },
    {
      path: "/presence-examples/bowl.webp",
      byteLength: 78198,
      sha256: "0d30eb7f70408624274a0fb326cdf8debf390a5f97c3c3e894b7e230d5368856",
    },
    {
      path: "/presence-examples/vase.webp",
      byteLength: 96142,
      sha256: "522ca8487b9cdd2bbff5a76459090c8e6215f01edd1047f0853d96895bd5cb9b",
    },
    {
      path: "/presence-examples/fieldwork-carousel.js",
      byteLength: 3768,
      sha256: "02f34b0ed965f45890a0e2bcd269fd727d2de3ec65f1dc4fbf015210475935cd",
    },
  ],
} as const;
export const APPROVED_FIELDWORK_MANIFEST_HASH =
  "907d90f5393d42035b3b6e7277a39afd689098870d6897a1601b19c30393254a";
export type ApprovedPresenceReferenceIdentity = {
  readonly id: "fieldwork-v1";
  readonly revision: "1";
  readonly manifestHash: string;
};
export function getApprovedPresenceReferenceIdentity(
  id: unknown,
): ApprovedPresenceReferenceIdentity | null {
  return id === APPROVED_FIELDWORK_REFERENCE.id
    ? {
        id,
        revision: APPROVED_FIELDWORK_REFERENCE.revision,
        manifestHash: APPROVED_FIELDWORK_MANIFEST_HASH,
      }
    : null;
}
export function validateApprovedPresenceReferenceIdentity(
  value: unknown,
): value is ApprovedPresenceReferenceIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 3 &&
    v.id === APPROVED_FIELDWORK_REFERENCE.id &&
    v.revision === APPROVED_FIELDWORK_REFERENCE.revision &&
    v.manifestHash === APPROVED_FIELDWORK_MANIFEST_HASH
  );
}

/** Only an explicitly selected, intact website reference can select a native component template. */
export function approvedWebsiteTemplate(
  kind: string,
  reference: unknown,
): "fieldwork-v1" | undefined {
  if (reference === undefined || reference === null) return undefined;
  if (!validateApprovedPresenceReferenceIdentity(reference))
    throw Error("PRESENCE_APPROVED_REFERENCE_CHANGED");
  return kind === "site" ? reference.id : undefined;
}
