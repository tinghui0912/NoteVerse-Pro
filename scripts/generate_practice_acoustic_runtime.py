"""Validate and generate the configured Practice acoustic runtime projections."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_DIRECTORY = "contracts/practice/acoustic"
MAX_SAFE_INTEGER = 2**53 - 1


def canonical_json(value: object) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def digest(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def fields(value: object, names: str) -> dict:
    if not isinstance(value, dict) or set(value) != set(names.split()):
        raise ValueError(f"Expected exactly these fields: {names}")
    return value


def integer(value: object, minimum: int = 1) -> int:
    if type(value) is not int or not minimum <= value <= MAX_SAFE_INTEGER:
        raise ValueError("Expected a safe integer")
    return value


def text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Expected nonempty text")
    return value


def sha(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("Expected SHA256")
    return value


def repository_file(root: Path, name: object) -> Path:
    name = text(name)
    path = (root / name).resolve()
    if (
        Path(name).is_absolute()
        or "\\" in name
        or ".." in Path(name).parts
        or not path.is_relative_to(root.resolve())
        or not path.is_file()
    ):
        raise ValueError(f"Not a repository file: {name}")
    return path


def load_json(path: Path) -> dict:
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate field: {key}")
            result[key] = value
        return result

    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=unique_pairs,
        parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)),
    )


def validate(runtime: dict, root: Path = ROOT) -> None:
    fields(
        runtime,
        "schemaVersion model runtime input outputs decoder window sourceAdapters",
    )
    if integer(runtime["schemaVersion"]) != 1:
        raise ValueError("Unsupported acoustic contract schema")
    model = fields(runtime["model"], "assetId assetVersion byteSize sha256 mediaType storageKey")
    for key in ["assetId", "assetVersion", "mediaType", "storageKey"]:
        text(model[key])
    integer(model["byteSize"])
    if model["mediaType"] != "application/octet-stream":
        raise ValueError("Unsupported model byte media type")
    for key in ["assetId", "assetVersion"]:
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", model[key]):
            raise ValueError("Invalid model asset identity")
    sha(model["sha256"])
    if model["sha256"] not in model["storageKey"].split("/"):
        raise ValueError("Model identity and content-addressed locator must agree")
    engine = fields(
        runtime["runtime"],
        "packageName packageVersion executionProvider automaticFallback graphOptimizationLevel",
    )
    if (
        engine["packageName"] != "onnxruntime-web"
        or not re.fullmatch(r"\d+\.\d+\.\d+", text(engine["packageVersion"]))
        or engine["executionProvider"] != "webgpu"
        or engine["automaticFallback"] is not False
        or engine["graphOptimizationLevel"] != "disabled"
    ):
        raise ValueError("Unqualified acoustic runtime")
    dependencies = load_json(root / "apps/customer-web/package.json")["dependencies"]
    if dependencies.get(engine["packageName"]) != engine["packageVersion"]:
        raise ValueError("Runtime package declaration does not match the contract")
    input_ = fields(runtime["input"], "name dtype shape sampleRateHz")
    text(input_["name"])
    shape = input_["shape"]
    if (
        input_["dtype"] != "float32"
        or not isinstance(shape, list)
        or len(shape) != 2
        or integer(shape[0]) != 1
    ):
        raise ValueError("Expected a single float32 audio input")
    samples, rate = integer(shape[1]), integer(input_["sampleRateHz"])
    outputs = runtime["outputs"]
    if not isinstance(outputs, list) or len(outputs) != 2:
        raise ValueError("Expected onset and frame outputs, in that order")
    for output in outputs:
        fields(output, "name dtype shape")
        text(output["name"])
        if (
            output["dtype"] != input_["dtype"]
            or not isinstance(output["shape"], list)
            or len(output["shape"]) != 3
            or integer(output["shape"][0]) != 1
        ):
            raise ValueError("Invalid output descriptor")
        for dimension in output["shape"]:
            integer(dimension)
    if outputs[0]["name"] == outputs[1]["name"] or outputs[0]["shape"] != outputs[1]["shape"]:
        raise ValueError("Output names must be unique with matching geometry")
    decoder = fields(
        runtime["decoder"],
        "identity outputFrameRateHz midiPitchStart onsetThreshold frameThreshold",
    )
    if decoder["identity"] != "A":
        raise ValueError("Unqualified decoder")
    fps, pitch = integer(decoder["outputFrameRateHz"]), integer(decoder["midiPitchStart"], 0)
    if outputs[0]["shape"][1] != samples * fps // rate + 1 or pitch + outputs[0]["shape"][2] > 128:
        raise ValueError("Input, decoder and output geometry disagree")
    for key in ["onsetThreshold", "frameThreshold"]:
        if (
            type(decoder[key]) not in (int, float)
            or not math.isfinite(decoder[key])
            or not 0 < decoder[key] < 1
        ):
            raise ValueError("Invalid decoder threshold")
    window = fields(runtime["window"], "ownedSamples futureContextSamples")
    if integer(window["ownedSamples"]) + integer(window["futureContextSamples"]) >= samples:
        raise ValueError("Window requires positive real past context")
    adapters = runtime["sourceAdapters"]
    if not isinstance(adapters, dict) or not adapters:
        raise ValueError("Qualified source adapters required")
    for key, adapter in adapters.items():
        fields(adapter, "sourceRateHz up down coefficientAsset")
        source_rate, up, down = (integer(adapter[k]) for k in ["sourceRateHz", "up", "down"])
        if str(source_rate) != key or source_rate * up != rate * down or math.gcd(up, down) != 1:
            raise ValueError("Inconsistent rational source adapter")
        asset = fields(adapter["coefficientAsset"], "path byteSize sha256")
        size = integer(asset["byteSize"])
        sha(asset["sha256"])
        if not text(asset["path"]).startswith("apps/customer-web/public/") or not asset[
            "path"
        ].endswith(".f32"):
            raise ValueError("FIR must be a shipped binary asset")
        raw = repository_file(root, asset["path"]).read_bytes()
        if (
            len(raw) != size
            or hashlib.sha256(raw).hexdigest() != asset["sha256"]
            or size % 4
            or (size // 4) % 2 != 1
        ):
            raise ValueError("FIR identity mismatch")
        if any(not math.isfinite(v[0]) for v in struct.iter_unpack("<f", raw)):
            raise ValueError("FIR coefficients must be finite")


def ts_data(value: object) -> str:
    if isinstance(value, dict):
        return (
            "Object.freeze({\n"
            + ",\n".join(f"{json.dumps(k)}: {ts_data(v)}" for k, v in value.items())
            + "\n} as const)"
        )
    if isinstance(value, list):
        return "Object.freeze([" + ", ".join(ts_data(v) for v in value) + "] as const)"
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def analysis_identity(runtime: dict) -> dict:
    return {
        "identityName": f"{runtime['model']['assetId']}@{runtime['model']['assetVersion']}",
        "analysisIdentitySha256": digest(runtime),
    }


def source_adapter_contracts(runtime: dict) -> dict:
    adapters = {}
    for key, adapter in runtime["sourceAdapters"].items():
        taps = adapter["coefficientAsset"]["byteSize"] // 4
        value = {
            **adapter,
            "targetRateHz": runtime["input"]["sampleRateHz"],
            "tapCount": taps,
            "realSourceLookaheadSamples": ((taps - 1) // 2 + adapter["up"] - 1) // adapter["up"],
            "firstFullyRealOutputIndex": ((taps - 1) // 2 + adapter["down"] - 1) // adapter["down"],
            "coefficientUrl": "/"
            + adapter["coefficientAsset"]["path"].removeprefix("apps/customer-web/public/"),
        }
        adapters[key] = {**value, "identitySha256": digest(value)}
    return adapters


def projections(runtime: dict) -> dict[str, str]:
    runtime = json.loads(canonical_json(runtime))
    identity = analysis_identity(runtime)
    adapters = source_adapter_contracts(runtime)
    descriptor = {
        "schemaVersion": runtime["schemaVersion"],
        "assetId": runtime["model"]["assetId"],
        "assetVersion": runtime["model"]["assetVersion"],
        "expectedByteSize": runtime["model"]["byteSize"],
        "sha256": runtime["model"]["sha256"],
        "mediaType": runtime["model"]["mediaType"],
    }
    header = f"Generated from {CONTRACT_DIRECTORY}/runtime-contract.json. Do not edit."
    ts = f"// {header}\n"
    for name, value in [
        ("ACOUSTIC_RUNTIME_CONTRACT", runtime),
        ("ACOUSTIC_ANALYSIS_IDENTITY", identity),
        ("SOURCE_ADAPTER_CONTRACTS", adapters),
        ("ACOUSTIC_MODEL_ASSET_DESCRIPTOR", descriptor),
    ]:
        ts += f"export const {name} = {ts_data(value)};\n"
    ts += "export const ACOUSTIC_TARGET_SAMPLES_PER_MS = ACOUSTIC_RUNTIME_CONTRACT.input.sampleRateHz / 1000;\n"
    py = (
        f'"""{header}"""\n\nfrom types import MappingProxyType\nfrom typing import NamedTuple\n\n\n'
    )
    model_fields = {
        "schema_version": runtime["schemaVersion"],
        "asset_id": runtime["model"]["assetId"],
        "asset_version": runtime["model"]["assetVersion"],
        "byte_size": runtime["model"]["byteSize"],
        "sha256": runtime["model"]["sha256"],
        "media_type": runtime["model"]["mediaType"],
        "storage_key": runtime["model"]["storageKey"],
    }
    py += "class ModelAssetContract(NamedTuple):\n"
    for name, value in model_fields.items():
        py += f"    {name}: {'int' if type(value) is int else 'str'}\n"
    py += "\n\nMODEL_ASSET = ModelAssetContract(\n"
    py += (
        "".join(f"    {name}={json.dumps(value)},\n" for name, value in model_fields.items())
        + ")\n"
    )
    for name, value in [("MODEL_ASSET_DESCRIPTOR", descriptor)]:
        py += f"{name} = MappingProxyType(\n    {{\n"
        py += "".join(
            f"        {json.dumps(key)}: {json.dumps(item)},\n" for key, item in value.items()
        )
        py += "    }\n)\n"
    return {
        "apps/customer-web/src/lib/practice/acoustic/generated/runtime-contract.ts": ts,
        "backend/app/modules/model_assets/generated/practice_acoustic_model_asset.py": py,
    }


def generate(root: Path, *, check: bool = False) -> None:
    runtime = load_json(root / CONTRACT_DIRECTORY / "runtime-contract.json")
    validate(runtime, root)
    for name, content in projections(runtime).items():
        path = root / name
        if check:
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                raise SystemExit(f"Acoustic projection differs: {name}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generate(ROOT, check=args.check)
    print("Practice acoustic runtime and model delivery projections agree.")


if __name__ == "__main__":
    main()
