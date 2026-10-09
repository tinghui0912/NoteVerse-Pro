"""Research-only ByteDance checkpoint vs fixed ONNX parity receipt.

This verifies the recovered PyTorch checkpoint against the current fixed-shape
ONNX asset on deterministic 1820ms golden PCM fixtures. It is intentionally
outside production runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from compare_step_microphone_frontends_causal_cases import ByteDancePianoTranscriptionProvider
from evaluate_bytedance_direct_note_frontend import _direct_note_forward, _warm_up_note_model


def main() -> int:
    args = parse_args()
    checkpoint_sha = sha256(args.checkpoint)
    onnx_sha = sha256(args.onnx)
    fixtures_manifest = json.loads((args.fixture_dir / "manifest.json").read_text(encoding="utf-8"))
    fixtures = fixtures_manifest["fixtures"][: args.fixture_count]

    provider = ByteDancePianoTranscriptionProvider(checkpoint_path=args.checkpoint, device=args.device)
    _warm_up_note_model(provider, device=args.device)

    import onnxruntime as ort

    try:
        session = ort.InferenceSession(str(args.onnx), providers=["CPUExecutionProvider"])
        ortOptimization = "default"
    except Exception:
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        session = ort.InferenceSession(str(args.onnx), sess_options=options, providers=["CPUExecutionProvider"])
        ortOptimization = "disabled_after_default_load_failed"
    comparisons = []
    for fixture in fixtures:
        fixture_input = args.fixture_dir / fixture["input_tensor_npy"]
        pcm = np.load(fixture_input).astype(np.float32, copy=False)
        pytorch_raw, _latency = _direct_note_forward(provider, pcm, 16000, device=args.device)
        onnx_onset, onnx_frame = session.run(
            ["reg_onset_output", "frame_output"],
            {"audio": pcm[None, :]},
        )
        onset_delta = np.abs(pytorch_raw["onset"] - onnx_onset[0])
        frame_delta = np.abs(pytorch_raw["frame"] - onnx_frame[0])
        comparisons.append(
            {
                "fixtureId": fixture["fixture_id"],
                "inputPcmSha256": sha256(fixture_input),
                "regOnsetShape": list(pytorch_raw["onset"].shape),
                "frameShape": list(pytorch_raw["frame"].shape),
                "regOnsetMeanAbsDelta": float(onset_delta.mean()),
                "regOnsetMaxAbsDelta": float(onset_delta.max()),
                "frameMeanAbsDelta": float(frame_delta.mean()),
                "frameMaxAbsDelta": float(frame_delta.max()),
                "decoderDecisionParityAtOnset020Frame020": bool(
                    ((pytorch_raw["onset"] >= 0.20) == (onnx_onset[0] >= 0.20)).all()
                    and ((pytorch_raw["frame"] >= 0.20) == (onnx_frame[0] >= 0.20)).all()
                ),
            }
        )

    receipt = {
        "schemaVersion": 1,
        "artifact": "phase9g_a21_bytedance_checkpoint_onnx_parity",
        "checkpointPath": normalize(args.checkpoint),
        "checkpointSha256": checkpoint_sha,
        "checkpointBytes": args.checkpoint.stat().st_size,
        "onnxPath": normalize(args.onnx),
        "onnxSha256": onnx_sha,
        "onnxBytes": args.onnx.stat().st_size,
        "device": args.device,
        "onnxRuntimeOptimization": ortOptimization,
        "fixtureCount": len(comparisons),
        "comparisons": comparisons,
        "overallDecoderDecisionParityAtOnset020Frame020": all(
            item["decoderDecisionParityAtOnset020Frame020"] for item in comparisons
        ),
        "maxRegOnsetAbsDelta": max(item["regOnsetMaxAbsDelta"] for item in comparisons),
        "maxFrameAbsDelta": max(item["frameMaxAbsDelta"] for item in comparisons),
        "meanRegOnsetAbsDelta": sum(item["regOnsetMeanAbsDelta"] for item in comparisons) / len(comparisons),
        "meanFrameAbsDelta": sum(item["frameMeanAbsDelta"] for item in comparisons) / len(comparisons),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(args.output)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--onnx", type=Path, required=True)
    parser.add_argument("--fixture-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixture-count", type=int, default=3)
    parser.add_argument("--device", default="cpu")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
      for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def normalize(path: Path) -> str:
    return str(path).replace("\\", "/")


if __name__ == "__main__":
    raise SystemExit(main())
