"""Consumer identity uses a database session ledger and platform primitives."""

import ast
from pathlib import Path

from app.db.models import UserSession
from app.runtime.customer_api.settings import CustomerApiSettings
from app.runtime.customer_api.main import create_app

APP = Path(__file__).resolve().parents[2] / "app"


def test_consumer_credentials_use_opaque_sessions():
    forbidden = {"jwt", "jose", "OAuth2PasswordRequestForm"}
    directories = (APP / "modules" / "auth", APP / "runtime" / "customer_api")
    for directory in directories:
        for path in directory.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    assert not {a.name.split(".")[0] for a in node.names} & forbidden, path
                elif isinstance(node, ast.ImportFrom):
                    assert (node.module or "").split(".")[0] not in forbidden, path
                    assert not {a.name for a in node.names} & forbidden, path
    assert "user_sessions" == UserSession.__tablename__
    assert "SECRET_KEY" not in CustomerApiSettings.model_fields
    assert not any(
        name.startswith(("ACCESS_TOKEN_", "REFRESH_TOKEN_"))
        for name in CustomerApiSettings.model_fields
    )
    assert "/api/v1/auth/refresh" not in create_app().openapi()["paths"]


def test_security_primitives_have_no_runtime_or_domain_dependencies():
    for path in (APP / "platform" / "security").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith(("app.runtime", "app.modules")), path
    module = ".".join(("app", "core", "security"))
    assert not (APP / "core" / "security.py").exists()
    for directory in (APP, APP.parent / "tests"):
        for path in directory.rglob("*.py"):
            assert module not in path.read_text(encoding="utf-8"), path
