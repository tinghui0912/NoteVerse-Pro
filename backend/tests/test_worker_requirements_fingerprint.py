from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from scripts.worker_requirements_fingerprint import DEFAULT_ROOTS, requirements_digest, resolve_closure

BACKEND_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_CLOSURE = {
    "backend/requirements/worker-app.txt",
    "backend/requirements/db.txt",
    "backend/requirements/storage.txt",
    "backend/requirements/celery.txt",
    "backend/requirements/cache.txt",
    "backend/requirements/core.txt",
    "backend/requirements/image.txt",
    "backend/requirements/render.txt",
    "backend/requirements/tracing.txt",
    "backend/requirements/ocr.txt",
}


@pytest.fixture
def copied_repo(tmp_path: Path) -> Path:
    shutil.copytree(BACKEND_ROOT / "requirements", tmp_path / "backend/requirements")
    return tmp_path


def test_current_worker_closure_matches_owned_requirements(copied_repo: Path) -> None:
    assert resolve_closure(copied_repo) == tuple(sorted(EXPECTED_CLOSURE))


def test_root_order_and_duplicate_roots_are_deterministic(copied_repo: Path) -> None:
    roots = tuple(reversed(DEFAULT_ROOTS)) + DEFAULT_ROOTS
    assert resolve_closure(copied_repo, roots) == resolve_closure(copied_repo)
    assert requirements_digest(copied_repo, roots) == requirements_digest(copied_repo)


def test_duplicate_nested_includes_are_visited_once(tmp_path: Path) -> None:
    req = tmp_path / "backend/requirements"
    req.mkdir(parents=True)
    (req / "root.txt").write_text("-r shared.txt\n--requirement shared.txt\n")
    (req / "shared.txt").write_text("example==1\n")
    assert resolve_closure(tmp_path, ("backend/requirements/root.txt",)) == (
        "backend/requirements/root.txt", "backend/requirements/shared.txt",
    )


def test_includes_are_relative_to_including_file_and_support_long_form(tmp_path: Path) -> None:
    req = tmp_path / "backend/requirements"
    (req / "nested").mkdir(parents=True)
    (req / "root.txt").write_text('--requirement "nested/child file.txt" # comment\n')
    (req / "nested/child file.txt").write_text("--requirement=../shared.txt\n")
    (req / "shared.txt").write_text("example==1\n")
    assert set(resolve_closure(tmp_path, ("backend/requirements/root.txt",))) == {
        "backend/requirements/root.txt", "backend/requirements/nested/child file.txt",
        "backend/requirements/shared.txt",
    }


@pytest.mark.parametrize("include", ["root.txt", "child.txt"])
def test_cycles_are_rejected(tmp_path: Path, include: str) -> None:
    req = tmp_path / "backend/requirements"
    req.mkdir(parents=True)
    (req / "root.txt").write_text(f"-r {include}\n")
    (req / "child.txt").write_text("-r root.txt\n")
    with pytest.raises(ValueError, match="include cycle"):
        resolve_closure(tmp_path, ("backend/requirements/root.txt",))


def test_missing_include_is_rejected(copied_repo: Path) -> None:
    (copied_repo / "backend/requirements/cache.txt").unlink()
    with pytest.raises(ValueError, match="Missing requirement file"):
        requirements_digest(copied_repo)


def test_missing_root_is_rejected(copied_repo: Path) -> None:
    with pytest.raises(ValueError, match="Missing requirement file"):
        resolve_closure(copied_repo, ("backend/requirements/missing.txt",))


def test_parent_path_escape_is_rejected(copied_repo: Path) -> None:
    (copied_repo / "backend/outside.txt").write_text("example==1\n")
    (copied_repo / DEFAULT_ROOTS[0]).write_text("-r ../outside.txt\n")
    with pytest.raises(ValueError, match="escapes requirements root"):
        requirements_digest(copied_repo)


@pytest.mark.parametrize("line", [
    "-r", "-r one.txt two.txt", "--requirement", "--requirement=",
    "-r https://example.com/requirements.txt", "-r ${FILE}", "-r *.txt",
    "-c constraints.txt", "--constraint=constraints.txt",
])
def test_ambiguous_or_unsupported_includes_are_rejected(copied_repo: Path, line: str) -> None:
    (copied_repo / DEFAULT_ROOTS[0]).write_text(line + "\n")
    with pytest.raises(ValueError):
        requirements_digest(copied_repo)


@pytest.mark.parametrize(("filename", "changes_digest"), [
    ("render.txt", True), ("tracing.txt", True),
    ("practice-score.txt", False), ("quality-tools.txt", False),
])
def test_digest_tracks_only_recursive_worker_inputs(
    copied_repo: Path, filename: str, changes_digest: bool,
) -> None:
    before = requirements_digest(copied_repo)
    path = copied_repo / "backend/requirements" / filename
    path.write_bytes(path.read_bytes() + b"\n# dependency fingerprint sensitivity probe\n")
    assert (requirements_digest(copied_repo) != before) is changes_digest


def test_digest_preserves_exact_file_bytes(copied_repo: Path) -> None:
    before = requirements_digest(copied_repo)
    path = copied_repo / "backend/requirements/render.txt"
    original = path.read_bytes()
    changed = original.replace(b"\r\n", b"\n") if b"\r\n" in original else original.replace(b"\n", b"\r\n")
    path.write_bytes(changed)
    assert requirements_digest(copied_repo) != before


def test_digest_includes_path_identity(tmp_path: Path) -> None:
    req = tmp_path / "backend/requirements"
    req.mkdir(parents=True)
    for name in ("first.txt", "second.txt"):
        (req / name).write_bytes(b"example==1\n")
    assert requirements_digest(tmp_path, ("backend/requirements/first.txt",)) != (
        requirements_digest(tmp_path, ("backend/requirements/second.txt",))
    )


def test_cli_lists_closure_and_emits_sha256(copied_repo: Path) -> None:
    scripts = copied_repo / "backend/scripts"
    scripts.mkdir(parents=True)
    source = BACKEND_ROOT / "scripts/worker_requirements_fingerprint.py"
    script = scripts / source.name
    shutil.copyfile(source, script)
    listed = subprocess.run(
        [sys.executable, str(script), "--list"], check=True, capture_output=True, text=True,
    )
    hashed = subprocess.run(
        [sys.executable, str(script)], check=True, capture_output=True, text=True,
    )
    assert listed.stdout.splitlines() == sorted(EXPECTED_CLOSURE)
    assert hashed.stdout.strip() == requirements_digest(copied_repo)
    assert len(hashed.stdout.strip()) == 64
