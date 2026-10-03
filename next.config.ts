import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // SAMEORIGIN (not DENY): the in-app PDF preview embeds /api/documents/:id/pdf in an iframe.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Letterhead uploads (<= 10 MB) travel through a server action.
  // staleTimes: Next 15 defaults dynamic pages to 0s cache — every click re-fetches.
  // Keep short client cache so revisiting sidebar pages feels instant.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },

  // Branding source files live in assets/branding/source (NOT in /public) and are deliberately not
  // traced into the deployment: production reads them from the private Supabase `branding` bucket.
  // For a self-hosted deployment that uses BRANDING_SOURCE=local, add:
  //   outputFileTracingIncludes: { "/api/**": ["./assets/branding/source/**"], "/document/**": [...] }

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Secure public document links must never be indexed, cached or leaked via Referer.
        source: "/document/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
