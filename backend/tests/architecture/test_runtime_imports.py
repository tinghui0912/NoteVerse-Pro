"""Each process imports with only its declared environment inputs."""

import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("role", ["customer_api", "control_plane", "worker", "beat", "paddle_ocr"])
def test_runtime_import_needs_only_its_own_configuration(role, tmp_path):
    env = {
        key: value
        for key, value in os.environ.items()
        if key in ("PATH", "SYSTEMROOT", "WINDIR", "VIRTUAL_ENV", "LD_LIBRARY_PATH")
    }
    if role != "paddle_ocr":
        env.update(
            DATABASE_URL="postgresql+psycopg://test:test@127.0.0.1:1/test", LOG_FORMAT="json"
        )
    else:
        env.update(
            {
                name: str(tmp_path)
                for name in (
                    "PADDLEOCR_DETECTION_MODEL_DIR",
                    "PADDLEOCR_RECOGNITION_MODEL_DIR",
                    "PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
                )
            }
        )
    if role in ("customer_api", "control_plane"):
        env["TRUSTED_PROXY_CIDRS"] = "[]"
    if role == "customer_api":
        env["BACKEND_CORS_ORIGINS"] = "[]"
    if role in ("customer_api", "worker", "beat"):
        env.update(
            REDIS_URL="redis://127.0.0.1:1/0",
            CELERY_BROKER_URL="redis://127.0.0.1:1/1",
            CELERY_RESULT_BACKEND="redis://127.0.0.1:1/2",
            WORK_ROOT=str(tmp_path),
        )
    if role in ("customer_api", "worker"):
        env.update(
            S3_ENDPOINT_URL="https://storage.example.test",
            S3_BUCKET="test",
            S3_ACCESS_KEY_ID="test",
            S3_SECRET_ACCESS_KEY="test",
        )
    if role == "beat":
        env["REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS"] = "60"
    if role in ("worker", "beat"):
        env["SCHEDULER_LOCK_DATABASE_URL"] = env["DATABASE_URL"]
    if role == "worker":
        env.update(
            REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS="60",
            REALTIME_EVENT_RETENTION_DAYS="7",
            LEGATO_REPO_PATH=str(tmp_path),
            PLAYBACK_SOUNDFONT_PATH=str(tmp_path / "test.sf2"),
        )
    if role == "customer_api":
        env.update(
            AUTH_COOKIE_SECURE="false",
            FRONTEND_BASE_URL="https://app.example.test",
        )
    if role == "control_plane":
        env.update(
            REDIS_URL="redis://127.0.0.1:1/0",
            OPERATOR_TOTP_ENCRYPTION_KEY="MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
            CONTROL_PLANE_COOKIE_SECURE="true",
            CONTROL_PLANE_CORS_ORIGINS='["https://admin.example.test"]',
        )
    forbidden = {
        "customer_api": ("control_plane",),
        "control_plane": ("customer_api",),
        "worker": ("customer_api", "control_plane"),
        "beat": ("customer_api", "control_plane", "worker"),
        "paddle_ocr": ("customer_api", "control_plane", "worker", "beat"),
    }[role]
    code = f"""
import importlib
import sys
m = importlib.import_module('app.runtime.{role}.main')
context = m.get_context() if hasattr(m, 'get_context') else None
if context is None:
    assert set(m.PaddleOcrSettings.model_fields) == {{'PADDLEOCR_DETECTION_MODEL_DIR', 'PADDLEOCR_RECOGNITION_MODEL_DIR', 'PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR'}}
    m.PaddleOcrSettings()
if hasattr(m, 'app'):
    assert m.app.state.settings is context.settings
    assert m.app.state.session_factory is context.sessions
    assert m.app.state.engine is context.engine
for other in {forbidden!r}:
    prefix = 'app.runtime.' + other
    assert not any(name == prefix or name.startswith(prefix + '.') for name in sys.modules)
print('isolated runtime imported')
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[2],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "isolated runtime imported" in result.stdout
