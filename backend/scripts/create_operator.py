"""Create a local-password platform operator using hidden TTY input."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from app.db.models import OperatorRole
from app.db.session import AsyncSessionLocal
from app.modules.platform_operators.service import operator_authentication_service


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", required=True, help="Unique local operator login name.")
    parser.add_argument("--display-name", required=True, help="Operator display name.")
    parser.add_argument(
        "--role",
        default=OperatorRole.PLATFORM_OPERATOR.value,
        choices=[role.value for role in OperatorRole],
        help="Explicit operator role to assign.",
    )
    return parser.parse_args()


async def create_operator(args: argparse.Namespace, password: str) -> str:
    async with AsyncSessionLocal() as db:
        operator = await operator_authentication_service.create_local_operator(
            db,
            username=args.username,
            password=password,
            display_name=args.display_name,
            role=OperatorRole(args.role),
        )
    return operator.operator_uuid


def main() -> int:
    if not sys.stdin.isatty():
        raise SystemExit("A TTY is required; passwords are never accepted through arguments or stdin.")

    args = parse_args()
    password = getpass.getpass("Operator password: ")
    confirmation = getpass.getpass("Confirm operator password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    if len(password) < 12:
        raise SystemExit("Operator passwords must contain at least 12 characters.")

    operator_uuid = asyncio.run(create_operator(args, password))
    print(f"Created operator {operator_uuid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
