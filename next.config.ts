import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Pinned because a stray package-lock.json in a parent directory makes Next infer the
  // wrong workspace root, which changes what gets traced into the build.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
