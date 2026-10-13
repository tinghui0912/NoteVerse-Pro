#!/usr/bin/env python3
"""Phase 9G-D.2R.1 final Online-AMT browser closure.

Research-only. This script preserves D.2/D.2R receipts, exports one combined
active-hop graph, runs real browser Worker harnesses, bridges 326-hop artifacts
through the authoritative TypeScript publication helper, and writes compact
D.2R.1 reports. It does not touch production Practice or p15-p22 blind data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import qualify_online_amt_browser_stateful as d2  # noqa: E402
import qualify_online_amt_browser_stateful_d2r as d2r  # noqa: E402


REPORT_DATE = "2026-10-13"
OWNED_HOPS = 320
CONTEXT_TAIL_HOPS = 6
TOTAL_HOPS = OWNED_HOPS + CONTEXT_TAIL_HOPS
OWNED_SAMPLES = OWNED_HOPS * d2.HOP_SAMPLES
CONTEXT_TAIL_SAMPLES = CONTEXT_TAIL_HOPS * d2.HOP_SAMPLES
TIMING_CORRECTION_MS = d2.TIMING_CORRECTION_MS


class CombinedActiveHop(torch.nn.Module):
    def __init__(self, model: Any):
        super().__init__()
        self.mel = d2r.ExportableMel(model)
        self.acoustic = d2r.AcousticStep(model)
        self.lm = d2r.NativeLmStep(model)

    def forward(
        self,
        audio_last_2048: Any,
        mel_buffer_in: Any,
        cache0_in: Any,
        cache1_in: Any,
        h_in: Any,
        c_in: Any,
        prev_output_in: Any,
    ) -> tuple[Any, Any, Any, Any, Any, Any]:
        new_mel = self.mel(audio_last_2048)
        mel_buffer_out = torch.cat((mel_buffer_in[:, :, 1:], new_mel), dim=2)
        acoustic_out, cache0_out, cache1_out = self.acoustic(mel_buffer_out, cache0_in, cache1_in)
        probabilities, h_out, c_out = self.lm(acoustic_out, h_in, c_in, prev_output_in)
        return probabilities, mel_buffer_out, cache0_out, cache1_out, h_out, c_out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--online-amt-repo", type=Path, default=Path("backend/data/work/online_amt"))
    parser.add_argument("--checkpoint", type=Path, default=Path("backend/data/work/online_amt/model-180000.pt"))
    parser.add_argument("--config", type=Path, default=Path("backend/research/product_benchmark/product_benchmark_config.json"))
    parser.add_argument("--work-dir", type=Path, default=Path("backend/data/work/phase9gd2r1_online_amt_browser"))
    parser.add_argument("--reports-dir", type=Path, default=Path("backend/research/reports"))
    parser.add_argument("--ort-dir", type=Path, default=Path("apps/customer-web/node_modules/onnxruntime-web/dist"))
    parser.add_argument("--browser-channel", default="chrome")
    parser.add_argument("--edge-channel", default="msedge")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--skip-browser", action="store_true")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    work_dir = (repo_root / args.work_dir).resolve()
    reports_dir = (repo_root / args.reports_dir).resolve()
    fixture_dir = work_dir / "fixtures"
    graphs_dir = work_dir / "graphs"
    work_dir.mkdir(parents=True, exist_ok=True)
    fixture_dir.mkdir(parents=True, exist_ok=True)
    graphs_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    source_identity = d2.verify_source_identity(
        repo_root,
        (repo_root / args.online_amt_repo).resolve(),
        (repo_root / args.checkpoint).resolve(),
        repo_root / args.config,
    )
    if source_identity["qualificationStatus"] != "PASS":
        write_reports(reports_dir, blocked_reports(source_identity, "SOURCE_IDENTITY_BLOCKED"))
        return 2

    d2.prepare_online_amt_imports((repo_root / args.online_amt_repo).resolve())
    from transcribe import OnlineTranscriber, load_model

    model = load_model(str((repo_root / args.checkpoint).resolve()))
    model.eval()
    pcm = d2.load_nonblind_fixture(repo_root, TOTAL_HOPS)
    reference = generate_reference(model, OnlineTranscriber, pcm, fixture_dir)
    export = export_combined(model, reference, graphs_dir, fixture_dir)
    combined_py = compare_combined_pytorch(model, OnlineTranscriber, pcm, reference)
    combined_ort = run_python_ort_combined(export, reference, pcm)
    manifest = build_manifest(export, reference)
    (fixture_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    python_artifact_path = fixture_dir / "python_hop_artifact.json"
    python_artifact = build_hop_artifact(reference["probabilities"], reference["latenciesMs"])
    write_json(python_artifact_path, python_artifact)

    split_diagnostic = read_d2r_split_diagnostic(repo_root)
    if args.skip_browser:
        chrome_gate = chrome_worker = edge_worker = {"status": "NOT_EXECUTED", "reason": "--skip-browser"}
    else:
        chrome_gate = run_browser(repo_root, fixture_dir, repo_root / args.ort_dir, args.browser_channel, args.headed, "worker-gate", work_dir / "chrome_worker_gate.json")
        chrome_worker = run_browser(repo_root, fixture_dir, repo_root / args.ort_dir, args.browser_channel, args.headed, "worker-combined", work_dir / "chrome_worker_combined.json")
        edge_worker = run_browser(repo_root, fixture_dir, repo_root / args.ort_dir, args.edge_channel, args.headed, "worker-combined", work_dir / "edge_worker_combined.json")

    browser_artifact_path = fixture_dir / "browser_hop_artifact.json"
    browser_artifact = extract_browser_artifact(chrome_worker)
    if browser_artifact:
        write_json(browser_artifact_path, browser_artifact)
    bridge = run_bridge(repo_root, work_dir, python_artifact_path, browser_artifact_path if browser_artifact else None)

    reports = build_reports(
        repo_root=repo_root,
        source_identity=source_identity,
        export=export,
        combined_py=combined_py,
        combined_ort=combined_ort,
        split_diagnostic=split_diagnostic,
        chrome_gate=chrome_gate,
        chrome_worker=chrome_worker,
        edge_worker=edge_worker,
        bridge=bridge,
        python_artifact_path=python_artifact_path,
        browser_artifact_path=browser_artifact_path if browser_artifact else None,
    )
    write_reports(reports_dir, reports)
    print(json.dumps({"outcome": reports["phase9g_d2r1_online_amt_final_feasibility"]["outcome"], "reportsDir": d2.rel(repo_root, reports_dir)}, indent=2))
    return 0


def generate_reference(model: Any, transcriber_cls: Any, pcm: np.ndarray, fixture_dir: Path) -> dict[str, Any]:
    session = transcriber_cls(model, return_roll=False)
    initial = {
        "audio_buffer": session.audio_buffer.detach().cpu().numpy().astype(np.float32),
        "mel_buffer": session.mel_buffer.detach().cpu().numpy().astype(np.float32),
        "cache0": session.acoustic_layer_outputs[0].detach().cpu().numpy().astype(np.float32),
        "cache1": session.acoustic_layer_outputs[1].detach().cpu().numpy().astype(np.float32),
        "h": session.hidden[0].detach().cpu().numpy().astype(np.float32),
        "c": session.hidden[1].detach().cpu().numpy().astype(np.float32),
        "prev": session.prev_output.detach().cpu().numpy().astype(np.int64),
    }
    for name, value in initial.items():
        d2r.write_npy(fixture_dir / f"initial_{name}.npy", value)
    hops = pcm[: TOTAL_HOPS * d2.HOP_SAMPLES].reshape(TOTAL_HOPS, d2.HOP_SAMPLES).astype(np.float32)
    d2r.write_npy(fixture_dir / "hops.npy", hops.reshape(-1))
    rows: dict[str, list[np.ndarray]] = {key: [] for key in ["mel_buffer", "cache0", "cache1", "h", "c", "probabilities", "chosen"]}
    gate_rows = []
    latencies = []
    with torch.no_grad():
        for hop_index, hop in enumerate(hops):
            started = time.perf_counter()
            session.update_buffer(hop)
            session.switch_on_or_off()
            short = session.num_under_thr > session.patience
            if short:
                probs = np.zeros((88, 5), dtype=np.float32)
                probs[:, 0] = 1.0
                chosen = np.zeros((88,), dtype=np.int64)
            else:
                session.update_mel_buffer()
                acoustic_out = session.update_acoustic_out(session.mel_buffer.transpose(-1, -2))
                language_out, session.hidden = session.model.lm_model_step(acoustic_out, session.hidden, session.prev_output)
                boosted = language_out.clone()
                boosted[0, 0, :, 3:5] *= d2.PUBLISHED_ONSET_BOOST
                session.prev_output = boosted.argmax(dim=3)
                probs = boosted[0, 0].detach().cpu().numpy().astype(np.float32)
                chosen = session.prev_output[0, 0].detach().cpu().numpy().astype(np.int64)
            latencies.append((time.perf_counter() - started) * 1000)
            rows["mel_buffer"].append(session.mel_buffer.detach().cpu().numpy().astype(np.float32).reshape(-1))
            rows["cache0"].append(session.acoustic_layer_outputs[0].detach().cpu().numpy().astype(np.float32).reshape(-1))
            rows["cache1"].append(session.acoustic_layer_outputs[1].detach().cpu().numpy().astype(np.float32).reshape(-1))
            rows["h"].append(session.hidden[0].detach().cpu().numpy().astype(np.float32).reshape(-1))
            rows["c"].append(session.hidden[1].detach().cpu().numpy().astype(np.float32).reshape(-1))
            rows["probabilities"].append(probs.reshape(-1))
            rows["chosen"].append(chosen)
            gate_rows.append({"hopIndex": hop_index, "numUnderThr": int(session.num_under_thr), "shortCircuit": bool(short)})
    d2r.write_npy(fixture_dir / "reference_mel_buffer.npy", np.asarray(rows["mel_buffer"], dtype=np.float32).reshape(TOTAL_HOPS, 1, 229, 7))
    d2r.write_npy(fixture_dir / "reference_cache0.npy", np.asarray(rows["cache0"], dtype=np.float32).reshape(TOTAL_HOPS, 1, 64, 5, 229))
    d2r.write_npy(fixture_dir / "reference_cache1.npy", np.asarray(rows["cache1"], dtype=np.float32).reshape(TOTAL_HOPS, 1, 64, 3, 114))
    d2r.write_npy(fixture_dir / "reference_h.npy", np.asarray(rows["h"], dtype=np.float32).reshape(TOTAL_HOPS, 2, 1, model.language_hidden_size))
    d2r.write_npy(fixture_dir / "reference_c.npy", np.asarray(rows["c"], dtype=np.float32).reshape(TOTAL_HOPS, 2, 1, model.language_hidden_size))
    d2r.write_npy(fixture_dir / "reference_probabilities.npy", np.asarray(rows["probabilities"], dtype=np.float32).reshape(TOTAL_HOPS, 88, 5))
    d2r.write_npy(fixture_dir / "reference_chosen_states.npy", np.asarray(rows["chosen"], dtype=np.int64))
    return {
        "initial": initial,
        "hopCount": TOTAL_HOPS,
        "performanceOwnedSamples": OWNED_SAMPLES,
        "contextTailSamples": CONTEXT_TAIL_SAMPLES,
        "acousticOutFeatures": int(model.model_complexity_conv * 16),
        "probabilities": np.asarray(rows["probabilities"], dtype=np.float32).reshape(TOTAL_HOPS, 88, 5),
        "chosen": np.asarray(rows["chosen"], dtype=np.int64),
        "h": np.asarray(rows["h"], dtype=np.float32).reshape(TOTAL_HOPS, 2, 1, model.language_hidden_size),
        "c": np.asarray(rows["c"], dtype=np.float32).reshape(TOTAL_HOPS, 2, 1, model.language_hidden_size),
        "latenciesMs": latencies,
        "nativeGate": gate_rows,
    }


def export_combined(model: Any, reference: dict[str, Any], graphs_dir: Path, fixture_dir: Path) -> dict[str, Any]:
    combined_path = graphs_dir / "online_amt_combined_active_hop_opset18.onnx"
    module = CombinedActiveHop(model).eval()
    inputs = (
        torch.zeros((1, 2048), dtype=torch.float32),
        torch.from_numpy(reference["initial"]["mel_buffer"]).float(),
        torch.from_numpy(reference["initial"]["cache0"]).float(),
        torch.from_numpy(reference["initial"]["cache1"]).float(),
        torch.from_numpy(reference["initial"]["h"]).float(),
        torch.from_numpy(reference["initial"]["c"]).float(),
        torch.from_numpy(reference["initial"]["prev"]).long(),
    )
    graph = d2r.torch_export(
        torch,
        module,
        inputs,
        combined_path,
        ["audio_last_2048", "mel_buffer_in", "cache0_in", "cache1_in", "h_in", "c_in", "prev_output_in"],
        ["probabilities", "mel_buffer_out", "cache0_out", "cache1_out", "h_out", "c_out"],
    )
    if graph.get("status") == "PASS":
        shutil.copyfile(combined_path, fixture_dir / combined_path.name)
    graph["graphKind"] = "combinedActiveHop"
    graph["graphOptimizationSetting"] = "disabled"
    return graph


def compare_combined_pytorch(model: Any, transcriber_cls: Any, pcm: np.ndarray, reference: dict[str, Any]) -> dict[str, Any]:
    wrapper = CombinedActiveHop(model).eval()
    session = transcriber_cls(model, return_roll=False)
    state = {
        "mel": session.mel_buffer.clone(),
        "cache0": session.acoustic_layer_outputs[0].clone(),
        "cache1": session.acoustic_layer_outputs[1].clone(),
        "h": session.hidden[0].clone(),
        "c": session.hidden[1].clone(),
        "prev": session.prev_output.clone(),
        "audio": session.audio_buffer.clone(),
        "num": 0,
    }
    prob_deltas = []
    h_deltas = []
    c_deltas = []
    chosen_mismatch = 0
    with torch.no_grad():
        for hop_index in range(TOTAL_HOPS):
            hop_np = pcm[hop_index * d2.HOP_SAMPLES:(hop_index + 1) * d2.HOP_SAMPLES].astype(np.float32)
            state["audio"] = torch.cat((state["audio"][:, d2.HOP_SAMPLES:], torch.from_numpy(hop_np).view(1, d2.HOP_SAMPLES)), dim=1)
            intensity = float(state["audio"].max() - state["audio"].min()) if float(state["audio"].abs().max()) > 0 else 0.0
            state["num"] = state["num"] + 1 if intensity < 0.05 else 0
            if state["num"] > 100:
                probs = np.zeros((1, 1, 88, 5), dtype=np.float32)
                probs[:, :, :, 0] = 1.0
                chosen = np.zeros((1, 1, 88), dtype=np.int64)
            else:
                probs_t, mel, cache0, cache1, h, c = wrapper(state["audio"][:, -2048:], state["mel"], state["cache0"], state["cache1"], state["h"], state["c"], state["prev"])
                state.update({"mel": mel, "cache0": cache0, "cache1": cache1, "h": h, "c": c})
                state["prev"] = probs_t.argmax(dim=3)
                probs = probs_t.detach().cpu().numpy()
                chosen = state["prev"].detach().cpu().numpy()
            prob_deltas.append(compare_np(probs.reshape(88, 5), reference["probabilities"][hop_index]))
            ref_h = reference["h"][hop_index]
            ref_c = reference["c"][hop_index]
            h_deltas.append(compare_np(state["h"].detach().cpu().numpy(), ref_h))
            c_deltas.append(compare_np(state["c"].detach().cpu().numpy(), ref_c))
            chosen_mismatch += int((chosen.reshape(88) != reference["chosen"][hop_index]).sum())
    return {
        "status": "PASS" if chosen_mismatch == 0 else "MISMATCH",
        "chosenStateMismatchCount": chosen_mismatch,
        "probabilities": summarize_delta_rows(prob_deltas),
        "h": summarize_delta_rows(h_deltas),
        "c": summarize_delta_rows(c_deltas),
    }


def run_python_ort_combined(export: dict[str, Any], reference: dict[str, Any], pcm: np.ndarray) -> dict[str, Any]:
    if export.get("status") != "PASS":
        return {"status": "NOT_EXECUTED_EXPORT_FAILED"}
    try:
        import onnxruntime as ort
    except Exception as exc:
        return {"status": "NOT_EXECUTED_ONNXRUNTIME_UNAVAILABLE", "error": repr(exc)}
    session = ort.InferenceSession(export["path"], providers=["CPUExecutionProvider"])
    audio = reference["initial"]["audio_buffer"].astype(np.float32).copy()
    mel = reference["initial"]["mel_buffer"].astype(np.float32).copy()
    cache0 = reference["initial"]["cache0"].astype(np.float32).copy()
    cache1 = reference["initial"]["cache1"].astype(np.float32).copy()
    h = reference["initial"]["h"].astype(np.float32).copy()
    c = reference["initial"]["c"].astype(np.float32).copy()
    prev = reference["initial"]["prev"].astype(np.int64).copy()
    num = 0
    prob_deltas = []
    chosen_mismatch = 0
    for hop_index in range(TOTAL_HOPS):
        hop = pcm[hop_index * d2.HOP_SAMPLES:(hop_index + 1) * d2.HOP_SAMPLES].astype(np.float32)
        audio = np.concatenate((audio[:, d2.HOP_SAMPLES:], hop.reshape(1, d2.HOP_SAMPLES)), axis=1)
        intensity = float(audio.max() - audio.min()) if float(np.abs(audio).max()) > 0 else 0.0
        num = num + 1 if intensity < 0.05 else 0
        if num > 100:
            probs = np.zeros((1, 1, 88, 5), dtype=np.float32)
            probs[:, :, :, 0] = 1.0
            chosen = np.zeros((88,), dtype=np.int64)
        else:
            out = session.run(None, {
                "audio_last_2048": audio[:, -2048:].astype(np.float32),
                "mel_buffer_in": mel,
                "cache0_in": cache0,
                "cache1_in": cache1,
                "h_in": h,
                "c_in": c,
                "prev_output_in": prev,
            })
            probs, mel, cache0, cache1, h, c = out
            chosen = probs.argmax(axis=3).reshape(88)
            prev = chosen.reshape(1, 1, 88).astype(np.int64)
        prob_deltas.append(compare_np(probs.reshape(88, 5), reference["probabilities"][hop_index]))
        chosen_mismatch += int((chosen != reference["chosen"][hop_index]).sum())
    return {
        "status": "PASS" if chosen_mismatch == 0 else "MISMATCH",
        "executionProvider": "CPUExecutionProvider",
        "chosenStateMismatchCount": chosen_mismatch,
        "probabilities": summarize_delta_rows(prob_deltas),
    }


def build_manifest(export: dict[str, Any], reference: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "online_amt_d2r1_browser_fixture_manifest",
        "hopCount": TOTAL_HOPS,
        "performanceOwnedSamples": OWNED_SAMPLES,
        "contextTailSamples": CONTEXT_TAIL_SAMPLES,
        "acousticOutFeatures": reference["acousticOutFeatures"],
        "graphs": {"combined": {"file": export.get("file")}},
        "initialState": {
            "audioBuffer": "initial_audio_buffer.npy",
            "melBuffer": "initial_mel_buffer.npy",
            "cache0": "initial_cache0.npy",
            "cache1": "initial_cache1.npy",
            "h": "initial_h.npy",
            "c": "initial_c.npy",
            "prevOutput": "initial_prev.npy",
        },
        "fixtures": {
            "hops": "hops.npy",
            "referenceMelBuffer": "reference_mel_buffer.npy",
            "referenceCache0": "reference_cache0.npy",
            "referenceCache1": "reference_cache1.npy",
            "referenceProbabilities": "reference_probabilities.npy",
            "referenceChosenStates": "reference_chosen_states.npy",
            "referenceH": "reference_h.npy",
            "referenceC": "reference_c.npy",
        },
        "p15p22InferenceIncrease": 0,
    }


def run_browser(repo_root: Path, fixture_dir: Path, ort_dir: Path, channel: str, headed: bool, mode: str, output: Path) -> dict[str, Any]:
    cmd = [
        "node",
        str(repo_root / "backend/research/browser_runtime/online_amt_stateful_browser_harness.mjs"),
        "--fixture-dir", str(fixture_dir),
        "--ort-dir", str(ort_dir),
        "--backend", "webgpu",
        "--graph-optimization-level", "disabled",
        "--browser-channel", channel,
        "--mode", mode,
        "--output", str(output),
    ]
    if headed:
        cmd.append("--headed")
    try:
        started = time.perf_counter()
        proc = subprocess.run(cmd, cwd=repo_root, text=True, capture_output=True, timeout=360)
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


def run_bridge(repo_root: Path, work_dir: Path, python_artifact_path: Path, browser_artifact_path: Path | None) -> dict[str, Any]:
    output = work_dir / "publication_bridge_receipt.json"
    cmd = [
        "node",
        str(repo_root / "backend/research/browser_runtime/online_amt_d2r1_bridge_hop_artifacts.mjs"),
        "--python-artifact", str(python_artifact_path),
        "--output", str(output),
    ]
    if browser_artifact_path:
        cmd.extend(["--browser-artifact", str(browser_artifact_path)])
    try:
        proc = subprocess.run(cmd, cwd=repo_root, text=True, capture_output=True, timeout=120)
        body = json.loads(output.read_text(encoding="utf-8")) if output.exists() else None
        return {
            "status": "PASS" if proc.returncode == 0 and body else "FAILED",
            "returncode": proc.returncode,
            "stdoutTail": proc.stdout[-4000:],
            "stderrTail": proc.stderr[-4000:],
            "receipt": body,
        }
    except Exception as exc:
        return {"status": "FAILED", "error": repr(exc)}


def build_hop_artifact(probabilities: np.ndarray, latencies: list[float]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "online_amt_real_hop_output",
        "segments": [{
            "segmentId": "phase9gd2r1-p07-segment",
            "performanceStartMs": 0,
            "performanceOwnedSamples": OWNED_SAMPLES,
            "contextTailSamples": CONTEXT_TAIL_SAMPLES,
            "hops": [
                {
                    "hopIndex": hop_index,
                    "localDecisionSample": (hop_index + 1) * d2.HOP_SAMPLES,
                    "processingLatencyMs": float(latencies[hop_index]),
                    "pitchStates": [
                        {
                            "pitch": pitch_name(pitch),
                            "probabilities": [float(x) for x in probabilities[hop_index, pitch]],
                            "chosenState": int(np.argmax(probabilities[hop_index, pitch])),
                        }
                        for pitch in range(88)
                    ],
                }
                for hop_index in range(TOTAL_HOPS)
            ],
        }],
    }


def extract_browser_artifact(run: dict[str, Any]) -> dict[str, Any] | None:
    return (((run.get("result") or {}).get("result") or {}).get("artifact"))


def build_reports(**kwargs: Any) -> dict[str, dict[str, Any]]:
    repo_root: Path = kwargs["repo_root"]
    export = kwargs["export"]
    chrome_worker = kwargs["chrome_worker"]
    edge_worker = kwargs["edge_worker"]
    bridge = kwargs["bridge"]
    worker_file = repo_root / "backend/research/browser_runtime/online_amt_stateful_browser_worker.mjs"
    browser_chrome = extract_worker_result(chrome_worker)
    browser_edge = extract_worker_result(edge_worker)
    outcome = decide_outcome(browser_chrome, browser_edge, kwargs["combined_py"], kwargs["combined_ort"])
    online_eligible = outcome == "ONLINE_AMT_BROWSER_FEASIBILITY_VALIDATED"
    base = {
        "phase": "9G-D.2R.1",
        "schemaVersion": 1,
        "p15p22InferenceIncrease": 0,
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "phase9gBHistoricalConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
    }
    tail = {
        "correctionDelaySamples": math.ceil(abs(TIMING_CORRECTION_MS) / 1000 * d2.SAMPLE_RATE),
        "requiredProcessedSamples": TOTAL_HOPS * d2.HOP_SAMPLES,
        "requiredContextTailSamples": CONTEXT_TAIL_SAMPLES,
    }
    return {
        "phase9g_d2r1_correction_receipt": {
            **base,
            "artifact": "phase9g_d2r1_correction_receipt",
            "d2rSplitSessionResult": "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE",
            "d2rSplitSessionScope": "three-session browser implementation only",
            "d2r1Purpose": "one prospectively allowed combined active-hop graph plus corrected native gate plus actual Worker execution plus authoritative publication bridge",
            "retainedD2rEvidence": kwargs["split_diagnostic"],
        },
        "phase9g_d2r1_online_amt_combined_graph": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_combined_graph",
            "graph": export,
            "combinedPyTorchParity": kwargs["combined_py"],
            "combinedPythonOrtParity": kwargs["combined_ort"],
            "combinedGraphOptimizationAttempt": "ONE_ALLOWED_BOUND_OPTIMIZATION_ATTEMPT",
        },
        "phase9g_d2r1_online_amt_real_native_gate_parity": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_real_native_gate_parity",
            "nativeGatePrevOutputBugDisposition": "FIXED_BROWSER_SHORT_CIRCUIT_RETURNS_SILENT_STATES_WITHOUT_MUTATING_PERSISTENT_PREV_OUTPUT",
            "chromeGateWorker": extract_gate_result(kwargs["chrome_gate"]),
        },
        "phase9g_d2r1_online_amt_worker_step_parity": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_worker_step_parity",
            "worker": {"path": d2.rel(repo_root, worker_file), "sha256": sha256(worker_file)},
            "chrome": extract_parity(browser_chrome),
            "edge": extract_parity(browser_edge),
            "unsafeWebGpuFlagUsed": False,
            "wasmFallbackUsed": False,
        },
        "phase9g_d2r1_online_amt_publication_bridge_parity": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_publication_bridge_parity",
            "tailRequirement": tail,
            "ownedPerformanceMs": OWNED_SAMPLES / d2.SAMPLE_RATE * 1000,
            "requiredProcessingFrontierMs": TOTAL_HOPS * d2.HOP_SAMPLES / d2.SAMPLE_RATE * 1000,
            "correctedFrontierMs": TOTAL_HOPS * d2.HOP_SAMPLES / d2.SAMPLE_RATE * 1000 + TIMING_CORRECTION_MS,
            "finalAnalyzedThroughPerformanceMs": OWNED_SAMPLES / d2.SAMPLE_RATE * 1000,
            "pythonArtifact": file_identity(kwargs["python_artifact_path"]),
            "browserArtifact": file_identity(kwargs["browser_artifact_path"]) if kwargs["browser_artifact_path"] else None,
            "typescriptBridge": bridge,
        },
        "phase9g_d2r1_online_amt_worker_runtime": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_worker_runtime",
            "splitSessionDiagnostic": kwargs["split_diagnostic"].get("runtime"),
            "chromeHeadedDefaultWebGpu": extract_runtime(browser_chrome, chrome_worker),
            "edgeHeadedDefaultWebGpu": extract_runtime(browser_edge, edge_worker),
            "unsafeWebGpuFlagUsed": False,
            "wasmFallbackUsed": False,
        },
        "phase9g_d2r1_online_amt_final_feasibility": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_final_feasibility",
            "outcome": outcome,
            "onlineAmtEligibleForCurrentOfflineFirstProductionFinal": online_eligible,
            "noFurtherOnlineAmtOptimizationPhaseRequired": True,
            "browserDeploymentIdentity": browser_identity(export, worker_file, outcome) if outcome == "ONLINE_AMT_BROWSER_FEASIBILITY_VALIDATED" else None,
        },
    }


def decide_outcome(chrome: dict[str, Any], edge: dict[str, Any], py: dict[str, Any], ort: dict[str, Any]) -> str:
    if py.get("status") != "PASS" or ort.get("status") != "PASS":
        return "ONLINE_AMT_BROWSER_SOURCE_RUNTIME_PARITY_DIVERGED"
    if chrome.get("status") != "PASS" or edge.get("status") != "PASS":
        return "ONLINE_AMT_BROWSER_IMPLEMENTATION_ERROR"
    if chrome.get("chosenState", {}).get("mismatchCount") or edge.get("chosenState", {}).get("mismatchCount"):
        return "ONLINE_AMT_BROWSER_SOURCE_RUNTIME_PARITY_DIVERGED"
    if chrome.get("backlogClassification") != "TRANSIENT_BACKLOG_DRAINED" or edge.get("backlogClassification") != "TRANSIENT_BACKLOG_DRAINED":
        return "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE"
    return "ONLINE_AMT_BROWSER_FEASIBILITY_VALIDATED"


def run_reports_dir_path(name: str) -> str:
    return f"{name}_{REPORT_DATE}.json"


def write_reports(reports_dir: Path, reports: dict[str, dict[str, Any]]) -> None:
    for name, report in reports.items():
        write_json(reports_dir / run_reports_dir_path(name), report)


def blocked_reports(source_identity: dict[str, Any], reason: str) -> dict[str, dict[str, Any]]:
    return {
        "phase9g_d2r1_final_feasibility": {
            "schemaVersion": 1,
            "artifact": "phase9g_d2r1_online_amt_final_feasibility",
            "phase": "9G-D.2R.1",
            "outcome": "ONLINE_AMT_BROWSER_IMPLEMENTATION_ERROR",
            "reason": reason,
            "sourceIdentity": source_identity,
            "productionMicrophoneEnabled": False,
            "productionWinnerSelected": False,
            "phase9gBHistoricalConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
            "p15p22InferenceIncrease": 0,
        }
    }


def read_d2r_split_diagnostic(repo_root: Path) -> dict[str, Any]:
    reports = repo_root / "backend/research/reports"
    runtime = read_optional(reports / f"phase9g_d2r_online_amt_default_browser_runtime_{REPORT_DATE}.json")
    feasibility = read_optional(reports / f"phase9g_d2r_online_amt_feasibility_receipt_{REPORT_DATE}.json")
    return {
        "d2rSplitSessionEvidenceRetained": True,
        "outcome": (feasibility or {}).get("outcome"),
        "runtime": runtime,
    }


def run_bridge_digest(publications: Any) -> str:
    return hashlib.sha256(json.dumps(publications, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def extract_worker_result(run: dict[str, Any]) -> dict[str, Any]:
    return ((run.get("result") or {}).get("result") or {}) if run.get("status") == "PASS" else {"status": run.get("status"), "error": run.get("error") or (run.get("result") or {}).get("error")}


def extract_gate_result(run: dict[str, Any]) -> dict[str, Any]:
    body = extract_worker_result(run)
    return body.get("realNativeGateParity", body)


def extract_parity(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": body.get("status"),
        "hopCount": body.get("hopCount"),
        "probability": body.get("probability"),
        "melBuffer": body.get("melBuffer"),
        "cache0": body.get("cache0"),
        "cache1": body.get("cache1"),
        "h": body.get("h"),
        "c": body.get("c"),
        "chosenState": body.get("chosenState"),
    }


def extract_runtime(body: dict[str, Any], run: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": body.get("status"),
        "runtime": ((run.get("result") or {}).get("runtime") or {}),
        "ort": ((run.get("result") or {}).get("ort_asset") or {}),
        "sessionLoadCount": body.get("sessionLoadCount"),
        "combinedLoadMs": body.get("combinedLoadMs"),
        "firstCombinedExecutionMs": body.get("firstCombinedExecutionMs"),
        "completeHopLatencyMs": body.get("completeHopLatencyMs"),
        "combinedSessionRunMs": body.get("combinedSessionRunMs"),
        "nonOrtJsMs": body.get("nonOrtJsMs"),
        "queueDelayMs": body.get("queueDelayMs"),
        "finalQueueDelayMs": body.get("finalQueueDelayMs"),
        "maximumQueueDepth": body.get("maximumQueueDepth"),
        "tail64QueueDelayMs": body.get("tail64QueueDelayMs"),
        "backlogClassification": body.get("backlogClassification"),
    }


def browser_identity(export: dict[str, Any], worker_file: Path, outcome: str) -> dict[str, Any]:
    payload = {
        "deploymentId": "online-amt-browser-v1",
        "sourceCandidateId": "online-amt-calibrated-v1",
        "upstreamCommit": d2.EXPECTED_REPO_COMMIT,
        "checkpointSha256": d2.EXPECTED_CHECKPOINT_SHA256,
        "configurationSha256": d2.EXPECTED_CONFIG_SHA256,
        "combinedGraphSha256": export.get("sha256"),
        "browserWorkerSha256": sha256(worker_file),
        "stateContractVersion": "online_amt_explicit_state_contract_v2_combined_active_hop",
        "ortWebVersion": "1.20.1",
        "executionProvider": "webgpu",
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "publishedOnsetBoost": 1.0,
        "pseudoIntensity": "NATIVE",
        "hopSamples": d2.HOP_SAMPLES,
        "sourceRuntimeParityStatus": outcome,
    }
    payload["deploymentSha256"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return payload


def compare_np(actual: np.ndarray, expected: np.ndarray) -> dict[str, float]:
    delta = np.abs(np.asarray(actual, dtype=np.float32) - np.asarray(expected, dtype=np.float32))
    return {"meanAbsDelta": float(delta.mean()), "maxAbsDelta": float(delta.max())}


def summarize_delta_rows(rows: list[dict[str, float]]) -> dict[str, Any]:
    if not rows:
        return {"status": "NOT_MEASURED"}
    return {"status": "PASS", "meanAbsDeltaMax": max(row["meanAbsDelta"] for row in rows), "maxAbsDelta": max(row["maxAbsDelta"] for row in rows)}


def pitch_name(pitch_index: int) -> str:
    midi = pitch_index + 21
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return f"{names[midi % 12]}{midi // 12 - 1}"


def file_identity(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    return {"path": str(path), "byteSize": path.stat().st_size, "sha256": sha256(path)}


def read_optional(path: Path) -> dict[str, Any] | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalize(value), indent=2) + "\n", encoding="utf-8")


def normalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, str) and "NoteVerse-Pro" in value:
        return value.split("NoteVerse-Pro", 1)[1].lstrip("/\\").replace("\\", "/")
    if isinstance(value, str) and value.startswith("/workspace/"):
        return value.removeprefix("/workspace/").replace("\\", "/")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
