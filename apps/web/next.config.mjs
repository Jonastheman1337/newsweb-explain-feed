import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Multipart overhead above the API's 40 MiB PDF limit.
  experimental: { middlewareClientMaxBodySize: "42mb" },
  async redirects() {
    return [
      { source: "/next", destination: "/", permanent: false },
      { source: "/feed", destination: "/", permanent: false }
    ];
  },
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@newsweb/shared"]
};

export default nextConfig;
