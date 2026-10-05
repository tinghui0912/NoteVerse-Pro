"""Research-only ByteDance Continuous dynamic-batch export/parity gate.

This script does not modify the production fixed-shape model manifest. It
exports a research ONNX graph with a dynamic batch dimension and compares raw
``reg_onset_output`` / ``frame_output`` tensors for B=1/2/4/8 against direct
PyTorch note_model inference.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import traceback
from typing import Any

import numpy as np

from compare_step_microphone_frontends_causal_cases import ByteDancePianoTranscriptionProvider
from evaluate_bytedance_direct_note_frontend import _sha256, _warm_up_note_model


SAMPLE_RATE = 16000
INPUT_SAMPLES = 29120
REQUESTED_BATCH_SIZES = (1, 2, 4, 8)


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / f"bytedance_continuous_batch_export_parity_{args.date}.json"
    onnx_path = output_dir / f"bytedance_note_model_dynamic_batch_{args.date}.onnx"

    checkpoint_path = args.checkpoint
    fixture_manifest_path = args.fixture_dir / "manifest.json"
    fixtures = json.loads(fixture_manifest_path.read_text(encoding="utf-8"))["fixtures"]
    fixture_inputs = [
        np.load(args.fixture_dir / fixture["input_tensor_npy"]).astype(np.float32, copy=False)
        for fixture in fixtures
    ]
    for fixture_input in fixture_inputs:
        if fixture_input.shape != (INPUT_SAMPLES,):
            raise ValueError(f"expected fixture input shape {(INPUT_SAMPLES,)}, got {fixture_input.shape}")

    report: dict[str, Any] = {
        "reportType": "continuous_dynamic_batch_export_parity",
        "generatedAt": dt.datetime.now(dt.UTC).isoformat(),
        "command": " ".join(["python", "backend/scripts/evaluate_bytedance_continuous_batch_export.py", *os.sys.argv[1:]]),
        "checkpoint": {
            "path": str(checkpoint_path),
            "exists": checkpoint_path.exists(),
            "sha256": _sha256(checkpoint_path) if checkpoint_path.exists() else None,
            "byteSize": checkpoint_path.stat().st_size if checkpoint_path.exists() else None,
        },
        "fixtureManifest": str(fixture_manifest_path),
        "fixtureCount": len(fixture_inputs),
        "requestedBatchSizes": list(REQUESTED_BATCH_SIZES),
        "export": None,
        "parity": {},
        "verdict": "NOT_EXECUTED",
    }

    if not checkpoint_path.exists():
        report["verdict"] = "BLOCKED"
        report["blocker"] = "checkpoint not found"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return 2

    provider = ByteDancePianoTranscriptionProvider(checkpoint_path=checkpoint_path, device=args.device)
    _warm_up_note_model(provider, device=args.device)
    model = provider._transcriber.model
    note_model = model.module.note_model if hasattr(model, "module") else model.note_model
    try:
        export_report = _export_dynamic_batch_onnx(note_model, onnx_path=onnx_path, opset=args.opset)
        report["export"] = export_report
    except Exception as exc:  # pragma: no cover - research environment only
        report["export"] = {
            "status": "failed",
            "errorType": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        report["verdict"] = "FAIL"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return 1

    if report["export"]["status"] != "exported":
        report["verdict"] = "FAIL"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return 1

    try:
        report["parity"] = _run_parity(
            note_model,
            onnx_path=onnx_path,
            fixture_inputs=fixture_inputs,
            device=args.device,
        )
    except Exception as exc:  # pragma: no cover - research environment only
        report["parityError"] = {
            "errorType": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        report["verdict"] = "FAIL"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return 1

    max_delta = max(
        float(item["onsetMaxAbsDelta"])
        for batch in report["parity"].values()
        for item in batch["items"]
    )
    max_delta = max(
        max_delta,
        max(
            float(item["frameMaxAbsDelta"])
            for batch in report["parity"].values()
            for item in batch["items"]
        ),
    )
    report["maxRawAbsDelta"] = max_delta
    report["verdict"] = "PASS" if max_delta <= args.max_abs_delta else "FAIL"
    report["maxAbsDeltaTolerance"] = args.max_abs_delta
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "verdict": report["verdict"], "maxRawAbsDelta": max_delta}, indent=2))
    return 0 if report["verdict"] == "PASS" else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--fixture-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--date", default="2026-10-05")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--opset", type=int, default=18)
    parser.add_argument("--max-abs-delta", type=float, default=1e-4)
    return parser.parse_args()


def _export_dynamic_batch_onnx(note_model: object, *, onnx_path: Path, opset: int) -> dict[str, Any]:
    import torch

    class OnsetFrameWrapper(torch.nn.Module):
        def __init__(self, wrapped: object) -> None:
            super().__init__()
            self.wrapped = wrapped

        def forward(self, audio):  # noqa: ANN001
            output = self.wrapped(audio)
            return output["reg_onset_output"], output["frame_output"]

    model_device = next(note_model.parameters()).device
    dummy = torch.zeros((2, INPUT_SAMPLES), dtype=torch.float32, device=model_device)
    wrapper = OnsetFrameWrapper(note_model).eval()
    batch_dim = torch.export.Dim("batch", min=1, max=max(REQUESTED_BATCH_SIZES))
    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapper,
        dummy,
        str(onnx_path),
        input_names=["audio"],
        output_names=["reg_onset_output", "frame_output"],
        opset_version=opset,
        external_data=False,
        dynamic_shapes={"audio": {0: batch_dim}},
        do_constant_folding=True,
    )
    return {
        "status": "exported",
        "onnxPath": str(onnx_path),
        "onnxSizeBytes": onnx_path.stat().st_size,
        "onnxSha256": _file_sha256(onnx_path),
        "opset": opset,
        "inputShape": ["batch", INPUT_SAMPLES],
        "requestedBatchSymbol": "batch",
    }


def _run_parity(
    note_model: object,
    *,
    onnx_path: Path,
    fixture_inputs: list[np.ndarray],
    device: str,
) -> dict[str, Any]:
    import onnxruntime as ort
    import torch
    from piano_transcription_inference.inference import move_data_to_device

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    results: dict[str, Any] = {}
    for batch_size in REQUESTED_BATCH_SIZES:
        batch = np.stack(
            [fixture_inputs[index % len(fixture_inputs)] for index in range(batch_size)],
            axis=0,
        ).astype(np.float32, copy=False)
        _sync(device)
        tensor = move_data_to_device(batch, next(note_model.parameters()).device)
        with torch.no_grad():
            note_model.eval()
            torch_output = note_model(tensor)
        _sync(device)
        torch_onset = torch_output["reg_onset_output"].detach().cpu().numpy()
        torch_frame = torch_output["frame_output"].detach().cpu().numpy()
        ort_onset, ort_frame = session.run(["reg_onset_output", "frame_output"], {"audio": batch})
        items = []
        for index in range(batch_size):
            onset_delta = np.abs(ort_onset[index] - torch_onset[index])
            frame_delta = np.abs(ort_frame[index] - torch_frame[index])
            items.append(
                {
                    "index": index,
                    "fixtureInputIndex": index % len(fixture_inputs),
                    "onsetMeanAbsDelta": float(np.mean(onset_delta)),
                    "onsetMaxAbsDelta": float(np.max(onset_delta)),
                    "frameMeanAbsDelta": float(np.mean(frame_delta)),
                    "frameMaxAbsDelta": float(np.max(frame_delta)),
                }
            )
        results[str(batch_size)] = {
            "inputShape": list(batch.shape),
            "torchOnsetShape": list(torch_onset.shape),
            "ortOnsetShape": list(ort_onset.shape),
            "torchFrameShape": list(torch_frame.shape),
            "ortFrameShape": list(ort_frame.shape),
            "items": items,
        }
    return results


def _sync(device: str) -> None:
    if device == "cuda":
        import torch

        if torch.cuda.is_available():
            torch.cuda.synchronize()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
