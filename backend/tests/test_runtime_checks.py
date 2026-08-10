import sys
import json
from types import SimpleNamespace

from app.core.config import get_worker_runtime_settings
from app.core.runtime_checks import (
    ROLE_CHECK_NAMES,
    RuntimeRole,
    check_huggingface_models,
    check_omr_cuda_runtime,
    check_omr_engine,
)


def test_api_runtime_checks_cover_api_owned_dependencies() -> None:
    assert ROLE_CHECK_NAMES[RuntimeRole.API] == (
        "settings",
        "database",
        "storage_quota_policy",
        "redis",
        "storage",
    )


def test_practice_runtime_checks_cover_practice_owned_dependencies() -> None:
    assert ROLE_CHECK_NAMES[RuntimeRole.PRACTICE] == (
        "settings",
        "database",
        "storage_quota_policy",
        "redis",
        "storage",
        "soundfont",
        "practice_alignment",
    )


def test_control_plane_runtime_checks_require_independent_identity_configuration() -> None:
    assert ROLE_CHECK_NAMES[RuntimeRole.CONTROL_PLANE] == (
        "settings",
        "control_plane_settings",
        "database",
        "storage_quota_policy",
        "redis",
    )


def test_observability_exporter_checks_only_its_database_dependency() -> None:
    assert ROLE_CHECK_NAMES[RuntimeRole.OBSERVABILITY_EXPORTER] == ("settings", "database")


def test_worker_runtime_checks_cover_worker_owned_dependencies() -> None:
    checks = ROLE_CHECK_NAMES[RuntimeRole.WORKER]

    assert "worker_database" in checks
    assert "worker_settings" in checks
    assert "storage_quota_policy" in checks
    assert "celery_tasks" in checks
    assert "omr_engine" in checks
    assert "omr_cuda_runtime" in checks
    assert "render_engine" in checks
    assert "playback_renderer" in checks
    assert "paddleocr_models" in checks
    assert "huggingface_models" in checks
    assert "database" not in checks
    assert "practice_alignment" not in checks


def test_beat_runtime_checks_remain_lightweight() -> None:
    assert ROLE_CHECK_NAMES[RuntimeRole.BEAT] == (
        "settings",
        "redis",
        "beat_state",
    )


def test_all_runtime_checks_are_a_deduplicated_union() -> None:
    all_checks = ROLE_CHECK_NAMES[RuntimeRole.ALL]

    assert len(all_checks) == len(set(all_checks))
    for role in (
        RuntimeRole.API,
        RuntimeRole.CONTROL_PLANE,
        RuntimeRole.OBSERVABILITY_EXPORTER,
        RuntimeRole.WORKER,
        RuntimeRole.BEAT,
        RuntimeRole.PRACTICE,
    ):
        assert set(ROLE_CHECK_NAMES[role]).issubset(all_checks)


def test_omr_runtime_check_accepts_image_source_without_git_metadata(tmp_path, monkeypatch) -> None:
    repo_path = tmp_path / "legato"
    (repo_path / "legato" / "models").mkdir(parents=True)

    monkeypatch.setattr(get_worker_runtime_settings(), "LEGATO_REPO_PATH", str(repo_path))
    monkeypatch.setattr(get_worker_runtime_settings(), "LEGATO_REPO_COMMIT", "abc123")

    result = check_omr_engine()

    assert result.ok is True
    assert result.message == "LEGATO commit=abc123 (image metadata)"


def test_omr_cuda_runtime_check_is_skipped_for_cpu_device(monkeypatch) -> None:
    monkeypatch.setattr(get_worker_runtime_settings(), "LEGATO_DEVICE", "cpu")

    result = check_omr_cuda_runtime()

    assert result.ok is True
    assert result.message == "not required for LEGATO_DEVICE=cpu"


def test_omr_cuda_runtime_check_fails_when_cuda_is_unavailable(monkeypatch) -> None:
    torch_stub = SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: False,
            device_count=lambda: 0,
            get_device_name=lambda _: "unused",
        )
    )
    monkeypatch.setattr(get_worker_runtime_settings(), "LEGATO_DEVICE", "cuda")
    monkeypatch.setitem(sys.modules, "torch", torch_stub)

    result = check_omr_cuda_runtime()

    assert result.ok is False
    assert result.message == "CUDA is not available to the worker process"


def test_omr_cuda_runtime_check_reports_available_gpu(monkeypatch) -> None:
    torch_stub = SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: True,
            device_count=lambda: 1,
            get_device_name=lambda _: "NVIDIA Test GPU",
        )
    )
    monkeypatch.setattr(get_worker_runtime_settings(), "LEGATO_DEVICE", "cuda")
    monkeypatch.setitem(sys.modules, "torch", torch_stub)

    result = check_omr_cuda_runtime()

    assert result.ok is True
    assert result.message == "CUDA ready: devices=1, primary=NVIDIA Test GPU"


def test_huggingface_model_check_rejects_incomplete_sharded_snapshot(tmp_path, monkeypatch) -> None:
    snapshot = tmp_path / "hub" / "models--example--model" / "snapshots" / "revision"
    snapshot.mkdir(parents=True)
    (snapshot / "config.json").write_text("{}", encoding="utf-8")
    (snapshot / "model-00002-of-00002.safetensors").write_bytes(b"weights")
    (snapshot / "model.safetensors.index.json").write_text(
        json.dumps(
            {
                "weight_map": {
                    "layer.0": "model-00001-of-00002.safetensors",
                    "layer.1": "model-00002-of-00002.safetensors",
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(get_worker_runtime_settings(), "HF_HOME", str(tmp_path))
    monkeypatch.setattr(get_worker_runtime_settings(), "HF_MODEL_REPOSITORIES", ["example/model"])

    result = check_huggingface_models()

    assert result.ok is False
    assert "model-00001-of-00002.safetensors" in result.message
