import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Source-export workspace packages are transpiled by Next (no build step in packages/*).
  transpilePackages: ["@pikar/backend", "@pikar/contracts", "@pikar/core", "@pikar/cost"],
};

export default nextConfig;
