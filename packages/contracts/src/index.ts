// Contract source of truth (Zod schemas live here).
//
// This index is intentionally minimal. Later plans add domain contract modules
// (e.g. audit.ts, skill.ts, tenant.ts) under src/, consumed via the "./*" subpath
// export — so they do NOT require editing this file.
//
// The marker below is imported by packages/backend/convex/schema.ts purely to prove
// that the Convex bundler resolves source-export workspace packages.

export const CONTRACTS_PACKAGE_NAME = "@pikar/contracts" as const;

/** Generic branding helper reused by later contract modules. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
