"""Project fixed Customer browser identity and OpenAPI native route metadata (stdlib only)."""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = "contracts/http/customer-browser-protocol.json"
OPENAPI = "backend/docs/contracts/openapi/customer-api.json"
PYTHON = "backend/app/core/generated/customer_browser_protocol.py"
TYPESCRIPT = "apps/customer-web/src/generated/browser-protocol.ts"
ROUTES = "apps/customer-web/src/generated/customer-routes.ts"
EXPORTS = {
    "api_prefix": "CUSTOMER_API_PREFIX",
    "auth_cookie_name": "AUTH_COOKIE_NAME",
    "refresh_cookie_name": "REFRESH_COOKIE_NAME",
    "csrf_cookie_name": "CSRF_COOKIE_NAME",
    "csrf_header_name": "CSRF_HEADER_NAME",
}
METHODS = {"get", "put", "post", "patch", "delete", "head", "options", "trace"}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError(f"Non-JSON numeric constant: {value}")


def load_json(path):
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=unique_object,
        parse_constant=invalid_constant,
    )


def validate_protocol(protocol):
    if not isinstance(protocol, dict) or set(protocol) != set(EXPORTS):
        raise ValueError("Customer browser protocol requires exactly its five identity fields")
    prefix = protocol["api_prefix"]
    if not isinstance(prefix, str) or not re.fullmatch(
        r"/[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*", prefix
    ):
        raise ValueError("api_prefix must be an absolute path prefix without a trailing slash")
    for key in EXPORTS.keys() - {"api_prefix"}:
        value = protocol[key]
        if not isinstance(value, str) or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", value):
            raise ValueError(f"{key} must be a nonempty HTTP token")
    if protocol["csrf_header_name"] != protocol["csrf_header_name"].lower():
        raise ValueError("csrf_header_name must use canonical lowercase")
    if (
        len(
            {
                protocol[key]
                for key in ("auth_cookie_name", "refresh_cookie_name", "csrf_cookie_name")
            }
        )
        != 3
    ):
        raise ValueError("Customer cookie identities must be distinct")


def operation_routes(openapi):
    if not isinstance(openapi, dict) or not isinstance(openapi.get("paths"), dict):
        raise ValueError("Customer OpenAPI requires paths")
    routes = {}
    for path, methods in openapi["paths"].items():
        if not isinstance(path, str) or not path.startswith("/") or not isinstance(methods, dict):
            raise ValueError("Invalid OpenAPI path item")
        for method, operation in methods.items():
            if method not in METHODS:
                continue
            identity = operation.get("operationId") if isinstance(operation, dict) else None
            if not isinstance(identity, str) or not re.fullmatch(r"[a-z][A-Za-z0-9]*", identity):
                raise ValueError("Customer operations require explicit semantic operationId")
            if identity in routes:
                raise ValueError(f"Duplicate Customer operationId: {identity}")
            routes[identity] = {"method": method.upper(), "url": path}
    return dict(sorted(routes.items()))


def projections(protocol, openapi):
    validate_protocol(protocol)
    py = [f'"""Generated from {PROTOCOL}. Do not edit."""', ""]
    ts = [f"// Generated from {PROTOCOL}. Do not edit."]
    for key, name in EXPORTS.items():
        literal = json.dumps(protocol[key], ensure_ascii=True)
        py.append(f"{name} = {literal}")
        ts.append(f"export const {name} = {literal} as const;")
    routes = [f"// Generated from {OPENAPI}. Do not edit.", "export const customerRoutes = {"]
    for identity, route in operation_routes(openapi).items():
        routes.append(
            f"  {identity}: {{ method: {json.dumps(route['method'])}, url: {json.dumps(route['url'])} }},"
        )
    routes.append("} as const;")
    return {
        "backend/app/core/generated/__init__.py": '"""Generated cross-runtime protocol projections."""\n',
        PYTHON: "\n".join(py) + "\n",
        TYPESCRIPT: "\n".join(ts) + "\n",
        ROUTES: "\n".join(routes) + "\n",
    }


def generate(root, *, check=False):
    outputs = projections(load_json(root / PROTOCOL), load_json(root / OPENAPI))
    stale = []
    for relative, content in outputs.items():
        path = root / relative
        if check:
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                stale.append(relative)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    if stale:
        print("Stale Customer browser projections: " + ", ".join(stale))
        return 1
    print("Customer browser identity and OpenAPI route projections are current.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    return generate(ROOT, check=args.check)


if __name__ == "__main__":
    raise SystemExit(main())
