"""Export or verify the non-secret runtime deployment contract."""

import argparse
import json
from pathlib import Path
from app.runtime.deployment import deployment_snapshot

DESTINATION = Path(__file__).resolve().parents[1] / "docs/contracts/runtime-deployment.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(deployment_snapshot(), indent=2, sort_keys=True) + "\n"
    if args.check:
        if DESTINATION.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Runtime deployment contract is stale")
    else:
        DESTINATION.write_text(rendered, encoding="utf-8")
    print("Runtime deployment contract is current")


if __name__ == "__main__":
    main()
