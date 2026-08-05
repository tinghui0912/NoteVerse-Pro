#!/usr/bin/env python3
"""Split a rendered Kustomize release into deterministic apply phases."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


DOCUMENT_SEPARATOR = re.compile(r"^---\s*$", re.MULTILINE)
KIND_PATTERN = re.compile(r"^kind:\s*([^\s#]+)", re.MULTILINE)
NAME_PATTERN = re.compile(r"^metadata:\s*\n(?:^[ \t]+.*\n)*?^[ \t]+name:\s*([^\s#]+)", re.MULTILINE)
WORKLOAD_KINDS = {"DaemonSet", "Deployment", "StatefulSet"}
MIGRATION_JOB_NAME = "noteverse-db-migrate"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("overlay", type=Path, help="Rendered Kustomize overlay directory")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for phase manifests")
    return parser.parse_args()


def resource_identity(document: str) -> tuple[str, str]:
    kind_match = KIND_PATTERN.search(document)
    name_match = NAME_PATTERN.search(document)
    if kind_match is None or name_match is None:
        raise ValueError("Rendered manifest document is missing kind or metadata.name.")
    return kind_match.group(1), name_match.group(1)


def write_phase(path: Path, documents: list[str]) -> None:
    if not documents:
        path.write_text("", encoding="utf-8")
        return
    path.write_text("---\n" + "\n---\n".join(documents) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_arguments()
    rendered = subprocess.run(
        ["kubectl", "kustomize", str(args.overlay)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    bootstrap: list[str] = []
    migration: list[str] = []
    workloads: list[str] = []
    for document in DOCUMENT_SEPARATOR.split(rendered):
        document = document.strip()
        if not document:
            continue
        kind, name = resource_identity(document)
        if kind == "Job" and name == MIGRATION_JOB_NAME:
            migration.append(document)
        elif kind in WORKLOAD_KINDS:
            workloads.append(document)
        else:
            bootstrap.append(document)

    if len(migration) != 1:
        raise ValueError(
            f"Expected exactly one Job/{MIGRATION_JOB_NAME}; found {len(migration)}."
        )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_phase(args.output_dir / "00-bootstrap.yaml", bootstrap)
    write_phase(args.output_dir / "10-migration.yaml", migration)
    write_phase(args.output_dir / "20-workloads.yaml", workloads)

    print(f"bootstrap={len(bootstrap)} migration={len(migration)} workloads={len(workloads)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (subprocess.CalledProcessError, ValueError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
