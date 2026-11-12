"""One authored original Recording policy projects into both runtime adapters."""

import ast
import copy
import importlib.util
import json
from pathlib import Path

import pytest

from app.db.models.performance_take_manifest import PerformanceTakeMediaKind
from app.modules.performance_takes.generated.recording_media_policy import CAPTURE_CONTAINERS
from app.modules.performance_takes.recording_media_policy import (
    capture_extension,
    is_supported_capture_mime,
    normalize_capture_mime,
    verify_capture_container_signature,
)
from tests.support.recording_media import SIGNATURE_HEADERS

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "recording_policy_generator", ROOT / "scripts/generate_practice_recording_media_policy.py"
)
assert spec and spec.loader
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
policy = generator.load_policy(ROOT / generator.CONTRACT)


def test_canonical_policy_has_exact_stable_immutable_projections():
    expected = generator.projections(policy)
    for path, content in expected.items():
        assert (ROOT / path).read_text(encoding="utf-8") == content
    assert generator.projections(dict(reversed(list(policy.items())))) == expected
    assert {row.kind for row in CAPTURE_CONTAINERS} == {
        kind.value for kind in PerformanceTakeMediaKind
    }
    with pytest.raises(AttributeError):
        CAPTURE_CONTAINERS[0].mime_type = "audio/other"


@pytest.mark.parametrize("descriptor", CAPTURE_CONTAINERS, ids=lambda row: row.mime_type)
def test_each_policy_container_normalizes_admits_extends_and_verifies_exact_family(descriptor):
    actual_mime = f" {descriptor.mime_type.upper()} ;codecs=browser-selected"
    assert normalize_capture_mime(actual_mime) == descriptor.mime_type
    assert is_supported_capture_mime(descriptor.kind, actual_mime)
    assert capture_extension(descriptor.kind, actual_mime) == descriptor.extension
    valid = SIGNATURE_HEADERS[descriptor.signature]
    assert verify_capture_container_signature(descriptor.kind, actual_mime, valid)
    for invalid in (b"", b"not a recording", valid[:3]):
        assert not verify_capture_container_signature(descriptor.kind, actual_mime, invalid)
    other_kind = "VIDEO" if descriptor.kind == "AUDIO" else "AUDIO"
    assert not is_supported_capture_mime(other_kind, actual_mime)
    assert not verify_capture_container_signature(other_kind, actual_mime, valid)
    with pytest.raises(ValueError):
        capture_extension(other_kind, actual_mime)


def test_alias_free_normalization_and_unknown_extension_fail_closed():
    assert normalize_capture_mime(" VIDEO/MP4 ;codecs=avc1") == "video/mp4"
    assert normalize_capture_mime("audio/x-wav;codecs=browser") == "audio/x-wav"
    assert capture_extension("AUDIO", "audio/x-wav") == "wav"
    assert not verify_capture_container_signature("VIDEO", "video/mp4", b"ftypwrong-position")
    assert not verify_capture_container_signature("AUDIO", "audio/wav", b"RIFF\0\0\0\0NOPE")
    for kind, mime in [
        ("VIDEO", "video/quicktime"),
        ("AUDIO", "audio/unknown"),
        ("OTHER", "audio/webm"),
        ("AUDIO", ""),
    ]:
        assert not is_supported_capture_mime(kind, mime)
        assert not verify_capture_container_signature(kind, mime, b"\x1a\x45\xdf\xa3")
        with pytest.raises(ValueError):
            capture_extension(kind, mime)


@pytest.mark.parametrize(
    "path,value",
    [
        ((), []),
        (("schemaVersion",), True),
        (("schemaVersion",), 2),
        (("captureContainers",), []),
        (("captureContainers",), {}),
        (("captureContainers", 0, "kind"), "IMAGE"),
        (("captureContainers", 0, "mimeType"), "audio/webm;codecs=opus"),
        (("captureContainers", 0, "mimeType"), " AUDIO/WEBM "),
        (("captureContainers", 0, "mimeType"), "video/webm"),
        (("captureContainers", 0, "extension"), "../webm"),
        (("captureContainers", 0, "extension"), "WEBM"),
        (("captureContainers", 0, "extension"), ""),
        (("captureContainers", 0, "signature"), "CODEC"),
        (("videoRecorderCandidates",), []),
        (("videoRecorderCandidates",), "video/webm"),
        (("videoRecorderCandidates",), ["video/webm", "video/webm"]),
        (("videoRecorderCandidates",), ["audio/webm;codecs=opus"]),
        (("videoRecorderCandidates",), ["video/quicktime"]),
    ],
)
def test_malformed_policy_is_rejected_before_projection(path, value):
    changed = copy.deepcopy(policy)
    if not path:
        changed = value
    else:
        parent = changed
        for field in path[:-1]:
            parent = parent[field]
        parent[path[-1]] = value
    with pytest.raises(ValueError):
        generator.projections(changed)


def test_exact_fields_and_unique_mimes_are_required():
    for target in [(), ("captureContainers", 0)]:
        changed = copy.deepcopy(policy)
        parent = changed
        for key in target:
            parent = parent[key]
        parent["unexpected"] = True
        with pytest.raises(ValueError):
            generator.validate(changed)
    changed = copy.deepcopy(policy)
    changed["captureContainers"].append(changed["captureContainers"][0])
    with pytest.raises(ValueError, match="Duplicate capture MIME"):
        generator.validate(changed)


@pytest.mark.parametrize(
    "text",
    [
        '{"schemaVersion":1,"schemaVersion":1}',
        '{"captureContainers":[{"kind":"AUDIO","kind":"VIDEO"}]}',
        '{"schemaVersion":NaN}',
        '{"schemaVersion":Infinity}',
    ],
)
def test_duplicate_keys_and_non_json_numbers_are_rejected(tmp_path, text):
    source = tmp_path / "policy.json"
    source.write_text(text, encoding="utf-8")
    with pytest.raises(ValueError):
        generator.load_policy(source)


def test_candidate_order_is_preserved():
    changed = copy.deepcopy(policy)
    changed["videoRecorderCandidates"].reverse()
    generated = generator.projections(changed)
    assert generated != generator.projections(policy)
    source = generated[generator.TS_PATH].split("export const VIDEO_CAPTURE_MIME_CANDIDATES =", 1)[
        1
    ]
    positions = [
        source.index(json.dumps(candidate)) for candidate in changed["videoRecorderCandidates"]
    ]
    assert positions == sorted(positions)


@pytest.mark.parametrize("path", list(generator.projections(policy)))
def test_check_detects_drift_without_writing_and_normal_generation_repairs(tmp_path, path):
    contract = tmp_path / generator.CONTRACT
    contract.parent.mkdir(parents=True)
    contract.write_text(json.dumps(policy), encoding="utf-8")
    generator.generate(tmp_path)
    generator.generate(tmp_path, check=True)
    stale = tmp_path / path
    stale.write_text("stale projection\n", encoding="utf-8")
    before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in tmp_path.rglob("*") if p.is_file()}
    with pytest.raises(SystemExit, match="projections differ"):
        generator.generate(tmp_path, check=True)
    assert before == {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}
    generator.generate(tmp_path)
    generator.generate(tmp_path, check=True)
    contract.write_text('{"schemaVersion":2}', encoding="utf-8")
    before = stale.read_bytes()
    with pytest.raises(ValueError):
        generator.generate(tmp_path)
    assert stale.read_bytes() == before


def test_manifest_upload_and_delivery_depend_on_the_policy_adapter():
    for name in ["manifest.py", "service.py", "upload_reservation/service.py"]:
        tree = ast.parse(
            (ROOT / "backend/app/modules/performance_takes" / name).read_text(encoding="utf-8")
        )
        assert any(
            isinstance(node, ast.ImportFrom)
            and node.module
            in {"recording_media_policy", "app.modules.performance_takes.recording_media_policy"}
            for node in ast.walk(tree)
        )
        assert not any(
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and node.value.startswith(("audio/", "video/"))
            for node in ast.walk(tree)
        )


def test_check_on_missing_outputs_does_not_create_projection_directories(tmp_path):
    contract = tmp_path / generator.CONTRACT
    contract.parent.mkdir(parents=True)
    contract.write_text(json.dumps(policy), encoding="utf-8")
    before = sorted(path.relative_to(tmp_path) for path in tmp_path.rglob("*"))
    with pytest.raises(SystemExit, match="projections differ"):
        generator.generate(tmp_path, check=True)
    assert sorted(path.relative_to(tmp_path) for path in tmp_path.rglob("*")) == before
