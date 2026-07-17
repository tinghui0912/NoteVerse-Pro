"""Render NoteVerse observability Helm releases locally.

This script does not install anything into the cluster. It renders Helm
manifests so chart/value compatibility can be checked before an operator runs
`helm upgrade --install`.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
VALUES_DIR = REPO_ROOT / "deploy" / "observability" / "values"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "tmp" / "observability-rendered"


@dataclass(frozen=True, slots=True)
class Release:
    name: str
    chart: str
    values_file: Path


RELEASES: tuple[Release, ...] = (
    Release("loki", "grafana/loki", VALUES_DIR / "loki.values.yaml"),
    Release("fluent-bit", "fluent/fluent-bit", VALUES_DIR / "fluent-bit.values.yaml"),
    Release(
        "kube-prometheus-stack",
        "prometheus-community/kube-prometheus-stack",
        VALUES_DIR / "kube-prometheus-stack.values.yaml",
    ),
    Release("tempo", "grafana/tempo", VALUES_DIR / "tempo.values.yaml"),
    Release(
        "otel-collector",
        "open-telemetry/opentelemetry-collector",
        VALUES_DIR / "otel-collector.values.yaml",
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--namespace",
        default="observability",
        help="Kubernetes namespace used for Helm rendering.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where rendered manifests are written.",
    )
    parser.add_argument(
        "--release",
        action="append",
        choices=[release.name for release in RELEASES],
        help="Release to render. Can be repeated. Defaults to all releases.",
    )
    return parser.parse_args()


def require_helm() -> None:
    if shutil.which("helm") is None:
        raise RuntimeError("helm is required but was not found on PATH")


def selected_releases(names: list[str] | None) -> list[Release]:
    if not names:
        return list(RELEASES)
    wanted = set(names)
    return [release for release in RELEASES if release.name in wanted]


def render_release(release: Release, namespace: str, output_dir: Path) -> Path:
    if not release.values_file.exists():
        raise RuntimeError(f"missing values file: {release.values_file.relative_to(REPO_ROOT)}")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{release.name}.yaml"
    command = [
        "helm",
        "template",
        release.name,
        release.chart,
        "--namespace",
        namespace,
        "-f",
        str(release.values_file),
    ]
    result = subprocess.run(command, cwd=REPO_ROOT, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"helm template failed for {release.name}\n"
            f"chart: {release.chart}\n"
            f"stderr:\n{result.stderr.strip()}"
        )

    output_path.write_text(result.stdout, encoding="utf-8")
    return output_path


def main() -> int:
    args = parse_args()
    try:
        require_helm()
        rendered = [
            render_release(release, args.namespace, args.output_dir)
            for release in selected_releases(args.release)
        ]
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    for path in rendered:
        print(path.relative_to(REPO_ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
