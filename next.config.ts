import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["pdf-parse"],
  poweredByHeader: false,
};

export default nextConfig;
