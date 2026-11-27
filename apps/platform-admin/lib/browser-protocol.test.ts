import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import * as protocol from "../generated/browser-protocol";

afterEach(() => vi.unstubAllEnvs());
it("browser identities agree with the versioned authority", () => {
  const source = JSON.parse(readFileSync(new URL("../../../contracts/http/control-plane-browser-protocol.json", import.meta.url), "utf8"));
  expect({ CONTROL_PLANE_API_PREFIX: protocol.CONTROL_PLANE_API_PREFIX, OPERATOR_AUTH_COOKIE_NAME: protocol.OPERATOR_AUTH_COOKIE_NAME, OPERATOR_CSRF_COOKIE_NAME: protocol.OPERATOR_CSRF_COOKIE_NAME, OPERATOR_CSRF_HEADER_NAME: protocol.OPERATOR_CSRF_HEADER_NAME }).toEqual({ CONTROL_PLANE_API_PREFIX: source.api_prefix, OPERATOR_AUTH_COOKIE_NAME: source.auth_cookie_name, OPERATOR_CSRF_COOKIE_NAME: source.csrf_cookie_name, OPERATOR_CSRF_HEADER_NAME: source.csrf_header_name });
});
it("the same-origin proxy uses the generated prefix and server topology", async () => {
  vi.stubEnv("NEXT_CONTROL_PLANE_ORIGIN", "http://internal-control:8000/");
  const { default: config } = await import("../next.config");
  expect(typeof config.rewrites).toBe("function");
  expect(await config.rewrites!()).toEqual([{ source: `${protocol.CONTROL_PLANE_API_PREFIX}/:path*`, destination: `http://internal-control:8000${protocol.CONTROL_PLANE_API_PREFIX}/:path*` }]);
});

it("browser policy declares its generated identity dependencies", () => {
  const transport = readFileSync(new URL("./control-plane-browser-transport.ts", import.meta.url), "utf8");
  const proxy = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  expect(transport).toContain('from "../generated/browser-protocol"');
  expect(proxy).toContain('from "./generated/browser-protocol"');
  for (const identity of Object.values(protocol)) {
    if (typeof identity !== "string") continue;
    expect(transport.includes(JSON.stringify(identity))).toBe(false);
    expect(proxy.includes(JSON.stringify(identity))).toBe(false);
  }
});
