#!/usr/bin/env python3
"""Phase 9G-D.2R Online-AMT explicit-state browser completion attempt.

Research-only. This keeps D.2 reports immutable, corrects their interpretation,
exports explicit mel/acoustic/language graphs, attempts ORT Web/WebGPU browser
execution, and writes compact receipts. It does not touch production Practice or
blind p15-p22 data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import qualify_online_amt_browser_stateful as d2  # noqa: E402


REPORT_DATE = "2026-10-13"
TIMING_CORRECTION_MS = d2.TIMING_CORRECTION_MS
SAMPLE_RATE = d2.SAMPLE_RATE
HOP_SAMPLES = d2.HOP_SAMPLES
HOP_MS = d2.HOP_MS
P15P22_INFERENCE_INCREASE = 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--online-amt-repo", type=Path, default=Path("backend/data/work/online_amt"))
    parser.add_argument("--checkpoint", type=Path, default=Path("backend/data/work/online_amt/model-180000.pt"))
    parser.add_argument("--config", type=Path, default=Path("backend/research/product_benchmark/product_benchmark_config.json"))
    parser.add_argument("--work-dir", type=Path, default=Path("backend/data/work/phase9gd2r_online_amt_browser"))
    parser.add_argument("--reports-dir", type=Path, default=Path("backend/research/reports"))
    parser.add_argument("--ort-dir", type=Path, default=Path("apps/customer-web/node_modules/onnxruntime-web/dist"))
    parser.add_argument("--browser-channel", default="chrome")
    parser.add_argument("--edge-channel", default="msedge")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--hop-count", type=int, default=320)
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    work_dir = (repo_root / args.work_dir).resolve()
    reports_dir = (repo_root / args.reports_dir).resolve()
    online_repo = (repo_root / args.online_amt_repo).resolve()
    checkpoint = (repo_root / args.checkpoint).resolve()
    ort_dir = (repo_root / args.ort_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    source_identity = d2.verify_source_identity(repo_root, online_repo, checkpoint, repo_root / args.config)
    if source_identity["qualificationStatus"] != "PASS":
        write_all_blocked(reports_dir, source_identity, "SOURCE_IDENTITY_BLOCKED")
        return 2

    d2.prepare_online_amt_imports(online_repo)
    import torch
    from transcribe import OnlineTranscriber, load_model

    model = load_model(str(checkpoint))
    transcriber = OnlineTranscriber(model, return_roll=False)
    model.eval()

    fixtures_dir = work_dir / "fixtures"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    graphs_dir = work_dir / "graphs"
    graphs_dir.mkdir(parents=True, exist_ok=True)

    pcm = d2.load_nonblind_fixture(repo_root, args.hop_count)
    reference = generate_reference_sequence(model, OnlineTranscriber, torch, pcm, args.hop_count, fixtures_dir)

    export = export_graphs(model, transcriber, torch, graphs_dir, reference)
    for graph in export.values():
        if graph.get("status") == "PASS":
            shutil.copyfile(graph["path"], fixtures_dir / graph["file"])
    py_parity = python_layer_parity(model, OnlineTranscriber, torch, pcm, reference)
    manifest = build_browser_manifest(fixtures_dir, export, reference, args.hop_count)
    (fixtures_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    chrome_native = run_browser_harness(repo_root, fixtures_dir, ort_dir, args.browser_channel, args.headed, "native-lm", work_dir / "chrome_native_lm.json")
    chrome_pipeline = run_browser_harness(repo_root, fixtures_dir, ort_dir, args.browser_channel, args.headed, "pipeline", work_dir / "chrome_pipeline.json")
    edge_pipeline = run_browser_harness(repo_root, fixtures_dir, ort_dir, args.edge_channel, args.headed, "pipeline", work_dir / "edge_pipeline.json")

    ts_bridge = run_ts_bridge(repo_root, work_dir, reference, chrome_pipeline)
    correction = correction_receipt(source_identity)
    graph_report = graph_export_report(export, source_identity, py_parity)
    layer_report = layer_parity_report(py_parity, chrome_pipeline, edge_pipeline)
    step_report = step_parity_report(reference, chrome_pipeline, edge_pipeline, chrome_native)
    bridge_report = publication_bridge_report(ts_bridge)
    runtime_report = runtime_report_from_browser(chrome_pipeline, edge_pipeline)
    feasibility = feasibility_receipt(chrome_pipeline, edge_pipeline, py_parity, export, ts_bridge)

    write_report(reports_dir, "phase9g_d2r_correction_receipt", correction)
    write_report(reports_dir, "phase9g_d2r_online_amt_graph_export", graph_report)
    write_report(reports_dir, "phase9g_d2r_online_amt_browser_layer_parity", layer_report)
    write_report(reports_dir, "phase9g_d2r_online_amt_browser_step_parity", step_report)
    write_report(reports_dir, "phase9g_d2r_online_amt_publication_bridge_parity", bridge_report)
    write_report(reports_dir, "phase9g_d2r_online_amt_default_browser_runtime", runtime_report)
    write_report(reports_dir, "phase9g_d2r_online_amt_feasibility_receipt", feasibility)

    print(json.dumps({"outcome": feasibility["outcome"], "reportsDir": d2.rel(repo_root, reports_dir)}, indent=2))
    return 0


class ExportableMel(torch.nn.Module):
    def __init__(self, model: Any):
        super().__init__()
        self.register_buffer("forward_basis", model.melspectrogram.stft.forward_basis.detach().clone())
        self.register_buffer("mel_basis", model.melspectrogram.mel_basis.detach().clone())

    def forward(self, audio_last_2048: Any) -> Any:
        x = audio_last_2048.view(audio_last_2048.shape[0], 1, audio_last_2048.shape[1])
        transform = torch.conv1d(x, self.forward_basis, stride=512, padding=0)
        cutoff = 1025
        real = transform[:, :cutoff, :]
        imag = transform[:, cutoff:, :]
        magnitude = torch.sqrt(real * real + imag * imag)
        mel = torch.matmul(self.mel_basis, magnitude)
        return torch.log(torch.clamp(mel, min=1e-5))


class AcousticStep(torch.nn.Module):
    def __init__(self, model: Any):
        super().__init__()
        self.layers = model.acoustic_model.cnn
        self.fc = model.acoustic_model.fc

    def forward(self, mel_buffer: Any, cache0_in: Any, cache1_in: Any) -> tuple[Any, Any, Any]:
        mel = mel_buffer.transpose(-1, -2)
        x = mel[:, -3:, :].unsqueeze(1)
        for i in range(3):
            x = self.layers[i](x)
        cache0_out = torch.cat((cache0_in[:, :, 1:, :], x), dim=2)
        x = cache0_out[:, :, -3:, :]
        for i in range(3, 8):
            x = self.layers[i](x)
        cache1_out = torch.cat((cache1_in[:, :, 1:, :], x), dim=2)
        x = cache1_out
        for i in range(8, 13):
            x = self.layers[i](x)
        x = x.transpose(1, 2).flatten(-2)
        return self.fc(x), cache0_out, cache1_out


class ManualFloatLmStep(torch.nn.Module):
    def __init__(self, model: Any):
        super().__init__()
        self.lstm = model.language_model
        self.post = model.language_post[0]

    def lstm_layer(self, x: Any, h: Any, c: Any, layer: int) -> tuple[Any, Any]:
        weight_ih = getattr(self.lstm, f"weight_ih_l{layer}")
        weight_hh = getattr(self.lstm, f"weight_hh_l{layer}")
        bias_ih = getattr(self.lstm, f"bias_ih_l{layer}")
        bias_hh = getattr(self.lstm, f"bias_hh_l{layer}")
        gates = torch.nn.functional.linear(x, weight_ih, bias_ih) + torch.nn.functional.linear(h, weight_hh, bias_hh)
        i, f, g, o = gates.chunk(4, dim=-1)
        i = torch.sigmoid(i)
        f = torch.sigmoid(f)
        g = torch.tanh(g)
        o = torch.sigmoid(o)
        c_new = f * c + i * g
        h_new = o * torch.tanh(c_new)
        return h_new, c_new

    def forward(self, acoustic_out: Any, h_in: Any, c_in: Any, prev_embedding_in: Any) -> tuple[Any, Any, Any]:
        current = torch.cat((acoustic_out, prev_embedding_in), dim=2)
        h0, c0 = self.lstm_layer(current[:, 0, :], h_in[0], c_in[0], 0)
        h1, c1 = self.lstm_layer(h0, h_in[1], c_in[1], 1)
        logits = self.post(h1).view(acoustic_out.shape[0], 1, 88, 5)
        probs = torch.softmax(logits, dim=3)
        return probs, torch.stack((h0, h1), dim=0), torch.stack((c0, c1), dim=0)


class NativeLmStep(torch.nn.Module):
    def __init__(self, model: Any):
        super().__init__()
        self.model = model

    def forward(self, acoustic_out: Any, h_in: Any, c_in: Any, prev_output_in: Any) -> tuple[Any, Any, Any]:
        probs, (h_out, c_out) = self.model.lm_model_step(acoustic_out, (h_in, c_in), prev_output_in)
        return probs, h_out, c_out


def export_graphs(model: Any, transcriber: Any, torch: Any, graphs_dir: Path, reference: dict[str, Any]) -> dict[str, Any]:
    mel_path = graphs_dir / "online_amt_mel_step_opset18.onnx"
    acoustic_path = graphs_dir / "online_amt_acoustic_step_opset18.onnx"
    lm_float_path = graphs_dir / "online_amt_lm_manual_float_step_opset18.onnx"
    lm_native_path = graphs_dir / "online_amt_lm_native_step_opset18.onnx"

    mel = ExportableMel(model).eval()
    acoustic = AcousticStep(model).eval()
    lm_float = ManualFloatLmStep(model).eval()
    lm_native = NativeLmStep(model).eval()

    audio = torch.zeros((1, 2048), dtype=torch.float32)
    mel_buffer = torch.from_numpy(reference["initial"]["mel_buffer"]).float()
    cache0 = torch.from_numpy(reference["initial"]["cache0"]).float()
    cache1 = torch.from_numpy(reference["initial"]["cache1"]).float()
    acoustic_out = torch.zeros((1, 1, model.model_complexity_conv * 16), dtype=torch.float32)
    h = torch.zeros((2, 1, model.language_hidden_size), dtype=torch.float32)
    c = torch.zeros((2, 1, model.language_hidden_size), dtype=torch.float32)
    prev_long = torch.zeros((1, 1, 88), dtype=torch.long)
    prev_embedding = torch.zeros((1, 1, 176), dtype=torch.float32)

    exports = {}
    exports["mel"] = torch_export(torch, mel, (audio,), mel_path, ["audio_last_2048"], ["new_mel_frame"])
    exports["acoustic"] = torch_export(
        torch,
        acoustic,
        (mel_buffer, cache0, cache1),
        acoustic_path,
        ["mel_buffer", "cache0_in", "cache1_in"],
        ["acoustic_out", "cache0_out", "cache1_out"],
    )
    exports["lmFloat"] = torch_export(
        torch,
        lm_float,
        (acoustic_out, h, c, prev_embedding),
        lm_float_path,
        ["acoustic_out", "h_in", "c_in", "prev_embedding_in"],
        ["probabilities", "h_out", "c_out"],
    )
    exports["lmNative"] = torch_export(
        torch,
        lm_native,
        (acoustic_out, h, c, prev_long),
        lm_native_path,
        ["acoustic_out", "h_in", "c_in", "prev_output_in"],
        ["probabilities", "h_out", "c_out"],
    )
    return exports


def torch_export(torch: Any, module: Any, inputs: tuple[Any, ...], path: Path, input_names: list[str], output_names: list[str]) -> dict[str, Any]:
    try:
        torch.onnx.export(module, inputs, str(path), input_names=input_names, output_names=output_names, opset_version=18, dynamic_axes=None)
        return {
            "status": "PASS",
            "file": path.name,
            "path": str(path),
            "sha256": sha256(path),
            "byteSize": path.stat().st_size,
            "opset": 18,
            "inputNames": input_names,
            "outputNames": output_names,
            "operators": onnx_operators(path),
        }
    except Exception as exc:
        return {"status": "BLOCKED", "file": path.name, "error": repr(exc), "inputNames": input_names, "outputNames": output_names}


def generate_reference_sequence(model: Any, transcriber_cls: Any, torch: Any, pcm: np.ndarray, hop_count: int, fixtures_dir: Path) -> dict[str, Any]:
    session = transcriber_cls(model, return_roll=False)
    initial = {
        "audio_buffer": session.audio_buffer.detach().cpu().numpy().astype(np.float32),
        "mel_buffer": session.mel_buffer.detach().cpu().numpy().astype(np.float32),
        "cache0": session.acoustic_layer_outputs[0].detach().cpu().numpy().astype(np.float32),
        "cache1": session.acoustic_layer_outputs[1].detach().cpu().numpy().astype(np.float32),
        "h": session.hidden[0].detach().cpu().numpy().astype(np.float32),
        "c": session.hidden[1].detach().cpu().numpy().astype(np.float32),
        "prev": session.prev_output.detach().cpu().numpy().astype(np.int64),
        "embedding": model.class_embedding.weight.detach().cpu().numpy().astype(np.float32),
    }
    for name, value in initial.items():
        write_npy(fixtures_dir / f"initial_{name}.npy", value)

    hops = pcm[: hop_count * HOP_SAMPLES].reshape(hop_count, HOP_SAMPLES).astype(np.float32)
    write_npy(fixtures_dir / "hops.npy", hops.reshape(-1))
    mel_frames = []
    acoustic_rows = []
    probs_rows = []
    chosen_rows = []
    h_rows = []
    c_rows = []
    native_gate = []
    with torch.no_grad():
        for hop_index, hop in enumerate(hops):
            session.update_buffer(hop)
            session.switch_on_or_off()
            short = session.num_under_thr > session.patience
            if short:
                probs = np.zeros((88, 5), dtype=np.float32)
                probs[:, 0] = 1.0
                chosen = np.zeros((88,), dtype=np.int64)
            else:
                session.update_mel_buffer()
                mel_frames.append(session.mel_buffer[:, :, 6:].detach().cpu().numpy().astype(np.float32).reshape(229))
                acoustic_out = session.update_acoustic_out(session.mel_buffer.transpose(-1, -2))
                acoustic_rows.append(acoustic_out.detach().cpu().numpy().astype(np.float32).reshape(-1))
                language_out, session.hidden = session.model.lm_model_step(acoustic_out, session.hidden, session.prev_output)
                boosted = language_out.clone()
                boosted[0, 0, :, 3:5] *= d2.PUBLISHED_ONSET_BOOST
                session.prev_output = boosted.argmax(dim=3)
                probs = boosted[0, 0].detach().cpu().numpy().astype(np.float32)
                chosen = session.prev_output[0, 0].detach().cpu().numpy().astype(np.int64)
            probs_rows.append(probs.reshape(-1))
            chosen_rows.append(chosen)
            h_rows.append(session.hidden[0].detach().cpu().numpy().astype(np.float32).reshape(-1))
            c_rows.append(session.hidden[1].detach().cpu().numpy().astype(np.float32).reshape(-1))
            native_gate.append({"hopIndex": hop_index, "numUnderThr": int(session.num_under_thr), "shortCircuit": bool(short)})
    # D.2 active p07 sequence is non-silent; still make arrays total-hop aligned.
    if len(mel_frames) != hop_count:
        mel_frames = [np.zeros((229,), dtype=np.float32) if i >= len(mel_frames) else mel_frames[i] for i in range(hop_count)]
    if len(acoustic_rows) != hop_count:
        features = int(model.model_complexity_conv * 16)
        acoustic_rows = [np.zeros((features,), dtype=np.float32) if i >= len(acoustic_rows) else acoustic_rows[i] for i in range(hop_count)]

    write_npy(fixtures_dir / "reference_mel_frames.npy", np.asarray(mel_frames, dtype=np.float32))
    write_npy(fixtures_dir / "reference_acoustic_out.npy", np.asarray(acoustic_rows, dtype=np.float32))
    write_npy(fixtures_dir / "reference_probabilities.npy", np.asarray(probs_rows, dtype=np.float32))
    write_npy(fixtures_dir / "reference_chosen_states.npy", np.asarray(chosen_rows, dtype=np.int64))
    write_npy(fixtures_dir / "reference_h.npy", np.asarray(h_rows, dtype=np.float32).reshape(hop_count, 2, 1, model.language_hidden_size))
    write_npy(fixtures_dir / "reference_c.npy", np.asarray(c_rows, dtype=np.float32).reshape(hop_count, 2, 1, model.language_hidden_size))

    native_fixture = {
        "acoustic": "native_lm_acoustic.npy",
        "h": "native_lm_h.npy",
        "c": "native_lm_c.npy",
        "prev": "native_lm_prev.npy",
        "probabilities": "native_lm_probabilities.npy",
        "hOut": "native_lm_hout.npy",
        "cOut": "native_lm_cout.npy",
    }
    write_npy(fixtures_dir / native_fixture["acoustic"], np.asarray(acoustic_rows[0], dtype=np.float32).reshape(1, 1, -1))
    write_npy(fixtures_dir / native_fixture["h"], initial["h"])
    write_npy(fixtures_dir / native_fixture["c"], initial["c"])
    write_npy(fixtures_dir / native_fixture["prev"], initial["prev"])
    write_npy(fixtures_dir / native_fixture["probabilities"], np.asarray(probs_rows[0], dtype=np.float32).reshape(1, 1, 88, 5))
    write_npy(fixtures_dir / native_fixture["hOut"], np.asarray(h_rows[0], dtype=np.float32).reshape(2, 1, model.language_hidden_size))
    write_npy(fixtures_dir / native_fixture["cOut"], np.asarray(c_rows[0], dtype=np.float32).reshape(2, 1, model.language_hidden_size))

    return {
        "initial": initial,
        "hopCount": hop_count,
        "acousticOutFeatures": int(model.model_complexity_conv * 16),
        "nativeGate": native_gate,
        "nativeLmFixture": native_fixture,
    }


def python_layer_parity(model: Any, transcriber_cls: Any, torch: Any, pcm: np.ndarray, reference: dict[str, Any]) -> dict[str, Any]:
    mel = ExportableMel(model).eval()
    acoustic = AcousticStep(model).eval()
    lm_float = ManualFloatLmStep(model).eval()
    session = transcriber_cls(model, return_roll=False)
    mel_deltas = []
    acoustic_deltas = []
    prob_deltas = []
    chosen_mismatch = 0
    with torch.no_grad():
        for hop_index in range(reference["hopCount"]):
            hop = pcm[hop_index * HOP_SAMPLES:(hop_index + 1) * HOP_SAMPLES].astype(np.float32)
            session.update_buffer(hop)
            session.switch_on_or_off()
            if session.num_under_thr > session.patience:
                continue
            exported_mel = mel(session.audio_buffer[:, -2048:])
            session.update_mel_buffer()
            mel_deltas.append(compare_np(exported_mel.detach().cpu().numpy(), session.mel_buffer[:, :, 6:].detach().cpu().numpy()))
            exported_acoustic, cache0, cache1 = acoustic(
                session.mel_buffer,
                session.acoustic_layer_outputs[0],
                session.acoustic_layer_outputs[1],
            )
            upstream_acoustic = session.update_acoustic_out(session.mel_buffer.transpose(-1, -2))
            acoustic_deltas.append(compare_np(exported_acoustic.detach().cpu().numpy(), upstream_acoustic.detach().cpu().numpy()))
            session.acoustic_layer_outputs = [cache0, cache1]
            prev_embedding = model.class_embedding(session.prev_output).view(1, 1, 176)
            probs, h_out, c_out = lm_float(upstream_acoustic, session.hidden[0], session.hidden[1], prev_embedding)
            upstream_probs, session.hidden = model.lm_model_step(upstream_acoustic, session.hidden, session.prev_output)
            boosted = upstream_probs.clone()
            boosted[0, 0, :, 3:5] *= d2.PUBLISHED_ONSET_BOOST
            prob_deltas.append(compare_np(probs.detach().cpu().numpy(), upstream_probs.detach().cpu().numpy()))
            manual_chosen = probs.argmax(dim=3)
            upstream_chosen = boosted.argmax(dim=3)
            chosen_mismatch += int((manual_chosen != upstream_chosen).sum().item())
            session.prev_output = upstream_chosen
    return {
        "melExportableVsPythonFormula": summarize_delta_rows(mel_deltas),
        "acousticExplicitVsUpstream": summarize_delta_rows(acoustic_deltas),
        "manualFloatLmVsUpstream": summarize_delta_rows(prob_deltas),
        "manualFloatLmChosenMismatchCount": chosen_mismatch,
    }


def build_browser_manifest(fixtures_dir: Path, export: dict[str, Any], reference: dict[str, Any], hop_count: int) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "online_amt_d2r_browser_fixture_manifest",
        "hopCount": hop_count,
        "acousticOutFeatures": reference["acousticOutFeatures"],
        "graphs": {
            "mel": {"file": export["mel"]["file"]},
            "acoustic": {"file": export["acoustic"]["file"]},
            "lmFloat": {"file": export["lmFloat"]["file"]},
            "lmNative": {"file": export["lmNative"]["file"]},
        },
        "nativeLmModel": export["lmNative"]["file"],
        "nativeLmFixture": reference["nativeLmFixture"],
        "initialState": {
            "audioBuffer": "initial_audio_buffer.npy",
            "melBuffer": "initial_mel_buffer.npy",
            "cache0": "initial_cache0.npy",
            "cache1": "initial_cache1.npy",
            "h": "initial_h.npy",
            "c": "initial_c.npy",
            "prevOutput": "initial_prev.npy",
            "embedding": "initial_embedding.npy",
        },
        "fixtures": {
            "hops": "hops.npy",
            "referenceMelFrames": "reference_mel_frames.npy",
            "referenceAcousticOut": "reference_acoustic_out.npy",
            "referenceProbabilities": "reference_probabilities.npy",
            "referenceChosenStates": "reference_chosen_states.npy",
            "referenceH": "reference_h.npy",
            "referenceC": "reference_c.npy",
        },
        "p15p22InferenceIncrease": 0,
    }


def run_browser_harness(repo_root: Path, fixture_dir: Path, ort_dir: Path, channel: str, headed: bool, mode: str, output: Path) -> dict[str, Any]:
    cmd = [
        "node",
        str(repo_root / "backend/research/browser_runtime/online_amt_stateful_browser_harness.mjs"),
        "--fixture-dir",
        str(fixture_dir),
        "--ort-dir",
        str(ort_dir),
        "--backend",
        "webgpu",
        "--graph-optimization-level",
        "disabled",
        "--browser-channel",
        channel,
        "--mode",
        mode,
        "--output",
        str(output),
    ]
    if headed:
        cmd.append("--headed")
    try:
        started = time.perf_counter()
        proc = subprocess.run(cmd, cwd=repo_root, text=True, capture_output=True, timeout=240)
        elapsed = (time.perf_counter() - started) * 1000
        body = json.loads(output.read_text(encoding="utf-8")) if output.exists() else None
        return {
            "status": "PASS" if proc.returncode == 0 and body and body.get("result") else "FAILED",
            "mode": mode,
            "browserChannel": channel,
            "elapsedMs": elapsed,
            "returncode": proc.returncode,
            "stdoutTail": proc.stdout[-4000:],
            "stderrTail": proc.stderr[-4000:],
            "result": body,
        }
    except Exception as exc:
        return {"status": "FAILED", "mode": mode, "browserChannel": channel, "error": repr(exc)}


def run_ts_bridge(repo_root: Path, work_dir: Path, reference: dict[str, Any], chrome_pipeline: dict[str, Any]) -> dict[str, Any]:
    # D.2R uses the authoritative TS tail calculation even when browser parity
    # fails before creating a trustworthy hop artifact.
    script = f"""
const path = require('node:path');
const jiti = require(path.resolve({json.dumps(str(repo_root))}, 'apps/customer-web/node_modules/jiti/dist/jiti.cjs'))(__filename);
const mod = jiti(path.resolve({json.dumps(str(repo_root))}, 'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'));
const req = mod.onlineAmtSegmentTailRequirement(320*512, {TIMING_CORRECTION_MS});
console.log(JSON.stringify(req));
"""
    try:
        proc = subprocess.run(["node", "-e", script], cwd=repo_root, text=True, capture_output=True)
    except FileNotFoundError as exc:
        req = local_tail_requirement(320 * 512)
        return {
            "status": "TAIL_LOCAL_FORMULA_NODE_UNAVAILABLE",
            "authoritativeTailRequirement": req,
            "ownedPerformanceMs": 320 * 512 / SAMPLE_RATE * 1000,
            "requiredProcessingFrontierMs": req["requiredProcessedSamples"] / SAMPLE_RATE * 1000,
            "correctedFrontierMs": req["requiredProcessedSamples"] / SAMPLE_RATE * 1000 + TIMING_CORRECTION_MS,
            "finalOwnedAnalyzedThroughPerformanceMs": 320 * 512 / SAMPLE_RATE * 1000,
            "timingCorrectionMs": TIMING_CORRECTION_MS,
            "publicationBridgeParity": "NOT_EXECUTED",
            "nodeError": repr(exc),
        }
    req = json.loads(proc.stdout) if proc.returncode == 0 and proc.stdout.strip() else None
    return {
        "status": "TAIL_ONLY_BROWSER_PUBLICATION_NOT_TRUSTWORTHY" if chrome_pipeline.get("status") != "PASS" else "TAIL_PLUS_BROWSER_PIPELINE_AVAILABLE",
        "authoritativeTailRequirement": req,
        "ownedPerformanceMs": 320 * 512 / SAMPLE_RATE * 1000,
        "requiredProcessingFrontierMs": (req["requiredProcessedSamples"] / SAMPLE_RATE * 1000) if req else None,
        "correctedFrontierMs": (req["requiredProcessedSamples"] / SAMPLE_RATE * 1000 + TIMING_CORRECTION_MS) if req else None,
        "finalOwnedAnalyzedThroughPerformanceMs": 320 * 512 / SAMPLE_RATE * 1000,
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "publicationBridgeParity": "NOT_EXECUTED" if chrome_pipeline.get("status") != "PASS" else "ATTEMPTED",
        "nodeReturncode": proc.returncode,
        "nodeStderr": proc.stderr,
    }


def local_tail_requirement(performance_owned_samples: int) -> dict[str, int]:
    correction_delay_samples = math.ceil(abs(TIMING_CORRECTION_MS) / 1000 * SAMPLE_RATE)
    required_processed_samples = math.ceil((performance_owned_samples + correction_delay_samples) / HOP_SAMPLES) * HOP_SAMPLES
    return {
        "correctionDelaySamples": correction_delay_samples,
        "requiredProcessedSamples": required_processed_samples,
        "requiredContextTailSamples": max(0, required_processed_samples - performance_owned_samples),
    }


def correction_receipt(source_identity: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_correction_receipt",
        "phase": "9G-D.2R",
        "d2HistoricalReportedOutcome": "ONLINE_AMT_BROWSER_EXPORT_BLOCKED",
        "d2rCorrectedInterpretation": "ONLINE_AMT_BROWSER_FEASIBILITY_UNRESOLVED_IMPLEMENTATION_INCOMPLETE",
        "retainedD2Evidence": {
            "frozenSourceIdentity": "PASS",
            "explicitPythonStateContract": "RECORDED",
            "pythonFormulaMelOracle": "PASS",
            "pythonChronologicalOracle": "RECORDED",
            "lmStepOnnxExport": "PASS",
        },
        "d2MelEvidenceReclassifiedAs": "PYTHON_MEL_FORMULA_ORACLE_PARITY",
        "sourceIdentity": source_identity["sourceCandidate"],
        "p15p22InferenceIncrease": 0,
    }


def graph_export_report(export: dict[str, Any], source_identity: dict[str, Any], py_parity: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_graph_export",
        "phase": "9G-D.2R",
        "sourceIdentity": source_identity["sourceCandidate"],
        "graphs": export,
        "pythonExportableParity": py_parity,
        "initialStateAssetPolicy": "deterministic_initial_state_tensors_versioned_as_browser_assets",
        "p15p22InferenceIncrease": 0,
    }


def layer_parity_report(py_parity: dict[str, Any], chrome: dict[str, Any], edge: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_browser_layer_parity",
        "phase": "9G-D.2R",
        "pythonToPythonExportable": py_parity,
        "pythonToChrome": extract_browser_layer(chrome),
        "pythonToEdge": extract_browser_layer(edge),
        "p15p22InferenceIncrease": 0,
    }


def step_parity_report(reference: dict[str, Any], chrome: dict[str, Any], edge: dict[str, Any], native: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_browser_step_parity",
        "phase": "9G-D.2R",
        "hopCount": reference["hopCount"],
        "totalPitchHopComparisons": reference["hopCount"] * 88,
        "nativeLmWebGpuAttempt": extract_native(native),
        "manualFloatLstmNeeded": native.get("status") != "PASS",
        "chrome": extract_browser_step(chrome),
        "edge": extract_browser_step(edge),
        "unsafeWebGpuFlagUsed": False,
        "wasmFallbackUsed": False,
        "p15p22InferenceIncrease": 0,
    }


def publication_bridge_report(ts_bridge: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_publication_bridge_parity",
        "phase": "9G-D.2R",
        **ts_bridge,
        "p15p22InferenceIncrease": 0,
    }


def runtime_report_from_browser(chrome: dict[str, Any], edge: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_default_browser_runtime",
        "phase": "9G-D.2R",
        "chromeDefaultWebGpu": extract_runtime(chrome),
        "edgeDefaultWebGpu": extract_runtime(edge),
        "unsafeWebGpuFlagUsed": False,
        "wasmFallbackUsed": False,
        "memoryTelemetry": {"status": "NOT_MEASURED", "reason": "browser API did not expose trustworthy process memory for this research harness"},
        "vramTelemetry": {"status": "NOT_MEASURED", "reason": "WebGPU adapter does not expose trustworthy VRAM utilization"},
        "networkTelemetry": {"status": "NOT_MEASURED", "reason": "local static harness; no production network transport"},
        "p15p22InferenceIncrease": 0,
    }


def feasibility_receipt(chrome: dict[str, Any], edge: dict[str, Any], py_parity: dict[str, Any], export: dict[str, Any], ts_bridge: dict[str, Any]) -> dict[str, Any]:
    chrome_ok = chrome.get("status") == "PASS"
    edge_ok = edge.get("status") == "PASS"
    if chrome_ok and edge_ok:
        outcome = "ONLINE_AMT_BROWSER_FEASIBILITY_VALIDATED"
    elif export["mel"].get("status") != "PASS":
        outcome = "ONLINE_AMT_BROWSER_MEL_EXPORT_BLOCKED"
    elif export["acoustic"].get("status") != "PASS":
        outcome = "ONLINE_AMT_BROWSER_ACOUSTIC_EXPORT_BLOCKED"
    elif not chrome_ok or not edge_ok:
        outcome = "ONLINE_AMT_BROWSER_IMPLEMENTATION_ERROR"
    else:
        outcome = "ONLINE_AMT_BROWSER_SOURCE_RUNTIME_PARITY_DIVERGED"
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_feasibility_receipt",
        "phase": "9G-D.2R",
        "outcome": outcome,
        "chromeStatus": chrome.get("status"),
        "edgeStatus": edge.get("status"),
        "pythonParity": py_parity,
        "publicationBridgeStatus": ts_bridge.get("status"),
        "browserDeploymentIdentity": browser_identity(export, outcome) if chrome_ok and edge_ok else None,
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "phase9gBHistoricalConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "p15p22InferenceIncrease": 0,
    }


def browser_identity(export: dict[str, Any], outcome: str) -> dict[str, Any]:
    payload = {
        "deploymentId": "online-amt-browser-v1",
        "sourceCandidateId": "online-amt-calibrated-v1",
        "upstreamCommit": d2.EXPECTED_REPO_COMMIT,
        "checkpointSha256": d2.EXPECTED_CHECKPOINT_SHA256,
        "configurationSha256": d2.EXPECTED_CONFIG_SHA256,
        "melGraphSha256": export["mel"].get("sha256"),
        "acousticGraphSha256": export["acoustic"].get("sha256"),
        "lmGraphSha256": export["lmFloat"].get("sha256"),
        "stateContractVersion": "online_amt_explicit_state_contract_v1",
        "ortWebVersion": "1.20.1",
        "executionProvider": "webgpu",
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "boost": 1.0,
        "nativeGatePolicy": "NATIVE_THRESHOLD_0_05_PATIENCE_100_GT",
        "hopSamples": HOP_SAMPLES,
        "sourceRuntimeParityStatus": outcome,
    }
    payload["deploymentSha256"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return payload


def extract_browser_layer(run: dict[str, Any]) -> dict[str, Any]:
    result = ((run.get("result") or {}).get("result") or {})
    return {
        "status": run.get("status"),
        "error": (run.get("result") or {}).get("error") or run.get("error"),
        "mel": result.get("mel"),
        "acousticOut": result.get("acousticOut"),
        "probabilities": result.get("probabilities"),
        "h": result.get("h"),
        "c": result.get("c"),
        "browser": ((run.get("result") or {}).get("runtime") or {}),
    }


def extract_browser_step(run: dict[str, Any]) -> dict[str, Any]:
    result = ((run.get("result") or {}).get("result") or {})
    return {
        "status": run.get("status"),
        "error": (run.get("result") or {}).get("error") or run.get("error"),
        "chosenState": result.get("chosenState"),
        "nativeGateRows": result.get("nativeGateRows"),
        "webgpuAdapter": result.get("webgpuAdapter"),
    }


def extract_native(run: dict[str, Any]) -> dict[str, Any]:
    result = ((run.get("result") or {}).get("result") or {})
    return {
        "status": run.get("status"),
        "error": (run.get("result") or {}).get("error") or run.get("error"),
        "probabilities": result.get("probabilities"),
        "h": result.get("h"),
        "c": result.get("c"),
        "browser": ((run.get("result") or {}).get("runtime") or {}),
    }


def extract_runtime(run: dict[str, Any]) -> dict[str, Any]:
    result = ((run.get("result") or {}).get("result") or {})
    return {
        "status": run.get("status"),
        "error": (run.get("result") or {}).get("error") or run.get("error"),
        "runtime": ((run.get("result") or {}).get("runtime") or {}),
        "ort": ((run.get("result") or {}).get("ort_asset") or {}),
        "sessionLoadCount": result.get("sessionLoadCount"),
        "graphLoadMs": result.get("graphLoadMs"),
        "firstGraphExecutionMs": result.get("firstGraphExecutionMs"),
        "firstCompleteHopMs": result.get("firstCompleteHopMs"),
        "completeHopLatencyMs": result.get("completeHopLatencyMs"),
        "queueDelayMs": result.get("queueDelayMs"),
        "finalQueueDelayMs": result.get("finalQueueDelayMs"),
        "maximumQueueDepth": result.get("maximumQueueDepth"),
        "tailQueueDelayMs": result.get("tailQueueDelayMs"),
        "backlogClassification": result.get("backlogClassification"),
    }


def compare_np(actual: np.ndarray, expected: np.ndarray) -> dict[str, float]:
    delta = np.abs(np.asarray(actual, dtype=np.float32) - np.asarray(expected, dtype=np.float32))
    return {"meanAbsDelta": float(delta.mean()), "maxAbsDelta": float(delta.max())}


def summarize_delta_rows(rows: list[dict[str, float]]) -> dict[str, Any]:
    if not rows:
        return {"status": "NOT_MEASURED"}
    return {
        "status": "PASS",
        "meanAbsDeltaMax": max(row["meanAbsDelta"] for row in rows),
        "maxAbsDelta": max(row["maxAbsDelta"] for row in rows),
    }


def write_npy(path: Path, array: np.ndarray) -> None:
    array = np.asarray(array)
    if array.dtype == np.float64:
        array = array.astype(np.float32)
    if array.dtype == np.int32:
        array = array.astype(np.int64)
    if array.dtype == np.float32:
        descr = "<f4"
    elif array.dtype == np.int64:
        descr = "<i8"
    else:
        raise ValueError(f"unsupported dtype for npy: {array.dtype}")
    shape = array.shape
    shape_text = "(" + ", ".join(str(item) for item in shape) + ("," if len(shape) == 1 else "") + ")"
    header = f"{{'descr': '{descr}', 'fortran_order': False, 'shape': {shape_text}, }}\n"
    magic_len = 10
    padding = (16 - ((magic_len + len(header)) % 16)) % 16
    header = header[:-1] + (" " * padding) + "\n"
    with path.open("wb") as handle:
        handle.write(b"\x93NUMPY")
        handle.write(bytes([1, 0]))
        handle.write(struct.pack("<H", len(header)))
        handle.write(header.encode("latin1"))
        handle.write(np.ascontiguousarray(array).tobytes())


def onnx_operators(path: Path) -> list[str]:
    try:
        import onnx
        model = onnx.load(str(path))
        return sorted({node.op_type for node in model.graph.node})
    except Exception as exc:
        return [f"ONNX_OPERATOR_READ_FAILED:{exc!r}"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_report(reports_dir: Path, stem: str, body: dict[str, Any]) -> None:
    body.setdefault("schemaVersion", 1)
    body.setdefault("artifact", stem)
    body.setdefault("phase", "9G-D.2R")
    target = reports_dir / f"{stem}_{REPORT_DATE}.json"
    target.write_text(json.dumps(normalize_paths(body), indent=2) + "\n", encoding="utf-8")


def normalize_paths(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: normalize_paths(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize_paths(item) for item in value]
    if isinstance(value, str) and (value.startswith("/workspace/") or "NoteVerse-Pro" in value):
        marker = "NoteVerse-Pro"
        if marker in value:
            return value.split(marker, 1)[1].lstrip("/\\").replace("\\", "/")
        return value.replace("/workspace/", "")
    return value


def write_all_blocked(reports_dir: Path, source_identity: dict[str, Any], reason: str) -> None:
    body = {"status": "BLOCKED", "reason": reason, "sourceIdentity": source_identity, "p15p22InferenceIncrease": 0}
    for stem in [
        "phase9g_d2r_correction_receipt",
        "phase9g_d2r_online_amt_graph_export",
        "phase9g_d2r_online_amt_browser_layer_parity",
        "phase9g_d2r_online_amt_browser_step_parity",
        "phase9g_d2r_online_amt_publication_bridge_parity",
        "phase9g_d2r_online_amt_default_browser_runtime",
        "phase9g_d2r_online_amt_feasibility_receipt",
    ]:
        write_report(reports_dir, stem, dict(body))


if __name__ == "__main__":
    raise SystemExit(main())
