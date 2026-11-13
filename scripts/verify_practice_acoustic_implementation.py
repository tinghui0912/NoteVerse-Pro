"""Verify selected acoustic implementation bytes for repository engineering evidence."""

import hashlib
import json
from pathlib import Path, PurePosixPath
import re

ROOT = Path(__file__).resolve().parents[1]
ATTESTATION = (
    "apps/customer-web/tests/attestations/practice-acoustic/implementation-attestation.json"
)


def exact_fields(value: object, names: str) -> dict:
    if not isinstance(value, dict) or set(value) != set(names.split()):
        raise ValueError(f"Expected exactly these attestation fields: {names}")
    return value


def load_attestation(path: Path) -> dict:
    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError(f"Duplicate attestation field: {key}")
            value[key] = item
        return value

    def invalid_constant(value):
        raise ValueError(f"Non-JSON attestation number: {value}")

    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=unique_pairs,
        parse_constant=invalid_constant,
    )


def normalized_source_bytes(raw: bytes) -> bytes:
    return raw.decode("utf-8").replace("\r\n", "\n").encode("utf-8")


def source_file(root: Path, name: object) -> Path:
    if not isinstance(name, str) or not name:
        raise ValueError("Expected a repository source path")
    relative = PurePosixPath(name)
    path = (root / name).resolve()
    if (
        relative.is_absolute()
        or relative.as_posix() != name
        or ".." in relative.parts
        or "\\" in name
        or ":" in name
        or relative.suffix != ".ts"
        or not path.is_relative_to(root.resolve())
        or not path.is_file()
    ):
        raise ValueError(f"Not a repository TypeScript source: {name}")
    return path


def validate(attestation: dict, root: Path = ROOT) -> None:
    exact_fields(attestation, "schemaVersion scope sourceFiles")
    if type(attestation["schemaVersion"]) is not int or attestation["schemaVersion"] != 1:
        raise ValueError("Unsupported implementation attestation schema")
    scopes = [attestation["scope"]]
    sources = exact_fields(
        attestation["sourceFiles"],
        "sourceAnalysis sourcePublication decoder windowPlanner sourceAdapter",
    )
    paths = set()
    for entry in sources.values():
        exact_fields(entry, "path byteSize sha256 normalization scope")
        scopes.append(entry["scope"])
        if (
            type(entry["byteSize"]) is not int
            or entry["byteSize"] <= 0
            or not isinstance(entry["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])
            or entry["normalization"] != "UTF8_CRLF_TO_LF"
        ):
            raise ValueError("Invalid implementation source attestation")
        path = source_file(root, entry["path"])
        if path in paths:
            raise ValueError("Duplicate attested source path")
        paths.add(path)
        raw = normalized_source_bytes(path.read_bytes())
        if len(raw) != entry["byteSize"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError(f"Source attestation mismatch: {entry['path']}")
    if any(not isinstance(scope, str) or not scope.strip() for scope in scopes):
        raise ValueError("Expected an explicit implementation evidence scope")


def verify(root: Path = ROOT) -> None:
    validate(load_attestation(root / ATTESTATION), root)


if __name__ == "__main__":
    verify()
    print("Practice acoustic implementation attestation agrees with repository sources.")
