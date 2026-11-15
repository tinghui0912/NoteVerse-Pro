"""Exact realtime payloads and deterministic language projections share one schema."""

import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import pytest
from pydantic import ValidationError
from sqlalchemy import CheckConstraint

from app.db.models import RealtimeChange
from app.modules.realtime.generated import transport

ROOT = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
spec = importlib.util.spec_from_file_location(
    "realtime_generator", ROOT / "scripts/generate_realtime_contract.py"
)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def test_current_language_projections_match_the_machine_schema():
    events = generator.load_schema(ROOT)
    outputs = generator.projections(events)
    assert outputs == generator.projections(generator.load_schema(ROOT))
    for relative, content in outputs.items():
        assert (ROOT / relative).read_text(encoding="utf-8") == content
    kinds = {d["properties"]["kind"]["const"] for _, d in events if d["x-sse-event"] == "change"}
    assert {kind.value for kind in transport.RealtimeChangeKind} == kinds
    assert set(RealtimeChange.__table__.c.kind.type.enums) == kinds
    identity_check = next(
        c
        for c in RealtimeChange.__table__.constraints
        if isinstance(c, CheckConstraint) and c.name == "ck_realtime_changes_identity"
    )
    assert set(re.findall(r"'([^']+)'", str(identity_check.sqltext))) == kinds


@pytest.mark.parametrize("name,definition", generator.load_schema(ROOT))
def test_each_generated_python_payload_matches_its_exact_schema(name, definition):
    values = {}
    for field, rule in definition["properties"].items():
        if "const" in rule:
            values[field] = rule["const"]
        elif "enum" in rule:
            values[field] = rule["enum"][0]
        elif rule["type"] == "integer":
            values[field] = rule["minimum"]
        elif rule.get("format") == "date-time":
            values[field] = "2026-11-15T18:00:00+08:00"
        elif isinstance(rule["type"], list):
            values[field] = None
        else:
            values[field] = "identity"
    model = getattr(transport, name + "Read")
    payload = model.model_validate_json(json.dumps(values))
    assert payload.sequence == values["sequence"]
    if definition["x-sse-event"] == "change":
        assert transport.change_read_adapter.validate_json(json.dumps(values)) == payload
        assert payload.createdAt.utcoffset().total_seconds() == 0
        with pytest.raises(ValidationError):
            model.model_validate_json(json.dumps({**values, "createdAt": "2026-11-15T10:00:00"}))
        with pytest.raises(ValidationError):
            model.model_validate_json(json.dumps({**values, "createdAt": "2026-11-15 10:00:00Z"}))
        with pytest.raises(ValidationError):
            model.model_validate_json(
                json.dumps({**values, "createdAt": "2026-11-15T10:00:00+08:60"})
            )
    for invalid in (
        {**values, "private": "detail"},
        {**values, "schemaVersion": True},
        {**values, "sequence": -1},
        {**values, "sequence": 1.5},
    ):
        with pytest.raises(ValidationError):
            model.model_validate_json(json.dumps(invalid))


def run_generator(root, *args):
    return subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/generate_realtime_contract.py"),
            "--root",
            str(root),
            *args,
        ],
        capture_output=True,
        text=True,
    )


def test_generation_checks_missing_and_stale_outputs_without_mutating_them(tmp_path):
    source = tmp_path / generator.SOURCE
    source.parent.mkdir(parents=True)
    source.write_text((ROOT / generator.SOURCE).read_text(encoding="utf-8"), encoding="utf-8")
    assert run_generator(tmp_path, "--check").returncode == 1
    assert not (tmp_path / generator.PYTHON).exists()
    assert run_generator(tmp_path).returncode == 0
    before = {
        path: (tmp_path / path).read_bytes() for path in (generator.PYTHON, generator.TYPESCRIPT)
    }
    assert run_generator(tmp_path).returncode == 0
    assert before == {path: (tmp_path / path).read_bytes() for path in before}
    assert run_generator(tmp_path, "--check").returncode == 0
    output = tmp_path / generator.TYPESCRIPT
    output.write_text("drift", encoding="utf-8")
    assert run_generator(tmp_path, "--check").returncode == 1
    assert output.read_text() == "drift"


@pytest.mark.parametrize(
    "source", ['{"title": 1, "title": 2}', '{"value": NaN}', '{"value": Infinity}']
)
def test_contract_loading_rejects_ambiguous_json(tmp_path, source):
    path = tmp_path / generator.SOURCE
    path.parent.mkdir(parents=True)
    path.write_text(source, encoding="utf-8")
    with pytest.raises(ValueError):
        generator.load_schema(tmp_path)


def test_generation_reports_schema_rules_outside_its_supported_projection(tmp_path):
    schema = json.loads((ROOT / generator.SOURCE).read_text(encoding="utf-8"))
    schema["$defs"]["RealtimeCheckpoint"]["properties"]["sequence"]["multipleOf"] = 2
    path = tmp_path / generator.SOURCE
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(schema), encoding="utf-8")
    assert run_generator(tmp_path).returncode == 1
    assert not (tmp_path / generator.TYPESCRIPT).exists()
