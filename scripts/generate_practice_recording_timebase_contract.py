"""Generate the narrow RecordingTimebase structural contract using only stdlib."""

import argparse
import difflib
import json
import keyword
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "contracts/practice/recording-timebase.schema.json"
PY_PATH = "backend/app/modules/performance_takes/generated/recording_timebase_contract.py"
TS_PATH = "apps/customer-web/src/lib/practice/recording/generated/recording-timebase-contract.ts"
DRAFT = "https://json-schema.org/draft/2020-12/schema"
NOTICE = f"Generated from {SCHEMA}. Do not edit."


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate schema key: {key}")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError(f"Non-JSON schema number: {value}")


def load_schema(path):
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=unique_object,
        parse_constant=invalid_constant,
    )


def exact_keys(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f"Expected exact supported schema keywords: {sorted(keys)}")


def object_properties(value):
    exact_keys(value, {"type", "additionalProperties", "required", "properties"})
    if value["type"] != "object" or value["additionalProperties"] is not False:
        raise ValueError("Recording objects must forbid additionalProperties")
    properties, required = value["properties"], value["required"]
    if (
        not isinstance(properties, dict)
        or not properties
        or any(
            not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9]*", key) or keyword.iskeyword(key)
            for key in properties
        )
    ):
        raise ValueError("Recording fields must be non-empty identifiers")
    if (
        not isinstance(required, list)
        or any(not isinstance(key, str) for key in required)
        or len(required) != len(set(required))
        or set(required) != set(properties)
    ):
        raise ValueError("Every exact Recording field must be required once")
    return {name: properties[name] for name in required}


def validate(schema):
    exact_keys(
        schema,
        {
            "$schema",
            "$id",
            "title",
            "$defs",
            "type",
            "additionalProperties",
            "required",
            "properties",
        },
    )
    if schema["$schema"] != DRAFT:
        raise ValueError("RecordingTimebase requires JSON Schema Draft 2020-12")
    if (
        not isinstance(schema["$id"], str)
        or not schema["$id"]
        or schema["title"] != "RecordingTimebase"
    ):
        raise ValueError("RecordingTimebase requires its schema identity and title")
    definitions = schema["$defs"]
    exact_keys(definitions, {"RecordingCoordinate", "RecordingActiveSegment"})
    bounds = definitions["RecordingCoordinate"]
    exact_keys(bounds, {"type", "minimum", "maximum"})
    if (
        bounds["type"] != "integer"
        or type(bounds["minimum"]) is not int
        or bounds["minimum"] != 0
        or type(bounds["maximum"]) is not int
        or not 1 <= bounds["maximum"] <= 2**53 - 1
    ):
        raise ValueError("Recording coordinates require nonnegative JSON-safe integer bounds")

    def coordinate(value):
        if (
            not isinstance(value, dict)
            or not {"$ref"} <= set(value) <= {"$ref", "minimum"}
            or value["$ref"] != "#/$defs/RecordingCoordinate"
        ):
            raise ValueError(
                "Only RecordingCoordinate references with a minimum refinement are supported"
            )
        minimum = value.get("minimum", bounds["minimum"])
        if type(minimum) is not int or minimum not in (0, 1) or minimum > bounds["maximum"]:
            raise ValueError("Recording coordinate minimum must be zero or one")
        return minimum

    segments = object_properties(definitions["RecordingActiveSegment"])
    segment_bounds = {name: coordinate(value) for name, value in segments.items()}
    root = object_properties(
        {key: schema[key] for key in ["type", "additionalProperties", "required", "properties"]}
    )
    root_bounds = {}
    arrays = []
    for name, value in root.items():
        if isinstance(value, dict) and value.get("type") == "array":
            exact_keys(value, {"type", "minItems", "items"})
            exact_keys(value["items"], {"$ref"})
            if (
                type(value["minItems"]) is not int
                or value["minItems"] != 1
                or value["items"]["$ref"] != "#/$defs/RecordingActiveSegment"
            ):
                raise ValueError(
                    "Recording segments require a non-empty array of RecordingActiveSegment"
                )
            arrays.append(name)
        else:
            root_bounds[name] = coordinate(value)
    if len(arrays) != 1 or len(root_bounds) != 1 or len(segment_bounds) != 4:
        raise ValueError(
            "Recording contract requires one duration, one segment array and four segment coordinates"
        )
    return bounds["maximum"], segment_bounds, root_bounds, arrays[0]


def projections(schema):
    maximum, segment_bounds, root_bounds, array_name = validate(schema)
    root_names = schema["required"]
    min_items = schema["properties"][array_name]["minItems"]
    py = [
        f'"""{NOTICE}"""',
        "",
        "from typing import Generic, TypeVar",
        "from pydantic import BaseModel, ConfigDict, Field",
        "",
        f"MAX_RECORDING_COORDINATE = {maximum}",
        "",
        "",
        "class RecordingActiveSegmentStructure(BaseModel):",
        '    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)',
        "",
    ]
    for name, minimum in segment_bounds.items():
        lower = "gt=0" if minimum == 1 else "ge=0"
        py.append(f"    {name}: int = Field(strict=True, {lower}, le=MAX_RECORDING_COORDINATE)")
    py.extend(
        [
            "",
            "",
            'Segment = TypeVar("Segment", bound=RecordingActiveSegmentStructure)',
            "",
            "",
            "class RecordingTimebaseStructure(BaseModel, Generic[Segment]):",
            '    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)',
            "",
        ]
    )
    for name in root_names:
        if name == array_name:
            py.append(f"    {name}: tuple[Segment, ...] = Field(min_length={min_items})")
        else:
            lower = "gt=0" if root_bounds[name] == 1 else "ge=0"
            py.append(f"    {name}: int = Field(strict=True, {lower}, le=MAX_RECORDING_COORDINATE)")
    py.append("")
    ts = [
        f"// {NOTICE}",
        f"const MAX_RECORDING_COORDINATE = {maximum};",
        "",
        "export type RecordingActiveSegment = Readonly<{",
    ]
    ts.extend(f"  {name}: number;" for name in segment_bounds)
    ts.extend(["}>;", "", "export type RecordingTimebase = Readonly<{"])
    ts.extend(
        f"  {name}: {'readonly RecordingActiveSegment[]' if name == array_name else 'number'};"
        for name in root_names
    )
    ts.extend(
        """}>;

export function isRecordingCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_RECORDING_COORDINATE
  );
}

function exactObject(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  );
}

export function assertRecordingTimebaseStructure(
  value: unknown,
): asserts value is RecordingTimebase {""".splitlines()
    )
    checks = [f"!exactObject(value, {json.dumps(root_names)})"]
    for name, minimum in root_bounds.items():
        checks.append(f"!isRecordingCoordinate(value.{name})")
        if minimum:
            checks.append(f"value.{name} < {minimum}")
    checks.extend(
        [f"!Array.isArray(value.{array_name})", f"value.{array_name}.length < {min_items}"]
    )
    ts.append("  if (")
    ts.extend(
        "    " + check + (" ||" if index < len(checks) - 1 else "")
        for index, check in enumerate(checks)
    )
    ts.extend(["  )", '    throw new Error("recording_timebase_invalid");'])
    ts.append(f"  for (const segment of value.{array_name}) {{")
    ts.extend(["    if (", "      !exactObject(segment, ["])
    ts.extend(f"        {json.dumps(name)}," for name in segment_bounds)
    ts.append("      ]) ||")
    checks = []
    for name, minimum in segment_bounds.items():
        checks.append(f"!isRecordingCoordinate(segment.{name})")
        if minimum:
            checks.append(f"segment.{name} < {minimum}")
    ts.extend(
        "      " + check + (" ||" if index < len(checks) - 1 else "")
        for index, check in enumerate(checks)
    )
    ts.extend(
        ["    )", '      throw new Error("recording_timebase_invalid_segment");', "  }", "}", ""]
    )
    return {PY_PATH: "\n".join(py), TS_PATH: "\n".join(ts)}


def generate(root, *, check=False):
    outputs = projections(load_schema(root / SCHEMA))
    drift = False
    for name, expected in outputs.items():
        path = root / name
        if check:
            actual = path.read_text(encoding="utf-8") if path.exists() else ""
            if actual != expected:
                drift = True
                print(
                    "".join(
                        difflib.unified_diff(
                            actual.splitlines(keepends=True),
                            expected.splitlines(keepends=True),
                            fromfile=name,
                            tofile=f"{name} (generated)",
                        )
                    )
                )
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8", newline="\n")
    if drift:
        raise SystemExit("RecordingTimebase projections differ; run the generator")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    generate(ROOT, check=parser.parse_args().check)
    print("RecordingTimebase structural projections agree.")


if __name__ == "__main__":
    main()
