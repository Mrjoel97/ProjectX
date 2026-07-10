"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

// NEXT_PUBLIC_CONVEX_URL must exist in apps/web/.env.local. `npx convex dev` does NOT
// write it there — it writes CONVEX_URL to packages/backend/.env.local. Copy it across
// (see README "Clean-clone boot order", step 2b). Read at module scope, so `next build`
// fails at prerender without it, even for pages that never call Convex.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
