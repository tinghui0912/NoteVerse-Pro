"""Offline projections of the bounded recipient realtime JSON Schema contract."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "contracts/realtime/events.schema.json"
PYTHON = "backend/app/modules/realtime/generated/transport.py"
PYTHON_VOCABULARY = "backend/app/shared/realtime.py"
TYPESCRIPT = "apps/customer-web/src/lib/realtime/generated/events.ts"


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate key: {key}")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError(f"Invalid JSON number: {value}")


def load_schema(root):
    schema = json.loads(
        (root / SOURCE).read_text(encoding="utf-8"),
        object_pairs_hook=unique_object,
        parse_constant=invalid_constant,
    )
    if (
        set(schema) != {"$schema", "$id", "title", "$defs", "oneOf"}
        or schema["$schema"] != "https://json-schema.org/draft/2020-12/schema"
    ):
        raise ValueError("Expected the realtime Draft 2020-12 event union")
    definitions = schema["$defs"]
    if schema["oneOf"] != [{"$ref": "#/$defs/" + name} for name in definitions]:
        raise ValueError("Every event definition must belong to the union")
    events = []
    for name, definition in definitions.items():
        if not name.isidentifier() or set(definition) != {
            "type",
            "additionalProperties",
            "properties",
            "required",
            "x-sse-event",
        }:
            raise ValueError("Unsupported realtime object definition")
        properties = definition["properties"]
        if (
            definition["type"] != "object"
            or definition["additionalProperties"] is not False
            or definition["required"] != list(properties)
        ):
            raise ValueError("Realtime objects require exact, required properties")
        if properties.get("schemaVersion") != {"type": "integer", "const": 1}:
            raise ValueError("Realtime schemaVersion must be exactly 1")
        event = definition["x-sse-event"]
        if event not in ("checkpoint", "resync-required", "change"):
            raise ValueError("Unsupported SSE event")
        expected = {"schemaVersion", "sequence"}
        if event == "resync-required":
            expected.add("reason")
        if event == "change":
            expected |= {"kind", "changeId", "createdAt"}
            kind = properties.get("kind", {}).get("const")
            if not isinstance(kind, str) or not all(
                part.replace("_", "").isalpha() for part in kind.split(".")
            ):
                raise ValueError("Invalid change kind")
        if not expected <= properties.keys():
            raise ValueError("Event identity fields are incomplete")
        for field, rule in properties.items():
            if not field.isidentifier() or set(rule) - {
                "type",
                "const",
                "enum",
                "minimum",
                "maximum",
                "minLength",
                "format",
                "pattern",
            }:
                raise ValueError("Unsupported realtime field rule")
            if rule.get("type") not in ("integer", "string", ["string", "null"]):
                raise ValueError("Unsupported realtime field type")
            if rule.get("format") not in (None, "date-time"):
                raise ValueError("Unsupported format")
        sequence = properties["sequence"]
        if sequence != {
            "type": "integer",
            "minimum": 1 if event == "change" else 0,
            "maximum": 9007199254740991,
        }:
            raise ValueError("Sequence must be a safe cursor in its event domain")
        events.append((name, definition))
    if len([1 for _, d in events if d["x-sse-event"] == "change"]) != 5 or sorted(
        d["x-sse-event"] for _, d in events if d["x-sse-event"] != "change"
    ) != ["checkpoint", "resync-required"]:
        raise ValueError("Expected five change variants and two stream controls")
    kinds = [d["properties"]["kind"]["const"] for _, d in events if d["x-sse-event"] == "change"]
    if len(set(kinds)) != len(kinds):
        raise ValueError("Change kinds must be unique")
    return events


def projections(events):
    patterns = {
        rule["pattern"]
        for _, definition in events
        for rule in definition["properties"].values()
        if rule.get("format") == "date-time"
    }
    if len(patterns) != 1:
        raise ValueError("Realtime date-times require one explicit-offset wire pattern")
    py = [
        '"""Generated from contracts/realtime/events.schema.json. Do not edit."""',
        "",
        "from datetime import datetime",
        "import re",
        "from typing import Annotated, Any, Literal",
        "from pydantic import BeforeValidator, ConfigDict, Field, TypeAdapter, field_validator",
        "from app.shared.api_model import ApiModel",
        "from app.shared.time import Instant",
    ]
    vocabulary = [
        '"""Generated from contracts/realtime/events.schema.json. Do not edit."""',
        "",
        "from enum import StrEnum",
        "",
        "",
        "class RealtimeChangeKind(StrEnum):",
    ]
    changes = []
    for name, d in events:
        if d["x-sse-event"] == "change":
            kind = d["properties"]["kind"]["const"]
            vocabulary.append(f"    {kind.upper().replace('.', '_')} = {json.dumps(kind)}")
            changes.append(name)
    py += [
        "",
        "",
        "_DATETIME_PATTERN = " + json.dumps(next(iter(patterns))),
        "",
        "",
        "def _date_time(value: Any) -> Any:",
        "    if isinstance(value, str):",
        "        if re.fullmatch(_DATETIME_PATTERN, value) is None:",
        '            raise ValueError("createdAt must be an RFC3339 aware instant")',
        '        return datetime.fromisoformat(value.upper().replace("Z", "+00:00"))',
        "    return value",
        "",
        "",
        "class _RealtimeEvent(ApiModel):",
        '    model_config = ConfigDict(extra="forbid", strict=True)',
        "",
        '    @field_validator("schemaVersion", mode="before", check_fields=False)',
        "    @classmethod",
        "    def integer_version(cls, value: Any) -> Any:",
        "        if type(value) is not int:",
        '            raise ValueError("schemaVersion must be an integer")',
        "        return value",
    ]
    ts = ["// Generated from contracts/realtime/events.schema.json. Do not edit.", ""]
    for name, d in events:
        py += ["", "", f"class {name}Read(_RealtimeEvent):"]
        export = "" if d["x-sse-event"] == "change" else "export "
        ts += [f"{export}type {name} = {{"]
        for field, rule in d["properties"].items():
            if "const" in rule:
                annotation = f"Literal[{json.dumps(rule['const'])}]"
                ts_type = json.dumps(rule["const"])
            elif "enum" in rule:
                annotation = "Literal[" + ", ".join(json.dumps(v) for v in rule["enum"]) + "]"
                ts_type = " | ".join(json.dumps(v) for v in rule["enum"])
            elif rule.get("format") == "date-time":
                annotation, ts_type = "Annotated[Instant, BeforeValidator(_date_time)]", "string"
            else:
                annotation, ts_type = {
                    "integer": ("int", "number"),
                    "string": ("str", "string"),
                }.get(str(rule["type"]), ("str | None", "string | null"))
            constraints = {"minimum": "ge", "maximum": "le", "minLength": "min_length"}
            args = [f"{target}={rule[key]!r}" for key, target in constraints.items() if key in rule]
            if "pattern" in rule and rule.get("format") != "date-time":
                args.append("pattern=" + json.dumps(rule["pattern"]))
            if (
                rule.get("type") in ("integer", "string")
                and "const" not in rule
                and "enum" not in rule
                and rule.get("format") != "date-time"
            ):
                args.append("strict=True")
            py.append(
                f"    {field}: {annotation}" + (" = Field(" + ", ".join(args) + ")" if args else "")
            )
            ts.append(f"  {field}: {ts_type};")
        ts += ["};", ""]
    py += [
        "",
        "",
        "RealtimeChangeRead = Annotated[",
        *[
            "    " + ("| " if i else "") + n + "Read" + ("," if i == len(changes) - 1 else "")
            for i, n in enumerate(changes)
        ],
        '    Field(discriminator="kind"),',
        "]",
        "change_read_adapter: TypeAdapter[RealtimeChangeRead] = TypeAdapter(RealtimeChangeRead)",
        "",
        "ResyncReason = "
        + "Literal["
        + ", ".join(
            json.dumps(x)
            for _, d in events
            if d["x-sse-event"] == "resync-required"
            for x in d["properties"]["reason"]["enum"]
        )
        + "]",
        "",
    ]
    ts += [
        "export type RealtimeChange = " + " | ".join(changes) + ";",
        "",
        "const definitions = "
        + json.dumps({name: {"properties": d["properties"]} for name, d in events}, indent=2)
        + " as const;",
        "",
    ]
    ts.append(TS_DECODER)
    for name, d in events:
        function = {
            "change": None,
            "checkpoint": "parseRealtimeCheckpoint",
            "resync-required": "parseRealtimeResyncRequired",
        }[d["x-sse-event"]]
        if function:
            ts += [
                f"export function {function}(data: string): {name} | null {{",
                f"  return decode(data, ['{name}']) as {name} | null;",
                "}",
                "",
            ]
    ts += [
        "export function parseRealtimeChange(data: string): RealtimeChange | null {",
        "  return decode(data, " + json.dumps(changes) + ") as RealtimeChange | null;",
        "}",
        "",
    ]
    return {
        PYTHON: "\n".join(py),
        PYTHON_VOCABULARY: "\n".join(vocabulary) + "\n",
        TYPESCRIPT: "\n".join(ts),
    }


TS_DECODER = r"""
type Rule = { type: string | readonly string[]; const?: string | number; enum?: readonly string[]; minimum?: number; maximum?: number; minLength?: number; format?: string; pattern?: string };
function matches(value: unknown, rule: Rule): boolean {
  if (value === null) return Array.isArray(rule.type) && rule.type.includes('null');
  if (rule.const !== undefined && value !== rule.const) return false;
  if (rule.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value) && value >= (rule.minimum ?? -Infinity) && value <= (rule.maximum ?? Infinity);
  if (typeof value !== 'string' || value.length < (rule.minLength ?? 0)) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.pattern && !new RegExp(rule.pattern).test(value)) return false;
  if (rule.format === 'date-time') {
    if (!Number.isFinite(Date.parse(value))) return false;
    const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-Tt:]/).map(Number);
    const date = new Date(0); date.setUTCFullYear(year, month - 1, day);
    if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return false;
  }
  return true;
}
function decode(data: string, names: readonly (keyof typeof definitions)[]): unknown {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const object = value as Record<string, unknown>;
    for (const name of names) {
      const properties = definitions[name].properties;
      if (Object.keys(object).length !== Object.keys(properties).length) continue;
      if (Object.entries(properties).every(([key, rule]) => Object.hasOwn(object, key) && matches(object[key], rule))) return object;
    }
    return null;
  } catch { return null; }
}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        outputs = projections(load_schema(args.root))
        stale = []
        for relative, content in outputs.items():
            path = args.root / relative
            if args.check:
                if not path.exists() or path.read_text(encoding="utf-8") != content:
                    stale.append(relative)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
        if stale:
            raise ValueError("Stale realtime projections: " + ", ".join(stale))
    except (ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Realtime contract error: {error}\n")
    print(
        "Realtime event projections are current."
        if args.check
        else "Generated realtime event projections."
    )


if __name__ == "__main__":
    main()
