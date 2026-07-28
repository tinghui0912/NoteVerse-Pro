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
            if rule == "obvious-secret-value" and "${" in line:
                continue
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


def validate_environment_object_storage(target: Path) -> list[Finding]:
    target_path = target if target.is_absolute() else REPO_ROOT / target
    values_dir = target_path / "values"
    findings: list[Finding] = []
    for profile in ("minikube", "production"):
        profile_dir = values_dir / profile
        if not profile_dir.exists():
            continue
        for release_name in ("loki", "tempo"):
            path = profile_dir / f"{release_name}.values.yaml"
            if not path.exists():
                findings.append(
                    add_file_finding(
                        profile_dir,
                        f"{profile}-{release_name}-object-storage-overlay",
                        f"missing {release_name}.values.yaml object-storage overlay",
                    )
                )
                continue
            text = path.read_text(encoding="utf-8").lower()
            if "filesystem" in text:
                findings.append(
                    add_file_finding(
                        path,
                        f"{profile}-{release_name}-no-filesystem-storage",
                        "staging/production observability overlays must not use filesystem storage",
                    )
                )
            if "s3" not in text:
                findings.append(
                    add_file_finding(
                        path,
                        f"{profile}-{release_name}-s3-storage",
                        "staging/production observability overlays must use S3-compatible object storage",
                    )
                )
    return findings


def add_file_finding(path: Path, rule: str, text: str) -> Finding:
    return Finding(path=str(path.relative_to(REPO_ROOT)), line=1, rule=rule, text=text)


def validate_fluent_bit_values(target: Path) -> list[Finding]:
    """Validate the NoteVerse Fluent Bit -> Loki values contract."""

    target_path = target if target.is_absolute() else REPO_ROOT / target
    fluent_bit_path = target_path / "values" / "fluent-bit.values.yaml"
    if not fluent_bit_path.exists():
        return []

    text = fluent_bit_path.read_text(encoding="utf-8")
    findings: list[Finding] = []
    required_snippets = {
        "fluent-bit-json-parser": "Name        noteverse_json",
        "fluent-bit-custom-parser-file": "Parsers_File /fluent-bit/etc/conf/custom_parsers.conf",
        "fluent-bit-kube-url-env": "Kube_URL            https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT}",
        "fluent-bit-merge-parser": "Merge_Parser        noteverse_json",
        "fluent-bit-loki-output": "Name        loki",
        "fluent-bit-loki-host-env": "Host        ${LOKI_SERVICE_HOST}",
        "fluent-bit-loki-port": "Port        3100",
        "fluent-bit-json-line-format": "Line_Format json",
        "fluent-bit-level-label": "Label_Keys  $level",
        "fluent-bit-kubernetes-labels": (
            "Labels      job=noteverse,namespace=$kubernetes['namespace_name'],"
            "container=$kubernetes['container_name']"
        ),
        "fluent-bit-disable-auto-kubernetes-labels": "Auto_Kubernetes_Labels Off",
    }
    for rule, snippet in required_snippets.items():
        if snippet not in text:
            findings.append(add_file_finding(fluent_bit_path, rule, f"missing required snippet: {snippet}"))

    if re.search(r"\bName\s+parser\b.*\bKey_Name\s+log\b", text, re.IGNORECASE | re.DOTALL):
        findings.append(
            add_file_finding(
                fluent_bit_path,
                "fluent-bit-parser-after-kubernetes-merge",
                "parse NoteVerse JSON through Kubernetes Merge_Parser, not a second log-field parser filter",
            )
        )

    labels_line = next((line.strip() for line in text.splitlines() if line.strip().startswith("Labels ")), "")
    if labels_line and "=" in labels_line:
        allowed_label_names = {"job", "namespace", "container"}
        label_names = {
            segment.split("=", 1)[0].strip()
            for segment in labels_line.removeprefix("Labels").split(",")
            if "=" in segment
        }
        unexpected = sorted(label_names.difference(allowed_label_names))
        if unexpected:
            findings.append(
                add_file_finding(
                    fluent_bit_path,
                    "unexpected-loki-label",
                    f"unexpected Loki labels: {', '.join(unexpected)}",
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
    findings.extend(validate_fluent_bit_values(args.target))
    findings.extend(validate_environment_object_storage(args.target))

    if findings:
        print_findings(findings)
        return 1

    print(f"Observability manifest check passed: {args.target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
