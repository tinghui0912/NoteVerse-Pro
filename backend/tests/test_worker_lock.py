from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import worker_lock as lock

HASH = " --hash=sha256:" + "a" * 64


def write(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def test_real_generated_target_lock_has_hashes_and_current_owned_versions():
    path = Path(__file__).resolve().parents[1] / "requirements/worker-image-py312-linux-amd64.lock"
    entries = lock.read_lock(path)
    assert entries["numpy"].version == "2.3.5"
    assert entries["paddlepaddle"].version == "3.2.0"
    assert entries["torch"].version == "2.6.0+cu124"
    assert {"multidict", "pycryptodome"}.issubset(entries)
    assert lock.BOOTSTRAP.issubset(entries)


@pytest.mark.parametrize("requirement", ["demo>=1", "demo==1", "demo @ http://example.test/file.whl", "-r unknown.txt"])
def test_unpinned_or_unhashed_entries_fail_closed(tmp_path, requirement):
    with pytest.raises(ValueError):
        lock.read_lock(write(tmp_path / "lock", requirement + "\n"))


def test_bootstrap_versions_and_hashes_are_owned_by_full_lock(tmp_path):
    full = write(tmp_path / "full.lock", "\n".join(n + "==1" + HASH for n in lock.BOOTSTRAP) + "\nother==2" + HASH)
    bootstrap = lock.bootstrap_requirements(full)
    assert "other" not in bootstrap
    assert all(name + "==1" in bootstrap for name in lock.BOOTSTRAP)
    assert bootstrap.count("--hash=sha256:") == len(lock.BOOTSTRAP)


def test_missing_build_tool_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="packaging/build tools"):
        lock.bootstrap_requirements(write(tmp_path / "lock", "demo==1" + HASH))


def test_installed_environment_must_match_complete_lock(tmp_path, monkeypatch):
    path = write(tmp_path / "lock", "demo==1" + HASH)
    monkeypatch.setattr(lock.importlib.metadata, "distributions", lambda: [SimpleNamespace(metadata={"Name": "demo"}, version="1")])
    lock.check_installed(path)
    monkeypatch.setattr(lock.importlib.metadata, "distributions", lambda: [SimpleNamespace(metadata={"Name": "demo"}, version="2")])
    with pytest.raises(ValueError, match="locked='1', installed='2'"):
        lock.check_installed(path)


def test_unlisted_inherited_distribution_is_rejected(tmp_path, monkeypatch):
    path = write(tmp_path / "lock", "demo==1" + HASH)
    monkeypatch.setattr(lock.importlib.metadata, "distributions", lambda: [
        SimpleNamespace(metadata={"Name": "demo"}, version="1"),
        SimpleNamespace(metadata={"Name": "undeclared"}, version="9"),
    ])
    with pytest.raises(ValueError, match="undeclared"):
        lock.check_installed(path)


def test_ci_regeneration_failure_never_rewrites_checkout(tmp_path, monkeypatch, capsys):
    existing = write(tmp_path / lock.LOCK, "demo==1" + HASH)
    before = existing.read_bytes()
    monkeypatch.setattr(lock, "generate", lambda *a, **kw: b"changed output\n")
    assert lock.main(["--repo", str(tmp_path), "--check", "--uv", "/unused/uv"]) == 1
    assert existing.read_bytes() == before
    assert "worker_lock.py --generate" in capsys.readouterr().err


def test_clean_ci_check_never_rewrites_checkout(tmp_path, monkeypatch):
    existing = write(tmp_path / lock.LOCK, "demo==1" + HASH)
    before = existing.read_bytes()
    monkeypatch.setattr(lock, "generate", lambda *a, **kw: before)
    assert lock.main(["--repo", str(tmp_path), "--check", "--uv", "/unused/uv"]) == 0
    assert existing.read_bytes() == before


def test_ci_cannot_request_automatic_upgrade():
    with pytest.raises(SystemExit) as exc:
        lock.main(["--check", "--upgrade"])
    assert exc.value.code == 2


def test_regeneration_pins_tool_target_and_existing_version_preferences(tmp_path, monkeypatch):
    write(tmp_path / lock.TOOL, "uv==0.13.5\n")
    write(tmp_path / lock.LOCK, "demo==1" + HASH)
    calls = []
    monkeypatch.setattr(lock.platform, "system", lambda: "Linux")
    monkeypatch.setattr(lock.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(lock.sys, "version_info", (3, 12, 15))
    monkeypatch.setattr(lock.subprocess, "check_output", lambda *a, **kw: "uv 0.13.5 (x86_64-unknown-linux-gnu)\n")
    monkeypatch.setenv("UV_OVERRIDE", "untrusted")

    def compile(args, **kwargs):
        calls.append((args, kwargs))
        assert "demo==1" in Path(args[args.index("--output-file") + 1]).read_text()

    monkeypatch.setattr(lock.subprocess, "run", compile)
    lock.generate(tmp_path, Path("/pinned/uv"), tmp_path / "temporary.lock")
    args, kwargs = calls[0]
    assert "--upgrade" not in args and "--generate-hashes" in args
    assert args[args.index("--python-version") + 1] == "3.12"
    assert args[args.index("--python-platform") + 1] == lock.TARGET
    assert kwargs["env"]["UV_PYTHON_DOWNLOADS"] == "never"
    assert "UV_OVERRIDE" not in kwargs["env"]


def test_wrong_resolver_version_fails(tmp_path, monkeypatch):
    write(tmp_path / lock.TOOL, "uv==0.13.5\n")
    monkeypatch.setattr(lock.platform, "system", lambda: "Linux")
    monkeypatch.setattr(lock.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(lock.sys, "version_info", (3, 12, 15))
    monkeypatch.setattr(lock.subprocess, "check_output", lambda *a, **kw: "uv 0.13.6\n")
    with pytest.raises(ValueError, match="Expected uv 0.13.5"):
        lock.generate(tmp_path, Path("/wrong/uv"), tmp_path / "temp")
