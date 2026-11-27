"""Durable dependency-authority boundaries; uv owns resolution and lock validation."""

import os
from pathlib import Path
import re
import tomllib

import pytest


ROOT = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
BACKEND = ROOT / "backend"
PROJECT = tomllib.loads((BACKEND / "pyproject.toml").read_text(encoding="utf-8"))
CAPABILITIES = {
    "core",
    "db",
    "cache",
    "celery",
    "tracing",
    "metrics",
    "http",
    "auth",
    "storage",
    "image",
    "fingering",
    "render",
    "ocr",
    "migrations",
    "quality-tools",
}
RUNTIMES = {"api", "beat", "worker-app", "worker", "quality", "dev"}


def test_one_virtual_project_and_one_lock():
    assert PROJECT["project"]["name"] == "noteverse-backend"
    assert PROJECT["project"]["requires-python"] == ">=3.12,<3.13"
    assert PROJECT["project"]["dependencies"] == []
    assert PROJECT["tool"]["uv"]["package"] is False
    assert "workspace" not in PROJECT["tool"]["uv"]
    assert PROJECT["tool"]["uv"]["required-version"] == "==0.13.5"
    assert PROJECT["tool"]["uv"]["default-groups"] == ["dev"]
    assert PROJECT["tool"]["uv"]["index-strategy"] == "first-index"
    assert PROJECT["tool"]["uv"]["prerelease"] != "allow"
    assert (
        not {"constraint-dependencies", "override-dependencies", "conflicts"}
        & PROJECT["tool"]["uv"].keys()
    )
    assert (BACKEND / ".python-version").read_text().strip() == "3.12"
    assert list(BACKEND.rglob("uv.lock")) == [BACKEND / "uv.lock"]
    assert list(BACKEND.rglob("pyproject.toml")) == [BACKEND / "pyproject.toml"]


def test_capability_and_runtime_composition():
    groups = PROJECT["dependency-groups"]
    assert set(groups) == CAPABILITIES | RUNTIMES
    assert groups["dev"] == [{"include-group": "quality"}]
    assert groups["quality"] == [
        {"include-group": role}
        for role in (
            "api",
            "beat",
            "render",
            "quality-tools",
        )
    ]
    assert groups["worker-app"] == [
        {"include-group": role}
        for role in (
            "auth",
            "metrics",
            "db",
            "storage",
            "celery",
            "image",
            "render",
            "tracing",
        )
    ]
    for runtime in RUNTIMES:
        assert any(isinstance(item, dict) and "include-group" in item for item in groups[runtime])


def test_database_capability_uses_the_psycopg_driver_family():
    assert PROJECT["dependency-groups"]["db"] == [
        {"include-group": "core"},
        "sqlmodel==0.0.48",
        "psycopg[binary]==3.3.6",
    ]


def test_worker_sources_are_explicit_and_platform_scoped():
    uv = PROJECT["tool"]["uv"]
    (index,) = uv["index"]
    assert index == {
        "name": "pytorch-cu124",
        "url": "https://download.pytorch.org/whl/cu124",
        "explicit": True,
    }
    assert uv["sources"]["torch"]["index"] == index["name"]
    assert set(uv["sources"]) == {"torch", "paddlepaddle"}
    for source in uv["sources"].values():
        assert "linux" in source["marker"] and "x86_64" in source["marker"]
    assert uv["sources"]["paddlepaddle"]["url"].endswith(
        "paddlepaddle-3.2.0-cp312-cp312-linux_x86_64.whl"
    )
    assert "environments" not in uv  # Heavy Worker sources cannot restrict ordinary development.
    assert "no-build-isolation" not in uv
    assert "preview" not in uv
    for constraint in uv["build-constraint-dependencies"]:
        assert "==" in constraint["requirement"]
        assert all(re.fullmatch(r"sha256:[0-9a-f]{64}", h) for h in constraint["hashes"])


@pytest.mark.parametrize(
    ("image", "group"),
    [("api", "api"), ("beat", "beat"), ("quality", "quality"), ("worker-deps", "worker")],
)
def test_docker_self_enforces_project_authority(image, group):
    dockerfile = (ROOT / f"docker/backend/Dockerfile.{image}").read_text(encoding="utf-8")
    approved_uv = PROJECT["tool"]["noteverse"]["images"]["uv"]
    assert re.fullmatch(r"ghcr.io/astral-sh/uv@sha256:[0-9a-f]{64}", approved_uv)
    assert f"COPY --from={approved_uv} /uv /uvx /usr/local/bin/" in dockerfile
    assert "COPY backend/pyproject.toml backend/uv.lock /opt/noteverse/project/" in dockerfile
    assert f"--locked --no-default-groups --only-group {group} " in dockerfile
    assert "UV_PYTHON_DOWNLOADS=never" in dockerfile
    assert "VIRTUAL_ENV=/opt/noteverse/venv" in dockerfile
    assert 'PATH="/opt/noteverse/venv/bin:$PATH"' in dockerfile
    assert "uv pip check --python /opt/noteverse/venv/bin/python" in dockerfile


def test_worker_dependency_artifact_uses_the_governed_python_base():
    worker = (ROOT / "docker/backend/Dockerfile.worker-deps").read_text(encoding="utf-8")
    configured = PROJECT["tool"]["noteverse"]["images"]["worker-python"]
    assert f"ARG PYTHON_IMAGE={configured}" in worker
    assert "FROM ${PYTHON_IMAGE}" in worker
    final = (ROOT / "docker/backend/Dockerfile.worker").read_text(encoding="utf-8")
    assert "ARG WORKER_DEPS_IMAGE" in final
    assert "FROM ${WORKER_DEPS_IMAGE}" in final
