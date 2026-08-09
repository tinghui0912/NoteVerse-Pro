"""Export or verify versioned OpenAPI contracts for NoteVerse HTTP runtimes."""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI


BACKEND_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_ROOT = BACKEND_ROOT / "docs" / "contracts" / "openapi"
RUNTIME_MODULES = {
    "customer-api": "app.main",
    "practice-api": "app.practice_main",
    "control-plane-api": "app.control_plane_main",
}
CONTROL_PLANE_CONTRACT_DEFAULTS = {
    "CONTROL_PLANE_AUTH_COOKIE_NAME": "openapi_control_session",
    "CONTROL_PLANE_CSRF_COOKIE_NAME": "openapi_control_csrf",
    "CONTROL_PLANE_CSRF_HEADER_NAME": "x-openapi-control-csrf-token",
    "CONTROL_PLANE_COOKIE_SECURE": "false",
    "CONTROL_PLANE_COOKIE_SAMESITE": "lax",
    "CONTROL_PLANE_SESSION_EXPIRE_MINUTES": "30",
    "CONTROL_PLANE_CORS_ORIGINS": '["http://localhost:3001"]',
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runtime", choices=sorted(RUNTIME_MODULES))
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the committed contract differs from the runtime OpenAPI document",
    )
    return parser.parse_args()


def load_application(runtime: str) -> FastAPI:
    if runtime == "control-plane-api":
        # Contract generation imports route dependencies but never serves a
        # request. These non-secret placeholders keep documentation generation
        # independent from an operator deployment's private environment file.
        for name, value in CONTROL_PLANE_CONTRACT_DEFAULTS.items():
            os.environ.setdefault(name, value)
    module = importlib.import_module(RUNTIME_MODULES[runtime])
    application = getattr(module, "app", None)
    if not isinstance(application, FastAPI):
        raise RuntimeError(f"{RUNTIME_MODULES[runtime]} does not expose a FastAPI app")
    return application


def serialize_openapi(application: FastAPI) -> str:
    schema: dict[str, Any] = application.openapi()
    return json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    args = parse_args()
    destination = CONTRACT_ROOT / f"{args.runtime}.json"
    rendered = serialize_openapi(load_application(args.runtime))

    if args.check:
        if not destination.exists():
            print(f"Missing committed contract: {destination}", file=sys.stderr)
            return 1
        committed = destination.read_text(encoding="utf-8")
        if committed != rendered:
            print(
                f"OpenAPI contract is stale for {args.runtime}. "
                "Run backend/scripts/export_openapi.py without --check.",
                file=sys.stderr,
            )
            return 1
        print(f"OpenAPI contract is current: {destination.relative_to(BACKEND_ROOT)}")
        return 0

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(rendered, encoding="utf-8")
    print(f"Wrote OpenAPI contract: {destination.relative_to(BACKEND_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
