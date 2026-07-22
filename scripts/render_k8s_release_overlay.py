"""Render a deployable Kubernetes application overlay.

The public overlays under deploy/application/overlays are templates. This
script copies one template overlay to a caller-provided output directory and
injects release-specific values such as image references and public hosts.

It intentionally does not generate Kubernetes Secrets or credentials.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
OVERLAYS_ROOT = REPO_ROOT / "deploy" / "application" / "overlays"


@dataclass(frozen=True, slots=True)
class ImageRef:
    name: str
    field: str
    value: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", choices=("staging", "production"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--backend-api-image", required=True)
    parser.add_argument("--backend-beat-image", required=True)
    parser.add_argument("--backend-worker-image", required=True)
    parser.add_argument("--frontend-image", required=True)
    parser.add_argument("--frontend-host", required=True)
    parser.add_argument("--api-host", required=True)
    parser.add_argument("--tls-secret", required=True)
    parser.add_argument("--frontend-base-url", required=True)
    parser.add_argument("--backend-cors-origins", required=True)
    parser.add_argument("--auth-cookie-secure", choices=("true", "false"), required=True)
    parser.add_argument("--mail-default-sender", required=True)
    parser.add_argument("--s3-endpoint-url", required=True)
    parser.add_argument("--s3-region", required=True)
    parser.add_argument("--s3-bucket", required=True)
    parser.add_argument("--s3-public-base-url", required=True)
    parser.add_argument("--s3-force-path-style", choices=("true", "false"), required=True)
    parser.add_argument("--s3-presign-expire-seconds", required=True)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace the output directory if it already exists.",
    )
    return parser.parse_args()


def parse_image_ref(value: str) -> ImageRef:
    if "@sha256:" in value:
        name, digest = value.split("@", 1)
        return ImageRef(name=name, field="digest", value=digest)

    slash_index = value.rfind("/")
    colon_index = value.rfind(":")
    if colon_index <= slash_index:
        raise ValueError(
            f"Image reference must include an immutable tag or digest: {value}"
        )
    return ImageRef(name=value[:colon_index], field="newTag", value=value[colon_index + 1 :])


def replace_image_block(text: str, image_name: str, image_ref: ImageRef) -> str:
    replacement = (
        f"  - name: {image_name}\n"
        f"    newName: {image_ref.name}\n"
        f"    {image_ref.field}: {image_ref.value}"
    )
    pattern = re.compile(
        rf"  - name: {re.escape(image_name)}\n"
        r"    newName: .+\n"
        r"    (?:newTag|digest): .+"
    )
    updated, count = pattern.subn(replacement, text)
    if count != 1:
        raise ValueError(f"Expected exactly one image block for {image_name}, found {count}")
    return updated


def replace_required(text: str, old: str, new: str) -> str:
    if old not in text:
        raise ValueError(f"Expected placeholder not found: {old}")
    return text.replace(old, new)


def replace_env_value(text: str, key: str, value: str) -> str:
    updated, count = re.subn(
        rf"^{re.escape(key)}=.*$",
        f"{key}={value}",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise ValueError(f"Expected exactly one environment value for {key}, found {count}")
    return updated


def copy_template(source: Path, output: Path, overwrite: bool) -> None:
    if output.exists():
        if not overwrite:
            raise FileExistsError(f"Output already exists: {output}")
        shutil.rmtree(output)
    shutil.copytree(source, output)


def render_overlay(args: argparse.Namespace) -> Path:
    source = OVERLAYS_ROOT / args.environment
    if not source.is_dir():
        raise FileNotFoundError(f"Overlay template not found: {source}")

    output = args.output if args.output.is_absolute() else REPO_ROOT / args.output
    copy_template(source, output, args.overwrite)

    backend_api_ref = parse_image_ref(args.backend_api_image)
    backend_beat_ref = parse_image_ref(args.backend_beat_image)
    backend_worker_ref = parse_image_ref(args.backend_worker_image)
    frontend_ref = parse_image_ref(args.frontend_image)

    kustomization_path = output / "kustomization.yaml"
    kustomization = kustomization_path.read_text(encoding="utf-8")
    base_relative_path = os.path.relpath(REPO_ROOT / "deploy" / "application" / "base", output)
    kustomization = replace_required(
        kustomization,
        "- ../../base",
        f"- {base_relative_path.replace(os.sep, '/')}",
    )
    kustomization = replace_image_block(kustomization, "noteverse-backend-api", backend_api_ref)
    kustomization = replace_image_block(kustomization, "noteverse-backend-beat", backend_beat_ref)
    kustomization = replace_image_block(kustomization, "noteverse-backend-worker", backend_worker_ref)
    kustomization = replace_image_block(kustomization, "noteverse-frontend", frontend_ref)
    kustomization_path.write_text(kustomization, encoding="utf-8")

    frontend_placeholder = (
        "staging.noteverse.example.invalid"
        if args.environment == "staging"
        else "noteverse.example.invalid"
    )
    api_placeholder = (
        "api.staging.noteverse.example.invalid"
        if args.environment == "staging"
        else "api.noteverse.example.invalid"
    )
    tls_placeholder = (
        "noteverse-staging-tls"
        if args.environment == "staging"
        else "noteverse-production-tls"
    )

    ingress_path = output / "ingress.yaml"
    ingress = ingress_path.read_text(encoding="utf-8")
    ingress = replace_required(ingress, api_placeholder, args.api_host)
    ingress = replace_required(ingress, frontend_placeholder, args.frontend_host)
    ingress = replace_required(ingress, tls_placeholder, args.tls_secret)
    ingress_path.write_text(ingress, encoding="utf-8")

    backend_config_path = output / "backend-config.env"
    backend_config = backend_config_path.read_text(encoding="utf-8")
    backend_config = replace_env_value(
        backend_config,
        "FRONTEND_BASE_URL",
        args.frontend_base_url,
    )
    backend_config = replace_env_value(
        backend_config,
        "BACKEND_CORS_ORIGINS",
        args.backend_cors_origins,
    )
    backend_config = replace_env_value(
        backend_config,
        "AUTH_COOKIE_SECURE",
        args.auth_cookie_secure,
    )
    backend_config = replace_env_value(
        backend_config,
        "MAIL_DEFAULT_SENDER",
        args.mail_default_sender,
    )
    backend_config = replace_env_value(
        backend_config,
        "S3_ENDPOINT_URL",
        args.s3_endpoint_url,
    )
    backend_config = replace_env_value(
        backend_config,
        "S3_REGION",
        args.s3_region,
    )
    backend_config = replace_env_value(
        backend_config,
        "S3_BUCKET",
        args.s3_bucket,
    )
    backend_config = replace_env_value(
        backend_config,
        "S3_PUBLIC_BASE_URL",
        args.s3_public_base_url,
    )
    backend_config = replace_env_value(
        backend_config,
        "S3_FORCE_PATH_STYLE",
        args.s3_force_path_style,
    )
    backend_config = replace_env_value(
        backend_config,
        "S3_PRESIGN_EXPIRE_SECONDS",
        args.s3_presign_expire_seconds,
    )
    backend_config_path.write_text(backend_config, encoding="utf-8")

    return output


def main() -> int:
    args = parse_args()
    output = render_overlay(args)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
