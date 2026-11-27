"""Generate strict transport projections from the Practice score JSON Schema (offline)."""

from __future__ import annotations

import argparse
import difflib
import json
import math
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "contracts/practice/score/artifact.schema.json"
NOTICE = "Generated from contracts/practice/score/artifact.schema.json. Do not edit."


def load_schema(path: Path = SCHEMA_PATH) -> dict[str, Any]:
    def exact_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate schema key: {key}")
            result[key] = value
        return result

    schema = json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=exact_object,
        parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)),
    )
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        raise ValueError("Practice score schema must declare Draft 2020-12")
    allowed = {
        "$schema",
        "$id",
        "$defs",
        "$ref",
        "title",
        "type",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "minItems",
        "uniqueItems",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "const",
        "enum",
        "minLength",
        "maxLength",
        "pattern",
    }

    def visit(node, stack=()):
        if not isinstance(node, dict) or set(node) - allowed:
            raise ValueError(f"Unsupported score schema node: {node}")
        resolved = resolve(schema, node, stack)
        kind = resolved.get("type")
        if kind not in {"object", "array", "string", "integer", "number"}:
            raise ValueError(f"Unsupported schema primitive: {kind}")
        common = {"$schema", "$id", "$defs", "title", "type"}
        keywords = {
            "object": {"properties", "required", "additionalProperties"},
            "array": {"items", "minItems", "uniqueItems"},
            "string": {"minLength", "maxLength", "pattern", "enum", "const"},
            "integer": {"minimum", "maximum", "exclusiveMinimum", "enum", "const"},
            "number": {"minimum", "maximum", "exclusiveMinimum", "enum", "const"},
        }
        if set(resolved) - common - keywords[kind]:
            raise ValueError(f"Unsupported {kind} schema keywords")
        if "const" in resolved or "enum" in resolved:
            if set(resolved) - {"title", "type", "const", "enum"}:
                raise ValueError(
                    "Constrained literals require an explicit projection implementation"
                )
            values = resolved.get("enum", [resolved.get("const")])
            primitive = {"integer": int, "number": float, "string": str}[kind]
            if not values or any(type(value) is not primitive for value in values):
                raise ValueError("Invalid typed literal")
        if resolved.get("maximum", float("inf")) < resolved.get("minimum", float("-inf")):
            raise ValueError("Inconsistent numerical bounds")
        if resolved.get("maxLength", float("inf")) < resolved.get("minLength", 0):
            raise ValueError("Inconsistent string bounds")
        if "uniqueItems" in resolved and type(resolved["uniqueItems"]) is not bool:
            raise ValueError("uniqueItems requires boolean")
        for key in ("minimum", "maximum", "exclusiveMinimum"):
            if key in resolved and (
                type(resolved[key]) not in (int, float) or not math.isfinite(resolved[key])
            ):
                raise ValueError(f"Invalid finite bound: {key}")
        for key in ("minItems", "minLength", "maxLength"):
            if key in resolved and (type(resolved[key]) is not int or resolved[key] < 0):
                raise ValueError(f"Invalid nonnegative bound: {key}")
        if kind == "object":
            props = resolved.get("properties", {})
            if (
                resolved.get("additionalProperties") is not False
                or not props
                or len(resolved.get("required", [])) != len(props)
                or set(resolved["required"]) != set(props)
            ):
                raise ValueError("Every artifact object requires exact fields")
            for child in props.values():
                visit(child)
        elif kind == "array":
            visit(resolved["items"])
            if resolved.get("uniqueItems") and resolve(schema, resolved["items"])["type"] not in {
                "string",
                "integer",
                "number",
            }:
                raise ValueError("Projection supports unique scalar arrays")
        if "pattern" in resolved:
            re.compile(resolved["pattern"])

    for node in schema["$defs"].values():
        visit(node)
    visit(schema)
    return schema


def resolve(schema, node, stack=()):
    if "$ref" not in node:
        return node
    reference = node["$ref"]
    if not reference.startswith("#/$defs/") or reference in stack:
        raise ValueError(f"Nonlocal or cyclic reference: {reference}")
    name = reference[len("#/$defs/") :]
    if name not in schema["$defs"]:
        raise ValueError(f"Unresolved reference: {reference}")
    base = resolve(schema, schema["$defs"][name], (*stack, reference))
    for key in ("minimum", "minItems", "minLength"):
        if key in node and key in base and node[key] < base[key]:
            raise ValueError("Reference constraint must narrow its base")
    for key in ("maximum", "maxLength"):
        if key in node and key in base and node[key] > base[key]:
            raise ValueError("Reference constraint must narrow its base")
    if set(node) - {"$ref", "minimum", "maximum", "minItems", "minLength", "maxLength"}:
        raise ValueError("Unsupported reference overlay")
    return {**base, **{k: v for k, v in node.items() if k != "$ref"}}


def constants(schema):
    tick = resolve(schema, schema["$defs"]["ScoreTick"])
    piano = resolve(schema, schema["$defs"]["PracticePianoKey"])
    return {
        "PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION": schema["properties"]["schemaVersion"]["const"],
        "MAX_JSON_SAFE_INTEGER": tick["maximum"],
        "PRACTICE_PIANO_KEY_MIN": piano["minimum"],
        "PRACTICE_PIANO_KEY_MAX": piano["maximum"],
    }


def python_models(schema):
    output = [
        f'"""{NOTICE}"""',
        "from __future__ import annotations",
        "from typing import Annotated, Literal",
        "from pydantic import BaseModel, ConfigDict, Field, field_validator",
        "",
        "class ArtifactTransportModel(BaseModel):",
        '    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)',
        "",
    ]
    emitted = set()

    def field_type(node):
        value = resolve(schema, node)
        kind = value["type"]
        if kind == "object":
            emit(value)
            return value["title"]
        if "const" in value:
            return f"Literal[{value['const']!r}]"
        if "enum" in value:
            return "Literal[" + ", ".join(repr(v) for v in value["enum"]) + "]"
        base = {"integer": "int", "number": "float", "string": "str"}.get(kind)
        if kind == "array":
            base = f"list[{field_type(value['items'])}]"
        args = []
        for source, target in [
            ("minimum", "ge"),
            ("maximum", "le"),
            ("exclusiveMinimum", "gt"),
            ("minLength", "min_length"),
            ("maxLength", "max_length"),
            ("minItems", "min_length"),
            ("pattern", "pattern"),
        ]:
            if source in value:
                args.append(f"{target}={value[source]!r}")
        if value.get("uniqueItems"):
            args.append('json_schema_extra={"uniqueItems": True}')
        return f"Annotated[{base}, Field({', '.join(args)})]" if args else base

    def emit(node):
        name = node["title"]
        if name in emitted:
            return
        fields = [
            (key, field_type(value), resolve(schema, value))
            for key, value in sorted(node["properties"].items())
        ]
        emitted.add(name)
        output.extend(
            [
                f"class {name}(ArtifactTransportModel):",
                *[f"    {key}: {typ}" for key, typ, _ in fields],
            ]
        )
        for key, _, value in fields:
            if value.get("uniqueItems"):
                output.extend(
                    [
                        "",
                        f'    @field_validator("{key}")',
                        "    @classmethod",
                        f"    def unique_{key}(cls, value: list[str]) -> list[str]:",
                        "        if len(value) != len(set(value)):",
                        '            raise ValueError("Duplicate array value")',
                        "        return value",
                    ]
                )
            if "const" in value:
                primitive = {"integer": "int", "number": "float", "string": "str"}[value["type"]]
                output.extend(
                    [
                        "",
                        f'    @field_validator("{key}", mode="before")',
                        "    @classmethod",
                        f"    def strict_{key}(cls, value: object) -> object:",
                        f"        if type(value) is not {primitive}:",
                        '            raise ValueError("Wrong constant primitive type")',
                        "        return value",
                    ]
                )
        output.append("")

    emit(schema)
    return "\n".join(output).rstrip() + "\n"


TS_VALIDATOR = r"""
type SchemaNode = {
  $ref?: string; type?: string; const?: unknown; enum?: readonly unknown[];
  properties?: Readonly<Record<string, SchemaNode>>; required?: readonly string[];
  additionalProperties?: boolean; items?: SchemaNode; minItems?: number; uniqueItems?: boolean;
  minimum?: number; maximum?: number; exclusiveMinimum?: number;
  minLength?: number; maxLength?: number; pattern?: string;
};
export class PracticeScoreStructureError extends Error {
  readonly code = 'practice_score_invalid';
}
function reject(path: string): never {
  throw new PracticeScoreStructureError(`Invalid PracticeScoreArtifact structure at ${path}`);
}
function validate(node: SchemaNode, value: unknown, path: string): void {
  if (node.$ref) {
    const name = node.$ref.slice('#/$defs/'.length);
    const definitions: Readonly<Record<string, SchemaNode>> = schema.$defs;
    const { $ref: reference, ...constraints } = node;
    void reference;
    validate({ ...definitions[name], ...constraints }, value, path);
    return;
  }
  if ('const' in node && value !== node.const) reject(path);
  if (node.enum && !node.enum.includes(value)) reject(path);
  switch (node.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) reject(path);
      const row = value as Record<string, unknown>, properties = node.properties!;
      if (node.required!.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !Object.hasOwn(properties, key))) reject(path);
      for (const [key, child] of Object.entries(properties)) validate(child, row[key], `${path}.${key}`);
      break;
    }
    case 'array':
      if (!Array.isArray(value) || value.length < (node.minItems ?? 0)) reject(path);
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) reject(path);
        validate(node.items!, value[i], `${path}[${i}]`);
      }
      if (node.uniqueItems && new Set(value).size !== value.length) reject(path);
      break;
    case 'string':
      if (typeof value !== 'string' || [...value].length < (node.minLength ?? 0) ||
          node.maxLength !== undefined && [...value].length > node.maxLength ||
          node.pattern !== undefined && !new RegExp(node.pattern).test(value)) reject(path);
      break;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) ||
          node.type === 'integer' && !Number.isSafeInteger(value) ||
          node.minimum !== undefined && value < node.minimum ||
          node.maximum !== undefined && value > node.maximum ||
          node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) reject(path);
      break;
  }
}
/** Structural admission only; preserves the exact caller object without repair or freezing. */
export function decodePracticeScoreArtifact(value: unknown): PracticeScoreArtifact {
  validate(schema, value, '$');
  return value as PracticeScoreArtifact;
}
"""


def typescript(schema):
    lines = [f"// {NOTICE}"]
    lines += [
        f"export const {name} = {value} as const;" for name, value in constants(schema).items()
    ]

    def typ(node):
        value = resolve(schema, node)
        if value["type"] == "object":
            return next(
                (key for key, definition in schema["$defs"].items() if definition == value),
                "PracticeScoreArtifact",
            )
        if "const" in value:
            return json.dumps(value["const"])
        if "enum" in value:
            return " | ".join(json.dumps(v) for v in value["enum"])
        if value["type"] == "array":
            return f"({typ(value['items'])})[]"
        return "string" if value["type"] == "string" else "number"

    for name, node in [*sorted(schema["$defs"].items()), ("PracticeScoreArtifact", schema)]:
        if node.get("type") != "object":
            continue
        lines += [
            f"export type {name} = {{",
            *[f"  {key}: {typ(value)};" for key, value in sorted(node["properties"].items())],
            "};",
        ]
    lines += [
        "const schema = "
        + json.dumps(schema, ensure_ascii=False, sort_keys=True, indent=2)
        + " as const;",
        TS_VALIDATOR,
    ]
    return "\n".join(lines).rstrip() + "\n"


def projections(schema):
    notice = f'"""{NOTICE}"""\n\n'
    return {
        "backend/app/modules/practice/score/generated/contract.py": notice
        + "".join(f"{key} = {value}\n" for key, value in constants(schema).items()),
        "backend/app/modules/practice/score/generated/artifact_transport.py": python_models(schema),
        "apps/customer-web/src/lib/practice/contracts/generated/score-artifact.ts": typescript(
            schema
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for name, content in projections(load_schema()).items():
        path = ROOT / name
        if args.check:
            current = path.read_text(encoding="utf-8") if path.exists() else ""
            if current != content:
                diff = "".join(
                    difflib.unified_diff(
                        current.splitlines(True),
                        content.splitlines(True),
                        fromfile=name,
                        tofile="generated",
                    )
                )
                raise SystemExit("Practice score projection drift:\n" + diff)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    print("Practice score transport projections agree.")


if __name__ == "__main__":
    main()
