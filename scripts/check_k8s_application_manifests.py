"""Validate NoteVerse Kubernetes application manifests.

The default mode validates the public repository templates. Public templates
may contain explicit placeholders such as ``example.invalid`` and
``replace-me``.

Use ``--strict`` for a private deployment overlay. Strict mode fails if
placeholders remain in rendered manifests.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGETS = (
    Path("deploy/application/base"),
    Path("deploy/application/overlays/staging"),
    Path("deploy/application/overlays/production"),
)


@dataclass(frozen=True, slots=True)
class Finding:
    path: str
    line: int
    rule: str
    text: str


ALWAYS_FORBIDDEN_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
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
            r"CELERY_RESULT_BACKEND\s*=\s*redis)",
            re.IGNORECASE,
        ),
    ),
)

STRICT_FORBIDDEN_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "deployment-placeholder",
        re.compile(
            r"(example\.invalid|registry\.example\.invalid|"
            r"\breplace-me\b|\bstaging-replace-me\b|\bproduction-replace-me\b)",
            re.IGNORECASE,
        ),
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "targets",
        nargs="*",
        type=Path,
        default=list(DEFAULT_TARGETS),
        help="Kustomize directories to render and validate.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail if rendered manifests still contain deployment placeholders.",
    )
    return parser.parse_args()


def render_kustomize(target: Path) -> str:
    target_path = target if target.is_absolute() else REPO_ROOT / target
    completed = subprocess.run(
        ["kubectl", "kustomize", str(target_path)],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        sys.stderr.write(completed.stderr)
        raise RuntimeError(f"kubectl kustomize failed for {target}")
    return completed.stdout


def scan_text(path: str, text: str, patterns: tuple[tuple[str, re.Pattern[str]], ...]) -> list[Finding]:
    findings: list[Finding] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        for rule, pattern in patterns:
            if pattern.search(line):
                findings.append(Finding(path=path, line=line_no, rule=rule, text=line.strip()))
    return findings


def print_findings(findings: list[Finding]) -> None:
    for finding in findings:
        print(f"{finding.path}:{finding.line}: {finding.rule}: {finding.text}")


def main() -> int:
    args = parse_args()
    patterns = ALWAYS_FORBIDDEN_PATTERNS + (STRICT_FORBIDDEN_PATTERNS if args.strict else ())
    findings: list[Finding] = []

    for target in args.targets:
        rendered = render_kustomize(target)
        findings.extend(scan_text(f"{target} (rendered)", rendered, patterns))

    if findings:
        print_findings(findings)
        return 1

    mode = "strict" if args.strict else "template"
    targets = ", ".join(str(target) for target in args.targets)
    print(f"Kubernetes application manifest check passed ({mode}): {targets}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
