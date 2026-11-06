"""The canonical machine configuration and selected evidence produce both runtimes."""

import copy
import json
import re
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "acoustic_contract_generator", ROOT / "scripts/generate_practice_acoustic_contract.py"
)
assert spec and spec.loader
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
runtime = generator.load_json(ROOT / generator.CONTRACT_DIRECTORY / "runtime-contract.json")
evidence = generator.load_json(ROOT / generator.CONTRACT_DIRECTORY / "evidence-attestation.json")


def test_current_contract_evidence_and_generated_projections_agree():
    generator.validate(runtime, evidence)
    for name, content in generator.projections(runtime, evidence).items():
        assert (ROOT / name).read_text(encoding="utf-8") == content
    assert generator.projections(runtime, evidence) == generator.projections(
        copy.deepcopy(runtime), copy.deepcopy(evidence)
    )


def test_browser_projection_contains_only_product_runtime_exports():
    ts = generator.projections(runtime, evidence)[
        "apps/customer-web/src/lib/practice/acoustic/generated/runtime-contract.ts"
    ]
    assert set(re.findall(r"^export const (\w+) =", ts, re.MULTILINE)) == {
        "ACOUSTIC_RUNTIME_CONTRACT",
        "ACOUSTIC_ANALYSIS_IDENTITY",
        "SOURCE_ADAPTER_CONTRACTS",
        "ACOUSTIC_MODEL_ASSET_DESCRIPTOR",
        "ACOUSTIC_TARGET_SAMPLES_PER_MS",
    }
    for source in evidence["sourceFiles"].values():
        for field in ["path", "sha256", "scope"]:
            assert source[field] not in ts


def test_generated_identity_label_derives_from_the_deployed_asset():
    from app.modules.model_assets.generated.practice_acoustic_contract import ANALYSIS_IDENTITY

    assert ANALYSIS_IDENTITY["identityName"] == (
        f"{runtime['model']['assetId']}@{runtime['model']['assetVersion']}"
    )


@pytest.mark.parametrize(
    "surface",
    [
        (),
        ("model",),
        ("runtime",),
        ("input",),
        ("outputs", 0),
        ("decoder",),
        ("window",),
        ("sourceAdapters", "44100"),
        ("sourceAdapters", "48000", "coefficientAsset"),
    ],
)
def test_unclassified_configuration_fields_fail_closed(surface):
    value = copy.deepcopy(runtime)
    target = value
    for field in surface:
        target = target[field]
    target["unclassified"] = 1
    with pytest.raises(ValueError):
        generator.validate(value, evidence)


@pytest.mark.parametrize(
    "path, changed",
    [
        (("model", "mediaType"), "image/png"),
        (("runtime", "automaticFallback"), True),
        (("runtime", "executionProvider"), "wasm"),
        (("runtime", "packageVersion"), "0.0.0"),
        (("input", "shape"), [1, 0]),
        (("outputs", 0, "shape"), [1, 2, 88]),
        (("decoder", "onsetThreshold"), float("nan")),
        (("decoder", "frameThreshold"), True),
        (("window", "ownedSamples"), 999999),
        (("sourceAdapters", "44100", "down"), 1),
        (("sourceAdapters", "48000", "coefficientAsset", "sha256"), "0" * 64),
    ],
)
def test_runtime_relationships_and_exact_assets_are_required(path, changed):
    value = copy.deepcopy(runtime)
    target = value
    for field in path[:-1]:
        target = target[field]
    target[path[-1]] = changed
    with pytest.raises(ValueError):
        generator.validate(value, evidence)


@pytest.mark.parametrize(
    "field, changed",
    [("byteSize", 1), ("sha256", "0" * 64), ("normalization", "trim"), ("path", "../outside.ts")],
)
def test_selected_source_evidence_requires_exact_current_bytes(field, changed):
    value = copy.deepcopy(evidence)
    value["sourceFiles"]["decoder"][field] = changed
    with pytest.raises(ValueError):
        generator.validate(runtime, value)


def test_missing_or_unclassified_evidence_and_duplicate_json_fields_are_rejected(tmp_path):
    value = copy.deepcopy(evidence)
    value["sourceFiles"]["decoder"]["runtimeThreshold"] = 0.3
    with pytest.raises(ValueError):
        generator.validate(runtime, value)
    value = copy.deepcopy(evidence)
    value["coefficientAssets"] = []
    with pytest.raises(ValueError):
        generator.validate(runtime, value)
    source = tmp_path / "contract.json"
    source.write_text('{"schemaVersion":1,"schemaVersion":2}')
    with pytest.raises(ValueError):
        generator.load_json(source)


def test_canonical_key_order_does_not_change_generated_values_or_digests():
    reordered = json.loads(json.dumps(runtime, sort_keys=True))
    assert generator.digest(runtime) == generator.digest(reordered)
    assert generator.projections(runtime, evidence) == generator.projections(reordered, evidence)
