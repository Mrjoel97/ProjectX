import type { MetadataRoute } from "next";
import { SITE } from "./legal";

// Next generates /sitemap.xml from this at build time. Add every new public route here —
// a page absent from the sitemap is a page Google may never crawl.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/terms`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
