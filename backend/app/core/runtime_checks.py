"""Role-specific runtime dependency checks."""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import shutil
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Awaitable, Callable

import redis

from app.core.config import settings
from app.core.control_plane_settings import require_control_plane_settings
from app.core.settings.practice_runtime import get_practice_runtime_settings
from app.core.settings.task_reliability import get_task_reliability_settings
from app.core.settings.worker_runtime import get_worker_runtime_settings
from app.processing.engines.omr.legato_manifest import HF_MODEL_REPOSITORIES, LEGATO_REPO_COMMIT
from app.processing.resources import ensure_partitura_default_soundfont


class RuntimeRole(StrEnum):
    API = "api"
    CONTROL_PLANE = "control"
    OBSERVABILITY_EXPORTER = "observability-exporter"
    WORKER = "worker"
    BEAT = "beat"
    PRACTICE = "practice"
    ALL = "all"


@dataclass(frozen=True, slots=True)
class CheckResult:
    name: str
    ok: bool
    message: str


CheckCallable = Callable[[bool], CheckResult | Awaitable[CheckResult]]


@dataclass(frozen=True, slots=True)
class CheckSpec:
    name: str
    run: CheckCallable


def _result(name: str, ok: bool, message: str) -> CheckResult:
    return CheckResult(name=name, ok=ok, message=message)


def _worker_settings():
    return get_worker_runtime_settings()


def _format_size(num_bytes: int) -> str:
    units = ("B", "K", "M", "G", "T")
    size = float(num_bytes)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.1f}{unit}" if unit != "B" else f"{int(size)}B"
        size /= 1024
    return f"{num_bytes}B"


def _directory_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def _size_suffix(path: Path, include_sizes: bool) -> str:
    if not include_sizes:
        return ""
    return f" ({_format_size(_directory_size(path))})"


def _existing_dir(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value).expanduser()
    return path if path.is_dir() else None


def _check_writable_directory(name: str, path_value: str | Path) -> CheckResult:
    path = Path(path_value).expanduser()
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".noteverse-write-check"
        probe.write_text("ok", encoding="ascii")
        probe.unlink()
    except OSError as exc:
        return _result(name, False, f"directory is not writable: {path}: {exc}")
    return _result(name, True, f"directory is writable: {path}")


def _read_git_dir(repo_path: Path) -> Path | None:
    git_path = repo_path / ".git"
    if git_path.is_dir():
        return git_path
    if not git_path.is_file():
        return None

    content = git_path.read_text(encoding="utf-8").strip()
    prefix = "gitdir:"
    if not content.startswith(prefix):
        return None
    git_dir = Path(content[len(prefix) :].strip())
    return git_dir if git_dir.is_absolute() else repo_path / git_dir


def _read_git_commit(repo_path: Path) -> str:
    git_dir = _read_git_dir(repo_path)
    if git_dir is None:
        raise FileNotFoundError(f"missing .git metadata under {repo_path}")

    head = (git_dir / "HEAD").read_text(encoding="utf-8").strip()
    prefix = "ref:"
    if not head.startswith(prefix):
        return head

    ref_name = head[len(prefix) :].strip()
    loose_ref = git_dir / ref_name
    if loose_ref.is_file():
        return loose_ref.read_text(encoding="utf-8").strip()

    packed_refs = git_dir / "packed-refs"
    if packed_refs.is_file():
        for line in packed_refs.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith(("#", "^")):
                continue
            commit, _, name = line.partition(" ")
            if name == ref_name:
                return commit
    raise FileNotFoundError(f"could not resolve git ref {ref_name}")


def check_settings(_: bool = False) -> CheckResult:
    task_settings = get_task_reliability_settings()
    return _result(
        "settings",
        True,
        (
            f"storage={settings.FILE_STORAGE_BACKEND}; "
            f"pipeline={task_settings.MAX_PROCESSING_TIME}s; "
            f"celery_soft={task_settings.CELERY_TASK_SOFT_TIME_LIMIT}s, "
            f"celery_hard={task_settings.CELERY_TASK_TIME_LIMIT}s"
        ),
    )


def check_worker_settings(_: bool = False) -> CheckResult:
    worker_settings = _worker_settings()
    return _result(
        "worker_settings",
        True,
        f"OMR=legato, render=verovio; paddle={worker_settings.PADDLEOCR_TIMEOUT_SECONDS}s",
    )


def check_control_plane_settings(_: bool = False) -> CheckResult:
    """Fail closed before the control-plane server imports its route tree."""

    try:
        require_control_plane_settings()
    except RuntimeError as exc:
        return _result(
            "control_plane_settings", False, f"control-plane configuration invalid: {exc}"
        )
    return _result("control_plane_settings", True, "independent control-plane configuration loaded")


async def check_api_database(_: bool = False) -> CheckResult:
    from sqlalchemy import text

    from app.db.session import engine

    try:
        async with engine.connect() as connection:
            await connection.execute(text("select 1"))
        return _result("database", True, "async database reachable")
    except Exception as exc:
        return _result(
            "database", False, f"async database unreachable: {type(exc).__name__}: {exc}"
        )


def check_sync_database(_: bool = False) -> CheckResult:
    from sqlalchemy import text

    from app.db.sync_session import sync_engine

    try:
        with sync_engine.connect() as connection:
            connection.execute(text("select 1"))
        return _result("sync_database", True, "sync database reachable")
    except Exception as exc:
        return _result(
            "sync_database",
            False,
            f"sync database unreachable: {type(exc).__name__}: {exc}",
        )


def check_storage_quota_policy(_: bool = False) -> CheckResult:
    from sqlalchemy import text

    from app.db.sync_session import sync_engine
    from app.modules.storage_usage.accounting import DEFAULT_PLAN_CODE

    try:
        with sync_engine.connect() as connection:
            row = connection.execute(
                text(
                    """
                    select quota_limit_bytes
                    from storage_quota_policies
                    where plan_code = :plan_code
                    """
                ),
                {"plan_code": DEFAULT_PLAN_CODE},
            ).first()
    except Exception as exc:
        return _result(
            "storage_quota_policy",
            False,
            f"storage quota policy check failed: {type(exc).__name__}: {exc}",
        )

    if row is None:
        return _result(
            "storage_quota_policy",
            False,
            f"missing required storage quota policy: {DEFAULT_PLAN_CODE}",
        )
    if int(row.quota_limit_bytes) <= 0:
        return _result(
            "storage_quota_policy",
            False,
            f"storage quota policy has invalid limit: {DEFAULT_PLAN_CODE}",
        )
    return _result("storage_quota_policy", True, f"storage quota policy ready: {DEFAULT_PLAN_CODE}")


def check_redis(_: bool = False) -> CheckResult:
    try:
        client = redis.Redis.from_url(
            settings.CELERY_BROKER_URL,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
        client.ping()
        return _result("redis", True, "redis/celery broker reachable")
    except Exception as exc:
        return _result(
            "redis", False, f"redis/celery broker unreachable: {type(exc).__name__}: {exc}"
        )


def check_api_storage(_: bool = False) -> CheckResult:
    if settings.FILE_STORAGE_BACKEND == "local":
        return _check_writable_directory("storage", settings.STORAGE_ROOT)
    return _result("storage", True, "s3 storage configuration validated by settings")


def check_work_root(_: bool = False) -> CheckResult:
    return _check_writable_directory("work_root", settings.WORK_ROOT)


def check_beat_state(_: bool = False) -> CheckResult:
    return _check_writable_directory("beat_state", Path(settings.WORK_ROOT) / "celerybeat")


def check_celery_tasks(_: bool = False) -> CheckResult:
    try:
        import app.worker.tasks  # noqa: F401
        from app.worker.celery_config import celery_app

        celery_app.loader.import_default_modules()
        required = {
            "app.worker.tasks.process_images_job",
            "app.worker.tasks.run_import_dispatch_maintenance",
            "app.worker.tasks.render_outbox_task",
            "app.worker.tasks.run_render_outbox_maintenance",
            "app.worker.tasks.playback_outbox_task",
            "app.worker.tasks.run_playback_outbox_maintenance",
            "app.worker.tasks.practice_replay_object_deletion_task",
            "app.worker.tasks.run_practice_replay_object_deletion_maintenance",
            "app.worker.tasks.run_job_maintenance",
            "app.worker.tasks.send_mail_outbox_task",
            "app.worker.tasks.run_mail_outbox_maintenance",
            "app.worker.tasks.run_mail_outbox_cleanup",
            "app.worker.tasks.run_realtime_maintenance",
            "app.worker.tasks.run_derived_asset_cleanup",
            "app.worker.tasks.run_score_deletion_cleanup",
        }
        missing = sorted(required.difference(celery_app.tasks))
    except Exception as exc:
        return _result(
            "celery_tasks", False, f"task registration failed: {type(exc).__name__}: {exc}"
        )
    if missing:
        return _result("celery_tasks", False, f"unregistered tasks: {', '.join(missing)}")
    return _result("celery_tasks", True, f"registered tasks: {len(required)} required tasks")


def check_omr_engine(_: bool = False) -> CheckResult:
    worker_settings = _worker_settings()
    if not worker_settings.LEGATO_REPO_PATH:
        return _result("omr_engine", False, "LEGATO_REPO_PATH is not configured")

    repo_path = Path(worker_settings.LEGATO_REPO_PATH)
    if not (repo_path / "legato" / "models").is_dir():
        return _result("omr_engine", False, f"LEGATO repository is incomplete: {repo_path}")
    if _read_git_dir(repo_path) is None:
        return _result("omr_engine", True, f"LEGATO commit={LEGATO_REPO_COMMIT} (image metadata)")
    try:
        actual_commit = _read_git_commit(repo_path)
    except Exception as exc:
        return _result("omr_engine", False, f"could not read LEGATO commit: {exc}")
    if actual_commit != LEGATO_REPO_COMMIT:
        return _result(
            "omr_engine",
            False,
            f"LEGATO commit mismatch: expected {LEGATO_REPO_COMMIT}, actual {actual_commit}",
        )
    return _result("omr_engine", True, f"LEGATO commit={actual_commit}")


def check_omr_cuda_runtime(_: bool = False) -> CheckResult:
    worker_settings = _worker_settings()
    if worker_settings.LEGATO_DEVICE.lower() != "cuda":
        return _result(
            "omr_cuda_runtime",
            True,
            f"not required for LEGATO_DEVICE={worker_settings.LEGATO_DEVICE}",
        )

    try:
        torch = importlib.import_module("torch")
    except Exception as exc:
        return _result(
            "omr_cuda_runtime", False, f"torch import failed: {type(exc).__name__}: {exc}"
        )

    try:
        if not torch.cuda.is_available():
            return _result("omr_cuda_runtime", False, "CUDA is not available to the worker process")
        device_count = torch.cuda.device_count()
        device_name = torch.cuda.get_device_name(0) if device_count else "unknown"
    except Exception as exc:
        return _result(
            "omr_cuda_runtime", False, f"CUDA runtime check failed: {type(exc).__name__}: {exc}"
        )

    return _result(
        "omr_cuda_runtime", True, f"CUDA ready: devices={device_count}, primary={device_name}"
    )


def check_render_engine(_: bool = False) -> CheckResult:
    try:
        import verovio

        return _result(
            "render_engine",
            True,
            f"verovio import ok: {getattr(verovio, '__version__', 'unknown')}",
        )
    except Exception as exc:
        return _result(
            "render_engine", False, f"verovio import failed: {type(exc).__name__}: {exc}"
        )


def check_soundfont(_: bool = False) -> CheckResult:
    practice_settings = get_practice_runtime_settings()
    if not practice_settings.PRACTICE_SOUNDFONT_PATH:
        return _result("soundfont", False, "PRACTICE_SOUNDFONT_PATH is not configured")
    path = Path(practice_settings.PRACTICE_SOUNDFONT_PATH)
    if not path.is_file():
        return _result("soundfont", False, f"soundfont does not exist: {path}")
    return _result(
        "soundfont", True, f"soundfont found: {path} ({_format_size(path.stat().st_size)})"
    )


def check_paddleocr_models(include_sizes: bool = False) -> CheckResult:
    worker_settings = _worker_settings()
    required = (
        ("det", worker_settings.PADDLEOCR_DETECTION_MODEL_DIR),
        ("rec", worker_settings.PADDLEOCR_RECOGNITION_MODEL_DIR),
        ("textline_ori", worker_settings.PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR),
    )
    missing: list[str] = []
    summaries: list[str] = []
    for label, path_value in required:
        path = _existing_dir(path_value)
        if path is None:
            missing.append(f"{label}: {path_value or 'not configured'}")
            continue
        required_files = ("inference.yml", "inference.pdiparams", "inference.json")
        absent = [name for name in required_files if not (path / name).is_file()]
        if absent:
            missing.append(f"{label}: missing {', '.join(absent)} in {path}")
            continue
        summaries.append(f"{label}={path}{_size_suffix(path, include_sizes)}")
    if missing:
        return _result("paddleocr_models", False, "; ".join(missing))
    return _result("paddleocr_models", True, "; ".join(summaries))


def _snapshot_missing_model_files(snapshot: Path) -> list[str]:
    if not (snapshot / "config.json").is_file():
        return ["config.json"]

    index_paths = [
        *snapshot.glob("*.safetensors.index.json"),
        *snapshot.glob("*.bin.index.json"),
    ]
    if index_paths:
        required_files: set[str] = set()
        for index_path in index_paths:
            try:
                payload = json.loads(index_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return [f"valid {index_path.name}"]
            weight_map = payload.get("weight_map")
            if not isinstance(weight_map, dict):
                return [f"weight_map in {index_path.name}"]
            required_files.update(
                filename for filename in weight_map.values() if isinstance(filename, str)
            )
        return sorted(
            filename for filename in required_files if not (snapshot / filename).is_file()
        )

    patterns = ("*.safetensors", "*.bin")
    if any(any(snapshot.glob(pattern)) for pattern in patterns):
        return []
    return ["model checkpoint"]


def _hf_repo_cache_dir(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")


def check_huggingface_models(include_sizes: bool = False) -> CheckResult:
    worker_settings = _worker_settings()
    hf_home = Path(
        worker_settings.HF_HOME or os.environ.get("HF_HOME") or "~/.cache/huggingface"
    ).expanduser()
    hub = hf_home / "hub"
    missing: list[str] = []
    summaries: list[str] = []
    for repo_id in HF_MODEL_REPOSITORIES:
        repo_dir = _hf_repo_cache_dir(repo_id)
        path = hub / repo_dir
        snapshots = path / "snapshots"
        snapshot_statuses = (
            [
                (item, _snapshot_missing_model_files(item))
                for item in snapshots.iterdir()
                if item.is_dir()
            ]
            if snapshots.is_dir()
            else []
        )
        valid_snapshots = [item for item, absent in snapshot_statuses if not absent]
        if not valid_snapshots:
            incomplete = [
                f"{item.name}: missing {', '.join(absent[:5])}"
                for item, absent in snapshot_statuses
            ]
            detail = "; ".join(incomplete) or "no model snapshot"
            missing.append(f"{repo_id}: no complete model snapshot in {path} ({detail})")
            continue
        summaries.append(f"{repo_id}={path}{_size_suffix(path, include_sizes)}")

    offline = f"HF_HUB_OFFLINE={int(worker_settings.HF_HUB_OFFLINE)}, TRANSFORMERS_OFFLINE={int(worker_settings.TRANSFORMERS_OFFLINE)}"
    if missing:
        return _result("huggingface_models", False, "; ".join(missing) + "; " + offline)
    return _result("huggingface_models", True, "; ".join(summaries) + "; " + offline)


def check_practice_alignment(_: bool = False) -> CheckResult:
    ensure_partitura_default_soundfont(get_practice_runtime_settings().PRACTICE_SOUNDFONT_PATH)
    try:
        import numpy  # noqa: F401
        import partitura  # noqa: F401
        from matchmaker.dp import OnlineTimeWarpingArztFrame  # noqa: F401
        from matchmaker.features.audio import ChromagramProcessor  # noqa: F401
        from partitura.io.exportmidi import get_ppq  # noqa: F401
    except Exception as exc:
        return _result(
            "practice_alignment", False, f"practice imports failed: {type(exc).__name__}: {exc}"
        )
    fluidsynth = shutil.which("fluidsynth")
    if not fluidsynth:
        return _result("practice_alignment", False, "fluidsynth executable not found on PATH")
    return _result("practice_alignment", True, f"practice alignment ready; fluidsynth={fluidsynth}")


def check_playback_renderer(_: bool = False) -> CheckResult:
    worker_settings = _worker_settings()
    if not worker_settings.PLAYBACK_SOUNDFONT_PATH:
        return _result("playback_renderer", False, "PLAYBACK_SOUNDFONT_PATH is not configured")
    path = Path(worker_settings.PLAYBACK_SOUNDFONT_PATH)
    if not path.is_file():
        return _result("playback_renderer", False, f"playback soundfont does not exist: {path}")
    fluidsynth = shutil.which("fluidsynth")
    if not fluidsynth:
        return _result("playback_renderer", False, "fluidsynth executable not found on PATH")
    return _result(
        "playback_renderer",
        True,
        f"playback renderer ready; soundfont={path}; fluidsynth={fluidsynth}",
    )


ROLE_CHECK_NAMES: dict[RuntimeRole, tuple[str, ...]] = {
    RuntimeRole.API: (
        "settings",
        "database",
        "storage_quota_policy",
        "redis",
        "storage",
    ),
    RuntimeRole.CONTROL_PLANE: (
        "settings",
        "control_plane_settings",
        "database",
        "storage_quota_policy",
        "redis",
    ),
    RuntimeRole.OBSERVABILITY_EXPORTER: ("settings", "database"),
    RuntimeRole.WORKER: (
        "settings",
        "worker_settings",
        "sync_database",
        "storage_quota_policy",
        "redis",
        "work_root",
        "celery_tasks",
        "omr_engine",
        "omr_cuda_runtime",
        "render_engine",
        "playback_renderer",
        "paddleocr_models",
        "huggingface_models",
    ),
    RuntimeRole.BEAT: ("settings", "redis", "beat_state"),
    RuntimeRole.PRACTICE: (
        "settings",
        "database",
        "storage_quota_policy",
        "redis",
        "storage",
        "soundfont",
        "practice_alignment",
    ),
}
ROLE_CHECK_NAMES[RuntimeRole.ALL] = tuple(
    dict.fromkeys(
        name
        for role in (
            RuntimeRole.API,
            RuntimeRole.CONTROL_PLANE,
            RuntimeRole.OBSERVABILITY_EXPORTER,
            RuntimeRole.WORKER,
            RuntimeRole.BEAT,
            RuntimeRole.PRACTICE,
        )
        for name in ROLE_CHECK_NAMES[role]
    )
)

CHECKS: dict[str, CheckSpec] = {
    "settings": CheckSpec("settings", check_settings),
    "worker_settings": CheckSpec("worker_settings", check_worker_settings),
    "control_plane_settings": CheckSpec("control_plane_settings", check_control_plane_settings),
    "database": CheckSpec("database", check_api_database),
    "sync_database": CheckSpec("sync_database", check_sync_database),
    "storage_quota_policy": CheckSpec("storage_quota_policy", check_storage_quota_policy),
    "redis": CheckSpec("redis", check_redis),
    "storage": CheckSpec("storage", check_api_storage),
    "soundfont": CheckSpec("soundfont", check_soundfont),
    "practice_alignment": CheckSpec("practice_alignment", check_practice_alignment),
    "playback_renderer": CheckSpec("playback_renderer", check_playback_renderer),
    "work_root": CheckSpec("work_root", check_work_root),
    "celery_tasks": CheckSpec("celery_tasks", check_celery_tasks),
    "omr_engine": CheckSpec("omr_engine", check_omr_engine),
    "omr_cuda_runtime": CheckSpec("omr_cuda_runtime", check_omr_cuda_runtime),
    "render_engine": CheckSpec("render_engine", check_render_engine),
    "paddleocr_models": CheckSpec("paddleocr_models", check_paddleocr_models),
    "huggingface_models": CheckSpec("huggingface_models", check_huggingface_models),
    "beat_state": CheckSpec("beat_state", check_beat_state),
}


async def run_runtime_checks(
    role: RuntimeRole, *, include_sizes: bool = False
) -> list[CheckResult]:
    results: list[CheckResult] = []
    for name in ROLE_CHECK_NAMES[role]:
        outcome = CHECKS[name].run(include_sizes)
        if isinstance(outcome, Awaitable):
            outcome = await outcome
        results.append(outcome)
    return results


async def check_database_readiness(timeout_seconds: float = 2.0) -> bool:
    try:
        result = await asyncio.wait_for(check_api_database(), timeout=timeout_seconds)
        return result.ok
    except TimeoutError:
        return False


async def check_redis_readiness(timeout_seconds: float = 2.0) -> bool:
    try:
        result = await asyncio.wait_for(asyncio.to_thread(check_redis), timeout=timeout_seconds)
        return result.ok
    except TimeoutError:
        return False


async def check_storage_quota_policy_readiness(timeout_seconds: float = 2.0) -> bool:
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(check_storage_quota_policy),
            timeout=timeout_seconds,
        )
        return result.ok
    except TimeoutError:
        return False
