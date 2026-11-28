"""Process composition and configuration form explicit dependency boundaries."""

import ast
from pathlib import Path

import pytest

from app.runtime.worker.settings import WorkerSettings
from app.runtime.beat.settings import BeatSettings
from app.runtime.customer_api.settings import CustomerApiSettings
from app.runtime.control_plane.settings import ControlPlaneSettings
from app.runtime.migrations.settings import MigrationSettings
from app.runtime.paddle_ocr.settings import PaddleOcrSettings

APP = Path(__file__).resolve().parents[2] / "app"


def imports(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    package = "app." + ".".join(path.relative_to(APP).parts[:-1])
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = package.split(".")[: len(package.split(".")) - node.level + 1]
                module = ".".join([*base, *([node.module] if node.module else [])])
            else:
                module = node.module or ""
            yield module
            yield from (module + "." + alias.name for alias in node.names)
        elif isinstance(node, ast.Call) and isinstance(node.func, (ast.Name, ast.Attribute)):
            name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr
            if (
                name in ("import_module", "__import__")
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                yield node.args[0].value


@pytest.mark.parametrize(
    "directory,forbidden",
    [
        ("platform", ("app.modules", "app.runtime")),
        ("modules", ("app.runtime",)),
        ("runtime/customer_api", ("app.runtime.control_plane",)),
        ("runtime/control_plane", ("app.runtime.customer_api",)),
        ("runtime/worker", ("app.runtime.customer_api", "app.runtime.control_plane")),
        ("runtime/beat", ("app.runtime.customer_api", "app.runtime.control_plane")),
        (
            "runtime/paddle_ocr",
            (
                "app.runtime.customer_api",
                "app.runtime.control_plane",
                "app.runtime.worker",
                "app.runtime.beat",
            ),
        ),
    ],
)
def test_import_direction(directory, forbidden):
    files = tuple((APP / directory).rglob("*.py"))
    assert files
    violations = [
        (str(p.relative_to(APP)), target)
        for p in files
        for target in imports(p)
        if any(target == prefix or target.startswith(prefix + ".") for prefix in forbidden)
    ]
    assert violations == []


def test_configuration_is_process_owned():
    removed = ".".join(("app", "core", "config"))
    assert not (APP / "core" / "config.py").exists()
    for directory in (APP, APP.parent / "tests"):
        for path in directory.rglob("*.py"):
            assert removed not in path.read_text(encoding="utf-8"), path


@pytest.mark.parametrize("model", [WorkerSettings, BeatSettings])
def test_background_settings_exclude_identity_credentials(model):
    fields = set(model.model_fields)
    assert "SECRET_KEY" not in fields
    assert not any(
        field.startswith(("AUTH_", "CONTROL_PLANE_", "ACCESS_TOKEN_", "REFRESH_TOKEN_"))
        for field in fields
    )


def test_http_settings_are_independent():
    assert "REALTIME_EVENT_RETENTION_DAYS" not in CustomerApiSettings.model_fields
    assert "NOTIFICATION_RETENTION_DAYS" not in CustomerApiSettings.model_fields
    assert "DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS" not in CustomerApiSettings.model_fields
    assert not any(name.startswith("CONTROL_PLANE_") for name in CustomerApiSettings.model_fields)
    assert "SECRET_KEY" not in ControlPlaneSettings.model_fields
    assert not any(
        name.startswith(("AUTH_", "ACCESS_TOKEN_", "REFRESH_TOKEN_"))
        for name in ControlPlaneSettings.model_fields
    )


def test_migration_settings_contain_only_database_credentials():
    assert set(MigrationSettings.model_fields) == {"DATABASE_URL"}


def test_ocr_subprocess_settings_contain_only_model_inputs():
    assert set(PaddleOcrSettings.model_fields) == {
        "PADDLEOCR_DETECTION_MODEL_DIR",
        "PADDLEOCR_RECOGNITION_MODEL_DIR",
        "PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
    }


def test_browser_admission_settings_belong_only_to_http_runtimes():
    from app.platform.config.browser_abuse import (
        CustomerRateLimitSettings,
        OperatorRateLimitSettings,
    )

    assert set(CustomerRateLimitSettings.model_fields) <= set(CustomerApiSettings.model_fields)
    assert set(OperatorRateLimitSettings.model_fields) <= set(ControlPlaneSettings.model_fields)
    for model in (
        WorkerSettings,
        BeatSettings,
        MigrationSettings,
        PaddleOcrSettings,
    ):
        assert not any(
            "RATE_LIMIT" in name or name == "TRUSTED_PROXY_HOPS" for name in model.model_fields
        )
