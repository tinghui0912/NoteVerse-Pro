"""Export or verify the committed Practice WebSocket JSON Schema contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.processing.realtime.protocol import (  # noqa: E402
    PRACTICE_WEBSOCKET_PROTOCOL_VERSION,
    practice_client_message_adapter,
    practice_server_message_adapter,
)


DESTINATION = BACKEND_ROOT / "docs" / "contracts" / "realtime" / "practice-websocket-v1.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the committed contract differs from the Pydantic source",
    )
    return parser.parse_args()


def build_contract() -> dict[str, Any]:
    """Build the stable, reviewable transport contract from source-owned models."""

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://noteverse.local/contracts/realtime/practice-websocket-v1.json",
        "title": "NoteVerse Practice WebSocket Protocol v1",
        "description": (
            "Versioned JSON control and server-event frames for Practice WebSocket sessions. "
            "Binary PCM frames use the REST-negotiated session audio format."
        ),
        "protocol_version": PRACTICE_WEBSOCKET_PROTOCOL_VERSION,
        "compatibility": {
            "within_version": "additive_only",
            "breaking_change": "new_protocol_version",
            "legacy_fallback": "forbidden",
        },
        "client_messages": practice_client_message_adapter.json_schema(),
        "server_messages": practice_server_message_adapter.json_schema(),
    }


def render_contract() -> str:
    return json.dumps(build_contract(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    args = parse_args()
    rendered = render_contract()
    if args.check:
        if not DESTINATION.exists():
            print(f"Missing committed contract: {DESTINATION}", file=sys.stderr)
            return 1
        if DESTINATION.read_text(encoding="utf-8") != rendered:
            print(
                "Practice WebSocket contract is stale. "
                "Run backend/scripts/export_realtime_protocol.py and commit the result.",
                file=sys.stderr,
            )
            return 1
        print(f"Practice WebSocket contract is current: {DESTINATION.relative_to(BACKEND_ROOT)}")
        return 0

    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(rendered, encoding="utf-8")
    print(f"Wrote Practice WebSocket contract: {DESTINATION.relative_to(BACKEND_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
