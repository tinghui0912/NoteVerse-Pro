"""Prevent the committed Docker environment template from drifting from runtime code."""

from __future__ import annotations

import re
from pathlib import Path

from app.core.config import PracticeRuntimeSettings, Settings, WorkerRuntimeSettings
from app.core.settings.playback import PlaybackSettings
from app.core.settings.worker_model_engine import WorkerModelEngineSettings


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ENV_TEMPLATES = {
    BACKEND_ROOT / ".env.docker.example": set(),
    BACKEND_ROOT / ".env.docker.worker.example": {
        "CELERY_WORKER_CONCURRENCY",
        *WorkerRuntimeSettings.model_fields,
    },
    BACKEND_ROOT / ".env.docker.practice.example": set(PracticeRuntimeSettings.model_fields),
}
ENVIRONMENT_ASSIGNMENT = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=")
WORKER_ROLE_SPECIFIC_KEYS = set(PlaybackSettings.model_fields) | set(WorkerModelEngineSettings.model_fields)


def _template_keys(path: Path) -> set[str]:
    return {
        match.group(1)
        for line in path.read_text(encoding="utf-8-sig").splitlines()
        if (match := ENVIRONMENT_ASSIGNMENT.match(line))
    }


def test_docker_environment_templates_declare_only_supported_keys() -> None:
    violations: list[str] = []
    for path, allowed_extra_keys in ENV_TEMPLATES.items():
        unsupported = _template_keys(path) - set(Settings.model_fields) - allowed_extra_keys
        violations.extend(f"{path.name}: {key}" for key in sorted(unsupported))

    assert not violations, "Unsupported Docker environment keys: " + ", ".join(violations)


def test_worker_process_template_declares_only_the_worker_entrypoint_contract() -> None:
    assert _template_keys(BACKEND_ROOT / ".env.docker.worker.example") <= {
        "CELERY_WORKER_CONCURRENCY",
        *WorkerRuntimeSettings.model_fields,
    }


def test_shared_docker_template_excludes_role_specific_runtime_settings() -> None:
    shared_keys = _template_keys(BACKEND_ROOT / ".env.docker.example")

    assert shared_keys.isdisjoint(WORKER_ROLE_SPECIFIC_KEYS)
    assert shared_keys.isdisjoint(PracticeRuntimeSettings.model_fields)
