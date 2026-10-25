"""Check repository documentation locations and work-tracking filenames."""

from __future__ import annotations

import argparse
from pathlib import Path


PROHIBITED_DIRECTORIES = (
    "docs/archive",
    "docs/engineering/plans",
    "docs/engineering/reviews",
    "docs/operations/plans",
)
WORK_TRACKING_SUFFIXES = (
    "-plan.md",
    "-roadmap.md",
    "-audit.md",
    "-ledger.md",
    "-legacy-inventory.md",
)


def find_violations(root: Path) -> list[str]:
    """Return structural violations without interpreting document prose."""
    docs = root / "docs"
    if not docs.is_dir():
        return ["docs/: documentation root is missing"]
    violations = [
        f"{name}/: use current references; track implementation work in GitHub Issues"
        for name in PROHIBITED_DIRECTORIES
        if (root / name).exists()
    ]
    for path in docs.rglob("*"):
        if path.is_file() and path.name.lower().endswith(WORK_TRACKING_SUFFIXES):
            violations.append(
                f"{path.relative_to(root).as_posix()}: work-tracking filename"
            )
    return sorted(violations)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[1]
    )
    args = parser.parse_args()
    violations = find_violations(args.root)
    if violations:
        print("Documentation structure failed:")
        for violation in violations:
            print(f"- {violation}")
        return 1
    print("Documentation structure OK: current references and accepted decisions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
