"""Worker-deps v3 artifact inputs and uv-owned explicit-target resolution only."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tomllib

SCHEMA = 3
PLATFORM = "linux/amd64"
UV_PLATFORM = "x86_64-manylinux_2_36"
PYTHON = "3.12"
IDENTITY_INPUTS = (
    "backend/pyproject.toml",
    "backend/uv.lock",
    "docker/backend/Dockerfile.worker-deps",
    "backend/scripts/worker_image_identity.py",
    "backend/scripts/check_image_contract.py",
    "backend/app/processing/engines/omr/legato_manifest.py",
)
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")


def validate_digest(value: str) -> str:
    if not DIGEST.fullmatch(value):
        raise ValueError(f"Invalid OCI digest: {value!r}")
    return value


def _worker_text_digest(path: Path) -> str:
    """Canonicalize only governed UTF-8 Worker text, never arbitrary binaries."""
    try:
        text = path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"Worker identity input must be UTF-8 text: {path}") from exc
    text = text.replace("\r\n", "\n")
    if "\r" in text:
        raise ValueError(f"Ambiguous lone CR in Worker identity input: {path}")
    if "\x00" in text:
        raise ValueError(f"Binary NUL in Worker identity text input: {path}")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def project_configuration(repo: Path) -> dict:
    with (repo / "backend/pyproject.toml").open("rb") as stream:
        return tomllib.load(stream)


def worker_resolution(repo: Path) -> bytes:
    """Export the locked target graph with stable uv; never interpret markers here.

    uv 0.13.5 export has no target switch. Its stable text tree does, while
    JSON output is experimental. Full uv.lock bytes separately bind all hashes.
    """
    config = project_configuration(repo)
    version = config["tool"]["uv"]["required-version"].removeprefix("==")
    observed = subprocess.run(["uv", "--version"], check=True, capture_output=True, text=True)
    if observed.stdout.split()[:2] != ["uv", version]:
        raise ValueError("Worker identity requires the project's exact approved uv version")
    command = [
        "uv", "tree", "--locked", "--only-group", "worker",
        "--python", "cpython@" + PYTHON, "--python-version", PYTHON,
        "--python-platform", UV_PLATFORM, "--color", "never", "--no-progress",
    ]
    print("WORKER_RESOLUTION_COMMAND " + " ".join(command), file=sys.stderr, flush=True)
    result = subprocess.run(command, cwd=repo / "backend", check=True, capture_output=True)
    if not result.stdout:
        raise ValueError("uv Worker target graph must not be empty")
    return result.stdout


def build_identity(repo: Path, python_base_digest: str, *, schema: int = SCHEMA) -> dict:
    validate_digest(python_base_digest)
    if schema < 3:
        raise ValueError("Legacy identity cannot be emitted by the uv v3 helper")
    config = project_configuration(repo)
    document = {
        "schema": f"noteverse-worker-deps-v{schema}",
        "target_platform": PLATFORM,
        "python": PYTHON,
        "uv_target": UV_PLATFORM,
        "resolution_format": "uv-tree-text",
        "resolved_python_base_oci_digest": python_base_digest,
        "worker_resolution_sha256": hashlib.sha256(worker_resolution(repo)).hexdigest(),
        "uv_required_version": config["tool"]["uv"]["required-version"],
        "uv_tool_image": config["tool"]["noteverse"]["images"]["uv"],
        "inputs": {path: _worker_text_digest(repo / path) for path in sorted(IDENTITY_INPUTS)},
    }
    serialized = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    key = hashlib.sha256(serialized.encode("ascii")).hexdigest()
    return {"schema": schema, "build_key": key, "key_tag": f"deps-v{schema}-{key}",
            "resolution_sha256": document["worker_resolution_sha256"], "document": document}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    key = sub.add_parser("build-key")
    key.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    key.add_argument("--python-base-digest", required=True)
    args = parser.parse_args(argv)
    try:
        result = build_identity(args.repo, args.python_base_digest)
        if args.output:
            with args.output.open("a", encoding="utf-8", newline="\n") as stream:
                for name in ("schema", "build_key", "key_tag", "resolution_sha256"):
                    stream.write(f"{name}={result[name]}\n")
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Worker identity failed closed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
