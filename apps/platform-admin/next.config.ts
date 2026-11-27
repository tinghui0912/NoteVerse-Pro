import type { NextConfig } from "next";
import { CONTROL_PLANE_API_PREFIX } from "./generated/browser-protocol";

const controlPlaneOrigin = process.env.NEXT_CONTROL_PLANE_ORIGIN;
if (!controlPlaneOrigin) {
  throw new Error("NEXT_CONTROL_PLANE_ORIGIN is required.");
}

const nextConfig: NextConfig = {
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
