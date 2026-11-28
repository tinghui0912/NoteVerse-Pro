"""Four-image deployment ownership, immutable release inputs and runtime commands."""

from __future__ import annotations

from pathlib import Path
import re
import yaml

IMAGE_KEYS = ("backend_core", "backend_worker", "customer_web", "platform_admin")
WORKLOADS = {
    "backend-api-deployment.yaml": ("backend_core", "customer-api"),
    "control-plane-deployment.yaml": ("backend_core", "control-plane"),
    "backend-beat-deployment.yaml": ("backend_core", "beat"),
    "migration-job.yaml": ("backend_core", "migrator"),
    "backend-worker-deployment.yaml": ("backend_worker", "worker"),
    "customer-web-deployment.yaml": ("customer_web", None),
    "platform-admin-deployment.yaml": ("platform_admin", None),
}


def validate_release_images(images: object) -> None:
    if not isinstance(images, dict) or set(images) != set(IMAGE_KEYS):
        raise ValueError("A release requires exactly four production image digests")
    for key, value in images.items():
        repository = key.replace("_", "-")
        if not isinstance(value, str) or not re.fullmatch(
            r"[a-z0-9][a-z0-9./:_-]*/" + repository + r"@sha256:[a-f0-9]{64}", value
        ):
            raise ValueError(f"Invalid immutable {key} image reference")


def validate_release_snapshot(source: Path, images: dict) -> None:
    validate_release_images(images)
    for filename, (key, command) in WORKLOADS.items():
        document = yaml.safe_load((source / "base" / filename).read_text(encoding="utf-8"))
        pod = document["spec"]["template"]["spec"]
        if len(pod["containers"]) != 1 or pod.get("initContainers"):
            raise ValueError(f"Unexpected release image in {filename}")
        container = pod["containers"][0]
        if container["image"] != images[key]:
            raise ValueError(f"{filename} must use the exact {key} release digest")
        if command and (container.get("args") != [command] or container.get("command")):
            raise ValueError(f"{filename} requires explicit runtime {command}")
    document = yaml.safe_load(
        (source / "base/model-cache-agent-daemonset.yaml").read_text(encoding="utf-8")
    )
    init = document["spec"]["template"]["spec"]["initContainers"][0]
    if (
        init["image"] != images["backend_worker"]
        or init.get("args") != ["model-cache", "--check-scope", "assets"]
        or init.get("command")
    ):
        raise ValueError("Model preparation requires the exact Worker digest and explicit command")
    configuration = yaml.safe_load((source / "kustomization.yaml").read_text(encoding="utf-8"))
    blocks = {image["name"]: image for image in configuration["images"]}
    names = {"noteverse-" + key.replace("_", "-") for key in IMAGE_KEYS}
    if len(blocks) != len(configuration["images"]) or set(blocks) - names - {"busybox"}:
        raise ValueError("Unexpected or duplicate release image block")
    for key, ref in images.items():
        name, digest = ref.split("@")
        image = blocks.get("noteverse-" + key.replace("_", "-"), {})
        if image.get("newName") != name or image.get("digest") != digest or "newTag" in image:
            raise ValueError(f"Kustomize must preserve exact {key} digest")
