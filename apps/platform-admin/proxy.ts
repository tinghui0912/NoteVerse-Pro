import type { NextRequest } from "next/server";
import { secureAdminRequest } from "./lib/security/csp";

export default function proxy(request: NextRequest) {
  return secureAdminRequest(request);
}

export const config = { matcher: ["/:path*"] };
