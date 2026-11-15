import type { NextConfig } from "next";
import { CONTROL_PLANE_API_PREFIX } from "./generated/browser-protocol";

const controlPlaneOrigin = process.env.NEXT_CONTROL_PLANE_ORIGIN;
if (!controlPlaneOrigin) {
  throw new Error("NEXT_CONTROL_PLANE_ORIGIN is required.");
}

const nextConfig: NextConfig = {
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
        source: `${CONTROL_PLANE_API_PREFIX}/:path*`,
        destination: `${controlPlaneOrigin.replace(/\/$/, "")}${CONTROL_PLANE_API_PREFIX}/:path*`,
      },
    ];
  },
};

export default nextConfig;
