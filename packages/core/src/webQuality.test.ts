import type { WebDocument } from "@pikar/contracts/webRuntime";
import { describe, expect, test } from "vitest";
import { assessWebQuality } from "./webQuality";
import { renderWebDocument } from "./webRuntime";

const photo = `webasset:photo:${"a".repeat(64)}`;
const document = (): WebDocument => ({
  kind: "site",
  title: "Fieldwork",
  brand: { name: "Fieldwork" },
  navigation: [{ label: "Home", path: "/p/fieldwork/home" }],
  pages: [
    {
      slug: "home",
      title: "Home",
      nodes: [
        { kind: "hero", heading: "Identity with purpose" },
        { kind: "media", storageRef: photo, alt: "Material & colour study", placement: "hero" },
        { kind: "form", id: "contact", fields: ["email"], consent: "Contact me about my inquiry." },
      ],
    },
  ],
});
const input = () => {
  const doc = document();
  return {
    document: doc,
    routeSlug: "fieldwork",
    artifacts: [
      { pageSlug: "home", html: renderWebDocument(doc, { slug: "fieldwork", page: "home" }) },
    ],
  };
};

describe("native website deterministic quality gate", () => {
  test("passing native bytes retain explicit browser review requirements and exact hashes", () => {
    const result = assessWebQuality(input());
    expect(result.ok).toBe(true);
    expect(result.browserReviewRequired).toBe(true);
    expect(result.requiredBrowserChecks).toContain("design_fidelity");
    const changed = input();
    changed.artifacts[0]!.html += " ";
    expect(assessWebQuality(changed).artifactHashes).not.toEqual(result.artifactHashes);
  });
  test("missing, duplicate or unrelated pages cannot masquerade as a complete build", () => {
    const value = input();
    expect(assessWebQuality({ ...value, artifacts: [] }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missing_artifact" })]),
    );
    expect(
      assessWebQuality({ ...value, artifacts: [...value.artifacts, ...value.artifacts] }).ok,
    ).toBe(false);
    expect(
      assessWebQuality({ ...value, artifacts: [{ ...value.artifacts[0]!, pageSlug: "other" }] }).ok,
    ).toBe(false);
  });
  test("broken local navigation and actions have repairable findings", () => {
    const value = input();
    value.document = {
      ...value.document,
      navigation: [{ label: "About", path: "/p/another/home" }],
      pages: [
        {
          ...value.document.pages[0]!,
          nodes: [
            ...value.document.pages[0]!.nodes,
            {
              kind: "cta",
              id: "go",
              label: "Explore",
              target: { kind: "local", path: "/missing" },
            },
          ],
        },
      ],
    };
    const result = assessWebQuality(value);
    expect(result.issues.filter((issue) => issue.code === "unresolved_local_target")).toHaveLength(
      2,
    );
  });
  test("removed image, consent and native form destination fail before review", () => {
    const value = input();
    value.artifacts[0]!.html = value.artifacts[0]!.html.replace(`data-asset-ref="${photo}"`, "")
      .replace("Contact me about my inquiry.", "")
      .replace("/forms/contact", "/forms/fake");
    expect(assessWebQuality(value).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["image_not_rendered", "inquiry_not_connected"]),
    );
  });
  test("executable markup and unbounded motion cannot qualify as native quality", () => {
    const value = input();
    value.artifacts[0]!.html = value.artifacts[0]!.html.replace(
      "</head>",
      "<style>h1{animation:spin 5s infinite}</style><script>alert(1)</script></head>",
    );
    expect(assessWebQuality(value).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["executable_artifact", "reduced_motion_missing"]),
    );
  });
  test("invalid structured content does not receive a static pass", () => {
    const value = input();
    value.document = { ...value.document, pages: [] };
    expect(assessWebQuality(value).ok).toBe(false);
  });
});
