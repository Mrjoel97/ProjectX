import type { MetadataRoute } from "next";
import { SITE } from "./legal";

// Next generates /robots.txt from this at build time.
// Everything is allowed, including AI crawlers (GPTBot, ClaudeBot, PerplexityBot, ...):
// Pikar AI wants to be discoverable by agents as well as by search engines, and a bare
// `User-agent: *  Allow: /` already grants them. Disallow rules would be the thing that
// hides us. Revisit only if a specific crawler misbehaves.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
