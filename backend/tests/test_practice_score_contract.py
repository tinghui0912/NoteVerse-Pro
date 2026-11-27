"""Shared structural conformance and deterministic generated score projections."""

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import pytest
from app.modules.practice.score.generated.artifact_transport import PracticeScoreArtifactRead

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "contracts/practice/score/artifact-transport-cases.json").read_text())


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda case: case["name"])
def test_shared_artifact_transport_case(case):
    value = deepcopy(CASES["base"])
    for edit in case["edits"]:
        owner = value
        for key in edit["path"][:-1]:
            owner = owner[key]
        key = edit["path"][-1]
        if edit.get("remove"):
            del owner[key]
        else:
            owner[key] = deepcopy(edit["value"])
    before = deepcopy(value)
    if case["valid"]:
        assert PracticeScoreArtifactRead.model_validate(value).model_dump() == value
        assert (
            PracticeScoreArtifactRead.model_validate_json(json.dumps(value)).model_dump() == value
        )
    else:
        with pytest.raises(ValueError):
            PracticeScoreArtifactRead.model_validate(value)
        with pytest.raises(ValueError):
            PracticeScoreArtifactRead.model_validate_json(json.dumps(value))
    assert value == before


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_runtime_nonfinite_structure(value):
    for section, field in [("scoreTempoSegments", "bpm"), ("events", "onsetTick")]:
        artifact = deepcopy(CASES["base"])
        artifact[section][0][field] = value
        with pytest.raises(ValueError):
            PracticeScoreArtifactRead.model_validate(artifact)


@pytest.mark.parametrize("value", [True, 1.0, "1"])
def test_strict_integer_primitive(value):
    artifact = deepcopy(CASES["base"])
    artifact["ticksPerQuarter"] = value
    with pytest.raises(ValueError):
        PracticeScoreArtifactRead.model_validate(artifact)


def generator():
    spec = importlib.util.spec_from_file_location(
        "score_contract_generator", ROOT / "scripts/generate_practice_score_contract.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_generated_projections_are_exact_and_key_order_independent():
    module = generator()
    schema = module.load_schema()
    for name, content in module.projections(schema).items():
        assert (ROOT / name).read_text() == content
    ordered = json.loads(json.dumps(schema, sort_keys=True))
    assert module.projections(ordered) == module.projections(schema)
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/generate_practice_score_contract.py"), "--check"],
        check=True,
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "additionalProperties",
        "unknown_keyword",
        "unresolved_ref",
        "wrong_constraint_kind",
        "weakened_reference",
    ],
)
def test_generator_rejects_unsupported_or_ambiguous_schema(tmp_path, mutation):
    module = generator()
    schema = module.load_schema()
    if mutation == "additionalProperties":
        schema["additionalProperties"] = True
    elif mutation == "unknown_keyword":
        schema["properties"]["artifactId"]["coerce"] = True
    elif mutation == "unresolved_ref":
        schema["properties"]["notes"]["items"]["$ref"] = "#/$defs/Missing"
    elif mutation == "wrong_constraint_kind":
        schema["properties"]["notes"]["minimum"] = 1
    else:
        schema["$defs"]["TicksPerQuarter"]["minimum"] = -1
    path = tmp_path / "schema.json"
    path.write_text(json.dumps(schema))
    with pytest.raises(ValueError):
        module.load_schema(path)


def test_generator_check_reports_drift(tmp_path):
    import shutil

    script = tmp_path / "scripts/generate_practice_score_contract.py"
    script.parent.mkdir()
    shutil.copyfile(ROOT / "scripts/generate_practice_score_contract.py", script)
    schema = tmp_path / "contracts/practice/score/artifact.schema.json"
    schema.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / "contracts/practice/score/artifact.schema.json", schema)
    subprocess.run([sys.executable, str(script)], check=True)
    path = tmp_path / "backend/app/modules/practice/score/generated/contract.py"
    path.write_text(path.read_text() + "# drift\n")
    result = subprocess.run(
        [sys.executable, str(script), "--check"], text=True, capture_output=True
    )
    assert (
        result.returncode != 0
        and "projection drift" in result.stderr
        and "contract.py" in result.stderr
    )


def test_generated_pydantic_schema_preserves_canonical_structure_constraints():
    canonical = generator().load_schema()
    generated = PracticeScoreArtifactRead.model_json_schema()

    def normalize(node, root):
        if "$ref" in node:
            name = node["$ref"].split("/")[-1]
            node = {**root["$defs"][name], **{k: v for k, v in node.items() if k != "$ref"}}
            return normalize(node, root)
        ignored = {"title", "$id", "$schema", "$defs"}
        return {
            key: (
                sorted(value)
                if key == "required"
                else {name: normalize(child, root) for name, child in value.items()}
                if key == "properties"
                else normalize(value, root)
                if key == "items"
                else value
            )
            for key, value in node.items()
            if key not in ignored
        }

    assert normalize(generated, generated) == normalize(canonical, canonical)
