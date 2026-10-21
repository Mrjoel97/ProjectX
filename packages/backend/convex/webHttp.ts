import type { WebCtaNode, WebDocument, WebNode } from "@pikar/contracts/webRuntime";
import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { servePublishedAsset } from "./webAssets";

export function registerPublicWebRoutes(router: HttpRouter): void {
  // ── Phase 48 public structured runtime ──────────────────────────────────────
  // Public reads are resolved from the request host and path. No tenant, project, version, or
  // document is accepted from the caller; those values come from the published coordination head.
  const publicHeaders = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
  const runtimeHeaders = (declaration: { hosting: string; source: string }) => ({
    ...publicHeaders,
    "X-Pikar-Hosting": declaration.hosting,
    "X-Pikar-Source": declaration.source,
  });
  const publicNotFound = () => new Response("not found", { status: 404, headers: publicHeaders });
  const publicUnavailable = () =>
    new Response("unavailable", { status: 503, headers: publicHeaders });

  function publicSegments(req: Request): string[] {
    const segments = new URL(req.url).pathname.split("/").filter(Boolean);
    if (segments[0] !== "p" || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment)))
      return [];
    return segments.slice(1);
  }

  function publicHost(req: Request): string {
    return new URL(req.url).host.toLowerCase();
  }

  async function readBoundedPublicBody(
    req: Request,
    limit: number,
  ): Promise<ArrayBuffer | "invalid" | "too_large"> {
    const declared = req.headers.get("Content-Length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) return "too_large";
    const reader = req.body?.getReader();
    if (!reader) return "invalid";
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return "too_large";
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // The fresh allocation is zero-offset and exactly `size` bytes; no caller buffer is exposed.
    return bytes.buffer as ArrayBuffer;
  }

  function findPublicCta(nodes: readonly WebNode[], id: string): WebCtaNode | null {
    for (const node of nodes) {
      if (node.kind === "cta" && node.id === id) return node;
      if (node.kind === "section") {
        const nested = findPublicCta(node.children, id);
        if (nested) return nested;
      }
    }
    return null;
  }

  router.route({
    pathPrefix: "/p/",
    method: "GET",
    handler: httpAction(async (ctx, req) => {
      if (req.method !== "GET" && req.method !== "HEAD") return publicNotFound();
      const parts = publicSegments(req);
      if (parts[1] === "assets") return servePublishedAsset(ctx, req);
      if (parts.length !== 2) return publicNotFound();
      const slug = parts[0]!;
      const page = parts[1]!;
      const resolved = await ctx.runQuery(internal.webRuntime.resolvePage, {
        host: publicHost(req),
        slug,
        page,
      });
      if (resolved.state !== "published") return publicNotFound();
      try {
        const metric = await ctx.runMutation(internal.webForms.recordMetric, {
          host: publicHost(req),
          slug,
          page,
          kind: "page_view",
        });
        if (!metric.ok) return publicNotFound();
        const headers = runtimeHeaders(resolved.hostingDeclaration);
        return new Response(req.method === "HEAD" ? null : resolved.html, {
          status: 200,
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        });
      } catch {
        return publicUnavailable();
      }
    }),
  });

  router.route({
    pathPrefix: "/p/",
    method: "POST",
    handler: httpAction(async (ctx, req) => {
      if (req.method !== "POST") return publicNotFound();
      const parts = publicSegments(req);
      if (parts.length === 4 && parts[2] === "cta") {
        const slug = parts[0]!;
        const pageSlug = parts[1]!;
        const ctaId = parts[3]!;
        const resolved = await ctx.runQuery(internal.webProjects.resolvePublished, {
          host: publicHost(req),
          slug,
        });
        if (resolved.state !== "published" || resolved.project.kind === "storefront")
          return publicNotFound();
        const page = (resolved.version.document as WebDocument).pages.find(
          (candidate) => candidate.slug === pageSlug,
        );
        const cta = page ? findPublicCta(page.nodes, ctaId) : null;
        if (!page || !cta || cta.analytics !== true) return publicNotFound();
        try {
          const metric = await ctx.runMutation(internal.webForms.recordMetric, {
            host: publicHost(req),
            slug,
            page: pageSlug,
            kind: "cta_click",
          });
          if (!metric.ok) return publicNotFound();
        } catch {
          return publicUnavailable();
        }
        return new Response(null, {
          status: 303,
          headers: {
            ...runtimeHeaders(resolved.project.hostingDeclaration),
            Location: cta.target.kind === "local" ? cta.target.path : cta.target.url,
          },
        });
      }
      if (parts.length !== 4 || parts[2] !== "forms") return publicNotFound();
      const slug = parts[0]!;
      const page = parts[1]!;
      const formId = parts[3]!;
      const resolved = await ctx.runQuery(internal.webProjects.resolvePublished, {
        host: publicHost(req),
        slug,
      });
      if (resolved.state !== "published" || resolved.project.kind === "storefront")
        return publicNotFound();
      // Bound the actual stream, not just caller-controlled Content-Length, before formData
      // materializes any fields or files and before the form mutation can write coordination state.
      const bytes = await readBoundedPublicBody(req, 8192);
      if (bytes === "too_large")
        return new Response("too large", { status: 413, headers: publicHeaders });
      if (bytes === "invalid")
        return Response.json(
          { ok: false, outcome: "invalid" },
          { status: 400, headers: runtimeHeaders(resolved.project.hostingDeclaration) },
        );
      let form: FormData;
      try {
        const contentType = req.headers.get("Content-Type");
        if (!contentType) throw new Error("missing form content type");
        form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
      } catch {
        return Response.json(
          { ok: false, outcome: "invalid" },
          { status: 400, headers: runtimeHeaders(resolved.project.hostingDeclaration) },
        );
      }
      const raw: Record<string, unknown> = {};
      for (const [key, value] of form.entries()) {
        if (typeof value !== "string" || Object.hasOwn(raw, key))
          return Response.json(
            { ok: false, outcome: "invalid" },
            { status: 400, headers: publicHeaders },
          );
        raw[key] = value;
      }
      const bodyKey = [raw.email, raw.name, raw.company, raw.consent]
        .map((value) => String(value ?? ""))
        .join("\u001f");
      const idempotencyKey =
        req.headers.get("Idempotency-Key")?.trim() || String(raw.idempotencyKey ?? bodyKey);
      const forwarded =
        req.headers.get("CF-Connecting-IP") ??
        req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
      const result = await ctx.runMutation(internal.webForms.submit, {
        host: publicHost(req),
        slug,
        page,
        formId,
        raw,
        idempotencyKey,
        abuseKey: forwarded || "anonymous",
      });
      const status = result.ok ? 200 : result.outcome === "rate_limited" ? 429 : 400;
      return Response.json(result, {
        status,
        headers: runtimeHeaders(resolved.project.hostingDeclaration),
      });
    }),
  });
}
