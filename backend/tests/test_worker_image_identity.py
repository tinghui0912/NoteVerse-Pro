from pathlib import Path
import shutil
from types import SimpleNamespace

import pytest

from scripts import worker_image_identity as identity

ROOT = Path(__file__).resolve().parents[1]
BASE = "sha256:" + "a" * 64
FIRST = "sha256:" + "b" * 64
OTHER = "sha256:" + "c" * 64
REPOSITORY = "ghcr.io/tinghui0912/noteverse/backend-worker-deps"
KEY = "d" * 64


class FakeRegistry:
    def __init__(self, entries=None):
        self.entries = dict(entries or {})
        self.reads = []
        self.writes = []

    def resolve(self, reference):
        self.reads.append(reference)
        return self.entries.get(reference)

    def attach(self, source, target):
        self.writes.append((source, target))
        self.entries[target] = source.split("@", 1)[1]


@pytest.fixture
def repo(tmp_path):
    shutil.copytree(ROOT / "requirements", tmp_path / "backend/requirements")
    for path in identity.IDENTITY_INPUTS:
        target = tmp_path / path
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        # Fixture source bytes are not needed from a repository .github mount.
        source = ROOT / path.removeprefix("backend/") if path.startswith("backend/") else None
        target.write_bytes(source.read_bytes() if source and source.exists() else b"fixture Dockerfile bytes\n")
    return tmp_path


def test_same_governed_inputs_produce_same_v2_build_key(repo):
    first = identity.build_identity(repo, BASE)
    assert first == identity.build_identity(repo, BASE)
    assert first["key_tag"] == "deps-v2-" + first["build_key"]
    assert len(first["build_key"]) == 64
    assert "resolved_ml_base_oci_digest" in first["document"]


@pytest.mark.parametrize("path", [
    identity.LOCK, "docker/backend/Dockerfile.worker-deps",
    "backend/app/processing/engines/omr/legato_manifest.py",
    "backend/requirements/render.txt", "backend/requirements/worker-image.in",
    "backend/requirements/worker-lock-tool.txt", "backend/scripts/worker_lock.py",
])
def test_changed_governed_input_changes_build_key(repo, path):
    before = identity.build_identity(repo, BASE)["build_key"]
    file = repo / path
    file.write_bytes(file.read_bytes() + b"\n# changed input\n")
    assert identity.build_identity(repo, BASE)["build_key"] != before


def test_resolved_base_digest_changes_key_even_when_alias_is_unchanged(repo):
    assert identity.build_identity(repo, BASE)["build_key"] != identity.build_identity(repo, OTHER)["build_key"]


def test_schema_changes_both_namespace_and_build_key(repo):
    v2 = identity.build_identity(repo, BASE)
    v3 = identity.build_identity(repo, BASE, schema=3)
    assert v3["key_tag"].startswith("deps-v3-")
    assert v2["build_key"] != v3["build_key"]
    with pytest.raises(ValueError, match="Legacy"):
        identity.build_identity(repo, BASE, schema=1)
    with pytest.raises(ValueError, match="Canonical"):
        identity.canonical_tag("deps", "fd1036acf6cf624e")


@pytest.mark.parametrize("value", ["sha256:abc", "sha256:" + "A" * 64, "md5:" + "a" * 32, BASE + "\n", "latest"])
def test_malformed_oci_digest_rejected(value):
    with pytest.raises(ValueError):
        identity.validate_digest(value)


def test_existing_canonical_selects_reuse_without_build_or_repush():
    canonical = REPOSITORY + ":deps-v2-" + KEY
    registry = FakeRegistry({canonical: FIRST})
    plan = identity.plan(registry, REPOSITORY, "deps", KEY, "123", "1")
    assert plan.action == "reuse" and plan.digest_ref == REPOSITORY + "@" + FIRST
    assert registry.reads == [canonical]
    assert registry.writes == []


def test_absent_canonical_selects_only_attempt_specific_candidate():
    registry = FakeRegistry()
    plan = identity.plan(registry, REPOSITORY, "deps", KEY, "123", "1")
    assert plan.action == "build" and plan.candidate_ref.endswith(":candidate-123-1")
    assert registry.writes == [] and plan.existing_digest == ""
    assert identity.candidate_tag("123", "1") != identity.candidate_tag("123", "2")


def test_existing_candidate_cannot_be_overwritten():
    registry = FakeRegistry({REPOSITORY + ":candidate-123-1": FIRST})
    with pytest.raises(RuntimeError, match="candidate already exists"):
        identity.plan(registry, REPOSITORY, "deps", KEY, "123", "1")
    assert registry.writes == []


@pytest.mark.parametrize("gate", ["contract", "sbom", "trivy"])
@pytest.mark.parametrize("status", ["failure", "skipped", "cancelled", ""])
def test_failed_or_missing_qualification_never_promotes(gate, status):
    registry = FakeRegistry()
    gates = dict(contract="success", sbom="success", trivy="success")
    gates[gate] = status
    with pytest.raises(ValueError, match="promotion denied"):
        identity.promote(registry, REPOSITORY, "deps", KEY, FIRST, gates)
    assert registry.reads == registry.writes == []


def test_qualified_candidate_promotes_exact_oci_without_wrapping():
    registry = FakeRegistry()
    result = identity.promote(registry, REPOSITORY, "deps", KEY, FIRST,
                              dict(contract="success", sbom="success", trivy="success"))
    assert result == "promoted-qualified-oci"
    assert registry.writes == [(REPOSITORY + "@" + FIRST, REPOSITORY + ":deps-v2-" + KEY)]


def test_different_concurrent_canonical_winner_is_never_overwritten():
    registry = FakeRegistry({REPOSITORY + ":deps-v2-" + KEY: OTHER})
    with pytest.raises(RuntimeError, match="never overwrite"):
        identity.promote(registry, REPOSITORY, "deps", KEY, FIRST,
                         dict(contract="success", sbom="success", trivy="success"))
    assert registry.writes == []


def test_identical_existing_winner_is_not_repushed():
    registry = FakeRegistry({REPOSITORY + ":deps-v2-" + KEY: FIRST})
    assert identity.promote(registry, REPOSITORY, "deps", KEY, FIRST,
                            dict(contract="success", sbom="success", trivy="success")) == "reused-without-repush"
    assert registry.writes == []


def test_final_source_tag_also_cannot_be_assigned_before_gates():
    registry = FakeRegistry()
    with pytest.raises(ValueError):
        identity.promote(registry, REPOSITORY.removesuffix("-deps"), "worker", "a" * 40,
                         FIRST, dict(contract="success", sbom="success", trivy="failure"))
    assert registry.writes == []


def test_ml_base_publication_and_role_mismatch_are_rejected():
    with pytest.raises(ValueError, match="mismatch"):
        identity.plan(FakeRegistry(), "ghcr.io/tinghui0912/noteverse/ml-base", "deps", KEY, "1", "1")


@pytest.mark.parametrize("error", ["denied", "unauthorized: not found", "403 Forbidden: manifest unknown", "401: not found", "network timeout", "429 Too Many Requests"])
def test_registry_access_error_is_not_treated_as_absence(monkeypatch, error):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error))
    with pytest.raises(RuntimeError, match="failed closed"):
        identity.DockerRegistry().resolve(REPOSITORY + ":missing")


def test_registry_explicit_missing_is_absence(monkeypatch):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr="ERROR: image: not found"))
    assert identity.DockerRegistry().resolve(REPOSITORY + ":missing") is None


def test_cli_rejects_custom_dependency_override():
    with pytest.raises(SystemExit) as exc:
        identity.main(["plan", "--worker-deps-tag", "arbitrary"])
    assert exc.value.code == 2


def test_tag_attachment_preserves_single_manifest_format(monkeypatch):
    calls = []
    monkeypatch.setattr(identity.subprocess, "run", lambda args, **kw: calls.append(args))
    identity.DockerRegistry().attach(REPOSITORY + "@" + FIRST, REPOSITORY + ":deps-v2-" + KEY)
    assert "--prefer-index=false" in calls[0]
    assert calls[0][-1] == REPOSITORY + "@" + FIRST
