from types import SimpleNamespace

import pytest

import backend_worker_runner_disk as disk


@pytest.fixture
def runner(monkeypatch):
    commands = []
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("NOTEVERSE_EPHEMERAL_RUNNER", "github-hosted")
    monkeypatch.setattr(disk, "run", lambda *args, **kw: commands.append(args))
    monkeypatch.setattr(disk.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=0))
    return commands


def test_cleanup_refuses_developer_or_self_hosted_docker(monkeypatch, tmp_path):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    with pytest.raises(ValueError, match="report-only"):
        disk.cleanup("release", builder="docker", image="deps", remove_images=[], root=tmp_path)


def test_phase_reports_space_and_prunes_cache_without_removing_pr_image(runner, tmp_path):
    disk.cleanup("before-scan", builder="docker", image="deps", remove_images=[], root=tmp_path)
    assert runner.count(("df", "-h")) == 2
    assert runner.count(("docker", "system", "df")) == 2
    assert ("docker", "builder", "prune", "--all", "--force") in runner
    assert not any(command[:3] == ("docker", "image", "rm") for command in runner)
    assert (tmp_path / "noteverse-worker/deps-scan/tmp").is_dir()


def test_only_explicit_completed_pulls_are_removed(runner, tmp_path):
    ref = "ghcr.io/tinghui0912/noteverse/backend-worker@sha256:" + "a" * 64
    disk.cleanup("release", builder="buildx", image="worker", remove_images=[ref], root=tmp_path)
    assert ("docker", "buildx", "prune", "--all", "--force") in runner
    assert ("docker", "image", "rm", ref) in runner
    assert not any("logout" in command or command[:3] in (("docker", "system", "prune"), ("docker", "image", "prune")) for command in runner)


def test_completed_scan_exports_removed_without_touching_credentials(runner, tmp_path):
    auth = tmp_path / "home/.docker/config.json"
    auth.parent.mkdir(parents=True)
    auth.write_text("unchanged authentication")
    own = disk.scan_directory(tmp_path, "deps")
    own.mkdir(parents=True)
    (own / "docker-export").write_text("temporary export")
    other = disk.scan_directory(tmp_path, "worker")
    other.mkdir()
    disk.cleanup("after-scan", builder="buildx", image="deps", remove_images=[], root=tmp_path)
    assert not own.exists() and other.is_dir()
    assert auth.read_text() == "unchanged authentication"


def test_symlink_escape_fails_before_any_cleanup(runner, tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (tmp_path / "noteverse-worker").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="Unsafe"):
        disk.cleanup("before-scan", builder="docker", image="deps", remove_images=[], root=tmp_path)
    assert runner == []


def test_invalid_image_reference_fails_before_pruning(runner, tmp_path):
    with pytest.raises(ValueError):
        disk.cleanup("release", builder="docker", image="deps", remove_images=["--all"], root=tmp_path)
    assert runner == []


def test_sbom_and_scan_temporary_space_are_separate(runner, tmp_path):
    disk.cleanup("before-sbom", builder="docker", image="worker", remove_images=[], root=tmp_path)
    assert (tmp_path / "noteverse-worker/worker-sbom/tmp").is_dir()
    assert not (tmp_path / "noteverse-worker/worker-scan").exists()
    disk.cleanup("after-sbom", builder="docker", image="worker", remove_images=[], root=tmp_path)
    assert not (tmp_path / "noteverse-worker/worker-sbom").exists()
