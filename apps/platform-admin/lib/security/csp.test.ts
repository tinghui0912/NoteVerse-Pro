import { expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import proxy from "../../proxy";
import { adminSecurity, createNonce } from "./csp";

afterEach(() => vi.unstubAllEnvs());
const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + " "))!;

it("uses fresh cryptographic 128-bit nonces", () => {
  const values = Array.from({ length: 64 }, createNonce);
  expect(new Set(values).size).toBe(64);
  for (const nonce of values) expect(atob(nonce).length).toBe(16);
});

it("production scripts require an approved source or the document nonce", () => {
  const security = adminSecurity("request-nonce");
  expect(directive(security["Content-Security-Policy"], "script-src")).toBe(
    "script-src 'self' 'nonce-request-nonce'",
  );
  expect(security["Content-Security-Policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(security["Content-Security-Policy"]).toContain("object-src 'none'");
  expect(security["Content-Security-Policy"]).toContain(
    "style-src 'self' 'nonce-request-nonce'",
  );
  expect(security["Content-Security-Policy"]).toContain("worker-src 'none'");
  expect(security["Permissions-Policy"]).toBe(
    "camera=(), microphone=(), geolocation=(), midi=(), payment=(), usb=()",
  );
  expect(security["Referrer-Policy"]).toBe("no-referrer");
  expect(security["X-Frame-Options"]).toBe("DENY");
  expect(security["X-Content-Type-Options"]).toBe("nosniff");
  expect(security["Cross-Origin-Opener-Policy"]).toBe("same-origin");
});

it("forwards the same fresh nonce and CSP to Next SSR and the browser", () => {
  vi.stubEnv("NODE_ENV", "production");
  const response = proxy(
    new NextRequest("https://admin.test/login", {
      headers: {
        "x-nonce": "untrusted",
        "Content-Security-Policy": "script-src *",
      },
    }),
  );
  const nonce = response.headers.get("x-middleware-request-x-nonce")!;
  expect(nonce).not.toBe("untrusted");
  expect(atob(nonce).length).toBe(16);
  expect(
    response.headers.get("x-middleware-request-content-security-policy"),
  ).toBe(response.headers.get("Content-Security-Policy"));
  expect(response.headers.get("Content-Security-Policy")).toContain(
    `'nonce-${nonce}'`,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Strict-Transport-Security")).toBeNull();
});

it("allows development eval exclusively through the development flag", () => {
  expect(
    directive(
      adminSecurity("nonce", true)["Content-Security-Policy"],
      "script-src",
    ),
  ).toContain("'unsafe-eval'");
  expect(
    directive(
      adminSecurity("nonce", false)["Content-Security-Policy"],
      "script-src",
    ),
  ).not.toMatch(/unsafe-(?:inline|eval)/);
});

it("Next config owns topology without a static CSP layer", () => {
  const config = readFileSync(
    new URL("../../next.config.ts", import.meta.url),
    "utf8",
  );
  expect(config).not.toContain("Content-Security-Policy");
  expect(config).not.toContain("unsafe-inline");
});
