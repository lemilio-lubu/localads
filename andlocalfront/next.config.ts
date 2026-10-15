import type { NextConfig } from "next";

const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1");
const apiBasePath = apiUrl.pathname.replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiUrl.origin}${apiBasePath}/:path*`,
      },
    ];
  },
};

export default nextConfig;
