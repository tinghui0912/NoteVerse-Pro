from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from app.core.settings.worker_runtime import get_worker_runtime_settings

def _load_prepare_model_assets_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "prepare_model_assets.py"
    spec = importlib.util.spec_from_file_location("prepare_model_assets_for_test", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_prepare_soundfonts_uses_only_deployed_playback_soundfont(monkeypatch, tmp_path: Path) -> None:
    module = _load_prepare_model_assets_module()
    playback_soundfont = tmp_path / "playback.sf2"
    prepared_targets: list[Path] = []

    monkeypatch.setenv("LEGATO_REPO_PATH", "/opt/noteverse/legato")
    monkeypatch.setenv("PLAYBACK_SOUNDFONT_PATH", str(playback_soundfont))
    monkeypatch.setattr(module, "prepare_soundfont", lambda target: prepared_targets.append(target))

    get_worker_runtime_settings.cache_clear()
    try:
        module.prepare_soundfonts()
    finally:
        get_worker_runtime_settings.cache_clear()

    assert prepared_targets == [playback_soundfont]
