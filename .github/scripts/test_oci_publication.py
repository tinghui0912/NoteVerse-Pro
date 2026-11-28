from types import SimpleNamespace

import pytest

import oci_publication as oci

REPO = "ghcr.io/tinghui0912/noteverse/backend-core"
REF = REPO + ":candidate-40124681012-1"
DIGEST = "sha256:" + "a" * 64
OTHER = "sha256:" + "b" * 64


@pytest.mark.parametrize(
    "reference", [REF, REPO + ":candidate-403123-1", REPO + ":candidate-429123-1"]
)
def test_exact_missing_reference_digits_are_not_status_codes(monkeypatch, reference):
    monkeypatch.setattr(
        oci.subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(
            returncode=1,
            stderr="ERROR: " + reference + ": not found\n",
        ),
    )
    assert oci.DockerRegistry().resolve(reference) is None


def test_numeric_candidate_identifier_is_not_interpreted_as_http_status(monkeypatch):
    reference = "ghcr.io/tinghui0912/noteverse/backend-worker-deps:candidate-40124681012-1"
    monkeypatch.setattr(
        oci.subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(
            returncode=1,
            stderr="ERROR: " + reference + ": not found\n",
        ),
    )
    assert oci.DockerRegistry().resolve(reference) is None


@pytest.mark.parametrize(
    "error",
    [
        "manifest unknown",
        "manifest unknown: manifest unknown",
        REF + ": manifest unknown",
        REF + ": manifest unknown: manifest unknown",
    ],
)
def test_complete_supported_manifest_absence(monkeypatch, error):
    monkeypatch.setattr(
        oci.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error)
    )
    assert oci.DockerRegistry().resolve(REF) is None


@pytest.mark.parametrize(
    "error",
    [
        "401 Unauthorized",
        "403 Forbidden",
        "429 Too Many Requests",
        "denied",
        "unauthorized",
        "authentication required",
        "error getting credentials",
        "HTTP status code: 401",
        "lookup ghcr.io: no such host",
        "TLS handshake timeout",
        "x509: unknown authority",
        "context deadline exceeded",
        "unknown registry error",
        "manifest unknown: unauthorized",
        REF + ": not found\n403 Forbidden",
        "timeout: manifest unknown",
        "network: not found",
    ],
)
def test_auth_rate_limit_infrastructure_and_mixed_diagnostics_fail_closed(monkeypatch, error):
    monkeypatch.setattr(
        oci.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stderr=error)
    )
    with pytest.raises(RuntimeError, match="failed closed"):
        oci.DockerRegistry().resolve(REF)


@pytest.mark.parametrize("digest", ["latest", "sha256:abc", "sha256:" + "A" * 64, DIGEST + "\n"])
def test_malformed_digest_fails(digest):
    with pytest.raises(ValueError):
        oci.validate_digest(digest)


def test_successful_registry_inspect_preserves_digest(monkeypatch):
    monkeypatch.setattr(
        oci.subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(returncode=0, stdout="Digest: " + DIGEST),
    )
    assert oci.DockerRegistry().resolve(REF) == DIGEST


def test_attach_preserves_single_manifest_identity(monkeypatch):
    calls = []
    monkeypatch.setattr(oci.subprocess, "run", lambda args, **kwargs: calls.append((args, kwargs)))
    oci.DockerRegistry().attach(REPO + "@" + DIGEST, REPO + ":canonical")
    assert calls == [
        (
            [
                "docker",
                "buildx",
                "imagetools",
                "create",
                "--prefer-index=false",
                "--tag",
                REPO + ":canonical",
                REPO + "@" + DIGEST,
            ],
            {"check": True},
        )
    ]


def test_malformed_successful_registry_output_is_fatal(monkeypatch):
    monkeypatch.setattr(
        oci.subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(returncode=0, stdout="Digest: invalid"),
    )
    with pytest.raises(ValueError, match="valid OCI digest"):
        oci.DockerRegistry().resolve(REF)
