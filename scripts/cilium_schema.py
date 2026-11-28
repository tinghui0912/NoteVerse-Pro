"""Offline validation against the pinned official Cilium v2 structural schema."""

from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import hashlib
import json
from pathlib import Path

import unicodedata

from jsonschema import Draft7Validator, ValidationError, validators

SCHEMA = (
    Path(__file__).resolve().parents[1]
    / "deploy/platform/cilium/schemas/ciliumnetworkpolicies-v1.20.5.json"
)
SCHEMA_SHA256 = "8a93660773d331cbcef604fdee3a415bbd696f5a908fb7c0a9e5e653c3d59101"


def strict_objects(schema):
    """Reject fields the Kubernetes structural schema would otherwise prune."""
    if isinstance(schema, dict):
        if schema.get("type") == "object" and "properties" in schema:
            schema.setdefault("additionalProperties", False)
        for value in schema.values():
            strict_objects(value)
    elif isinstance(schema, list):
        for value in schema:
            strict_objects(value)


def re2_pattern(validator, pattern, instance, schema):
    if pattern == r"^\PC*$" and isinstance(instance, str):
        if any(unicodedata.category(c).startswith("C") for c in instance):
            yield ValidationError("Cilium log values require printable Unicode characters")
    else:
        yield from Draft7Validator.VALIDATORS["pattern"](validator, pattern, instance, schema)


@lru_cache(maxsize=1)
def validator():
    data = SCHEMA.read_bytes().replace(b"\r\n", b"\n")
    if hashlib.sha256(data).hexdigest() != SCHEMA_SHA256:
        raise ValueError("Pinned Cilium schema digest mismatch")
    schema = deepcopy(json.loads(data))
    strict_objects(schema)
    Draft7Validator.check_schema(schema, format_checker=None)
    return validators.extend(Draft7Validator, {"pattern": re2_pattern})(schema)


def validate_cilium_documents(documents: list[dict]) -> list[str]:
    errors = []
    for document in documents:
        if document.get("kind") != "CiliumNetworkPolicy":
            continue
        name = document.get("metadata", {}).get("name", "unknown")
        if "specs" in document or "spec" not in document:
            errors.append(f"{name}: managed Cilium policies require exactly one spec")
        if document.get("apiVersion") != "cilium.io/v2":
            errors.append(f"{name}: Cilium requires cilium.io/v2")
        for error in validator().iter_errors(document):
            errors.append(f"{name}: Cilium CRD schema at {error.json_path}: {error.message}")
    return errors
