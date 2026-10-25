"""Narrow contracts against the actual API/Beat recipes, not copied fixtures."""

from pathlib import Path
import shlex

import pytest

from scripts import backend_service_lock as lock


@pytest.fixture
def repo():
    for candidate in (Path(__file__).resolve().parents[2], Path("/repo")):
        if (candidate / "docker/backend/Dockerfile.api").is_file():
            return candidate
    raise AssertionError("Dockerfile contract tests require the repository (quality container: mount /repo:ro)")


def assert_source_lock_contract(text: str, role: str, expected: set[str]) -> None:
    lines = [line.strip() for line in text.replace("\\\n", " ").splitlines() if line.strip() and not line.lstrip().startswith("#")]
    helper = "/usr/local/lib/noteverse/backend_service_lock.py"
    runtime_lock = f"/opt/noteverse/{role}-python.lock"
    gate = f"RUN --network=none python {helper} --role {role} --check-inputs --repo /tmp/service-lock-source --lock {runtime_lock}"
    assert lines.count(gate) == 1, "Offline role source-lock gate must execute exactly once"
    gate_index = lines.index(gate)
    install = next(i for i, line in enumerate(lines) if line.startswith("RUN ") and f"--require-hashes --no-build-isolation -r {runtime_lock}" in line)
    bootstrap = next(i for i, line in enumerate(lines) if line.startswith("RUN ") and "--bootstrap-requirements" in line)
    assert gate_index < bootstrap <= install, "Source gate must precede all locked installation"
    staged: list[str] = []
    copies = [shlex.split(line) for line in lines[:gate_index] if line.startswith("COPY ")]
    for parts in copies:
        assert "backend/requirements" not in [p.rstrip("/") for p in parts[1:-1]], "Whole requirements COPY breaks role isolation"
        if parts[-1] == "/tmp/service-lock-source/backend/requirements/":
            staged.extend(parts[1:-1])
    assert len(staged) == len(set(staged)) and set(staged) == expected, "Stage exactly the current recursive role closure"
    assert ["COPY", lock.role_paths(role).lock, runtime_lock] in copies
    assert ["COPY", "backend/scripts/backend_service_lock.py", helper] in copies


@pytest.mark.parametrize("role", ["api", "beat"])
def test_actual_dockerfile_stages_exact_role_closure_and_checks_before_install(repo, role):
    text = (repo / f"docker/backend/Dockerfile.{role}").read_text(encoding="utf-8")
    assert_source_lock_contract(text, role, set(lock.source_closure(repo, role)))


@pytest.mark.parametrize("role", ["api", "beat"])
@pytest.mark.parametrize("mutation", ["delete-gate", "resolver-instead", "wrong-role", "missing-input", "unrelated-input", "whole-directory", "late-gate"])
def test_dockerfile_contract_rejects_gate_removal_and_role_isolation_regressions(repo, role, mutation):
    text = (repo / f"docker/backend/Dockerfile.{role}").read_text(encoding="utf-8")
    gate = next(line for line in text.splitlines() if line.startswith("RUN --network=none "))
    if mutation == "delete-gate":
        text = text.replace(gate, "")
    elif mutation == "resolver-instead":
        text = text.replace("--check-inputs", "--check")
    elif mutation == "wrong-role":
        text = text.replace(gate, gate.replace(f"--role {role}", "--role " + ("beat" if role == "api" else "api")))
    elif mutation == "missing-input":
        text = text.replace("backend/requirements/core.txt", "backend/requirements/missing.txt")
    elif mutation == "unrelated-input":
        text = text.replace(f"COPY backend/requirements/{role}-image.in", f"COPY backend/requirements/quality-tools.txt backend/requirements/{role}-image.in")
    elif mutation == "whole-directory":
        start = text.index(f"COPY backend/requirements/{role}-image.in")
        end = text.index("/tmp/service-lock-source/backend/requirements/", start) + len("/tmp/service-lock-source/backend/requirements/")
        text = text[:start] + "COPY backend/requirements/ /tmp/service-lock-source/backend/requirements/" + text[end:]
    else:
        text = text.replace(gate, "") + "\n" + gate + "\n"
    with pytest.raises(AssertionError):
        assert_source_lock_contract(text, role, set(lock.source_closure(repo, role)))
