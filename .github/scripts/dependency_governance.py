"""Require explicit, reviewable registration of application npm overrides."""

import argparse
import json
from pathlib import Path
import sys


MANIFESTS = (
    "apps/customer-web/package.json",
    "apps/platform-admin/package.json",
)
REGISTRY = ".github/dependency-exceptions.json"
REQUIRED_TEXT = ("requested_version", "category", "reason", "exit_condition", "review_trigger")
CATEGORIES = {"security", "compatibility", "ecosystem", "other"}


class GovernanceError(ValueError):
    """Malformed policy inputs must fail closed."""


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise GovernanceError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise GovernanceError(f"Cannot read {path}: {error}") from error


def text(value):
    return isinstance(value, str) and bool(value.strip()) and value == value.strip()


def flatten_overrides(overrides):
    """Return canonical tuple paths; npm's '.' overrides its enclosing package."""
    result = {}

    def walk(value, path):
        if isinstance(value, str):
            if not text(value) or not path:
                raise GovernanceError(f"Invalid override version at {path}")
            if path in result:
                raise GovernanceError(f"Duplicate override selector: {path}")
            result[path] = value
            return
        if not isinstance(value, dict) or (path and not value):
            raise GovernanceError(f"Override must be a version string or nonempty object: {path}")
        if any(not text(key) for key in value):
            raise GovernanceError(f"Invalid override selector at {path}")
        for key in sorted(value):
            if key == ".":
                if not path or not isinstance(value[key], str):
                    raise GovernanceError("A '.' override must be a nested self-version string")
                walk(value[key], path)
            else:
                walk(value[key], path + (key,))

    if not isinstance(overrides, dict):
        raise GovernanceError("Top-level overrides must be an object")
    walk(overrides, ())
    return dict(sorted(result.items()))


def validate(manifests, registry):
    if not isinstance(registry, dict) or type(registry.get("schema_version")) is not int or registry["schema_version"] != 1:
        raise GovernanceError("Registry schema_version must be 1")
    if not isinstance(registry.get("exceptions"), list):
        raise GovernanceError("Registry exceptions must be an array")
    live = {}
    for name in MANIFESTS:
        manifest = manifests.get(name)
        if not isinstance(manifest, dict):
            raise GovernanceError(f"Missing or invalid targeted manifest: {name}")
        for selector, version in flatten_overrides(manifest.get("overrides", {})).items():
            live[name, selector] = version
    registered = {}
    for record in registry["exceptions"]:
        if not isinstance(record, dict):
            raise GovernanceError("Each exception must be an object")
        manifest, selector = record.get("manifest"), record.get("selector")
        if manifest not in MANIFESTS:
            raise GovernanceError(f"Exception targets an unsupported manifest: {manifest}")
        if not isinstance(selector, list) or not selector or any(not text(s) or s == "." for s in selector):
            raise GovernanceError("Exception selector must be a nonempty canonical string array")
        key = manifest, tuple(selector)
        if key in registered:
            raise GovernanceError(f"Duplicate exception selector: {key}")
        for field in REQUIRED_TEXT:
            if not text(record.get(field)):
                raise GovernanceError(f"Exception {key} requires nonempty {field}")
        if record["category"] not in CATEGORIES:
            raise GovernanceError(f"Unknown exception category: {record['category']}")
        evidence = record.get("evidence")
        if not isinstance(evidence, list) or not evidence or any(not text(item) for item in evidence):
            raise GovernanceError(f"Exception {key} requires nonempty evidence")
        registered[key] = record["requested_version"]
    errors = []
    for key in sorted(live.keys() | registered.keys()):
        label = f"{key[0]}: {' > '.join(key[1])}"
        if key not in registered:
            errors.append(f"Unregistered override: {label}")
        elif key not in live:
            errors.append(f"Obsolete exception: {label}")
        elif live[key] != registered[key]:
            errors.append(f"Version mismatch: {label}: manifest={live[key]}, registry={registered[key]}")
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    try:
        registry = load_json(args.root / REGISTRY)
        manifests = {name: load_json(args.root / name) for name in MANIFESTS}
        errors = validate(manifests, registry)
        if errors:
            raise GovernanceError("\n".join(errors))
    except GovernanceError as error:
        print(f"Dependency override governance failed: {error}", file=sys.stderr)
        return 1
    print(f"Dependency override governance passed: {len(registry['exceptions'])} registered exception(s) across {len(MANIFESTS)} manifests.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
