"""Immutable four-image releases, isolated commands and fail-closed publication gate."""

import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import production_image_contract as contract  # noqa: E402
import render_k8s_release_overlay as renderer  # noqa: E402
import promote_release_package_to_gitops as promotion  # noqa: E402
import check_gitops_manifests as gitops  # noqa: E402
import backend_core_image_smoke as smoke  # noqa: E402

IMAGES = {
    key: f"ghcr.io/owner/noteverse/{key.replace('_', '-')}@sha256:{str(i) * 64}"
    for i, key in enumerate(contract.IMAGE_KEYS, 1)
}


def test_exact_four_immutable_image_inputs():
    contract.validate_release_images(IMAGES)
    for key in IMAGES:
        incomplete = dict(IMAGES)
        incomplete.pop(key)
        with pytest.raises(ValueError):
            contract.validate_release_images(incomplete)
    for value in ("mutable:tag", "sha256:" + "a" * 64, IMAGES["backend_core"] + "extra"):
        with pytest.raises(ValueError):
            contract.validate_release_images(dict(IMAGES, backend_core=value))
    with pytest.raises(ValueError):
        contract.validate_release_images(dict(IMAGES, unowned=IMAGES["backend_core"]))


@pytest.fixture(params=["staging", "production"])
def release(tmp_path, request):
    args = SimpleNamespace(
        environment=request.param,
        output=tmp_path / request.param,
        overwrite=False,
        external_egress_config=None,
        **{key + "_image": image for key, image in IMAGES.items()},
        customer_web_host="app.noteverse.test",
        admin_host="admin.noteverse.test",
        tls_secret="noteverse-tls",
        customer_web_base_url="https://app.noteverse.test",
        backend_cors_origins='["https://app.noteverse.test"]',
        control_plane_cors_origins='["https://admin.noteverse.test"]',
        trusted_proxy_cidrs='["10.244.0.0/16"]',
        auth_cookie_secure="true",
        mail_default_sender="NoteVerse <mail@noteverse.test>",
        csp_object_storage_origins="https://storage.noteverse.test",
        s3_endpoint_url="https://storage.noteverse.test",
        s3_region="auto",
        s3_bucket="noteverse-test",
        s3_force_path_style="false",
        s3_presign_expire_seconds="900",
    )
    path = renderer.render_overlay(args)
    metadata = {"environment": request.param, "images": IMAGES}
    (path / "release-metadata.json").write_text(json.dumps(metadata))
    return path, request.param


def test_release_snapshot_uses_four_digests_and_explicit_runtime_commands(release):
    path, environment = release
    contract.validate_release_snapshot(path, IMAGES)
    assert promotion.load_metadata(path, environment)["images"] == IMAGES
    promotion.copy_allowed_content(path, path.parent / "promoted", False)
    promotion.rewrite_kustomization(path.parent / "promoted")
    contract.validate_release_snapshot(path.parent / "promoted", IMAGES)


@pytest.mark.parametrize(
    "mutation", ["core-digest", "core-command", "model-digest", "kustomize-digest"]
)
def test_release_rejects_runtime_or_image_drift(release, mutation):
    path, _ = release
    filename = {
        "core-digest": "base/backend-beat-deployment.yaml",
        "core-command": "base/migration-job.yaml",
        "model-digest": "base/model-cache-agent-daemonset.yaml",
        "kustomize-digest": "kustomization.yaml",
    }[mutation]
    file = path / filename
    document = yaml.safe_load(file.read_text())
    if mutation == "kustomize-digest":
        document["images"][0]["digest"] = "sha256:" + "f" * 64
    else:
        pod = document["spec"]["template"]["spec"]
        container = (pod["initContainers"] if mutation == "model-digest" else pod["containers"])[0]
        container["args" if mutation == "core-command" else "image"] = (
            ["incorrect"] if mutation == "core-command" else IMAGES["backend_worker"] + "extra"
        )
    file.write_text(yaml.safe_dump(document))
    with pytest.raises(ValueError):
        promotion.load_metadata(path, release[1])


def test_publication_gate_is_explicit_and_cannot_render_empty_or_mutable_state():
    target = ROOT / "deploy/gitops/environments/staging"
    assert gitops.validate_publication_block(target) == []
    assert not (target / "published-release").exists()
    application = yaml.safe_load(
        (ROOT / "deploy/gitops/applications/argocd/noteverse-staging.yaml").read_text()
    )
    assert "automated" not in application["spec"]["syncPolicy"]
    assert not (target / "release-metadata.json").exists()


def test_smoke_covers_identity_readonly_all_modes_and_unknown_command(monkeypatch):
    run = Mock(
        side_effect=[
            SimpleNamespace(stdout="10001:10001"),
            *[SimpleNamespace(returncode=0) for _ in range(6)],
            SimpleNamespace(returncode=64),
        ]
    )
    monkeypatch.setattr(smoke.subprocess, "run", run)
    smoke.smoke("local:core")
    commands = [call.args[0] for call in run.call_args_list]
    for runtime in smoke.RUNTIMES:
        assert any(command[-3:] == ["contract", "--runtime", runtime] for command in commands)
    for command in commands[1:]:
        assert "--read-only" in command and command[command.index("--network") + 1] == "none"
    assert "errno.EROFS" in commands[1][-1]


def test_docker_inventory_has_four_production_and_four_scoped_build_recipes():
    expected = {
        "docker/backend/Dockerfile.core",
        "docker/backend/Dockerfile.worker",
        "docker/customer-web/Dockerfile.runtime",
        "docker/platform-admin/Dockerfile.runtime",
        "docker/backend/Dockerfile.worker-deps",
        "docker/backend/Dockerfile.quality",
        "docker/customer-web/Dockerfile.dev",
        "docker/platform-admin/Dockerfile.dev",
    }
    actual = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "docker").rglob("Dockerfile*")
        if not path.name.endswith(".dockerignore")
    }
    assert actual == expected
    assert "--only-group api" in (ROOT / "docker/backend/Dockerfile.core").read_text()


def test_release_workflow_inputs_are_the_exact_four_images():
    for environment in ("staging", "production"):
        document = yaml.safe_load(
            (ROOT / f".github/workflows/{environment}-release-package.yml").read_text()
        )
        events = document.get("on", document.get(True))
        keys = events["workflow_dispatch"]["inputs"]
        assert {key for key in keys if key.endswith("_image")} == {
            key + "_image" for key in contract.IMAGE_KEYS
        }
