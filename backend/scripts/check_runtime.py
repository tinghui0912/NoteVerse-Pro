"""Check runtime dependencies for local development and worker execution."""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import redis
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine


def format_size(num_bytes: int) -> str:
    units = ("B", "K", "M", "G", "T")
    size = float(num_bytes)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.1f}{unit}" if unit != "B" else f"{int(size)}B"
        size /= 1024
    return f"{num_bytes}B"


def directory_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def existing_dir(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value).expanduser()
    return path if path.is_dir() else None


async def check_database() -> tuple[bool, str]:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("select 1"))
        return True, "database reachable"
    except Exception as exc:
        return False, f"database unreachable: {type(exc).__name__}: {exc}"


def check_redis() -> tuple[bool, str]:
    try:
        client = redis.Redis.from_url(
            settings.CELERY_BROKER_URL,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
        client.ping()
        return True, "redis/celery broker reachable"
    except Exception as exc:
        return False, f"redis/celery broker unreachable: {type(exc).__name__}: {exc}"


def check_legato() -> tuple[bool, str]:
    if settings.OMR_ENGINE != "legato":
        return True, "legato not selected"
    if not settings.LEGATO_REPO_PATH:
        return False, "LEGATO_REPO_PATH is not configured"

    repo_path = Path(settings.LEGATO_REPO_PATH)
    if not repo_path.exists():
        return False, f"LEGATO_REPO_PATH does not exist: {repo_path}"
    if not (repo_path / "legato" / "models").exists():
        return False, f"LEGATO repository does not look complete: {repo_path}"

    expected_commit = settings.LEGATO_REPO_COMMIT
    if expected_commit:
        try:
            result = subprocess.run(
                ["git", "-C", str(repo_path), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                timeout=5,
                check=True,
            )
            actual_commit = result.stdout.strip()
        except Exception as exc:
            return False, f"could not read LEGATO git commit from {repo_path}: {exc}"
        if actual_commit != expected_commit:
            return (
                False,
                "LEGATO commit mismatch: "
                f"expected {expected_commit}, actual {actual_commit}",
            )
        return True, f"legato repository found: {repo_path}; commit={actual_commit}"

    return True, f"legato repository found: {repo_path}; commit check disabled"


def check_soundfont() -> tuple[bool, str]:
    if not settings.PRACTICE_SOUNDFONT_PATH:
        return False, "PRACTICE_SOUNDFONT_PATH is not configured"
    path = Path(settings.PRACTICE_SOUNDFONT_PATH)
    if not path.is_file():
        return False, f"PRACTICE_SOUNDFONT_PATH does not exist: {path}"
    return True, f"{path} ({format_size(path.stat().st_size)})"


def check_paddleocr_models() -> tuple[bool, str]:
    required = (
        ("det", settings.PADDLEOCR_DETECTION_MODEL_DIR),
        ("rec", settings.PADDLEOCR_RECOGNITION_MODEL_DIR),
        ("textline_ori", settings.PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR),
    )
    missing: list[str] = []
    summaries: list[str] = []

    for label, path_value in required:
        path = existing_dir(path_value)
        if path is None:
            missing.append(f"{label}: {path_value or 'not configured'}")
            continue
        required_files = ("inference.yml", "inference.pdiparams", "inference.json")
        absent = [name for name in required_files if not (path / name).is_file()]
        if absent:
            missing.append(f"{label}: missing {', '.join(absent)} in {path}")
            continue
        summaries.append(f"{label}={path} ({format_size(directory_size(path))})")

    if missing:
        return False, "; ".join(missing)
    return True, "; ".join(summaries)


def check_huggingface_models() -> tuple[bool, str]:
    hf_home = Path(settings.HF_HOME or os.environ.get("HF_HOME") or "~/.cache/huggingface").expanduser()
    hub = hf_home / "hub"
    required = (
        ("legato", "models--guangyangmusic--legato"),
        ("llama_vision", "models--meta-llama--Llama-3.2-11B-Vision"),
    )
    missing: list[str] = []
    summaries: list[str] = []

    for label, repo_dir in required:
        path = hub / repo_dir
        if not path.is_dir():
            missing.append(f"{label}: missing {path}")
            continue
        snapshots = path / "snapshots"
        if not snapshots.is_dir() or not any(snapshots.iterdir()):
            missing.append(f"{label}: missing snapshots in {path}")
            continue
        summaries.append(f"{label}={path} ({format_size(directory_size(path))})")

    offline_flags = (
        f"HF_HUB_OFFLINE={int(settings.HF_HUB_OFFLINE)}",
        f"TRANSFORMERS_OFFLINE={int(settings.TRANSFORMERS_OFFLINE)}",
    )
    if missing:
        return False, "; ".join(missing) + "; " + ", ".join(offline_flags)
    return True, "; ".join(summaries) + "; " + ", ".join(offline_flags)


def check_verovio() -> tuple[bool, str]:
    if settings.SCORE_RENDER_ENGINE != "verovio":
        return True, "verovio not selected"
    try:
        import verovio  # type: ignore[import-not-found]

        version = getattr(verovio, "__version__", "unknown")
        return True, f"verovio import ok: {version}"
    except Exception as exc:
        return False, f"verovio import failed: {type(exc).__name__}: {exc}"


def check_practice_alignment() -> tuple[bool, str]:
    try:
        import numpy  # noqa: F401
        import partitura  # noqa: F401
        from matchmaker.dp import OnlineTimeWarpingArztFrame  # noqa: F401
        from matchmaker.features.audio import ChromagramProcessor  # noqa: F401
        from matchmaker.utils.misc import generate_score_audio  # noqa: F401
        from partitura.io.exportmidi import get_ppq  # noqa: F401
    except Exception as exc:
        return False, f"practice imports failed: {type(exc).__name__}: {exc}"

    fluidsynth_path = shutil.which("fluidsynth")
    if not fluidsynth_path:
        return False, "fluidsynth executable not found on PATH"

    if settings.PRACTICE_SOUNDFONT_PATH:
        soundfont_path = Path(settings.PRACTICE_SOUNDFONT_PATH)
        if not soundfont_path.exists():
            return False, f"PRACTICE_SOUNDFONT_PATH does not exist: {soundfont_path}"
        return True, f"practice alignment ready; fluidsynth={fluidsynth_path}; soundfont={soundfont_path}"

    return True, f"practice imports ok; fluidsynth={fluidsynth_path}; no explicit soundfont configured"


async def main() -> int:
    checks = [
        ("settings", True, f"OMR={settings.OMR_ENGINE}, render={settings.SCORE_RENDER_ENGINE}"),
        ("database", *(await check_database())),
        ("redis", *check_redis()),
        ("legato", *check_legato()),
        ("verovio", *check_verovio()),
        ("soundfont", *check_soundfont()),
        ("paddleocr_models", *check_paddleocr_models()),
        ("huggingface_models", *check_huggingface_models()),
        ("practice_alignment", *check_practice_alignment()),
    ]

    failed = False
    for name, ok, message in checks:
        status = "OK" if ok else "FAIL"
        print(f"[{status}] {name}: {message}")
        failed = failed or not ok

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
