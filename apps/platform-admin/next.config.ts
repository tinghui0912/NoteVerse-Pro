import type { NextConfig } from "next";

const controlPlaneOrigin = process.env.NEXT_CONTROL_PLANE_ORIGIN;
const csrfCookieName = process.env.NEXT_PUBLIC_CONTROL_PLANE_CSRF_COOKIE_NAME;
const csrfHeaderName = process.env.NEXT_PUBLIC_CONTROL_PLANE_CSRF_HEADER_NAME;

if (!controlPlaneOrigin || !csrfCookieName || !csrfHeaderName) {
  throw new Error("NEXT_CONTROL_PLANE_ORIGIN and Control Plane CSRF settings are required.");
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_CONTROL_PLANE_CSRF_COOKIE_NAME: csrfCookieName,
    NEXT_PUBLIC_CONTROL_PLANE_CSRF_HEADER_NAME: csrfHeaderName,
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [{
        key: "Content-Security-Policy",
        value: "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
      }],
    }];
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${controlPlaneOrigin.replace(/\/$/, "")}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
