"""RecordingTimebase generation projects structure and exact cross-field semantics."""

import copy
import importlib.util
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.performance_takes.generated.recording_timebase import (
    MAX_RECORDING_COORDINATE,
    RecordingActiveSegment,
    RecordingTimebase,
)

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "timebase_generator", ROOT / "scripts/generate_practice_recording_timebase.py"
)
assert spec and spec.loader
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
schema = generator.load_schema(ROOT / generator.SCHEMA)


def test_schema_projects_exactly_and_ignores_object_key_order():
    outputs = generator.projections(schema)
    for path, expected in outputs.items():
        assert (ROOT / path).read_text(encoding="utf-8") == expected

    def reordered(value):
        if isinstance(value, dict):
            return {key: reordered(item) for key, item in reversed(list(value.items()))}
        if isinstance(value, list):
            return [reordered(item) for item in value]
        return value

    assert generator.projections(reordered(schema)) == outputs
    assert MAX_RECORDING_COORDINATE == schema["$defs"]["RecordingCoordinate"]["maximum"]
    projection = RecordingTimebase.model_json_schema()
    assert set(projection["properties"]) == set(schema["properties"])
    assert projection["required"] == schema["required"]
    assert projection["additionalProperties"] is False
    for field, description in projection["$defs"]["RecordingActiveSegment"]["properties"].items():
        assert field in schema["$defs"]["RecordingActiveSegment"]["properties"]
        assert description["maximum"] == MAX_RECORDING_COORDINATE
        expected = schema["$defs"]["RecordingActiveSegment"]["properties"][field].get("minimum", 0)
        assert description.get("minimum", description.get("exclusiveMinimum", -1) + 1) == expected


@pytest.mark.parametrize(
    "path,bad",
    [
        (("$schema",), "https://json-schema.org/draft-07/schema"),
        (("additionalProperties",), True),
        (("required",), ["nominalMediaDurationUs"]),
        (("required",), ["nominalMediaDurationUs", "activeSegments", "activeSegments"]),
        (("properties", "activeSegments", "minItems"), 0),
        (("properties", "activeSegments", "minItems"), True),
        (("properties", "activeSegments", "items", "$ref"), "#/$defs/Other"),
        (("properties", "nominalMediaDurationUs", "minimum"), -1),
        (("properties", "nominalMediaDurationUs", "minimum"), 1.0),
        (("$defs", "RecordingCoordinate", "maximum"), 2**53),
        (("$defs", "RecordingCoordinate", "maximum"), -1),
        (("$defs", "RecordingCoordinate", "maximum"), True),
        (("$defs", "RecordingCoordinate", "maximum"), 1.5),
        (("$defs", "RecordingCoordinate", "minimum"), -1),
        (("$defs", "RecordingCoordinate", "type"), "number"),
        (("$defs", "RecordingActiveSegment", "additionalProperties"), True),
    ],
)
def test_generator_rejects_unsupported_schema_values(path, bad):
    changed = copy.deepcopy(schema)
    target = changed
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = bad
    with pytest.raises(ValueError):
        generator.projections(changed)


@pytest.mark.parametrize(
    "path",
    [
        (),
        ("$defs", "RecordingCoordinate"),
        ("$defs", "RecordingActiveSegment"),
        ("properties", "activeSegments"),
        ("properties", "activeSegments", "items"),
        ("properties", "nominalMediaDurationUs"),
    ],
)
def test_generator_rejects_unhandled_keywords_at_each_supported_schema_node(path):
    changed = copy.deepcopy(schema)
    target = changed
    for key in path:
        target = target[key]
    target["description"] = "unsupported keyword"
    with pytest.raises(ValueError):
        generator.projections(changed)


@pytest.mark.parametrize("key", ["required", "additionalProperties"])
def test_generator_requires_exact_object_declarations(key):
    changed = copy.deepcopy(schema)
    del changed["$defs"]["RecordingActiveSegment"][key]
    with pytest.raises(ValueError):
        generator.projections(changed)


@pytest.mark.parametrize(
    "text",
    [
        '{"$schema":1,"$schema":2}',
        '{"$defs":{"key":0,"key":1}}',
        '{"maximum":NaN}',
        '{"maximum":Infinity}',
        '{"maximum":-Infinity}',
    ],
)
def test_schema_parser_rejects_duplicate_keys_and_non_json_numbers(tmp_path, text):
    path = tmp_path / "schema.json"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ValueError):
        generator.load_schema(path)


@pytest.mark.parametrize("path", [generator.PY_PATH, generator.TS_PATH])
def test_generation_check_detects_drift_without_mutation(tmp_path, path, capsys):
    contract = tmp_path / generator.SCHEMA
    contract.parent.mkdir(parents=True)
    contract.write_text(json.dumps(schema), encoding="utf-8")
    before = set(tmp_path.rglob("*"))
    with pytest.raises(SystemExit):
        generator.generate(tmp_path, check=True)
    assert set(tmp_path.rglob("*")) == before
    generator.generate(tmp_path)
    generator.generate(tmp_path, check=True)
    output = tmp_path / path
    output.write_text("drift\n", encoding="utf-8")
    before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in tmp_path.rglob("*") if p.is_file()}
    with pytest.raises(SystemExit):
        generator.generate(tmp_path, check=True)
    assert before == {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}
    assert path in capsys.readouterr().out
    generator.generate(tmp_path)
    generator.generate(tmp_path, check=True)
    assert output.read_text(encoding="utf-8") == generator.projections(schema)[path]
    output.write_text("drift\n", encoding="utf-8")
    contract.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError):
        generator.generate(tmp_path)
    assert output.read_text(encoding="utf-8") == "drift\n"


@pytest.mark.parametrize(
    "bad", [None, [], True, "object", {}, {"nominalMediaDurationUs": 1, "activeSegments": []}]
)
def test_generated_model_rejects_non_recording_structures(bad):
    with pytest.raises(ValidationError):
        RecordingTimebase.model_validate(bad)


def test_generated_model_applies_exact_segment_rate():
    value = {
        "nominalMediaDurationUs": 2,
        "activeSegments": [
            {"performanceStartUs": 0, "performanceEndUs": 1, "mediaStartUs": 0, "mediaEndUs": 2}
        ],
    }
    with pytest.raises(ValidationError):
        RecordingTimebase.model_validate(value)


def test_declared_structural_bounds_project_into_both_runtimes():
    changed = copy.deepcopy(schema)
    changed["$defs"]["RecordingCoordinate"]["maximum"] = 1000
    outputs = generator.projections(changed)
    namespace = {"__name__": "generated_timebase_test"}
    exec(outputs[generator.PY_PATH], namespace)
    model = namespace["RecordingTimebase"]
    value = {
        "nominalMediaDurationUs": 1000,
        "activeSegments": [
            {
                "performanceStartUs": 0,
                "performanceEndUs": 1000,
                "mediaStartUs": 0,
                "mediaEndUs": 1000,
            }
        ],
    }
    assert model.model_validate(value).nominalMediaDurationUs == 1000
    value["nominalMediaDurationUs"] = 1001
    value["activeSegments"][0]["performanceEndUs"] = 1001
    value["activeSegments"][0]["mediaEndUs"] = 1001
    with pytest.raises(ValidationError):
        model.model_validate(value)
    assert "MAX_RECORDING_COORDINATE = 1000;" in outputs[generator.TS_PATH]
    assert generator.projections(changed) == outputs


def test_generated_segment_model_applies_semantics_without_a_timebase():
    with pytest.raises(ValidationError):
        RecordingActiveSegment(
            performanceStartUs=1, performanceEndUs=1, mediaStartUs=0, mediaEndUs=1
        )
