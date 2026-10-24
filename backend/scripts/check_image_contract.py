"""Offline packaging/import smoke; deliberately not deployment readiness."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import importlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

ROLES = ("api", "beat", "worker", "worker-deps")


@contextmanager
def packaging_environment(role: str):
    """Supply valid, synthetic import-time settings only in this CI process.

    Global Settings requires URLs/cookie policy even for non-HTTP roles. These
    endpoints are never contacted; workflows additionally use --network none.
    No production settings/defaults or readiness validators are changed.
    """
    with TemporaryDirectory(prefix="noteverse-image-contract-") as directory:
        root = Path(directory)
        env = {
            "SECRET_KEY": "image-contract-only-not-a-production-secret",
            "AUTH_COOKIE_NAME": "contract_session",
            "REFRESH_COOKIE_NAME": "contract_refresh",
            "CSRF_COOKIE_NAME": "contract_csrf",
            "CSRF_HEADER_NAME": "x-contract-csrf",
            "AUTH_COOKIE_SECURE": "false",
            "AUTH_COOKIE_SAMESITE": "lax",
            "DATABASE_URL": "postgresql+asyncpg://contract:contract@127.0.0.1:1/contract",
            "SYNC_DATABASE_URL": "postgresql+psycopg://contract:contract@127.0.0.1:1/contract",
            "SCHEDULER_LOCK_DATABASE_URL": "postgresql+psycopg://contract:contract@127.0.0.1:1/contract",
            "REDIS_URL": "redis://127.0.0.1:1/0",
            "CELERY_BROKER_URL": "redis://127.0.0.1:1/1",
            "CELERY_RESULT_BACKEND": "redis://127.0.0.1:1/2",
            "LOG_FORMAT": "json",
            "OTEL_TRACING_ENABLED": "false",
            "FRONTEND_BASE_URL": "http://localhost:3000",
            "BACKEND_CORS_ORIGINS": "[]",
            "TRUSTED_PROXY_CIDRS": "[]",
            "REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS": "60",
            "REALTIME_EVENT_RETENTION_DAYS": "7",
            "FILE_STORAGE_BACKEND": "local",
            "STORAGE_ROOT": str(root / "storage"),
            "WORK_ROOT": str(root / "work"),
            "NOTEVERSE_CELERY_IMPORT_TASKS": "true" if role == "worker" else "false",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK": "True",
        }
        if role == "api":
            env.update({
                "CONTROL_PLANE_AUTH_COOKIE_NAME": "contract_control",
                "CONTROL_PLANE_CSRF_COOKIE_NAME": "contract_control_csrf",
                "CONTROL_PLANE_CSRF_HEADER_NAME": "x-contract-control-csrf",
                "CONTROL_PLANE_COOKIE_SECURE": "false",
                "CONTROL_PLANE_COOKIE_SAMESITE": "lax",
                "CONTROL_PLANE_SESSION_EXPIRE_MINUTES": "30",
                "CONTROL_PLANE_CORS_ORIGINS": '["http://localhost:3001"]',
            })
        if role == "worker":
            # Required setting, intentionally not an existing asset/readiness check.
            env["PLAYBACK_SOUNDFONT_PATH"] = str(root / "not-required.sf2")
        previous = {key: os.environ.get(key) for key in env}
        os.environ.update(env)
        try:
            yield
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


def require_import(module: str, attribute: str | None = None) -> None:
    imported = importlib.import_module(module)
    if attribute is not None and not hasattr(imported, attribute):
        raise RuntimeError(f"{module} is missing {attribute}")


def check_migration_packaging() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    require_import("alembic.command", "upgrade")
    require_import("scripts.repair_unpublished_practice_migration_state", "main")
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    scripts = ScriptDirectory.from_config(config)
    if not scripts.get_heads():
        raise RuntimeError("No packaged Alembic head")
    for revision in scripts.walk_revisions():
        _ = revision.module  # Load modules, never invoke upgrade or Alembic env.py.
    env = BACKEND_ROOT / "alembic/env.py"
    compile(env.read_bytes(), str(env), "exec")


def check_worker_dependency_imports() -> None:
    require_import("opentelemetry.exporter.otlp.proto.grpc.trace_exporter", "OTLPSpanExporter")
    for module in ("paddle", "paddleocr", "paddlex"):
        require_import(module)


def run_contract(role: str) -> list[str]:
    if role not in ROLES:
        raise ValueError(f"Unknown image role: {role}")
    subprocess.run([sys.executable, "-m", "pip", "check"], check=True)
    evidence = ["pip check passed"]
    if role == "api":
        for module in ("app.main", "app.control_plane_main", "app.observability_main"):
            require_import(module, "app")
            evidence.append(f"{module}:app import passed (lifespan not started)")
        check_migration_packaging()
        evidence.append("migration command/revision imports passed (no database execution)")
    elif role == "beat":
        require_import("app.worker.celery_config", "celery_app")
        require_import("app.modules.scheduler_lock.beat_leader", "BeatLeader")
        require_import("app.modules.scheduler_lock.connection", "open_scheduler_lock_connection")
        require_import("psycopg", "connect")
        if "app.worker.tasks" in sys.modules:
            raise RuntimeError("Beat must not import Worker task execution")
        for module in ("torch", "paddle", "paddleocr", "paddlex", "verovio"):
            if importlib.util.find_spec(module) is not None:
                raise RuntimeError(f"Beat must not install Worker dependency: {module}")
        evidence.append("Beat/Celery/PostgreSQL-lock imports passed; Worker tasks not imported")
    elif role == "worker-deps":
        check_worker_dependency_imports()
        evidence.append("OTLP/Paddle/PaddleOCR/PaddleX imports passed; no models initialized")
    else:
        # The existing contract owns the task list and loads app.worker.tasks.
        runtime = importlib.import_module("app.core.runtime_checks")
        tasks = runtime.check_celery_tasks()
        if not tasks.ok:
            raise RuntimeError(tasks.message)
        evidence.append(tasks.message)
        require_import("verovio", "toolkit")
        check_worker_dependency_imports()
        evidence.append("Verovio/OTLP/Paddle/PaddleOCR/PaddleX imports passed; no models initialized")
    return evidence


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", choices=ROLES, required=True)
    role = parser.parse_args(argv).role
    try:
        with packaging_environment(role):
            evidence = run_contract(role)
    except Exception as exc:
        print(f"PACKAGING_CONTRACT role={role} FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    for message in evidence:
        print(f"PACKAGING_CONTRACT role={role} OK: {message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
