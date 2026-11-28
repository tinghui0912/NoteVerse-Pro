import type { NextConfig } from "next";
import { CONTROL_PLANE_API_PREFIX } from "./generated/browser-protocol";

const nextConfig: NextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const origin = process.env.NEXT_CONTROL_PLANE_ORIGIN;
    if (!origin) throw new Error("NEXT_CONTROL_PLANE_ORIGIN is required in development.");
    return [{
      source: `${CONTROL_PLANE_API_PREFIX}/:path*`,
      destination: `${origin.replace(/\/$/, "")}${CONTROL_PLANE_API_PREFIX}/:path*`,
    }];
  },
};

export default nextConfig;
