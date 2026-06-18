"""Check role-specific runtime dependencies."""

# ruff: noqa: E402 - bootstrap the backend import root before app imports.

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.core.runtime_checks import RuntimeRole, run_runtime_checks


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--role",
        choices=[role.value for role in RuntimeRole],
        default=RuntimeRole.ALL.value,
        help="process role to validate (default: all)",
    )
    parser.add_argument(
        "--include-sizes",
        action="store_true",
        help="recursively calculate model directory sizes for diagnostic output",
    )
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    role = RuntimeRole(args.role)
    results = await run_runtime_checks(role, include_sizes=args.include_sizes)
    for result in results:
        print(f"[{'OK' if result.ok else 'FAIL'}] {result.name}: {result.message}")
    return 1 if any(not result.ok for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
