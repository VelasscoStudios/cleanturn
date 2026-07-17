import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Static response headers applied to every route. The Content-Security-Policy
// is NOT set here — it carries a per-request nonce and is set in middleware.ts
// so scripts need no 'unsafe-inline'.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Tell browsers to pin HTTPS. Harmless on localhost (dev is http, so no
    // HSTS state is set there); protects every real deployment from downgrade.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// `next dev` gets its own output directory so a local `next build` can never
// clobber the assets a running dev server is serving. `next build` and
// `next start` must stay on the default `.next` — the deploy workflow rsyncs
// that directory by name to the server.
export default function config(phase: string): NextConfig {
  return {
    ...nextConfig,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
