import type { NextConfig } from "next";

// Where the FastAPI backend listens. Requests to /api/* are proxied there, so
// the browser stays same-origin and the backend needs no CORS setup in dev.
const backendUrl = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev-tools button (it overlaps the sidebar). Build and
  // runtime errors are still shown in development.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
