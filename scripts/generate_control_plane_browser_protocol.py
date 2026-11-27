"""Project fixed Control Plane browser identities (stdlib only)."""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = "contracts/http/control-plane-browser-protocol.json"
PYTHON = "backend/app/core/generated/control_plane_browser_protocol.py"
TYPESCRIPT = "apps/platform-admin/generated/browser-protocol.ts"
EXPORTS = {
    "api_prefix": "CONTROL_PLANE_API_PREFIX",
    "auth_cookie_name": "OPERATOR_AUTH_COOKIE_NAME",
    "secure_auth_cookie_name": "OPERATOR_SECURE_AUTH_COOKIE_NAME",
    "challenge_cookie_name": "OPERATOR_CHALLENGE_COOKIE_NAME",
    "secure_challenge_cookie_name": "OPERATOR_SECURE_CHALLENGE_COOKIE_NAME",
}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError(f"Non-JSON numeric constant: {value}")


def load_json(path):
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=unique_object,
        parse_constant=invalid_constant,
    )


def validate_protocol(protocol):
    if not isinstance(protocol, dict) or set(protocol) != set(EXPORTS):
        raise ValueError(
            "Control Plane browser protocol requires exactly its declared identity fields"
        )
    prefix = protocol["api_prefix"]
    if not isinstance(prefix, str) or not re.fullmatch(
        r"/[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*", prefix
    ):
        raise ValueError("api_prefix must be an absolute path prefix without a trailing slash")
    for key in EXPORTS.keys() - {"api_prefix"}:
        value = protocol[key]
        if not isinstance(value, str) or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", value):
            raise ValueError(f"{key} must be a nonempty HTTP token")
    if len({protocol[key] for key in EXPORTS if key.endswith("cookie_name")}) != 4:
        raise ValueError("Control Plane cookie identities must be distinct")


def projections(protocol):
    validate_protocol(protocol)
    py = [f'"""Generated from {PROTOCOL}. Do not edit."""', ""]
    ts = [f"// Generated from {PROTOCOL}. Do not edit."]
    for key, name in EXPORTS.items():
        literal = json.dumps(protocol[key], ensure_ascii=True)
        py.append(f"{name} = {literal}")
        ts.append(f"export const {name} = {literal} as const;")
    return {
        PYTHON: "\n".join(py) + "\n",
        TYPESCRIPT: "\n".join(ts) + "\n",
    }


def generate(root, *, check=False, target="all"):
    outputs = projections(load_json(root / PROTOCOL))
    stale = []
    for relative, content in outputs.items():
        if target == "backend" and not relative.startswith("backend/"):
            continue
        path = root / relative
        if check:
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                stale.append(relative)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    if stale:
        print("Stale Control Plane browser projections: " + ", ".join(stale))
        return 1
    print("Control Plane browser identity projections are current.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--target", choices=("all", "backend"), default="all")
    args = parser.parse_args()
    return generate(ROOT, check=args.check, target=args.target)


if __name__ == "__main__":
    raise SystemExit(main())
