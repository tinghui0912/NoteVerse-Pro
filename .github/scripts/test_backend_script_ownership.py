"""Present-state CI ownership, trigger coverage and distinct validation entrypoints."""

import ast
from fnmatch import fnmatchcase
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
CI = ROOT / ".github/scripts"
HELPERS = (
    "oci_publication.py", "backend_service_image_publication.py",
    "backend_worker_image_identity.py", "backend_worker_image_publication.py",
    "backend_worker_runner_disk.py",
)


def load_workflow(name):
    return yaml.safe_load((ROOT / ".github/workflows" / name).read_text(encoding="utf-8"))


def test_ci_helpers_are_owned_and_tested_in_the_ci_directory():
    for name in HELPERS:
        assert (CI / name).is_file()
        assert (CI / ("test_" + name)).is_file()
        tree = ast.parse((CI / name).read_text(encoding="utf-8"))
        modules = [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
        modules += [alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names]
        assert all(module.split(".")[0] != "app" for module in modules)


@pytest.mark.parametrize("workflow", ["backend-quality.yml", "backend-api-image.yml", "backend-beat-image.yml", "backend-worker-pr-image.yml"])
def test_backend_ci_changes_trigger_affected_validation(workflow):
    document = load_workflow(workflow)
    events = document.get("on", document.get(True))
    paths = events["pull_request"]["paths"]
    governed = [p.relative_to(ROOT).as_posix() for p in CI.glob("backend_*.py")]
    governed += [p.relative_to(ROOT).as_posix() for p in CI.glob("test_backend_*.py")]
    governed += [".github/scripts/oci_publication.py", ".github/scripts/test_oci_publication.py"]
    for path in governed:
        assert any(fnmatchcase(path, pattern) for pattern in paths if not pattern.startswith("!")), path
    if "push" in events:
        assert set(paths) <= set(events["push"]["paths"])


def test_quality_runs_ci_and_backend_tests_as_separate_suites():
    steps = load_workflow("backend-quality.yml")["jobs"]["quality"]["steps"]
    ci = next(step for step in steps if step["name"] == "Run CI policy and trust tests separately")
    backend = next(step for step in steps if step["name"] == "Run full backend pytest")
    assert "python -m pytest /repo/.github/scripts -q" in ci["run"]
    assert "python -m pytest tests -q" in backend["run"]
    checking = next(step for step in steps if step["name"] == "Run CI trust helper mypy")["run"]
    for name in HELPERS:
        assert "/repo/.github/scripts/" + name in checking


def test_backend_command_index_covers_backend_owned_executables():
    directory = ROOT / "backend/scripts"
    index = (directory / "README.md").read_text(encoding="utf-8")
    for script in directory.glob("*.py"):
        assert "`" + script.name + "`" in index
    contract = directory / "check_image_contract.py"
    recipe = (ROOT / "docker/backend/Dockerfile.worker-deps").read_text(encoding="utf-8")
    assert contract.is_file()
    assert "COPY backend/scripts/check_image_contract.py" in recipe
