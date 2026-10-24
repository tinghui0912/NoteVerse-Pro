from types import SimpleNamespace

import pytest

from scripts import backend_service_image_identity as identity

REPO = "ghcr.io/tinghui0912/noteverse/backend-api"
SOURCE = "a" * 40
FIRST = "sha256:" + "b" * 64
OTHER = "sha256:" + "c" * 64
GATES = {"contract": "success", "sbom": "success", "trivy": "success"}


class FakeRegistry:
    def __init__(self, entries=None, attached_digest=FIRST):
        self.entries = dict(entries or {})
        self.reads = []
        self.writes = []
        self.attached_digest = attached_digest

    def resolve(self, ref):
        self.reads.append(ref)
        return self.entries.get(ref)

    def attach(self, source, target):
        self.writes.append((source, target))
        self.entries[target] = self.attached_digest


@pytest.mark.parametrize("role", ["api", "beat"])
def test_absent_canonical_and_candidate_plan_build_without_writes(role):
    repo = REPO.removesuffix("api") + role
    registry = FakeRegistry()
    plan = identity.plan(registry, repo, role, SOURCE, "40108308138", "1")
    assert plan.action == "build"
    assert plan.canonical_ref == repo + ":" + SOURCE
    assert plan.candidate_ref == repo + ":candidate-40108308138-1"
    assert registry.reads == [plan.canonical_ref, plan.candidate_ref]
    assert registry.writes == []


def test_existing_source_canonical_refuses_rebuild_even_if_digest_is_known():
    registry = FakeRegistry({REPO + ":" + SOURCE: FIRST})
    with pytest.raises(RuntimeError, match="canonical already exists"):
        identity.plan(registry, REPO, "api", SOURCE, "123", "1")
    assert registry.reads == [REPO + ":" + SOURCE]
    assert registry.writes == []


def test_existing_attempt_candidate_refuses_overwrite():
    registry = FakeRegistry({REPO + ":candidate-123-1": FIRST})
    with pytest.raises(RuntimeError, match="candidate already exists"):
        identity.plan(registry, REPO, "api", SOURCE, "123", "1")
    assert registry.writes == []


@pytest.mark.parametrize("source", ["short", "A" * 40, "g" * 40, SOURCE + "\n", "latest"])
def test_invalid_source_is_rejected_before_registry_access(source):
    registry = FakeRegistry()
    with pytest.raises(ValueError, match="source SHA"):
        identity.plan(registry, REPO, "api", source, "123", "1")
    assert registry.reads == registry.writes == []


@pytest.mark.parametrize("repo,role", [
    (REPO, "beat"), (REPO, "worker"), (REPO + ":latest", "api"),
    ("ghcr.io/tinghui0912/noteverse/backend-worker", "api"),
    ("ghcr.io/tinghui0912/noteverse/ml-base", "api"),
    ("docker.io/owner/noteverse/backend-api", "api"),
])
def test_role_repository_mismatch_is_rejected(repo, role):
    registry = FakeRegistry()
    with pytest.raises(ValueError):
        identity.plan(registry, repo, role, SOURCE, "123", "1")
    assert registry.reads == registry.writes == []


@pytest.mark.parametrize("run,attempt", [("0", "1"), ("1", "0"), ("bad", "1"), ("1", "1\n")])
def test_invalid_candidate_identity_fails(run, attempt):
    with pytest.raises(ValueError):
        identity.candidate_tag(run, attempt)


def test_candidate_identity_is_attempt_specific():
    assert identity.candidate_tag("123", "1") != identity.candidate_tag("123", "2")
    assert identity.local_ref("api", "123", "1") == "noteverse-backend-api:pr-123-1"


@pytest.mark.parametrize("tag", ["candidate-40108308138-1", "candidate-403123-1", "candidate-429123-1", "unauthorized-401"])
def test_identifier_digits_and_words_are_not_http_or_auth_signals(monkeypatch, tag):
    reference = REPO + ":" + tag
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr="ERROR: " + reference + ": not found\n"))
    assert identity.DockerRegistry().resolve(reference) is None


@pytest.mark.parametrize("error", ["manifest unknown", "ERROR: manifest unknown: manifest unknown", REPO + ":missing: manifest unknown"])
def test_complete_manifest_absence_is_none(monkeypatch, error):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error))
    assert identity.DockerRegistry().resolve(REPO + ":missing") is None


@pytest.mark.parametrize("error", [
    "401 Unauthorized", "403 Forbidden", "429 Too Many Requests", "unauthorized", "authentication required",
    "denied", "forbidden", "credential helper failed", "HTTP status: 401: manifest unknown",
    "ERROR: " + REPO + ":missing: not found\n403 Forbidden", "manifest unknown: 429 Too Many Requests",
    "dial tcp: connection refused", "TLS handshake timeout", "x509 certificate error",
    "lookup ghcr.io: no such host", "context deadline exceeded", "unknown registry error",
    "timeout: manifest unknown", "lookup other-host: not found", "401: not found",
])
def test_access_or_infrastructure_failures_never_mean_absence(monkeypatch, error):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error))
    with pytest.raises(RuntimeError, match="failed closed"):
        identity.DockerRegistry().resolve(REPO + ":missing")


def test_successful_registry_resolution_preserves_exact_digest(monkeypatch):
    calls = []

    def inspect(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout=f"Name: {REPO}\nDigest: {FIRST}\n", stderr="")

    monkeypatch.setattr(identity.subprocess, "run", inspect)
    assert identity.DockerRegistry().resolve(REPO + ":tag") == FIRST
    assert calls == [["docker", "buildx", "imagetools", "inspect", REPO + ":tag"]]


def test_success_without_a_valid_registry_digest_fails_closed(monkeypatch):
    monkeypatch.setattr(identity.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=0, stdout="Digest: invalid\n", stderr=""))
    with pytest.raises(ValueError, match="valid OCI"):
        identity.DockerRegistry().resolve(REPO + ":tag")


def test_select_trusted_build_digest_without_registry_access():
    assert identity.select_artifact(REPO, "api", publish=True, digest=FIRST, local="") == REPO + "@" + FIRST


@pytest.mark.parametrize("digest", ["sha256:abc", "sha256:" + "B" * 64, FIRST + "\n", "md5:" + "a" * 32])
def test_invalid_build_digest_is_rejected(digest):
    with pytest.raises(ValueError, match="OCI digest"):
        identity.select_artifact(REPO, "api", publish=True, digest=digest, local="")


@pytest.mark.parametrize("local", [REPO + ":" + SOURCE, "noteverse-backend-beat:pr-123-1", "noteverse-backend-api:latest"])
def test_pr_selection_refuses_registry_or_uncontrolled_local_tags(local):
    with pytest.raises(ValueError, match="local-only"):
        identity.select_artifact(REPO, "api", publish=False, digest=FIRST, local=local)


def test_pr_cli_paths_never_instantiate_a_registry(monkeypatch, capsys):
    def forbidden():
        raise AssertionError("PR path attempted registry access")

    monkeypatch.setattr(identity, "DockerRegistry", forbidden)
    assert identity.main(["local", "--role", "api", "--run-id", "40108308138", "--run-attempt", "1"]) == 0
    assert identity.main(["select", "--repository", REPO, "--role", "api", "--publish", "false", "--digest", "", "--local-ref", "noteverse-backend-api:pr-40108308138-1"]) == 0
    assert "noteverse-backend-api:pr-40108308138-1" in capsys.readouterr().out


@pytest.mark.parametrize("gate", ["contract", "sbom", "trivy"])
@pytest.mark.parametrize("status", ["failure", "skipped", "cancelled", ""])
def test_any_failed_or_missing_gate_denies_promotion_without_registry_access(gate, status):
    registry = FakeRegistry()
    gates = dict(GATES, **{gate: status})
    with pytest.raises(ValueError, match="Promotion denied"):
        identity.promote(registry, REPO, "api", SOURCE, FIRST, gates)
    assert registry.reads == registry.writes == []


def test_missing_gate_key_denies_promotion():
    with pytest.raises(ValueError, match="Promotion denied"):
        identity.promote(FakeRegistry(), REPO, "api", SOURCE, FIRST, {"contract": "success", "sbom": "success"})


def test_qualified_candidate_promotes_exact_digest():
    registry = FakeRegistry()
    assert identity.promote(registry, REPO, "api", SOURCE, FIRST, GATES) == "promoted-qualified-oci"
    assert registry.writes == [(REPO + "@" + FIRST, REPO + ":" + SOURCE)]
    assert registry.reads == [REPO + ":" + SOURCE, REPO + ":" + SOURCE]


def test_different_canonical_winner_is_never_overwritten():
    registry = FakeRegistry({REPO + ":" + SOURCE: OTHER})
    with pytest.raises(RuntimeError, match="never overwrite"):
        identity.promote(registry, REPO, "api", SOURCE, FIRST, GATES)
    assert registry.writes == []


def test_identical_winner_is_not_repushed():
    registry = FakeRegistry({REPO + ":" + SOURCE: FIRST})
    assert identity.promote(registry, REPO, "api", SOURCE, FIRST, GATES) == "same-winner-without-repush"
    assert registry.writes == []


@pytest.mark.parametrize("observed", [OTHER, None])
def test_post_promotion_identity_mismatch_fails_without_repair(observed):
    registry = FakeRegistry(attached_digest=observed)
    with pytest.raises(RuntimeError, match="changed the candidate OCI"):
        identity.promote(registry, REPO, "api", SOURCE, FIRST, GATES)
    assert registry.writes == [(REPO + "@" + FIRST, REPO + ":" + SOURCE)]


def test_attachment_does_not_wrap_the_single_manifest(monkeypatch):
    calls = []
    monkeypatch.setattr(identity.subprocess, "run", lambda args, **kw: calls.append((args, kw)))
    identity.DockerRegistry().attach(REPO + "@" + FIRST, REPO + ":" + SOURCE)
    assert calls == [(["docker", "buildx", "imagetools", "create", "--prefer-index=false", "--tag", REPO + ":" + SOURCE, REPO + "@" + FIRST], {"check": True})]
