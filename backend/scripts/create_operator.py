"""Create a local-password platform operator using hidden TTY input."""

from __future__ import annotations


import argparse
import getpass
import sys

from app.modules.platform_operators.domain import OperatorRole
from app.modules.ops.audit_service import OpsAuditService
from app.runtime.cli.settings import DatabaseCommandSettings
from app.platform.db.engine import build_engine, build_session_factory
from app.modules.platform_operators.management_service import (
    create_operator as create_operator_record,
)
from app.platform.security.passwords import validate_password


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="Unique operator email address.")
    parser.add_argument("--display-name", required=True, help="Operator display name.")
    parser.add_argument(
        "--role",
        default=OperatorRole.SUPER_ADMIN.value,
        choices=[role.value for role in OperatorRole],
        help="Explicit operator role to assign.",
    )
    return parser.parse_args()


def create_operator(args: argparse.Namespace, password: str) -> str:
    with build_session_factory(build_engine(DatabaseCommandSettings()))() as db:
        operator = create_operator_record(
            db,
            email=args.email,
            password=password,
            display_name=args.display_name,
            role=OperatorRole(args.role),
        )
        OpsAuditService().record_event(
            db,
            action="operator.bootstrap",
            target_type="operator",
            target_id=operator.operator_uuid,
            reason="Operator bootstrap command",
            metadata_json={
                "role": operator.role.value,
                "status": operator.status.value,
                "totp_enabled": False,
            },
            outcome="succeeded",
        )
        db.commit()
    return operator.operator_uuid


def main() -> int:
    if not sys.stdin.isatty():
        raise SystemExit(
            "A TTY is required; passwords are never accepted through arguments or stdin."
        )

    args = parse_args()
    password = getpass.getpass("Operator password: ")
    confirmation = getpass.getpass("Confirm operator password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    validate_password(password)

    operator_uuid = create_operator(args, password)
    print(f"Created operator {operator_uuid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
