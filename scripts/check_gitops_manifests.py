"""Validate NoteVerse GitOps desired-state directories.

This guard is intentionally stricter than template manifest validation. GitOps
desired state is deployable state, so it must not contain placeholders, local
dev endpoints, raw credentials, or mutable image tags.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGETS = (Path("deploy/gitops/environments/staging"),)


@dataclass(frozen=True, slots=True)
class Finding:
    path: str
    line: int
    rule: str
    text: str


FORBIDDEN_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "deployment-placeholder",
        re.compile(
            r"(example\.invalid|registry\.example\.invalid|"
            r"\breplace-me\b|\bstaging-replace-me\b|\bproduction-replace-me\b)",
            re.IGNORECASE,
        ),
    ),
    (
        "local-dev-endpoint",
        re.compile(r"\b(localhost|127\.0\.0\.1|192\.168\.|host\.docker\.internal)\b", re.IGNORECASE),
    ),
    (
        "obvious-secret-value",
        re.compile(
            r"(your-secret|LTAI[0-9A-Za-z]|re_[0-9A-Za-z]{10,}|"
            r"S3_SECRET_ACCESS_KEY\s*=\s*\S+|"
            r"DATABASE_URL\s*=\s*(postgres|mysql|sqlite)|"
            r"SYNC_DATABASE_URL\s*=\s*(postgres|mysql|sqlite)|"
            r"REDIS_URL\s*=\s*redis|"
            r"CELERY_BROKER_URL\s*=\s*redis|"
            r"CELERY_RESULT_BACKEND\s*=\s*redis|"
            r"SECRET_KEY\s*=\s*\S+|"
            r"HF_TOKEN\s*=\s*\S+|"
            r"RESEND_API_KEY\s*=\s*\S+)",
            re.IGNORECASE,
        ),
    ),
)

IMAGE_BLOCK_PATTERN = re.compile(
    r"  - name: (?P<name>[^\n]+)\n"
    r"    newName: (?P<new_name>[^\n]+)\n"
    r"    (?P<field>newTag|digest): (?P<value>[^\n]+)",
)
RENDERED_IMAGE_PATTERN = re.compile(r"^\s*image:\s*(?P<image>\S+)\s*$")

REQUIRED_FILES = ("kustomization.yaml", "release-metadata.json", "base/kustomization.yaml")
REQUIRED_RENDERED_SNIPPETS = ("name: noteverse-registry-credentials",)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets", nargs="*", type=Path, default=list(DEFAULT_TARGETS))
    return parser.parse_args()


def repo_path(path: Path) -> Path:
    return path if path.is_absolute() else REPO_ROOT / path


def render_kustomize(target: Path) -> str:
    target_path = repo_path(target)
    result = subprocess.run(
        ["kubectl", "kustomize", str(target_path)],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise RuntimeError(f"kubectl kustomize failed for {target}")
    return result.stdout


def scan_text(path: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        for rule, pattern in FORBIDDEN_PATTERNS:
            if pattern.search(line):
                findings.append(Finding(path, line_no, rule, line.strip()))
    return findings


def validate_files(target: Path) -> list[Finding]:
    target_path = repo_path(target)
    findings: list[Finding] = []
    for filename in REQUIRED_FILES:
        if not (target_path / filename).exists():
            findings.append(Finding(str(target), 1, "required-file", f"missing {filename}"))

    for file_path in target_path.rglob("*"):
        if file_path.is_file():
            rel = file_path.relative_to(REPO_ROOT).as_posix()
            findings.extend(scan_text(rel, file_path.read_text(encoding="utf-8")))

    kustomization_path = target_path / "kustomization.yaml"
    if kustomization_path.exists():
        text = kustomization_path.read_text(encoding="utf-8")
        image_blocks = list(IMAGE_BLOCK_PATTERN.finditer(text))
        if not image_blocks:
            findings.append(Finding(str(kustomization_path), 1, "digest-pinned-image", "no image blocks found"))
        for match in image_blocks:
            if match.group("field") != "digest" or not match.group("value").startswith("sha256:"):
                findings.append(
                    Finding(
                        str(kustomization_path),
                        text[: match.start()].count("\n") + 1,
                        "digest-pinned-image",
                        match.group(0).replace("\n", " | "),
                    )
                )

    metadata_path = target_path / "release-metadata.json"
    if metadata_path.exists():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        images = metadata.get("images")
        if not isinstance(images, dict) or not images:
            findings.append(Finding(str(metadata_path), 1, "release-metadata-images", "missing images"))
        else:
            for name, value in images.items():
                if not isinstance(value, str) or "@sha256:" not in value:
                    findings.append(
                        Finding(str(metadata_path), 1, "release-metadata-digest", f"{name}={value!r}")
                    )
    return findings


def print_findings(findings: list[Finding]) -> None:
    for finding in findings:
        print(f"{finding.path}:{finding.line}: {finding.rule}: {finding.text}")


def validate_rendered_images(path: str, rendered: str) -> list[Finding]:
    findings: list[Finding] = []
    for line_no, line in enumerate(rendered.splitlines(), start=1):
        match = RENDERED_IMAGE_PATTERN.match(line)
        if match is None:
            continue
        image = match.group("image")
        if "@sha256:" not in image:
            findings.append(Finding(path, line_no, "rendered-image-digest", line.strip()))
    return findings


def main() -> int:
    args = parse_args()
    findings: list[Finding] = []
    for target in args.targets:
        findings.extend(validate_files(target))
        rendered = render_kustomize(target)
        findings.extend(scan_text(f"{target} (rendered)", rendered))
        findings.extend(validate_rendered_images(f"{target} (rendered)", rendered))
        for snippet in REQUIRED_RENDERED_SNIPPETS:
            if snippet not in rendered:
                findings.append(
                    Finding(f"{target} (rendered)", 1, "required-rendered-snippet", f"missing {snippet}")
                )
    if findings:
        print_findings(findings)
        return 1
    print("GitOps manifest check passed: " + ", ".join(str(target) for target in args.targets))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
