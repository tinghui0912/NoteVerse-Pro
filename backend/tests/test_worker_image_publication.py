from types import SimpleNamespace

import pytest
from scripts import worker_image_publication as identity
from scripts import oci_publication

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
                            dict(contract="success", sbom="success", trivy="success")) == "identical-winner-without-repush"
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


def test_worker_registry_mechanics_are_the_shared_primitive():
    assert identity.DockerRegistry is oci_publication.DockerRegistry
    assert identity.promote_qualified is oci_publication.promote_qualified


def test_legacy_truncated_key_never_becomes_canonical():
    with pytest.raises(ValueError, match="Canonical"):
        identity.canonical_tag("deps", "fd1036acf6cf624e")
