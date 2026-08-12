"""Prepare Kubernetes model assets in a writable node-local model cache.

This script is intended for one-time or controlled operational runs, not for
normal API/worker startup. Worker pods consume the same node-local cache
read-only after the model-cache DaemonSet has completed successfully.
"""

# ruff: noqa: E402 - bootstrap the backend import root before app imports.

from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


SYSTEM_SOUNDFONT_CANDIDATES = (
    Path("/usr/share/sounds/sf2/FluidR3_GM.sf2"),
    Path("/usr/share/sounds/sf2/default-GM.sf2"),
)


@dataclass(frozen=True, slots=True)
class PaddleOcrModelAsset:
    name: str
    target_env_name: str
    url: str
    expected_size_bytes: int


PADDLEOCR_MODEL_ASSETS = (
    PaddleOcrModelAsset(
        name="PP-OCRv6_medium_det",
        target_env_name="PADDLEOCR_DETECTION_MODEL_DIR",
        url=(
            "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/"
            "paddle3.0.0/PP-OCRv6_medium_det_infer.tar"
        ),
        expected_size_bytes=62279680,
    ),
    PaddleOcrModelAsset(
        name="PP-OCRv6_medium_rec",
        target_env_name="PADDLEOCR_RECOGNITION_MODEL_DIR",
        url=(
            "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/"
            "paddle3.0.0/PP-OCRv6_medium_rec_infer.tar"
        ),
        expected_size_bytes=76851200,
    ),
    PaddleOcrModelAsset(
        name="PP-LCNet_x1_0_textline_ori",
        target_env_name="PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
        url=(
            "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/"
            "paddle3.0.0/PP-LCNet_x1_0_textline_ori_infer.tar"
        ),
        expected_size_bytes=6871040,
    ),
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
        help="do not prepare PaddleOCR inference model directories",
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


def _has_required_inference_files(path: Path) -> bool:
    required_files = ("inference.yml", "inference.pdiparams", "inference.json")
    return all((path / filename).is_file() for filename in required_files)


def _remove_incomplete_model_dir(path: Path) -> None:
    if not path.exists():
        return
    if _has_required_inference_files(path):
        return
    if not path.is_dir():
        raise RuntimeError(f"PaddleOCR model path is not a directory: {path}")
    shutil.rmtree(path)
    print(f"[INFO] removed incomplete PaddleOCR model directory: {path}")


def _download_file(url: str, target: Path, expected_size_bytes: int) -> None:
    with urllib.request.urlopen(url, timeout=120) as response:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("wb") as output:
            shutil.copyfileobj(response, output)
    actual_size = target.stat().st_size
    if actual_size != expected_size_bytes:
        target.unlink(missing_ok=True)
        raise RuntimeError(
            f"downloaded PaddleOCR asset has unexpected size: {url}; "
            f"expected {expected_size_bytes}, got {actual_size}"
        )


def _safe_extract_tar(archive_path: Path, target_dir: Path) -> None:
    target_root = target_dir.resolve()
    with tarfile.open(archive_path) as archive:
        members = archive.getmembers()
        for member in members:
            member_path = (target_dir / member.name).resolve()
            if target_root not in (member_path, *member_path.parents):
                raise RuntimeError(f"unsafe path in PaddleOCR model archive: {member.name}")
            if member.issym() or member.islnk():
                raise RuntimeError(f"links are not allowed in PaddleOCR model archive: {member.name}")
        archive.extractall(target_dir, members=members)


def _find_inference_model_dir(root: Path) -> Path:
    if _has_required_inference_files(root):
        return root
    candidates = [path for path in root.rglob("*") if path.is_dir() and _has_required_inference_files(path)]
    if len(candidates) != 1:
        raise RuntimeError(
            f"expected exactly one PaddleOCR inference model directory in {root}, found {len(candidates)}"
        )
    return candidates[0]


def _replace_directory(source: Path, target: Path) -> None:
    _ensure_directory(target.parent)
    backup = None
    if target.exists():
        backup = target.with_name(f".{target.name}.old")
        if backup.exists():
            shutil.rmtree(backup)
        target.rename(backup)
    try:
        source.rename(target)
    except Exception:
        if backup is not None and not target.exists():
            backup.rename(target)
        raise
    if backup is not None:
        shutil.rmtree(backup)


def _prepare_paddleocr_model_asset(asset: PaddleOcrModelAsset, target: Path) -> None:
    if _has_required_inference_files(target):
        print(f"[OK] PaddleOCR model already present: {asset.name} -> {target}")
        return
    _remove_incomplete_model_dir(target)

    archive_path = target.parent / f".{asset.name}.tar"
    extraction_root = Path(tempfile.mkdtemp(prefix=f".{asset.name}-", dir=target.parent))
    prepared_root = Path(tempfile.mkdtemp(prefix=f".{asset.name}-prepared-", dir=target.parent))
    try:
        print(f"[INFO] downloading PaddleOCR model: {asset.name}")
        _download_file(asset.url, archive_path, asset.expected_size_bytes)
        _safe_extract_tar(archive_path, extraction_root)
        model_dir = _find_inference_model_dir(extraction_root)
        for item in model_dir.iterdir():
            shutil.move(str(item), prepared_root / item.name)
        if not _has_required_inference_files(prepared_root):
            raise RuntimeError(f"PaddleOCR model did not contain required inference files: {asset.name}")
        _replace_directory(prepared_root, target)
        print(f"[OK] PaddleOCR model ready: {asset.name} -> {target}")
    finally:
        archive_path.unlink(missing_ok=True)
        shutil.rmtree(extraction_root, ignore_errors=True)
        if prepared_root.exists():
            shutil.rmtree(prepared_root, ignore_errors=True)


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


def prepare_soundfonts() -> None:
    from app.core.settings.practice_runtime import get_practice_runtime_settings
    from app.core.settings.worker_runtime import get_worker_runtime_settings

    targets = {
        "PLAYBACK_SOUNDFONT_PATH": _require_path(
            get_worker_runtime_settings().PLAYBACK_SOUNDFONT_PATH,
            "PLAYBACK_SOUNDFONT_PATH",
        ),
        "PRACTICE_SOUNDFONT_PATH": _require_path(
            get_practice_runtime_settings().PRACTICE_SOUNDFONT_PATH,
            "PRACTICE_SOUNDFONT_PATH",
        ),
    }
    prepared_paths: set[Path] = set()
    for env_name, target in targets.items():
        if target in prepared_paths:
            print(f"[OK] soundfont target already prepared for {env_name}: {target}")
            continue
        prepare_soundfont(target)
        prepared_paths.add(target)


def prepare_huggingface_snapshots(hf_home: Path, repo_ids: Sequence[str]) -> None:
    from huggingface_hub import snapshot_download

    hub_cache = hf_home / "hub"
    _ensure_directory(hub_cache)
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    # Worker processes stay offline after deployment, but this explicit asset
    # preparation command must be able to hydrate incomplete snapshots.
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["TRANSFORMERS_OFFLINE"] = "0"
    for repo_id in repo_ids:
        print(f"[INFO] downloading Hugging Face snapshot: {repo_id}")
        snapshot_path = snapshot_download(
            repo_id=repo_id,
            cache_dir=str(hub_cache),
            token=token,
            local_files_only=False,
        )
        print(f"[OK] snapshot ready: {repo_id} -> {snapshot_path}")


def prepare_paddleocr_models() -> None:
    from app.core.settings.worker_runtime import get_worker_runtime_settings

    worker_settings = get_worker_runtime_settings()
    model_root = _require_path(worker_settings.PADDLEOCR_MODEL_ROOT, "PADDLEOCR_MODEL_ROOT")
    _ensure_directory(model_root)
    for asset in PADDLEOCR_MODEL_ASSETS:
        target = _require_path(getattr(worker_settings, asset.target_env_name), asset.target_env_name)
        _prepare_paddleocr_model_asset(asset, target)
    print("[OK] PaddleOCR models prepared")


async def run_final_checks(include_sizes: bool) -> int:
    from app.core.runtime_checks import RuntimeRole, run_runtime_checks

    results = await run_runtime_checks(RuntimeRole.WORKER, include_sizes=include_sizes)
    failed = False
    for result in results:
        print(f"[{'OK' if result.ok else 'FAIL'}] {result.name}: {result.message}")
        failed = failed or not result.ok
    return 1 if failed else 0


def run_asset_checks(include_sizes: bool) -> int:
    from app.core.runtime_checks import (
        check_huggingface_models,
        check_paddleocr_models,
        check_playback_renderer,
        check_soundfont,
    )

    checks = (
        check_playback_renderer,
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

    from app.core.settings.worker_runtime import get_worker_runtime_settings
    from app.processing.engines.omr.legato_manifest import HF_MODEL_REPOSITORIES

    worker_settings = get_worker_runtime_settings()
    model_root = _require_path(worker_settings.MODEL_ROOT, "MODEL_ROOT")
    _ensure_directory(model_root)

    if not args.skip_soundfont:
        prepare_soundfonts()
    if not args.skip_huggingface:
        prepare_huggingface_snapshots(
            _require_path(worker_settings.HF_HOME, "HF_HOME"),
            HF_MODEL_REPOSITORIES,
        )
    if not args.skip_paddleocr:
        prepare_paddleocr_models()

    if args.check_scope == "assets":
        return run_asset_checks(include_sizes=args.include_sizes)
    return await run_final_checks(include_sizes=args.include_sizes)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
