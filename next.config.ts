import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

if (process.env.VERCEL === "1") {
  process.env.VERCEL_PREVIEW_COMMENTS_ENABLED = "0";
}

/** Resolve a safe rewrite target URL (never undefined/empty for Vercel config processing). */
function resolveBackendUrl(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim().replace(/\/$/, "");
  if (trimmed && /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

/** Determine production mode */
const isProduction = process.env.NODE_ENV === "production";

/** Creative Motion main backend (FastAPI on 8000). */
const backendUrl = resolveBackendUrl(
  process.env.BACKEND_URL,
  isProduction ? "https://api.rasqhealth.com" : "http://127.0.0.1:8000",
);

/** Gait AI service (separate FastAPI on 8001). */
const gaitAiUrl = resolveBackendUrl(
  process.env.GAIT_AI_URL,
  "http://127.0.0.1:8001",
);

// Log backend configuration
console.log(`[Next.js Config] Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`[Next.js Config] Backend URL: ${backendUrl}`);
console.log(`[Next.js Config] Gait AI URL: ${gaitAiUrl}`);

const nextConfig: NextConfig = {
  /** Hostnames only (no protocol). Required for HMR when using LAN URL, e.g. http://192.168.x.x:3000 */
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.8.145"],

  async headers() {
    const isProd = process.env.NODE_ENV === "production";

    const securityHeaders = [
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(self), geolocation=(), payment=()",
      },
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
      {
        key: "Cross-Origin-Resource-Policy",
        value: "same-origin",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.sentry.io https://vercel.live https://cdn.jsdelivr.net",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "img-src 'self' data: blob: https:",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://vercel.live https://cdn.jsdelivr.net https://storage.googleapis.com http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ];

    if (isProd) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  async rewrites() {
    return [
      // Main backend — all /api/v1/* calls
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
      // Gait AI service — /api/gait/* → http://127.0.0.1:8001/api/v1/gait/*
      {
        source: "/api/gait/:path*",
        destination: `${gaitAiUrl}/api/v1/gait/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry CLI output during build
  silent: true,

  // Do not create Sentry releases automatically
  // We will do this manually when ready
  release: {
    create: false,
  },

  // No source map upload for now
  // Add SENTRY_AUTH_TOKEN later when source maps needed
  sourcemaps: {
    disable: true,
  },
  widenClientFileUpload: false,
});
