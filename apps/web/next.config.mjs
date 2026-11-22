/** @type {import("next").NextConfig} */
const API_URL = process.env.API_URL ?? "http://localhost:3001";

const nextConfig = {
  transpilePackages: ["@bidpilot/contracts"],
  // Same-origin proxy so the httpOnly session cookie works without CORS.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/api/v1/:path*` }];
  },
  poweredByHeader: false,
  async headers() {
    const security = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" }
    ];
    if (process.env.NODE_ENV === "production") {
      security.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
    }
    return [{ source: "/:path*", headers: security }];
  },
  experimental: { proxyTimeout: 120_000 }
};

export default nextConfig;
