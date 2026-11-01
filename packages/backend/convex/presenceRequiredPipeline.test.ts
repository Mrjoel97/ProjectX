import type { WebDocument } from "@pikar/contracts/webRuntime";
import { selectDesignProfile } from "@pikar/core/designKnowledge";
import { renderWebDocument, sha256Bytes } from "@pikar/core/webRuntime";
import { describe, expect, test, vi } from "vitest";
import {
  type RequiredDesignServices,
  requiredDesignTransition,
  runRequiredPresenceDesign,
} from "./lib/presenceRequiredPipeline";

const hash = (text: string) => sha256Bytes(new TextEncoder().encode(text));
const scope = {
  tenantId: "tenant",
  planId: "plan",
  revision: 2,
  briefHash: hash("brief"),
  sourceHash: hash("source"),
};
function setup() {
  const calls: string[] = [];
  const document = {
    kind: "site",
    title: "Fieldwork",
    brand: { name: "Fieldwork" },
    navigation: [],
    pages: [
      {
        slug: "home",
        title: "Home",
        nodes: [
          { kind: "hero", heading: "Identity with purpose" },
          {
            kind: "media",
            storageRef: `webasset:photo:${hash("image")}`,
            alt: "Studio materials",
            placement: "hero",
          },
        ],
      },
    ],
  };
  const services: RequiredDesignServices = {
    claim: vi.fn(async () => {
      calls.push("claim");
    }),
    assertCurrent: vi.fn(async () => {
      calls.push("current");
    }),
    stitch: vi.fn(async () => {
      calls.push("stitch");
      return { html: "reference", designHash: hash("reference") };
    }),
    kimi: vi.fn(async (_scope, reference) => {
      calls.push("kimi");
      expect(reference.html).toBe("reference");
      return {
        model: "or/moonshotai/kimi-k3.1-pro",
        text: JSON.stringify({ document, profile: selectDesignProfile().profile }),
      };
    }),
    validateBusinessContent: vi.fn(async () => true),
    render: vi.fn(async (doc: WebDocument) =>
      doc.pages.map((page) => ({
        pageSlug: page.slug,
        html: renderWebDocument(doc, { slug: "fieldwork", page: page.slug }),
      })),
    ),
    record: vi.fn(async (phase) => {
      calls.push(phase);
    }),
    routeSlug: "fieldwork",
  };
  return { services, calls };
}
describe("required Stitch and Kimi candidate pipeline", () => {
  test("calls both in order, validates native output and binds hashes without claiming fidelity", async () => {
    const { services, calls } = setup();
    const result = await runRequiredPresenceDesign(scope, services);
    expect(result.status).toBe("awaiting_browser_fidelity_review");
    expect(result.publicationAuthorized).toBe(false);
    expect(calls).toEqual([
      "claim",
      "current",
      "stitch",
      "stitch_complete",
      "current",
      "kimi",
      "current",
      "kimi_complete",
    ]);
    expect(services.record).toHaveBeenLastCalledWith(
      "kimi_complete",
      expect.objectContaining({
        documentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        artifactsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
  test("refuses budget admission before touching either provider", async () => {
    const { services } = setup();
    services.claim = vi.fn(async () => {
      throw Error("budget");
    });
    await expect(runRequiredPresenceDesign(scope, services)).rejects.toThrow("budget");
    expect(services.stitch).not.toHaveBeenCalled();
    expect(services.kimi).not.toHaveBeenCalled();
  });
  test("Stitch failure never falls back to Kimi alone or retries", async () => {
    const { services } = setup();
    services.stitch = vi.fn(async () => {
      throw Error("secret upstream error");
    });
    expect((await runRequiredPresenceDesign(scope, services)).status).toBe("stopped");
    expect(services.stitch).toHaveBeenCalledTimes(1);
    expect(services.kimi).not.toHaveBeenCalled();
    expect(services.record).toHaveBeenCalledWith("stopped", {
      reason: "provider_or_context_unavailable",
    });
  });
  test("a changed business revision stops before Kimi", async () => {
    const { services } = setup();
    let n = 0;
    services.assertCurrent = vi.fn(async () => {
      if (++n === 2) throw Error("stale");
    });
    expect((await runRequiredPresenceDesign(scope, services)).status).toBe("stopped");
    expect(services.kimi).not.toHaveBeenCalled();
  });
  test("a different model, arbitrary HTML or unsupported document is refused", async () => {
    for (const response of [
      { model: "other", text: "{}" },
      { model: "or/moonshotai/kimi-k3.1-pro", text: "<html>page</html>" },
    ]) {
      const { services } = setup();
      services.kimi = vi.fn(async () => response);
      expect((await runRequiredPresenceDesign(scope, services)).status).toBe("stopped");
      expect(services.render).not.toHaveBeenCalled();
    }
  });
  test("facts/asset checks and deterministic layout checks cannot be bypassed", async () => {
    const { services } = setup();
    services.validateBusinessContent = vi.fn(async () => false);
    expect((await runRequiredPresenceDesign(scope, services)).status).toBe("stopped");
    expect(services.render).not.toHaveBeenCalled();
    const second = setup();
    second.services.render = vi.fn(async () => []);
    expect((await runRequiredPresenceDesign(scope, second.services)).status).toBe("stopped");
  });
  test("phase machine rejects skipped providers and repeated terminal writes", () => {
    expect(requiredDesignTransition("claimed", "kimi_complete")).toBe(false);
    expect(requiredDesignTransition("stitch_complete", "kimi_complete")).toBe(true);
    expect(requiredDesignTransition("kimi_complete", "stopped")).toBe(false);
    expect(requiredDesignTransition("stopped", "stitch_complete")).toBe(false);
  });
});
