/** @type {import("next").NextConfig} */
const API_URL = process.env.API_URL ?? "http://localhost:3001";

const nextConfig = {
  transpilePackages: ["@bidpilot/contracts"],
  // Same-origin proxy so the httpOnly session cookie works without CORS.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/api/v1/:path*` }];
  },
  experimental: { proxyTimeout: 120_000 }
};

export default nextConfig;
