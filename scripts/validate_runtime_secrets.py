#!/usr/bin/env python3
"""Validate a single runtime credential file or Kubernetes Secret without displaying values."""

import argparse
import base64
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

CONTRACT = Path(__file__).resolve().parents[1] / "backend/docs/contracts/runtime-deployment.json"


def validate_values(runtime: str, values: dict[str, str]) -> None:
    contract = json.loads(CONTRACT.read_text())[runtime]
    if set(values) != set(contract["secret_keys"]):
        raise ValueError("Credential keys must exactly match the runtime contract")
    if contract["database_role"]:
        for key in ("DATABASE_URL", "SCHEDULER_LOCK_DATABASE_URL"):
            if key in values:
                url = urlparse(values[key])
                if url.scheme != "postgresql+psycopg" or url.username != contract["database_role"]:
                    raise ValueError("Database credentials must use the runtime's explicit role")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--env-file", type=Path)
    source.add_argument("--stdin-secret", action="store_true")
    args = parser.parse_args()
    try:
        if args.stdin_secret:
            secret = json.load(sys.stdin)
            contract = json.loads(CONTRACT.read_text())[args.runtime]
            if secret["metadata"]["name"] != contract["secret_name"]:
                raise ValueError("Unexpected Secret identity")
            values = {
                key: base64.b64decode(value, validate=True).decode()
                for key, value in secret.get("data", {}).items()
            }
            values.update(secret.get("stringData", {}))
        else:
            values = {}
            for line in args.env_file.read_text(encoding="utf-8-sig").splitlines():
                if line.strip() and not line.lstrip().startswith("#"):
                    key, value = line.split("=", 1)
                    if key in values:
                        raise ValueError("Duplicate credential key")
                    values[key] = value
        validate_values(args.runtime, values)
    except (ValueError, KeyError, OSError, TypeError):
        print(
            "Runtime credential contract validation failed; values are not displayed",
            file=sys.stderr,
        )
        return 1
    print("Runtime credential contract validated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
