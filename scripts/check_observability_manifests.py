"""Validate NoteVerse observability Helm values skeletons.

This guard is intentionally lightweight and dependency-free. It validates the
plain YAML-like files for risky values and high-cardinality label policy before
they are wired into a real Helm release.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGET = Path("deploy/observability")


@dataclass(frozen=True, slots=True)
class Finding:
    path: str
    line: int
    rule: str
    text: str


FORBIDDEN_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "local-dev-endpoint",
        re.compile(r"\b(localhost|127\.0\.0\.1|192\.168\.|host\.docker\.internal)\b", re.IGNORECASE),
    ),
    (
        "obvious-secret-value",
        re.compile(
            r"(your-secret|LTAI[0-9A-Za-z]|re_[0-9A-Za-z]{10,}|"
            r"password\s*:\s*['\"]?[^'\"\s]+|"
            r"secretAccessKey\s*:\s*['\"]?[^'\"\s]+|"
            r"accessKeyId\s*:\s*['\"]?[^'\"\s]+)",
            re.IGNORECASE,
        ),
    ),
    (
        "high-cardinality-loki-label",
        re.compile(
            r"\b(Label_Keys|Labels|labels|tags)\b.*"
            r"\b(request_id|originating_request_id|trace_id|span_id|"
            r"user_id|score_id|revision_id|job_id|outbox_id|storage_key|"
            r"file_hash|sha256|email|pod)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "sensitive-span-attribute",
        re.compile(
            r"\b(attributes|span|tags)\b.*"
            r"\b(password|token|email|musicxml|ocr_text|raw_audio|storage_key|file_hash|sha256)\b",
            re.IGNORECASE,
        ),
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target",
        nargs="?",
        type=Path,
        default=DEFAULT_TARGET,
        help="Observability directory to validate.",
    )
    return parser.parse_args()


def target_files(target: Path) -> list[Path]:
    target_path = target if target.is_absolute() else REPO_ROOT / target
    if target_path.is_file():
        return [target_path]
    return sorted(path for path in target_path.rglob("*") if path.suffix in {".yaml", ".yml", ".md"})


def scan_file(path: Path) -> list[Finding]:
    findings: list[Finding] = []
    text = path.read_text(encoding="utf-8")
    for line_no, line in enumerate(text.splitlines(), start=1):
        if line.lstrip().startswith("#"):
            continue
        for rule, pattern in FORBIDDEN_PATTERNS:
            if pattern.search(line):
                findings.append(
                    Finding(
                        path=str(path.relative_to(REPO_ROOT)),
                        line=line_no,
                        rule=rule,
                        text=line.strip(),
                    )
                )
    return findings


def print_findings(findings: list[Finding]) -> None:
    for finding in findings:
        print(f"{finding.path}:{finding.line}: {finding.rule}: {finding.text}")


def main() -> int:
    args = parse_args()
    findings: list[Finding] = []
    for path in target_files(args.target):
        findings.extend(scan_file(path))

    if findings:
        print_findings(findings)
        return 1

    print(f"Observability manifest check passed: {args.target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
