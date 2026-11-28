"""Browser command admission and HttpOnly credentials have distinct authorities."""

import ast
import json
import re
from pathlib import Path
from app.platform.security.origin_guard import BrowserOriginGuard
from starlette.middleware.base import BaseHTTPMiddleware

ROOT = Path(__file__).resolve().parents[3]


def test_origin_admission_uses_asgi_channels():
    assert not issubclass(BrowserOriginGuard, BaseHTTPMiddleware)
    tree = ast.parse(
        (ROOT / "backend/app/platform/security/origin_guard.py").read_text(encoding="utf-8")
    )
    assert any(
        isinstance(node, ast.AsyncFunctionDef) and node.name == "__call__"
        for node in ast.walk(tree)
    )


def test_browser_protocols_declare_only_host_cookie_identities():
    expected = {"api_prefix", "auth_cookie_name", "secure_auth_cookie_name"}
    customer = json.loads(
        (ROOT / "contracts/http/customer-browser-protocol.json").read_text(encoding="utf-8")
    )
    operator = json.loads(
        (ROOT / "contracts/http/control-plane-browser-protocol.json").read_text(encoding="utf-8")
    )
    assert set(customer) == expected
    assert set(operator) == expected | {"challenge_cookie_name", "secure_challenge_cookie_name"}


def test_browser_sources_share_cookie_free_command_admission():
    marker = "cs" + "rf"
    forbidden = re.compile(r"\b(?:\w*" + marker + r"\w*|x-" + marker + r"-token)\b", re.IGNORECASE)
    directories = [
        ROOT / "backend/app",
        ROOT / "apps/customer-web/src",
        ROOT / "apps/platform-admin/app",
        ROOT / "apps/platform-admin/lib",
        ROOT / "apps/platform-admin/components",
    ]
    paths = [
        p
        for directory in directories
        for p in directory.rglob("*")
        if p.suffix in {".py", ".ts", ".tsx"}
    ]
    assert paths
    assert [
        (str(path.relative_to(ROOT)), match.group(0))
        for path in paths
        for match in forbidden.finditer(path.read_text(encoding="utf-8"))
        if len(match.group(0)) < 128
    ] == []
