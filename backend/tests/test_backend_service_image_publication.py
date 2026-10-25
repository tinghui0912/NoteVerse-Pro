import copy
import os
from pathlib import Path

import pytest
import yaml

from scripts import backend_service_image_publication as service
from scripts import oci_publication as oci

SOURCE = "a" * 40
FIRST = "sha256:" + "b" * 64
OTHER = "sha256:" + "c" * 64
GATES = dict(contract="success", sbom="success", trivy="success")
ROOT = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))


class Registry:
    def __init__(self, entries=None, mismatch=False):
        self.entries = dict(entries or {})
        self.writes = []
        self.mismatch = mismatch

    def resolve(self, reference):
        return self.entries.get(reference)

    def attach(self, source, target):
        self.writes.append((source, target))
        self.entries[target] = OTHER if self.mismatch else source.split("@", 1)[1]


@pytest.fixture(params=["api", "beat"])
def artifact(request):
    role = request.param
    return role, "ghcr.io/tinghui0912/noteverse/backend-" + role


def test_absent_canonical_and_attempt_candidate_build(artifact):
    role, repo = artifact
    result = service.plan(Registry(), repo, role, SOURCE, "40108308138", "1")
    assert result.action == "build"
    assert result.canonical_ref == repo + ":" + SOURCE
    assert result.candidate_ref == repo + ":candidate-40108308138-1"
    assert oci.candidate_tag("40108308138", "2") != "candidate-40108308138-1"


def test_existing_source_canonical_refuses_even_identical_candidate(artifact):
    role, repo = artifact
    registry = Registry({repo + ":" + SOURCE: FIRST})
    with pytest.raises(RuntimeError, match="canonical already exists"):
        service.plan(registry, repo, role, SOURCE, "1", "1")
    assert registry.writes == []


def test_existing_candidate_refuses(artifact):
    role, repo = artifact
    with pytest.raises(RuntimeError, match="candidate already exists"):
        service.plan(Registry({repo + ":candidate-1-1": FIRST}), repo, role, SOURCE, "1", "1")


@pytest.mark.parametrize("source", ["main", "A" * 40, "a" * 39, SOURCE + "\n"])
def test_invalid_source_refuses(artifact, source):
    role, repo = artifact
    with pytest.raises(ValueError, match="source SHA"):
        service.plan(Registry(), repo, role, source, "1", "1")


@pytest.mark.parametrize(("repo", "role"), [
    ("ghcr.io/owner/noteverse/backend-beat", "api"),
    ("ghcr.io/owner/noteverse/backend-api", "worker"),
    ("ghcr.io/owner/other/backend-api", "api"),
])
def test_role_repository_mismatch_fails(repo, role):
    with pytest.raises(ValueError, match="mismatch"):
        service.plan(Registry(), repo, role, SOURCE, "1", "1")


@pytest.mark.parametrize("gate", ["contract", "sbom", "trivy"])
@pytest.mark.parametrize("outcome", ["failure", "skipped", "cancelled", ""])
def test_any_failed_gate_prevents_canonical(artifact, gate, outcome):
    role, repo = artifact
    registry = Registry()
    gates = dict(GATES, **{gate: outcome})
    with pytest.raises(ValueError, match="promotion denied"):
        service.promote(registry, repo, role, SOURCE, FIRST, gates)
    assert registry.writes == []


def test_different_winner_is_never_overwritten(artifact):
    role, repo = artifact
    registry = Registry({repo + ":" + SOURCE: OTHER})
    with pytest.raises(RuntimeError, match="never overwrite"):
        service.promote(registry, repo, role, SOURCE, FIRST, GATES)
    assert registry.writes == []


def test_identical_winner_is_not_repushed(artifact):
    role, repo = artifact
    registry = Registry({repo + ":" + SOURCE: FIRST})
    assert service.promote(registry, repo, role, SOURCE, FIRST, GATES) == "identical-winner-without-repush"
    assert registry.writes == []


def test_qualified_exact_digest_is_attached_and_verified(artifact):
    role, repo = artifact
    registry = Registry()
    assert service.promote(registry, repo, role, SOURCE, FIRST, GATES) == "promoted-qualified-oci"
    assert registry.writes == [(repo + "@" + FIRST, repo + ":" + SOURCE)]
    assert registry.resolve(repo + ":" + SOURCE) == FIRST


def test_post_attach_digest_mismatch_fails(artifact):
    role, repo = artifact
    with pytest.raises(RuntimeError, match="did not preserve"):
        service.promote(Registry(mismatch=True), repo, role, SOURCE, FIRST, GATES)


def test_services_use_shared_registry_and_gate_mechanics():
    assert service.DockerRegistry is oci.DockerRegistry
    assert service.promote_qualified is oci.promote_qualified


@pytest.fixture
def documents():
    return [yaml.safe_load((ROOT / p).read_text(encoding="utf-8")) for p in (
        ".github/workflows/backend-api-image.yml", ".github/workflows/backend-beat-image.yml",
        ".github/actions/backend-service-image/action.yml",
    )]


def test_actual_parsed_service_documents(documents):
    service.check_workflow_documents(*documents)


@pytest.mark.parametrize("mutation", [
    "canonical-build", "build-alias", "pr-write", "pr-login", "pr-push", "pr-plan",
    "unguarded-promotion", "early-promotion", "missing-gate", "mutable-sbom", "mutable-scan",
    "trusted-cancel", "no-pull", "online-contract", "ignore-gate", "local-canonical-tag",
    "different-promotion-digest", "wrong-gate-selection", "unconditional-pr-action-push", "trusted-event",
])
def test_trust_regressions_fail_closed(documents, mutation):
    api, beat, action = copy.deepcopy(documents)
    steps = {s["id"]: s for s in action["runs"]["steps"] if "id" in s}
    if mutation == "canonical-build":
        steps["build"]["with"]["tags"] = "${{ github.sha }}"
    elif mutation == "build-alias":
        steps["build"]["with"]["tags"] = "build-${{ github.run_id }}"
    elif mutation == "pr-write":
        api["jobs"]["validate"]["permissions"]["packages"] = "write"
    elif mutation == "pr-login":
        api["jobs"]["validate"]["steps"].append({"uses": "docker/login-action@pin"})
    elif mutation == "pr-push":
        api["jobs"]["validate"]["steps"].append({"run": "docker push bad"})
    elif mutation == "pr-plan":
        steps["plan"].pop("if")
    elif mutation == "unguarded-promotion":
        steps["promote"]["if"] = "always()"
    elif mutation == "early-promotion":
        action["runs"]["steps"].remove(steps["promote"])
        action["runs"]["steps"].insert(0, steps["promote"])
    elif mutation == "missing-gate":
        steps["promote"]["env"].pop("GATE_SBOM")
    elif mutation == "mutable-sbom":
        steps["sbom"]["with"]["image"] = "${{ github.sha }}"
    elif mutation == "mutable-scan":
        steps["scan"]["with"]["image-ref"] = "${{ github.sha }}"
    elif mutation == "trusted-cancel":
        beat["concurrency"]["cancel-in-progress"] = True
    elif mutation == "no-pull":
        steps["trusted-artifact"]["run"] = "echo no pull"
    elif mutation == "online-contract":
        steps["contract"]["run"] = "docker run online"
    elif mutation == "ignore-gate":
        steps["scan"]["continue-on-error"] = True
    elif mutation == "local-canonical-tag":
        steps["image"]["run"] = "echo ghcr.io/canonical"
    elif mutation == "different-promotion-digest":
        steps["promote"]["env"]["DIGEST"] = OTHER
    elif mutation == "wrong-gate-selection":
        steps["artifact"]["env"]["REF"] = "mutable:tag"
    elif mutation == "unconditional-pr-action-push":
        action["runs"]["steps"].append({"run": "docker push bad"})
    elif mutation == "trusted-event":
        api["jobs"]["publish"]["if"] = "true"
    with pytest.raises(ValueError):
        service.check_workflow_documents(api, beat, action)


def test_valid_service_digest_selection_cli(artifact, capsys):
    role, repo = artifact
    assert service.main(["select", "--role", role, "--repository", repo, "--digest", FIRST]) == 0
    assert repo + "@" + FIRST in capsys.readouterr().out


def test_malformed_service_digest_cli_fails_closed(artifact):
    role, repo = artifact
    assert service.main(["select", "--role", role, "--repository", repo, "--digest", "latest"]) == 1
