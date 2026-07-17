"""Prepare Kubernetes model assets in a writable model PVC.

This script is intended for one-time or controlled operational runs, not for
normal API/worker startup. Runtime pods consume the same PVC read-only after
this job has completed successfully.
"""

# ruff: noqa: E402 - bootstrap the backend import root before app imports.

from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


HF_REPOSITORIES = (
    "guangyangmusic/legato",
    "meta-llama/Llama-3.2-11B-Vision",
)

SYSTEM_SOUNDFONT_CANDIDATES = (
    Path("/usr/share/sounds/sf2/FluidR3_GM.sf2"),
    Path("/usr/share/sounds/sf2/default-GM.sf2"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-huggingface",
        action="store_true",
        help="do not download Hugging Face model snapshots",
    )
    parser.add_argument(
        "--skip-paddleocr",
        action="store_true",
        help="do not bootstrap PaddleOCR model directories",
    )
    parser.add_argument(
        "--skip-soundfont",
        action="store_true",
        help="do not copy the system FluidR3 soundfont into MODEL_ROOT",
    )
    parser.add_argument(
        "--include-sizes",
        action="store_true",
        help="include recursive directory sizes in the final runtime check output",
    )
    parser.add_argument(
        "--check-scope",
        choices=("assets", "worker"),
        default="worker",
        help="final validation scope: model assets only, or full worker runtime checks",
    )
    return parser.parse_args()


def _require_path(value: str | None, name: str) -> Path:
    if not value:
        raise RuntimeError(f"{name} is required for model asset preparation")
    return Path(value).expanduser().resolve()


def _ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _copy_if_changed(source: Path, target: Path) -> None:
    _ensure_directory(target.parent)
    if target.is_file() and target.stat().st_size == source.stat().st_size:
        print(f"[OK] soundfont already present: {target}")
        return
    shutil.copy2(source, target)
    print(f"[OK] copied soundfont: {source} -> {target}")


def prepare_soundfont(target_path: Path) -> None:
    for source in SYSTEM_SOUNDFONT_CANDIDATES:
        if source.is_file():
            _copy_if_changed(source, target_path)
            return
    candidates = ", ".join(str(path) for path in SYSTEM_SOUNDFONT_CANDIDATES)
    raise RuntimeError(f"FluidR3 soundfont was not found in runtime image. Checked: {candidates}")


def prepare_huggingface_snapshots(hf_home: Path) -> None:
    from huggingface_hub import snapshot_download

    hub_cache = hf_home / "hub"
    _ensure_directory(hub_cache)
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    for repo_id in HF_REPOSITORIES:
        print(f"[INFO] downloading Hugging Face snapshot: {repo_id}")
        snapshot_path = snapshot_download(
            repo_id=repo_id,
            cache_dir=str(hub_cache),
            token=token,
            local_files_only=False,
        )
        print(f"[OK] snapshot ready: {repo_id} -> {snapshot_path}")


def prepare_paddleocr_models() -> None:
    from PIL import Image

    from app.core.config import settings
    from app.processing.engines.paddle import run_ocr_subprocess

    required_dirs = (
        _require_path(settings.PADDLEOCR_MODEL_ROOT, "PADDLEOCR_MODEL_ROOT"),
        _require_path(settings.PADDLEOCR_DETECTION_MODEL_DIR, "PADDLEOCR_DETECTION_MODEL_DIR"),
        _require_path(settings.PADDLEOCR_RECOGNITION_MODEL_DIR, "PADDLEOCR_RECOGNITION_MODEL_DIR"),
        _require_path(
            settings.PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR,
            "PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
        ),
    )
    for directory in required_dirs:
        _ensure_directory(directory)

    with tempfile.TemporaryDirectory(prefix="noteverse-paddle-bootstrap-") as tmp:
        image_path = Path(tmp) / "blank.png"
        Image.new("RGB", (64, 64), color="white").save(image_path)
        result = run_ocr_subprocess(str(image_path), timeout_seconds=settings.PADDLEOCR_TIMEOUT_SECONDS)
    if not result.get("success"):
        raise RuntimeError(f"PaddleOCR model bootstrap failed: {result.get('code')}: {result.get('error')}")
    print("[OK] PaddleOCR bootstrap completed")


async def run_final_checks(include_sizes: bool) -> int:
    from app.core.runtime_checks import RuntimeRole, run_runtime_checks

    results = await run_runtime_checks(RuntimeRole.WORKER, include_sizes=include_sizes)
    failed = False
    for result in results:
        print(f"[{'OK' if result.ok else 'FAIL'}] {result.name}: {result.message}")
        failed = failed or not result.ok
    return 1 if failed else 0


def run_asset_checks(include_sizes: bool) -> int:
    from app.core.runtime_checks import check_huggingface_models, check_paddleocr_models, check_soundfont

    checks = (
        check_soundfont,
        check_paddleocr_models,
        check_huggingface_models,
    )
    failed = False
    for check in checks:
        result = check(include_sizes)
        print(f"[{'OK' if result.ok else 'FAIL'}] {result.name}: {result.message}")
        failed = failed or not result.ok
    return 1 if failed else 0


async def main() -> int:
    args = parse_args()

    from app.core.config import settings

    model_root = _require_path(settings.MODEL_ROOT, "MODEL_ROOT")
    _ensure_directory(model_root)

    if not args.skip_soundfont:
        prepare_soundfont(_require_path(settings.PLAYBACK_SOUNDFONT_PATH, "PLAYBACK_SOUNDFONT_PATH"))
    if not args.skip_huggingface:
        prepare_huggingface_snapshots(_require_path(settings.HF_HOME, "HF_HOME"))
    if not args.skip_paddleocr:
        prepare_paddleocr_models()

    if args.check_scope == "assets":
        return run_asset_checks(include_sizes=args.include_sizes)
    return await run_final_checks(include_sizes=args.include_sizes)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
