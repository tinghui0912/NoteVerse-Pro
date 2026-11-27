import { NextRequest, NextResponse } from "next/server";

export function createNonce(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
}

export function adminSecurity(
  nonce: string,
  development = false,
): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""}`,
      `style-src 'self' 'nonce-${nonce}'`,
      "style-src-attr 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'none'",
      "media-src 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), midi=(), payment=(), usb=()",
  };
}

export function secureAdminRequest(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const security = adminSecurity(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", security["Content-Security-Policy"]);
  const response = NextResponse.next({ request: { headers } });
  for (const [name, value] of Object.entries(security))
    response.headers.set(name, value);
  if (
    !request.nextUrl.pathname.startsWith("/_next/") &&
    !request.nextUrl.pathname.startsWith("/api/")
  ) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}
