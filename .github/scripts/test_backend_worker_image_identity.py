from pathlib import Path
import re
from types import SimpleNamespace

import pytest

import backend_worker_image_identity as identity

ROOT = Path(__file__).resolve().parents[2]
BASE = "sha256:" + "a" * 64
FIRST = "sha256:" + "b" * 64
OTHER = "sha256:" + "c" * 64
REPOSITORY = "ghcr.io/tinghui0912/noteverse/backend-worker-deps"
KEY = "d" * 64


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.setattr(identity, "worker_resolution", lambda _: b"locked Worker target graph\n")
    for path in identity.IDENTITY_INPUTS:
        target = tmp_path / path
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((ROOT / path).read_bytes())
    return tmp_path


def test_same_governed_inputs_produce_same_dependency_build_key(repo):
    first = identity.build_identity(repo, BASE)
    assert first == identity.build_identity(repo, BASE)
    assert first["key_tag"] == "deps-" + first["build_key"]
    assert len(first["build_key"]) == 64
    assert "resolved_python_base_oci_digest" in first["document"]


def test_lf_and_crlf_checkouts_have_identical_canonical_identity(repo):
    paths = identity.build_identity(repo, BASE)["document"]["inputs"]
    for path in paths:
        file = repo / path
        file.write_bytes(file.read_bytes().replace(b"\r\n", b"\n"))
    lf = identity.build_identity(repo, BASE)
    for path in paths:
        file = repo / path
        file.write_bytes(file.read_bytes().replace(b"\n", b"\r\n"))
    assert identity.build_identity(repo, BASE) == lf


def test_semantic_project_change_changes_canonical_key(repo):
    before = identity.build_identity(repo, BASE)["build_key"]
    project = repo / "backend/pyproject.toml"
    project.write_text(project.read_text(encoding="utf-8").replace("numpy==2.3.5", "numpy==2.3.4"), encoding="utf-8")
    assert identity.build_identity(repo, BASE)["build_key"] != before


def test_uv_worker_resolution_changes_key(repo, monkeypatch):
    before = identity.build_identity(repo, BASE)["build_key"]
    monkeypatch.setattr(identity, "worker_resolution", lambda _: b"changed uv resolution")
    assert identity.build_identity(repo, BASE)["build_key"] != before


def test_worker_resolution_uses_explicit_cpython_linux_target_and_exact_bytes(repo, monkeypatch):
    calls = []
    exported = b"noteverse-backend v0.0.0\n  package v1.0\n"

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(stdout="uv 0.13.5 (approved)\n" if args == ["uv", "--version"] else exported)

    monkeypatch.undo()  # Exercise the real exporter, not the identity fixture stub.
    monkeypatch.setattr(identity.subprocess, "run", run)
    assert identity.worker_resolution(repo) == exported
    assert calls[1][0] == [
        "uv", "tree", "--locked", "--only-group", "worker",
        "--python", "cpython@3.12", "--python-version", "3.12",
        "--python-platform", "x86_64-manylinux_2_36", "--color", "never", "--no-progress",
    ]
    assert calls[1][1]["cwd"] == repo / "backend"
    assert calls[1][1]["check"] is True
    assert "text" not in calls[1][1]  # No platform newline conversion.


def test_unapproved_uv_version_fails_before_export(repo, monkeypatch):
    monkeypatch.undo()
    monkeypatch.setattr(identity.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout="uv 0.13.4\n"))
    with pytest.raises(ValueError, match="exact approved uv"):
        identity.worker_resolution(repo)


def test_empty_native_target_graph_fails_closed(repo, monkeypatch):
    monkeypatch.undo()
    monkeypatch.setattr(identity.subprocess, "run", lambda args, **kwargs: SimpleNamespace(
        stdout="uv 0.13.5\n" if args == ["uv", "--version"] else b"",
    ))
    with pytest.raises(ValueError, match="target graph"):
        identity.worker_resolution(repo)


@pytest.mark.parametrize("content", [b"invalid \xff", b"binary \x00 input"])
def test_non_text_governed_input_fails_closed(repo, content):
    (repo / "docker/backend/Dockerfile.worker-deps").write_bytes(content)
    with pytest.raises(ValueError, match="UTF-8 text|Binary NUL"):
        identity.build_identity(repo, BASE)


def test_lone_cr_governed_input_fails_closed(repo):
    (repo / "docker/backend/Dockerfile.worker-deps").write_bytes(b"ARG BASE=x\rFROM x\n")
    with pytest.raises(ValueError, match="lone CR"):
        identity.build_identity(repo, BASE)


@pytest.mark.parametrize("path", identity.IDENTITY_INPUTS)
def test_changed_governed_input_changes_build_key(repo, path):
    before = identity.build_identity(repo, BASE)["build_key"]
    file = repo / path
    file.write_bytes(file.read_bytes() + b"\n# changed input\n")
    assert identity.build_identity(repo, BASE)["build_key"] != before


def test_resolved_base_digest_changes_key_even_when_alias_is_unchanged(repo):
    assert identity.build_identity(repo, BASE)["build_key"] != identity.build_identity(repo, OTHER)["build_key"]


def test_dependency_identity_describes_its_current_artifact_inputs(repo):
    result = identity.build_identity(repo, BASE)
    assert re.fullmatch(r"deps-[a-f0-9]{64}", result["key_tag"])
    assert set(result) == {"build_key", "key_tag", "resolution_sha256", "document"}
    document = result["document"]
    assert document["identity_type"] == "noteverse-worker-deps"
    assert set(document) == {
        "identity_type", "target_platform", "python", "uv_target", "resolution_format",
        "resolved_python_base_oci_digest", "worker_resolution_sha256",
        "uv_required_version", "uv_tool_image", "inputs",
    }


@pytest.mark.parametrize("value", ["sha256:abc", "sha256:" + "A" * 64, "md5:" + "a" * 32, BASE + "\n", "latest"])
def test_malformed_oci_digest_rejected(value):
    with pytest.raises(ValueError):
        identity.validate_digest(value)



@pytest.mark.parametrize(("host", "machine"), [("linux", "x86_64"), ("win32", "AMD64"), ("darwin", "arm64")])
def test_caller_host_cannot_change_target_resolution(repo, monkeypatch, host, machine):
    import platform

    monkeypatch.undo()
    monkeypatch.setattr(identity.sys, "platform", host)
    monkeypatch.setattr(platform, "machine", lambda: machine)
    graph = b"same locked CPython Linux x86_64 graph\n"
    def run(args, **kwargs):
        if args == ["uv", "--version"]:
            return SimpleNamespace(stdout="uv 0.13.5\n")
        assert args[args.index("--python-platform") + 1] == "x86_64-manylinux_2_36"
        assert args[args.index("--python-version") + 1] == "3.12"
        assert args[args.index("--python") + 1] == "cpython@3.12"
        return SimpleNamespace(stdout=graph)
    monkeypatch.setattr(identity.subprocess, "run", run)
    assert identity.worker_resolution(repo) == graph


@pytest.mark.parametrize("path", [".github/scripts/oci_publication.py", ".github/scripts/backend_worker_image_publication.py", ".github/scripts/backend_service_image_publication.py"])
def test_registry_policy_changes_do_not_change_dependency_key(repo, path):
    before = identity.build_identity(repo, BASE)
    policy = repo / path
    policy.parent.mkdir(parents=True, exist_ok=True)
    policy.write_text("changed registry classification or promotion", encoding="utf-8")
    assert identity.build_identity(repo, BASE) == before


def test_identity_module_has_no_registry_or_role_policy():
    source = Path(identity.__file__).read_text(encoding="utf-8")
    for implementation in ("DockerRegistry", "def plan(", "def promote(", "ghcr.io/", "oci_publication", "check_workflow_documents"):
        assert implementation not in source


@pytest.mark.parametrize("caller_platform", ["linux", "windows", "macos"])
def test_native_uv_marker_filtering_uses_target_not_caller_environment(tmp_path, monkeypatch, caller_platform):
    # Minimal checked-in-format fixture; uv validates/filters it offline. No parser here.
    backend = tmp_path / "backend"
    backend.mkdir()
    project = backend / "pyproject.toml"
    lock = backend / "uv.lock"
    project.write_text('[project]\nname="marker-fixture"\nversion="0.0.0"\nrequires-python=">=3.12,<3.13"\ndependencies=[]\n[dependency-groups]\nworker=["six==1.17.0; sys_platform == \'linux\'", "idna==3.20; sys_platform == \'win32\'"]\n[tool.uv]\npackage=false\nrequired-version="==0.13.5"\n', encoding="utf-8")
    lock.write_text('version = 1\nrevision = 5\nrequires-python = "==3.12.*"\n[[package]]\nname = "idna"\nversion = "3.20"\nsource = { registry = "https://pypi.org/simple" }\n[[package]]\nname = "six"\nversion = "1.17.0"\nsource = { registry = "https://pypi.org/simple" }\n[[package]]\nname = "marker-fixture"\nversion = "0.0.0"\nsource = { virtual = "." }\n[package.dev-dependencies]\nworker = [\n { name = "six", marker = "sys_platform == \'linux\'" },\n { name = "idna", marker = "sys_platform == \'win32\'" },\n]\n[package.metadata.requires-dev]\nworker = [\n { name = "six", specifier = "==1.17.0", marker = "sys_platform == \'linux\'" },\n { name = "idna", specifier = "==3.20", marker = "sys_platform == \'win32\'" },\n]\n', encoding="utf-8")
    before = (project.read_bytes(), lock.read_bytes())
    monkeypatch.setenv("UV_PYTHON_PLATFORM", caller_platform)
    monkeypatch.setenv("UV_PYTHON", "3.14")
    monkeypatch.setenv("UV_OFFLINE", "true")
    monkeypatch.setenv("UV_CACHE_DIR", str(tmp_path / "cache"))
    graph = identity.worker_resolution(tmp_path)
    assert graph == "marker-fixture v0.0.0\n└── six v1.17.0 (group: worker)\n".encode("utf-8")
    assert b"idna" not in graph
    assert (project.read_bytes(), lock.read_bytes()) == before
