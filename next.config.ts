import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root so Turbopack doesn't pick up stray lockfiles in parent directories.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
