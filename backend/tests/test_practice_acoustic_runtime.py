"""Configured runtime semantics produce browser identity and Backend model delivery facts."""

import copy
import json
import re
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "acoustic_runtime_generator", ROOT / "scripts/generate_practice_acoustic_runtime.py"
)
assert spec and spec.loader
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
runtime = generator.load_json(ROOT / generator.CONTRACT_DIRECTORY / "runtime-contract.json")


def test_current_runtime_and_generated_projections_agree():
    generator.validate(runtime)
    for name, content in generator.projections(runtime).items():
        assert (ROOT / name).read_text(encoding="utf-8") == content
    assert generator.projections(runtime) == generator.projections(copy.deepcopy(runtime))


def test_browser_projection_contains_only_product_runtime_exports():
    ts = generator.projections(runtime)[
        "apps/customer-web/src/lib/practice/acoustic/generated/runtime-contract.ts"
    ]
    assert set(re.findall(r"^export const (\w+) =", ts, re.MULTILINE)) == {
        "ACOUSTIC_RUNTIME_CONTRACT",
        "ACOUSTIC_ANALYSIS_IDENTITY",
        "SOURCE_ADAPTER_CONTRACTS",
        "ACOUSTIC_MODEL_ASSET_DESCRIPTOR",
        "ACOUSTIC_TARGET_SAMPLES_PER_MS",
    }
    assert set(generator.analysis_identity(runtime)) == {"identityName", "analysisIdentitySha256"}
    assert generator.analysis_identity(runtime)["identityName"] == (
        f"{runtime['model']['assetId']}@{runtime['model']['assetVersion']}"
    )
    from app.modules.model_assets.generated.practice_acoustic_model_asset import (
        MODEL_ASSET_DESCRIPTOR,
    )

    assert dict(MODEL_ASSET_DESCRIPTOR) == {
        "schemaVersion": runtime["schemaVersion"],
        "assetId": runtime["model"]["assetId"],
        "assetVersion": runtime["model"]["assetVersion"],
        "expectedByteSize": runtime["model"]["byteSize"],
        "sha256": runtime["model"]["sha256"],
        "mediaType": runtime["model"]["mediaType"],
    }


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
        generator.validate(value)


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
        generator.validate(value)


def test_canonical_key_order_does_not_change_generated_values_or_digests():
    reordered = json.loads(json.dumps(runtime, sort_keys=True))
    assert generator.digest(runtime) == generator.digest(reordered)
    assert generator.projections(runtime) == generator.projections(reordered)


def test_decoder_configuration_changes_only_analysis_identity():
    changed = copy.deepcopy(runtime)
    changed["decoder"]["onsetThreshold"] = 0.31
    generator.validate(changed)
    assert generator.analysis_identity(changed)["analysisIdentitySha256"] != generator.digest(
        runtime
    )
    assert generator.source_adapter_contracts(changed) == generator.source_adapter_contracts(
        runtime
    )
    before, after = generator.projections(runtime), generator.projections(changed)
    python_path = "backend/app/modules/model_assets/generated/practice_acoustic_model_asset.py"
    assert before[python_path] == after[python_path]


def test_adapter_byte_identity_changes_only_its_rate_identity_and_analysis():
    changed = copy.deepcopy(runtime)
    changed["sourceAdapters"]["44100"]["coefficientAsset"]["sha256"] = "a" * 64
    assert generator.analysis_identity(changed) != generator.analysis_identity(runtime)
    before, after = (
        generator.source_adapter_contracts(runtime),
        generator.source_adapter_contracts(changed),
    )
    assert before["44100"]["identitySha256"] != after["44100"]["identitySha256"]
    assert before["48000"] == after["48000"]
    for adapter in before.values():
        identity = adapter.pop("identitySha256")
        assert identity == generator.digest(adapter)
        assert set(adapter) == {
            "sourceRateHz",
            "targetRateHz",
            "up",
            "down",
            "coefficientAsset",
            "coefficientUrl",
            "tapCount",
            "realSourceLookaheadSamples",
            "firstFullyRealOutputIndex",
        }


@pytest.mark.parametrize(
    "text",
    [
        '{"schemaVersion":1,"schemaVersion":1}',
        '{"schemaVersion":NaN}',
        '{"schemaVersion":Infinity}',
    ],
)
def test_runtime_json_requires_unique_fields_and_json_numbers(tmp_path, text):
    source = tmp_path / "runtime.json"
    source.write_text(text, encoding="utf-8")
    with pytest.raises(ValueError):
        generator.load_json(source)
