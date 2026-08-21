import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @duckdb/node-api loads a platform-specific .node binary at runtime via a
  // switch on process.platform; bundling it statically makes the bundler try
  // to resolve every platform's binary and fail. Keep it a real require()
  // in the server runtime instead.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
};

export default nextConfig;
