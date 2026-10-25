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
def repo(tmp_path, monkeypatch):
    monkeypatch.setattr(identity, "worker_resolution", lambda _: b"locked uv export --hash=sha256:abc\n")
    for path in identity.IDENTITY_INPUTS:
        target = tmp_path / path
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        # Fixture source bytes are not needed from a repository .github mount.
        source = ROOT / path.removeprefix("backend/") if path.startswith("backend/") else None
        target.write_bytes(source.read_bytes() if source and source.exists() else b"fixture Dockerfile bytes\n")
    shutil.copyfile(ROOT / "pyproject.toml", tmp_path / "backend/pyproject.toml")
    return tmp_path


def test_same_governed_inputs_produce_same_v3_build_key(repo):
    first = identity.build_identity(repo, BASE)
    assert first == identity.build_identity(repo, BASE)
    assert first["key_tag"] == "deps-v3-" + first["build_key"]
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


def test_worker_resolution_delegates_to_locked_uv_and_hashes_exact_bytes(repo, monkeypatch):
    calls = []
    exported = b"package==1.0 \\\n    --hash=sha256:abc\n"

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(stdout="uv 0.13.5 (approved)\n" if args == ["uv", "--version"] else exported)

    monkeypatch.undo()  # Exercise the real exporter, not the identity fixture stub.
    monkeypatch.setattr(identity.subprocess, "run", run)
    assert identity.worker_resolution(repo) == exported
    assert calls[1][0] == ["uv", "export", "--locked", "--only-group", "worker", "--no-header", "--no-emit-project"]
    assert calls[1][1]["cwd"] == repo / "backend"
    assert calls[1][1]["check"] is True
    assert "text" not in calls[1][1]  # No platform newline conversion.


def test_unapproved_uv_version_fails_before_export(repo, monkeypatch):
    monkeypatch.undo()
    monkeypatch.setattr(identity.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout="uv 0.13.4\n"))
    with pytest.raises(ValueError, match="exact approved uv"):
        identity.worker_resolution(repo)


def test_export_without_artifact_hashes_fails_closed(repo, monkeypatch):
    monkeypatch.undo()
    monkeypatch.setattr(identity.subprocess, "run", lambda args, **kwargs: SimpleNamespace(
        stdout="uv 0.13.5\n" if args == ["uv", "--version"] else b"package==1.0\n",
    ))
    with pytest.raises(ValueError, match="artifact hashes"):
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


def test_legacy_namespace_cannot_be_emitted(repo):
    assert identity.build_identity(repo, BASE)["key_tag"].startswith("deps-v3-")
    for schema in (1, 2):
        with pytest.raises(ValueError, match="Legacy"):
            identity.build_identity(repo, BASE, schema=schema)
    with pytest.raises(ValueError, match="Canonical"):
        identity.canonical_tag("deps", "fd1036acf6cf624e")


@pytest.mark.parametrize("value", ["sha256:abc", "sha256:" + "A" * 64, "md5:" + "a" * 32, BASE + "\n", "latest"])
def test_malformed_oci_digest_rejected(value):
    with pytest.raises(ValueError):
        identity.validate_digest(value)


def test_existing_canonical_selects_reuse_without_build_or_repush():
    canonical = REPOSITORY + ":deps-v3-" + KEY
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


def test_existing_worker_source_cannot_be_misreported_as_current_dependency_composition():
    repository = REPOSITORY.removesuffix("-deps")
    source = "a" * 40
    registry = FakeRegistry({repository + ":" + source: FIRST})
    with pytest.raises(RuntimeError, match="refuse recomposition or retagging"):
        identity.plan(registry, repository, "worker", source, "123", "2")
    assert registry.reads == [repository + ":" + source]
    assert registry.writes == []


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
    assert registry.writes == [(REPOSITORY + "@" + FIRST, REPOSITORY + ":deps-v3-" + KEY)]


def test_different_concurrent_canonical_winner_is_never_overwritten():
    registry = FakeRegistry({REPOSITORY + ":deps-v3-" + KEY: OTHER})
    with pytest.raises(RuntimeError, match="never overwrite"):
        identity.promote(registry, REPOSITORY, "deps", KEY, FIRST,
                         dict(contract="success", sbom="success", trivy="success"))
    assert registry.writes == []


def test_identical_existing_winner_is_not_repushed():
    registry = FakeRegistry({REPOSITORY + ":deps-v3-" + KEY: FIRST})
    assert identity.promote(registry, REPOSITORY, "deps", KEY, FIRST,
                            dict(contract="success", sbom="success", trivy="success")) == "reused-without-repush"
    assert registry.writes == []


def test_final_source_tag_also_cannot_be_assigned_before_gates():
    registry = FakeRegistry()
    with pytest.raises(ValueError):
        identity.promote(registry, REPOSITORY.removesuffix("-deps"), "worker", "a" * 40,
                         FIRST, dict(contract="success", sbom="success", trivy="failure"))
    assert registry.writes == []


def test_unrelated_publication_repository_is_rejected():
    with pytest.raises(ValueError, match="repository"):
        identity.plan(FakeRegistry(), "ghcr.io/tinghui0912/noteverse/unrelated", "deps", KEY, "1", "1")


@pytest.mark.parametrize("error", ["denied", "unauthorized: not found", "403 Forbidden: manifest unknown", "401: not found", "network timeout", "429 Too Many Requests"])
def test_registry_access_error_is_not_treated_as_absence(monkeypatch, error):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error))
    with pytest.raises(RuntimeError, match="failed closed"):
        identity.DockerRegistry().resolve(REPOSITORY + ":missing")


def test_registry_explicit_missing_is_absence(monkeypatch):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=REPOSITORY + ":missing: not found"))
    assert identity.DockerRegistry().resolve(REPOSITORY + ":missing") is None


def test_registry_incident_candidate_40108308138_missing_is_absence(monkeypatch):
    reference = REPOSITORY + ":candidate-40108308138-1"
    error = "ERROR: " + reference + ": not found\n"
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error))
    assert identity.DockerRegistry().resolve(reference) is None


@pytest.mark.parametrize("tag", ["candidate-401123-1", "candidate-403123-1", "candidate-429123-1", "unauthorized-401"])
def test_registry_missing_identifier_is_not_an_http_or_auth_error(monkeypatch, tag):
    reference = REPOSITORY + ":" + tag
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr="ERROR: " + reference + ": not found"))
    assert identity.DockerRegistry().resolve(reference) is None


@pytest.mark.parametrize("error", [
    "manifest unknown", "ERROR: manifest unknown: manifest unknown",
    REPOSITORY + ":missing: manifest unknown", "ERROR: " + REPOSITORY + ":missing: manifest unknown: manifest unknown",
])
def test_registry_missing_manifest_is_absence(monkeypatch, error):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error))
    assert identity.DockerRegistry().resolve(REPOSITORY + ":missing") is None


@pytest.mark.parametrize("error", [
    "401 Unauthorized", "403 Forbidden", "unauthorized", "authentication required", "denied", "forbidden",
    "error getting credentials: exit status 1", "429 Too Many Requests", "HTTP status code: 401",
    "unexpected status: 403", "HTTP/1.1 429", "HTTP status code: 401: manifest unknown",
    "manifest unknown: 429 Too Many Requests", "unauthorized: manifest unknown",
    "authentication required: " + REPOSITORY + ":missing: not found",
    "ERROR: " + REPOSITORY + ":missing: not found\nHTTP status: 403",
    "dial tcp: connection refused", "TLS handshake timeout", "x509: certificate signed by unknown authority",
    "context deadline exceeded", "lookup ghcr.io: no such host", "unknown registry error",
    "lookup missing-host: not found", "timeout: manifest unknown", "manifest unknown: TLS handshake timeout",
    "unexpected status 500: " + REPOSITORY + ":missing: not found",
])
def test_registry_semantic_access_and_infrastructure_errors_fail_closed(monkeypatch, error):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error))
    with pytest.raises(RuntimeError, match="failed closed"):
        identity.DockerRegistry().resolve(REPOSITORY + ":missing")


def test_registry_success_returns_exact_oci_digest(monkeypatch):
    calls = []

    def inspect(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout=f"Name: {REPOSITORY}:present\nDigest: {FIRST}\n", stderr="")

    monkeypatch.setattr(identity.subprocess, "run", inspect)
    assert identity.DockerRegistry().resolve(REPOSITORY + ":present") == FIRST
    assert calls == [["docker", "buildx", "imagetools", "inspect", REPOSITORY + ":present"]]


def test_cli_rejects_custom_dependency_override():
    with pytest.raises(SystemExit) as exc:
        identity.main(["plan", "--worker-deps-tag", "arbitrary"])
    assert exc.value.code == 2


def test_tag_attachment_preserves_single_manifest_format(monkeypatch):
    calls = []
    monkeypatch.setattr(identity.subprocess, "run", lambda args, **kw: calls.append(args))
    identity.DockerRegistry().attach(REPOSITORY + "@" + FIRST, REPOSITORY + ":deps-v3-" + KEY)
    assert "--prefer-index=false" in calls[0]
    assert calls[0][-1] == REPOSITORY + "@" + FIRST
