"""Prevent the committed Docker environment template from drifting from runtime code."""

from __future__ import annotations

import re
from pathlib import Path

from app.core.config import Settings


ENV_TEMPLATE = Path(__file__).resolve().parents[1] / ".env.docker.example"
ENTRYPOINT_ONLY_KEYS = {"CELERY_WORKER_CONCURRENCY"}
ENVIRONMENT_ASSIGNMENT = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=")


def _template_keys() -> set[str]:
    return {
        match.group(1)
        for line in ENV_TEMPLATE.read_text(encoding="utf-8-sig").splitlines()
        if (match := ENVIRONMENT_ASSIGNMENT.match(line))
    }


def test_docker_environment_template_declares_only_supported_keys() -> None:
    unsupported = _template_keys() - set(Settings.model_fields) - ENTRYPOINT_ONLY_KEYS

    assert not unsupported, "Unsupported Docker environment keys: " + ", ".join(sorted(unsupported))


def test_entrypoint_only_docker_environment_keys_are_explicitly_allowlisted() -> None:
    assert ENTRYPOINT_ONLY_KEYS == {"CELERY_WORKER_CONCURRENCY"}
