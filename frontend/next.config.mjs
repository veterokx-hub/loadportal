/** @type {import('next').NextConfig} */

// Локальный `npm run dev` → localhost; в Docker build передаются Service DNS.
const CONSTRUCTOR =
  process.env.CONSTRUCTOR_API_URL || "http://localhost:8080";
const ORCHESTRATOR =
  process.env.ORCHESTRATOR_API_URL || "http://localhost:8082";

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Эндпоинт /_next/image не нужен (логотип — обычный <img>). Выключаем optimizer
  // и sharp/libheif, чтобы не тащить AVIF-RCE поверхность.
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/runs",
        destination: `${ORCHESTRATOR}/api/runs`,
      },
      {
        source: "/api/runs/:path*",
        destination: `${ORCHESTRATOR}/api/runs/:path*`,
      },
      {
        source: "/api/analysis",
        destination: `${ORCHESTRATOR}/api/analysis`,
      },
      {
        source: "/api/analysis/:path*",
        destination: `${ORCHESTRATOR}/api/analysis/:path*`,
      },
      {
        source: "/api/settings/gitlab",
        destination: `${ORCHESTRATOR}/api/settings/gitlab`,
      },
      {
        source: "/api/settings/gitlab/:path*",
        destination: `${ORCHESTRATOR}/api/settings/gitlab/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${CONSTRUCTOR}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
