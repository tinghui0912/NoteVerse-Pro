"""Inspect or repair one user's usage projection. Output contains no object locators."""

import argparse
import json
from dataclasses import asdict

from app.db.session import SessionLocal
from app.composition.storage_inventory import build_storage_inventory_registry
from app.modules.storage_governance.usage.reconciliation import StorageUsageReconciliation
from app.composition.storage_resources import storage_usage_service


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["inspect", "repair"])
    parser.add_argument("user_id", type=int)
    args = parser.parse_args()
    reconciliation = StorageUsageReconciliation(
        build_storage_inventory_registry(), storage_usage_service
    )
    with SessionLocal() as db:
        result = (
            reconciliation.reconcile_user
            if args.command == "repair"
            else reconciliation.inspect_user
        )(db, args.user_id)
        if args.command == "repair":
            db.commit()
        print(
            json.dumps(
                {**asdict(result), "drift": result.drift},
                default=lambda value: value.value,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
