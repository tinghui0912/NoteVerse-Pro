from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import backend_service_lock as lock

HASH = " --hash=sha256:" + "a" * 64


def write(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def fixture_lock(path: Path, role="api", entries="demo==1" + HASH) -> Path:
    return write(path, lock.header(role) + entries + "\n")


@pytest.mark.parametrize("role", ["api", "beat"])
def test_explicit_role_paths_keep_runtime_closures_separate(role):
    paths = lock.role_paths(role)
    assert paths.input == f"backend/requirements/{role}-image.in"
    assert paths.lock == f"backend/requirements/{role}-image-py312-linux-amd64.lock"


@pytest.mark.parametrize("role", ["worker", "all", "", "API"])
def test_unsupported_roles_fail_closed(role):
    with pytest.raises(ValueError, match="explicitly api or beat"):
        lock.role_paths(role)


def test_cli_requires_explicit_role():
    with pytest.raises(SystemExit) as exc:
        lock.main(["--check"])
    assert exc.value.code == 2


@pytest.mark.parametrize("role", ["api", "beat"])
def test_real_role_lock_has_exact_hashes_and_bootstrap_tools(role):
    backend = Path(__file__).resolve().parents[1]
    entries = lock.read_lock(backend / "requirements" / Path(lock.role_paths(role).lock).name, role)
    assert entries["wcwidth"].version == "0.9.4"
    assert lock.BOOTSTRAP.issubset(entries)
    image_input = (backend / "requirements" / f"{role}-image.in").read_text()
    assert f"-r {role}.txt" in image_input
    assert "wcwidth" not in image_input


def test_strict_parser_normalizes_names_and_preserves_hashes(tmp_path):
    path = fixture_lock(tmp_path / "api.lock", entries="Demo_Package==1.2.3 \\\n    --hash=sha256:" + "b" * 64 + HASH)
    entry = lock.read_lock(path, "api")["demo-package"]
    assert entry.version == "1.2.3"
    assert entry.requirement.count("--hash=sha256:") == 2


@pytest.mark.parametrize("entry", [
    "demo>=1" + HASH, "demo==1", "demo==1.*" + HASH, "demo~=1" + HASH,
    "demo==1; python_version>='3.12'" + HASH, "-r api.txt", "--index-url https://example.test",
    "demo @ https://example.test/demo-1-py3-none-any.whl" + HASH,
    "demo==1 --hash=md5:" + "a" * 32, "demo==1" + HASH + " trailing",
    "demo==1 --hash=sha256:" + "A" * 64,
])
def test_unpinned_unhashed_marked_or_ambiguous_entries_are_rejected(tmp_path, entry):
    with pytest.raises(ValueError, match="exact hashed entries"):
        lock.read_lock(fixture_lock(tmp_path / "api.lock", entries=entry), "api")


def test_duplicate_normalized_distributions_are_rejected(tmp_path):
    path = fixture_lock(tmp_path / "api.lock", entries="Demo_Name==1" + HASH + "\ndemo-name==1" + HASH)
    with pytest.raises(ValueError, match="Duplicate locked distribution"):
        lock.read_lock(path, "api")


def test_empty_lock_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="Empty service lock"):
        lock.read_lock(fixture_lock(tmp_path / "api.lock", entries=""), "api")


def test_role_or_target_mismatch_is_rejected(tmp_path):
    path = fixture_lock(tmp_path / "api.lock")
    with pytest.raises(ValueError, match="role/target/header mismatch"):
        lock.read_lock(path, "beat")
    path.write_text(path.read_text().replace("CPython 3.12", "CPython 3.13"))
    with pytest.raises(ValueError, match="role/target/header mismatch"):
        lock.read_lock(path, "api")


def test_bootstrap_uses_same_full_lock_entries_and_hashes(tmp_path):
    text = "\n".join(name + "==1" + HASH for name in sorted(lock.BOOTSTRAP)) + "\ndemo==2" + HASH
    path = fixture_lock(tmp_path / "api.lock", entries=text)
    bootstrap = lock.bootstrap_requirements(path, "api")
    assert "demo" not in bootstrap
    assert bootstrap.count("--hash=sha256:") == 4
    assert all(name + "==1" + HASH in bootstrap for name in lock.BOOTSTRAP)


def test_missing_bootstrap_tool_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="packaging/build tools"):
        lock.bootstrap_requirements(fixture_lock(tmp_path / "api.lock"), "api")


@pytest.mark.parametrize("actual", [{}, {"demo": "2"}, {"demo": "1", "extra": "1"}])
def test_installed_missing_mismatched_or_extra_distributions_fail(tmp_path, monkeypatch, actual):
    monkeypatch.setattr(lock, "installed_versions", lambda: actual)
    with pytest.raises(ValueError, match="Installed environment differs"):
        lock.check_installed(fixture_lock(tmp_path / "api.lock"), "api")


def test_exact_installed_map_passes_and_emits_audit_map(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(lock, "installed_versions", lambda: {"demo": "1"})
    assert lock.check_installed(fixture_lock(tmp_path / "api.lock"), "api") == {"demo": "1"}
    assert 'role=api ACTIVE_JSON={"demo": "1"}' in capsys.readouterr().out


def test_installed_discovery_normalizes_active_names(monkeypatch):
    monkeypatch.setattr(lock.importlib.metadata, "distributions", lambda: [SimpleNamespace(metadata={"Name": "Demo_Package"}, version="1")])
    assert lock.installed_versions() == {"demo-package": "1"}


def test_ambiguous_active_metadata_fails_closed(monkeypatch):
    monkeypatch.setattr(lock.importlib.metadata, "distributions", lambda: [
        SimpleNamespace(metadata={"Name": "demo"}, version="1"),
        SimpleNamespace(metadata={"Name": "demo"}, version="2"),
    ])
    with pytest.raises(ValueError, match="Ambiguous active"):
        lock.installed_versions()


@pytest.mark.parametrize("fresh", [True, False])
def test_freshness_checks_never_rewrite_checkout(tmp_path, monkeypatch, fresh, capsys):
    path = fixture_lock(tmp_path / lock.role_paths("api").lock)
    before = path.read_bytes()
    monkeypatch.setattr(lock, "require_generation_target", lambda: None)
    monkeypatch.setattr(lock, "generate", lambda *a, **kw: before if fresh else before.replace(b"demo==1", b"demo==2"))
    assert lock.main(["--role", "api", "--repo", str(tmp_path), "--check", "--uv", "/unused/uv"]) == (0 if fresh else 1)
    assert path.read_bytes() == before
    if not fresh:
        assert "--role api --generate" in capsys.readouterr().err


def test_upgrade_requires_explicit_generate_event():
    with pytest.raises(SystemExit) as exc:
        lock.main(["--role", "api", "--check", "--upgrade"])
    assert exc.value.code == 2


def test_generation_cannot_override_governed_role_lock_path():
    with pytest.raises(SystemExit):
        lock.main(["--role", "api", "--generate", "--lock", "/tmp/beat.lock"])


@pytest.mark.parametrize("upgrade", [False, True])
def test_pinned_resolver_target_seed_and_stable_header(tmp_path, monkeypatch, upgrade):
    write(tmp_path / lock.TOOL, "uv==0.13.5" + HASH + "\n")
    current = fixture_lock(tmp_path / lock.role_paths("api").lock)
    before = current.read_bytes()
    monkeypatch.setattr(lock, "require_generation_target", lambda: None)
    monkeypatch.setattr(lock.subprocess, "check_output", lambda *a, **kw: "uv 0.13.5 (x86_64-unknown-linux-gnu)\n")
    monkeypatch.setenv("UV_OVERRIDE", "untrusted")
    monkeypatch.setenv("PIP_INDEX_URL", "https://untrusted.test")
    calls = []

    def compile(args, **kwargs):
        calls.append((args, kwargs))
        output = Path(args[args.index("--output-file") + 1])
        assert output.read_bytes() == before
        output.write_text("demo==1" + HASH + "\n")

    monkeypatch.setattr(lock.subprocess, "run", compile)
    generated = lock.generate(tmp_path, "api", Path("/pinned/uv"), tmp_path / "temporary.lock", upgrade=upgrade)
    assert generated == before
    assert str(tmp_path).encode() not in generated
    args, kwargs = calls[0]
    assert ("--upgrade" in args) is upgrade
    assert "--generate-hashes" in args and "--no-config" in args
    assert args[args.index("--python-version") + 1] == "3.12"
    assert args[args.index("--python-platform") + 1] == lock.TARGET
    assert args[3] == lock.role_paths("api").input
    assert kwargs["env"]["UV_PYTHON_DOWNLOADS"] == "never"
    assert "UV_OVERRIDE" not in kwargs["env"] and "PIP_INDEX_URL" not in kwargs["env"]


def test_wrong_resolver_version_fails_closed(tmp_path, monkeypatch):
    write(tmp_path / lock.TOOL, "uv==0.13.5" + HASH)
    monkeypatch.setattr(lock, "require_generation_target", lambda: None)
    monkeypatch.setattr(lock.subprocess, "check_output", lambda *a, **kw: "uv 0.13.6")
    with pytest.raises(ValueError, match="Expected uv 0.13.5"):
        lock.generate(tmp_path, "api", Path("/wrong/uv"), tmp_path / "temporary.lock")


@pytest.mark.parametrize("python,system,machine", [((3, 13, 0), "Linux", "x86_64"), ((3, 12, 0), "Windows", "AMD64"), ((3, 12, 0), "Linux", "aarch64")])
def test_wrong_python_or_platform_generation_fails_closed(monkeypatch, python, system, machine):
    monkeypatch.setattr(lock.sys, "version_info", python)
    monkeypatch.setattr(lock.platform, "system", lambda: system)
    monkeypatch.setattr(lock.platform, "machine", lambda: machine)
    with pytest.raises(ValueError, match="Linux amd64 CPython 3.12"):
        lock.require_generation_target()
