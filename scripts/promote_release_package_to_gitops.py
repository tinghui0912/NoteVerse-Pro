"""Promote a rendered release package into GitOps desired state.

The input is an environment directory from a release package, for example:

    tmp/staging-release-package/staging

The output is the corresponding GitOps environment directory, for example:

    deploy/gitops/environments/staging

This script copies only declarative, non-secret files. Release packages contain
their own immutable application-base snapshot, so promoted GitOps state never
references the mutable application manifest tree in this repository.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
GITOPS_ENV_ROOT = REPO_ROOT / "deploy" / "gitops" / "environments"
ALLOWED_FILES = {
    "README.md",
    "backend-config.env",
    "backend-practice-config.env",
    "backend-worker-config.env",
    "control-plane-config.env",
    "customer-web-config.env",
    "gateway.yaml",
    "kustomization.yaml",
    "patch-backend-api-runtime-volumes.yaml",
    "patch-backend-beat-runtime-volumes.yaml",
    "patch-backend-practice-runtime-volumes.yaml",
    "patch-backend-worker-runtime-volumes.yaml",
    "patch-backend-worker-scheduling.yaml",
    "release-metadata.json",
}
ALLOWED_DIRECTORIES = {"base"}
AUXILIARY_IMAGES = {
    "busybox": ("busybox", "sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--environment", choices=("staging", "production"), required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def resolve_repo_path(path: Path) -> Path:
    return path if path.is_absolute() else REPO_ROOT / path


def load_metadata(source: Path, expected_environment: str) -> dict[str, object]:
    metadata_path = source / "release-metadata.json"
    if not metadata_path.exists():
        raise RuntimeError(f"release metadata is required: {metadata_path}")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("environment") != expected_environment:
        raise RuntimeError(
            f"release metadata environment {metadata.get('environment')!r} does not match {expected_environment!r}"
        )
    images = metadata.get("images")
    if not isinstance(images, dict) or not images:
        raise RuntimeError("release metadata must contain images")
    for name, value in images.items():
        if not isinstance(value, str) or "@sha256:" not in value:
            raise RuntimeError(f"release metadata image is not digest-pinned: {name}={value!r}")
    return metadata


def copy_allowed_content(source: Path, output: Path, overwrite: bool) -> None:
    if output.exists():
        if not overwrite:
            raise FileExistsError(f"Output already exists: {output}")
        for child in output.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    else:
        output.mkdir(parents=True)

    for item in source.iterdir():
        if item.is_dir():
            if item.name not in ALLOWED_DIRECTORIES:
                raise RuntimeError(f"unexpected release package directory: {item.name}")
            if not (item / "kustomization.yaml").is_file():
                raise RuntimeError(f"release package base snapshot is invalid: {item}")
            shutil.copytree(item, output / item.name)
            continue
        if item.name not in ALLOWED_FILES:
            raise RuntimeError(f"unexpected release package file: {item.name}")
        shutil.copy2(item, output / item.name)

    if not (output / "base" / "kustomization.yaml").is_file():
        raise RuntimeError("release package must include an application base snapshot")


def rewrite_kustomization(output: Path) -> None:
    kustomization_path = output / "kustomization.yaml"
    text = kustomization_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    rewritten = []
    replaced = False
    for line in lines:
        stripped = line.strip()
        if stripped.endswith("deploy/application/base") or stripped in {
            "- ../../base",
            "- ../../../deploy/application/base",
            "- base",
        }:
            indent = line[: len(line) - len(line.lstrip())]
            rewritten.append(f"{indent}- base")
            replaced = True
        else:
            rewritten.append(line)
    if not replaced:
        raise RuntimeError("failed to find application base resource in kustomization.yaml")
    text = "\n".join(rewritten) + "\n"
    for image_name, (new_name, digest) in AUXILIARY_IMAGES.items():
        if f"  - name: {image_name}\n" not in text:
            auxiliary_block = (
                f"  - name: {image_name}\n"
                f"    newName: {new_name}\n"
                f"    digest: {digest}\n"
            )
            marker = "\nconfigMapGenerator:"
            if marker not in text:
                raise RuntimeError("failed to find configMapGenerator marker for auxiliary image insertion")
            text = text.replace(marker, f"\n{auxiliary_block}{marker}", 1)
    kustomization_path.write_text(text, encoding="utf-8")


def write_gitops_readme(output: Path, metadata: dict[str, object]) -> None:
    commit_sha = str(metadata.get("commit_sha", "unknown"))
    rendered_at = str(metadata.get("rendered_at", "unknown"))
    workflow_run_id = str(metadata.get("workflow_run_id", "unknown"))
    environment = str(metadata.get("environment", "unknown"))
    readme = f"""# {environment.title()} GitOps Environment

This directory contains the current digest-pinned NoteVerse {environment}
desired state promoted from a release package.

Release metadata:

- commit: `{commit_sha}`
- rendered at: `{rendered_at}`
- workflow run: `{workflow_run_id}`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- The `base/` directory is a release-scoped application manifest snapshot.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
"""
    (output / "README.md").write_text(readme, encoding="utf-8")


def main() -> int:
    args = parse_args()
    source = resolve_repo_path(args.source)
    if not source.is_dir():
        raise RuntimeError(f"source directory does not exist: {source}")
    output = resolve_repo_path(args.output) if args.output else GITOPS_ENV_ROOT / args.environment
    metadata = load_metadata(source, args.environment)
    copy_allowed_content(source, output, args.overwrite)
    rewrite_kustomization(output)
    write_gitops_readme(output, metadata)
    print(output.relative_to(REPO_ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
