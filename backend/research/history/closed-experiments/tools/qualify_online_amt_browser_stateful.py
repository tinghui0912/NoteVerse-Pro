#!/usr/bin/env python3
"""Phase 9G-D.2 Online-AMT stateful browser feasibility research orchestrator.

This script is research-only. It verifies the frozen Phase 9G-B Online-AMT
identity, derives the real Python OnlineTranscriber state contract, creates
compact non-blind oracle evidence, and attempts the smallest explicit-state
ONNX export. It intentionally does not integrate production microphone
Practice or score a product winner.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


EXPECTED_REPO_COMMIT = "ad12550909a1d86f699097d11885f427054a5ac2"
EXPECTED_CHECKPOINT_SHA256 = "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0"
EXPECTED_CHECKPOINT_BYTES = 178_804_960
EXPECTED_CONFIG_SHA256 = "0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375"
SAMPLE_RATE = 16_000
HOP_SAMPLES = 512
HOP_MS = 32
TIMING_CORRECTION_MS = -162.93750000004252
PUBLISHED_ONSET_BOOST = 1.0
PSEUDO_INTENSITY = "NATIVE"
MIDI_OFFSET = 21
REPORT_DATE = "2026-10-12"


@dataclass
class TimedStep:
    hop_index: int
    total_ms: float
    mel_ms: float
    acoustic_ms: float
    language_ms: float
    native_gate_short_circuit: bool


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--online-amt-repo", type=Path, default=Path("backend/data/work/online_amt"))
    parser.add_argument("--checkpoint", type=Path, default=Path("backend/data/work/online_amt/model-180000.pt"))
    parser.add_argument("--config", type=Path, default=Path("backend/research/product_benchmark/product_benchmark_config.json"))
    parser.add_argument("--work-dir", type=Path, default=Path("backend/data/work/phase9gd2_online_amt_browser"))
    parser.add_argument("--reports-dir", type=Path, default=Path("backend/research/reports"))
    parser.add_argument("--hop-count", type=int, default=320)
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    online_amt_repo = (repo_root / args.online_amt_repo).resolve()
    checkpoint = (repo_root / args.checkpoint).resolve()
    work_dir = (repo_root / args.work_dir).resolve()
    reports_dir = (repo_root / args.reports_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    source_identity = verify_source_identity(repo_root, online_amt_repo, checkpoint, repo_root / args.config)
    write_report(reports_dir, "phase9g_d2_online_amt_browser_source_identity", source_identity)

    if source_identity["qualificationStatus"] != "PASS":
        blocked = feasibility_receipt(source_identity, outcome="ONLINE_AMT_BROWSER_EXPORT_BLOCKED")
        write_placeholder_reports(reports_dir, blocked)
        return 2

    prepare_online_amt_imports(online_amt_repo)
    import librosa
    import torch
    from transcribe import OnlineTranscriber, load_model
    from autoregressive import constants

    model = load_model(str(checkpoint))
    transcriber = OnlineTranscriber(model, return_roll=False)
    state_contract = build_state_contract(source_identity, model, transcriber, constants, torch)
    write_report(reports_dir, "phase9g_d2_online_amt_explicit_state_contract", state_contract)

    pcm = load_nonblind_fixture(repo_root, args.hop_count)
    oracle = run_oracle_sequence(
        model=model,
        transcriber_cls=OnlineTranscriber,
        pcm=pcm,
        hop_count=args.hop_count,
        torch=torch,
        librosa=librosa,
        work_dir=work_dir,
        repo_root=repo_root,
    )
    mel_report = oracle["melReport"]
    step_report = oracle["stepReport"]

    export_report = attempt_lm_onnx_export(
        model=model,
        torch=torch,
        work_dir=work_dir,
        step_report=step_report,
    )
    step_report["onnxExport"] = export_report
    step_report["browserWebGpuParity"] = {
        "status": "NOT_EXECUTED",
        "reason": (
            "Full browser-local stateful Online-AMT requires the mel step, acoustic CNN cache, "
            "LSTM recurrent state, native gate, and bridge to be implemented together. D.2 generated "
            "the Python oracle and LM-step ONNX export attempt, but no complete browser worker step "
            "was available to execute without inventing semantics."
        ),
    }

    native_gate = run_native_gate_fixtures(model, OnlineTranscriber, torch)
    step_report["nativeGateBoundaryParity"] = native_gate
    step_report["segmentReset"] = segment_reset_report(model, OnlineTranscriber, torch, pcm)
    step_report["statefulMattersDiagnostic"] = stateful_matters_report(model, OnlineTranscriber, torch, pcm)
    step_report["publicationBridgeParity"] = {
        "status": "NOT_EXECUTED",
        "reason": "No browser hop artifact exists because complete browser step parity is blocked.",
        "timingCorrectionMs": TIMING_CORRECTION_MS,
    }
    write_report(reports_dir, "phase9g_d2_online_amt_mel_preprocessing_parity", mel_report)
    write_report(reports_dir, "phase9g_d2_online_amt_browser_step_parity", step_report)

    runtime_report = build_runtime_report(step_report, export_report)
    write_report(reports_dir, "phase9g_d2_online_amt_default_browser_runtime", runtime_report)

    feasibility = feasibility_receipt(
        source_identity,
        outcome="ONLINE_AMT_BROWSER_EXPORT_BLOCKED",
        state_contract=state_contract,
        mel_report=mel_report,
        step_report=step_report,
        runtime_report=runtime_report,
    )
    write_report(reports_dir, "phase9g_d2_online_amt_feasibility_receipt", feasibility)
    print(json.dumps({"sourceIdentity": source_identity, "feasibility": feasibility}, indent=2))
    return 0


def verify_source_identity(repo_root: Path, online_amt_repo: Path, checkpoint: Path, config_path: Path) -> dict[str, Any]:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    candidate = next((item for item in config["candidates"] if item["candidateId"] == "online-amt-calibrated-v1"), None)
    problems: list[str] = []
    if candidate is None:
        problems.append("online-amt candidate missing from product benchmark config")
        candidate = {}
    streaming = candidate.get("streaming", {})
    expected_values = {
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "publishedOnsetBoost": PUBLISHED_ONSET_BOOST,
        "pseudoIntensityShortcut": PSEUDO_INTENSITY,
        "hopSamples": HOP_SAMPLES,
        "sampleRateHz": SAMPLE_RATE,
    }
    for key, expected in expected_values.items():
        actual = streaming.get(key)
        if actual != expected:
            problems.append(f"config {key} drift: {actual!r} != {expected!r}")
    if candidate.get("configurationSha256") != EXPECTED_CONFIG_SHA256:
        problems.append("configurationSha256 drift")
    if not online_amt_repo.exists():
        problems.append("online_amt repo missing")
        repo_commit = None
        dirty = None
    else:
        repo_commit = run_text(["git", "-C", str(online_amt_repo), "rev-parse", "HEAD"])
        dirty = run_text(["git", "-C", str(online_amt_repo), "status", "--short"]).splitlines()
        if repo_commit != EXPECTED_REPO_COMMIT:
            problems.append(f"upstream commit mismatch: {repo_commit}")
    checkpoint_identity = file_identity(checkpoint)
    if checkpoint_identity.get("sha256") != EXPECTED_CHECKPOINT_SHA256:
        problems.append(f"checkpoint SHA mismatch: {checkpoint_identity.get('sha256')}")
    if checkpoint_identity.get("byteSize") != EXPECTED_CHECKPOINT_BYTES:
        problems.append(f"checkpoint byte mismatch: {checkpoint_identity.get('byteSize')}")
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2_online_amt_browser_source_identity",
        "phase": "9G-D.2",
        "qualificationStatus": "PASS" if not problems else "BLOCKED",
        "problems": problems,
        "sourceCandidate": {
            "candidateId": "online-amt-calibrated-v1",
            "profileId": "online-amt-calibration-native-boost-1",
            "configurationSha256": EXPECTED_CONFIG_SHA256,
            "repo": "https://github.com/jdasam/online_amt",
            "expectedRepoCommit": EXPECTED_REPO_COMMIT,
            "actualRepoCommit": repo_commit,
            "upstreamWorkingTreeStatus": dirty,
            "checkpoint": checkpoint_identity,
        },
        "frozenConfigValues": expected_values,
        "configSource": rel(repo_root, config_path),
        "productBenchmarkConfigSha256": sha256(config_path),
        "p15p22InferenceIncrease": 0,
    }


def build_state_contract(source_identity: dict[str, Any], model: Any, transcriber: Any, constants: Any, torch: Any) -> dict[str, Any]:
    state = snapshot_state(transcriber, torch)
    checkpoint = torch.load(source_identity["sourceCandidate"]["checkpoint"]["path"], map_location="cpu")
    metadata = {
        "model_complexity_conv": int(checkpoint["model_complexity_conv"]),
        "model_complexity_lstm": int(checkpoint["model_complexity_lstm"]),
        "language_hidden_size": int(model.language_hidden_size),
    }
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2_online_amt_explicit_state_contract",
        "phase": "9G-D.2",
        "upstreamConstants": {
            "SAMPLE_RATE": int(constants.SAMPLE_RATE),
            "HOP_LENGTH": int(constants.HOP_LENGTH),
            "N_MELS": int(constants.N_MELS),
            "WINDOW_LENGTH": int(constants.WINDOW_LENGTH),
            "MEL_FMIN": int(constants.MEL_FMIN),
            "MEL_FMAX": int(constants.MEL_FMAX),
        },
        "checkpointMetadata": metadata,
        "mutableState": state,
        "initializationSemantics": {
            "audio_buffer": "zeros(1, 5120)",
            "mel_buffer": "model.melspectrogram(initial zero audio_buffer)",
            "acoustic_layer_outputs": "init_acoustic_layer(mel_buffer)",
            "hidden": "zero 2-layer LSTM h/c",
            "prev_output": "zeros(1, 1, 88) long",
            "num_under_thr": 0,
        },
        "stateContractVersion": "online_amt_explicit_state_contract_v1",
        "p15p22InferenceIncrease": 0,
    }


def run_oracle_sequence(*, model: Any, transcriber_cls: Any, pcm: np.ndarray, hop_count: int, torch: Any, librosa: Any, work_dir: Path, repo_root: Path) -> dict[str, Any]:
    session = transcriber_cls(model, return_roll=False)
    hop_rows = []
    mel_rows = []
    timings: list[TimedStep] = []
    for hop_index in range(hop_count):
        hop = pcm[hop_index * HOP_SAMPLES:(hop_index + 1) * HOP_SAMPLES]
        row, timing, mel_row = timed_reference_step(session, hop, hop_index, torch, librosa)
        hop_rows.append(row)
        timings.append(timing)
        if mel_row is not None:
            mel_rows.append(mel_row)
    state_hash_manifest = work_dir / "python_oracle_state_digests.json"
    state_hash_manifest.write_text(json.dumps({"hops": hop_rows}, indent=2), encoding="utf-8")
    chosen_states = np.asarray([row["chosenStateSha256"] for row in hop_rows], dtype=object)
    step_latencies = [timing.total_ms for timing in timings]
    mel_latencies = [timing.mel_ms for timing in timings]
    acoustic_latencies = [timing.acoustic_ms for timing in timings]
    language_latencies = [timing.language_ms for timing in timings]
    queue = model_single_worker(step_latencies)
    step_report = {
        "schemaVersion": 1,
        "artifact": "phase9g_d2_online_amt_browser_step_parity",
        "phase": "9G-D.2",
        "pythonOracle": {
            "hopCount": hop_count,
            "totalPitchHopComparisons": hop_count * 88,
            "chosenStateDigestSequenceSha256": sha256_bytes("\n".join(chosen_states.tolist()).encode("utf-8")),
            "stateDigestManifest": rel(repo_root, state_hash_manifest),
            "probabilityDigestFirstHop": hop_rows[0]["probabilitiesSha256"],
            "probabilityDigestLastHop": hop_rows[-1]["probabilitiesSha256"],
        },
        "parityHierarchy": {
            "mel": "MEASURED_IN_MEL_REPORT",
            "acousticCache": "PYTHON_ORACLE_DIGESTED; BROWSER_PARITY_NOT_EXECUTED",
            "languageState": "PYTHON_ORACLE_DIGESTED; BROWSER_PARITY_NOT_EXECUTED",
            "discreteChosenState": "BROWSER_PARITY_NOT_EXECUTED",
            "productResearchBridge": "BROWSER_HOP_ARTIFACT_NOT_AVAILABLE",
        },
        "chosenStateParity": {
            "status": "NOT_EXECUTED",
            "mismatchCount": None,
            "firstMismatch": None,
            "reason": "complete browser step not available",
        },
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "segmentTailParity": segment_tail_report(len(pcm)),
        "runtimeTimingPythonOracleMs": {
            "completeHop": summarize(step_latencies),
            "mel": summarize(mel_latencies),
            "acoustic": summarize(acoustic_latencies),
            "language": summarize(language_latencies),
        },
        "singleWorkerScheduleAt32MsArrival": queue,
        "statefulContinuity": True,
        "p15p22InferenceIncrease": 0,
    }
    mel_report = {
        "schemaVersion": 1,
        "artifact": "phase9g_d2_online_amt_mel_preprocessing_parity",
        "phase": "9G-D.2",
        "portableMelImplementation": "librosa.stft(center=false) + HTK mel + log(clamp(min=1e-5))",
        "fixtureCount": len(mel_rows),
        "rows": mel_rows,
        "summary": {
            "maxAbsDelta": max(row["maxAbsDelta"] for row in mel_rows),
            "meanAbsDeltaMaxAcrossRows": max(row["meanAbsDelta"] for row in mel_rows),
            "status": "PASS" if all(row["maxAbsDelta"] <= 1e-6 for row in mel_rows) else "WARN_NUMERICAL_DELTA",
        },
        "p15p22InferenceIncrease": 0,
    }
    return {"stepReport": step_report, "melReport": mel_report}


def timed_reference_step(session: Any, audio: np.ndarray, hop_index: int, torch: Any, librosa: Any) -> tuple[dict[str, Any], TimedStep, dict[str, Any] | None]:
    with torch.no_grad():
        t0 = time.perf_counter()
        session.update_buffer(audio.astype(np.float32))
        session.switch_on_or_off()
        if session.num_under_thr > session.patience:
            probabilities = np.zeros((88, 5), dtype=np.float32)
            probabilities[:, 0] = 1.0
            states = np.zeros(88, dtype=np.int64)
            row = oracle_row(session, probabilities, states, hop_index, native_short=True)
            timing = TimedStep(hop_index, (time.perf_counter() - t0) * 1000, 0, 0, 0, True)
            return row, timing, None
        mel_before = session.mel_buffer.detach().clone()
        m0 = time.perf_counter()
        session.update_mel_buffer()
        m1 = time.perf_counter()
        portable_last = portable_new_mel_frame(session.audio_buffer.detach().cpu().numpy()[0], session.model.melspectrogram.mel_basis.detach().cpu().numpy(), librosa)
        upstream_last = session.mel_buffer[:, :, 6:].detach().cpu().numpy()
        mel_row = {
            "hopIndex": hop_index,
            "portableMelFrameSha256": sha256_float32(portable_last),
            "upstreamMelFrameSha256": sha256_float32(upstream_last),
            "meanAbsDelta": float(np.mean(np.abs(portable_last - upstream_last))),
            "maxAbsDelta": float(np.max(np.abs(portable_last - upstream_last))),
            "melBufferChanged": sha256_float32(mel_before.detach().cpu().numpy()) != sha256_float32(session.mel_buffer.detach().cpu().numpy()),
        }
        a0 = time.perf_counter()
        acoustic_out = session.update_acoustic_out(session.mel_buffer.transpose(-1, -2))
        a1 = time.perf_counter()
        l0 = time.perf_counter()
        language_out, session.hidden = session.model.lm_model_step(acoustic_out, session.hidden, session.prev_output)
        boosted = language_out.clone()
        boosted[0, 0, :, 3:5] *= PUBLISHED_ONSET_BOOST
        session.prev_output = boosted.argmax(dim=3)
        l1 = time.perf_counter()
        probabilities = language_out[0, 0].detach().cpu().numpy().astype(np.float32)
        states = session.prev_output[0, 0].detach().cpu().numpy().astype(np.int64)
        row = oracle_row(session, probabilities, states, hop_index, native_short=False, acoustic_out=acoustic_out.detach().cpu().numpy())
        timing = TimedStep(hop_index, (time.perf_counter() - t0) * 1000, (m1 - m0) * 1000, (a1 - a0) * 1000, (l1 - l0) * 1000, False)
        return row, timing, mel_row


def oracle_row(session: Any, probabilities: np.ndarray, states: np.ndarray, hop_index: int, *, native_short: bool, acoustic_out: np.ndarray | None = None) -> dict[str, Any]:
    hidden_h, hidden_c = session.hidden if session.hidden is not None else (None, None)
    return {
        "hopIndex": hop_index,
        "nativeGateShortCircuit": native_short,
        "numUnderThr": int(session.num_under_thr),
        "audioBufferSha256": sha256_float32(session.audio_buffer.detach().cpu().numpy()),
        "melBufferSha256": sha256_float32(session.mel_buffer.detach().cpu().numpy()),
        "acousticCache0Sha256": sha256_float32(session.acoustic_layer_outputs[0].detach().cpu().numpy()),
        "acousticCache1Sha256": sha256_float32(session.acoustic_layer_outputs[1].detach().cpu().numpy()),
        "acousticOutputSha256": sha256_float32(acoustic_out) if acoustic_out is not None else None,
        "hSha256": sha256_float32(hidden_h.detach().cpu().numpy()) if hidden_h is not None else None,
        "cSha256": sha256_float32(hidden_c.detach().cpu().numpy()) if hidden_c is not None else None,
        "prevOutputSha256": sha256_int64(session.prev_output.detach().cpu().numpy()),
        "probabilitiesSha256": sha256_float32(probabilities),
        "chosenStateSha256": sha256_int64(states),
        "chosenStateCounts": {str(i): int(np.count_nonzero(states == i)) for i in range(5)},
    }


def portable_new_mel_frame(audio_buffer: np.ndarray, mel_basis: np.ndarray, librosa: Any) -> np.ndarray:
    magnitudes = np.abs(librosa.core.stft(audio_buffer[-2048:], n_fft=2048, hop_length=512, center=False))
    mel = np.matmul(mel_basis, magnitudes)
    return np.log(np.clip(mel, 1e-5, None))[None, :, :].astype(np.float32)


def attempt_lm_onnx_export(*, model: Any, torch: Any, work_dir: Path, step_report: dict[str, Any]) -> dict[str, Any]:
    try:
        import onnx  # type: ignore
        import onnxruntime as ort  # type: ignore
    except Exception as exc:
        return {"status": "BLOCKED", "reason": f"ONNX_DEPENDENCY_UNAVAILABLE:{exc!r}"}

    class LmStepWrapper(torch.nn.Module):
        def __init__(self, wrapped: Any):
            super().__init__()
            self.wrapped = wrapped

        def forward(self, acoustic_out: Any, h_in: Any, c_in: Any, prev_output_in: Any) -> tuple[Any, Any, Any]:
            probs, (h_out, c_out) = self.wrapped.lm_model_step(acoustic_out, (h_in, c_in), prev_output_in)
            return probs, h_out, c_out

    onnx_path = work_dir / "online_amt_lm_step_opset18.onnx"
    wrapper = LmStepWrapper(model).eval()
    acoustic = torch.zeros((1, 1, model.model_complexity_conv * 16), dtype=torch.float32)
    h = torch.zeros((2, 1, model.language_hidden_size), dtype=torch.float32)
    c = torch.zeros((2, 1, model.language_hidden_size), dtype=torch.float32)
    prev = torch.zeros((1, 1, 88), dtype=torch.long)
    try:
        torch.onnx.export(
            wrapper,
            (acoustic, h, c, prev),
            str(onnx_path),
            input_names=["acoustic_out", "h_in", "c_in", "prev_output_in"],
            output_names=["probabilities", "h_out", "c_out"],
            opset_version=18,
            dynamic_axes=None,
        )
        sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        output = sess.run(None, {
            "acoustic_out": acoustic.numpy(),
            "h_in": h.numpy(),
            "c_in": c.numpy(),
            "prev_output_in": prev.numpy(),
        })
        return {
            "status": "EXPORTED_LM_STEP_ONLY",
            "path": str(onnx_path),
            "sha256": sha256(onnx_path),
            "byteSize": onnx_path.stat().st_size,
            "opset": 18,
            "onnxVersion": getattr(onnx, "__version__", "unknown"),
            "onnxRuntimeVersion": getattr(ort, "__version__", "unknown"),
            "graphScope": "language_model_step_only",
            "browserCompleteness": "INCOMPLETE_ACOUSTIC_MEL_NATIVE_GATE_STATEFUL_WORKER_NOT_EXPORTED",
            "outputShapes": [list(item.shape) for item in output],
        }
    except Exception as exc:
        return {"status": "BLOCKED", "reason": repr(exc), "graphScope": "language_model_step_only"}


def run_native_gate_fixtures(model: Any, transcriber_cls: Any, torch: Any) -> dict[str, Any]:
    rows = []
    for count in [99, 100, 101, 102]:
        session = transcriber_cls(model, return_roll=False)
        for _ in range(count):
            step_for_gate(session, np.zeros(HOP_SAMPLES, dtype=np.float32), torch)
        rows.append({
            "silentHopCount": count,
            "numUnderThr": int(session.num_under_thr),
            "shortCircuitExpected": count > 100,
            "prevOutputDigest": sha256_int64(session.prev_output.detach().cpu().numpy()),
            "hDigest": sha256_float32(session.hidden[0].detach().cpu().numpy()),
            "cDigest": sha256_float32(session.hidden[1].detach().cpu().numpy()),
        })
    recovery = transcriber_cls(model, return_roll=False)
    for _ in range(101):
        step_for_gate(recovery, np.zeros(HOP_SAMPLES, dtype=np.float32), torch)
    before = snapshot_state(recovery, torch)
    step_for_gate(recovery, sine_hop(), torch)
    after = snapshot_state(recovery, torch)
    return {
        "status": "PYTHON_REFERENCE_RECORDED_BROWSER_PARITY_NOT_EXECUTED",
        "threshold": 0.05,
        "patience": 100,
        "boundary": "num_under_thr > patience",
        "rows": rows,
        "nonSilentRecovery": {
            "numUnderThrBefore": before["num_under_thr"]["value"],
            "numUnderThrAfter": after["num_under_thr"]["value"],
            "hChanged": before["hidden_h"]["sha256"] != after["hidden_h"]["sha256"],
            "prevOutputChanged": before["prev_output"]["sha256"] != after["prev_output"]["sha256"],
        },
    }


def step_for_gate(session: Any, audio: np.ndarray, torch: Any) -> None:
    with torch.no_grad():
        session.update_buffer(audio.astype(np.float32))
        session.switch_on_or_off()
        if session.num_under_thr > session.patience:
            return
        session.update_mel_buffer()
        acoustic_out = session.update_acoustic_out(session.mel_buffer.transpose(-1, -2))
        language_out, session.hidden = session.model.lm_model_step(acoustic_out, session.hidden, session.prev_output)
        session.prev_output = language_out.argmax(dim=3)


def segment_reset_report(model: Any, transcriber_cls: Any, torch: Any, pcm: np.ndarray) -> dict[str, Any]:
    first = transcriber_cls(model, return_roll=False)
    second = transcriber_cls(model, return_roll=False)
    initial_equal = snapshot_state(first, torch) == snapshot_state(second, torch)
    step_for_gate(first, pcm[:HOP_SAMPLES], torch)
    changed = snapshot_state(first, torch) != snapshot_state(second, torch)
    reset = transcriber_cls(model, return_roll=False)
    reset_equal = snapshot_state(second, torch) == snapshot_state(reset, torch)
    return {"initialStateDeterministic": initial_equal, "stateChangesAfterHop": changed, "freshSegmentResetRestoresInitialState": reset_equal}


def stateful_matters_report(model: Any, transcriber_cls: Any, torch: Any, pcm: np.ndarray) -> dict[str, Any]:
    def run(reset_each: bool) -> list[str]:
        session = transcriber_cls(model, return_roll=False)
        digests = []
        for idx in range(64):
            if reset_each and idx > 0:
                session.hidden = model.init_lstm_hidden(1, torch.device("cpu"))
                session.prev_output = torch.zeros_like(session.prev_output)
            step_for_gate(session, pcm[idx * HOP_SAMPLES:(idx + 1) * HOP_SAMPLES], torch)
            digests.append(sha256_int64(session.prev_output.detach().cpu().numpy()))
        return digests
    normal = run(False)
    reset = run(True)
    first = next((i for i, (a, b) in enumerate(zip(normal, reset)) if a != b), None)
    return {"statefulEffectDemonstrated": first is not None, "firstDivergenceHop": first}


def build_runtime_report(step_report: dict[str, Any], export_report: dict[str, Any]) -> dict[str, Any]:
    queue = step_report["singleWorkerScheduleAt32MsArrival"]
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2_online_amt_default_browser_runtime",
        "phase": "9G-D.2",
        "browserRuntimeStatus": "NOT_EXECUTED_COMPLETE_BROWSER_STEP_BLOCKED",
        "ortWebVersionRequiredFirst": "1.20.1",
        "chromeDefaultWebGpu": {"status": "NOT_EXECUTED", "reason": "complete browser-local step not available"},
        "edgeDefaultWebGpu": {"status": "NOT_EXECUTED", "reason": "complete browser-local step not available"},
        "unsafeWebGpuFlagUsed": False,
        "wasmFallbackUsed": False,
        "onnxGraphs": [export_report] if export_report else [],
        "sessionLoadCount": 0,
        "pythonOracleTimingMs": step_report["runtimeTimingPythonOracleMs"],
        "singleWorkerScheduleAt32MsArrival": queue,
        "memoryTelemetry": {"status": "NOT_MEASURED", "reason": "no complete browser worker executed"},
        "vramTelemetry": {"status": "NOT_MEASURED", "reason": "no complete browser worker executed"},
        "networkTelemetry": {"status": "NOT_MEASURED", "reason": "local research oracle only"},
        "p15p22InferenceIncrease": 0,
    }


def feasibility_receipt(source_identity: dict[str, Any], *, outcome: str, state_contract: dict[str, Any] | None = None, mel_report: dict[str, Any] | None = None, step_report: dict[str, Any] | None = None, runtime_report: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2_online_amt_feasibility_receipt",
        "phase": "9G-D.2",
        "outcome": outcome,
        "reason": "complete browser-local explicit-state Online-AMT step parity was not proven",
        "sourceIdentityStatus": source_identity["qualificationStatus"],
        "stateContractStatus": "RECORDED" if state_contract else "NOT_RECORDED",
        "melParityStatus": mel_report.get("summary", {}).get("status") if mel_report else "NOT_RECORDED",
        "chosenStateParityStatus": step_report.get("chosenStateParity", {}).get("status") if step_report else "NOT_RECORDED",
        "browserRuntimeStatus": runtime_report.get("browserRuntimeStatus") if runtime_report else "NOT_RECORDED",
        "deploymentIdentityCreated": False,
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "phase9gBHistoricalConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "p15p22InferenceIncrease": 0,
    }


def write_placeholder_reports(reports_dir: Path, feasibility: dict[str, Any]) -> None:
    placeholders = {
        "phase9g_d2_online_amt_explicit_state_contract": {"status": "BLOCKED"},
        "phase9g_d2_online_amt_mel_preprocessing_parity": {"status": "BLOCKED"},
        "phase9g_d2_online_amt_browser_step_parity": {"status": "BLOCKED"},
        "phase9g_d2_online_amt_default_browser_runtime": {"status": "BLOCKED"},
        "phase9g_d2_online_amt_feasibility_receipt": feasibility,
    }
    for stem, body in placeholders.items():
        body.update({"schemaVersion": 1, "artifact": stem, "phase": "9G-D.2", "p15p22InferenceIncrease": 0})
        write_report(reports_dir, stem, body)


def snapshot_state(session: Any, torch: Any) -> dict[str, Any]:
    h, c = session.hidden
    return {
        "audio_buffer": tensor_meta(session.audio_buffer),
        "mel_buffer": tensor_meta(session.mel_buffer),
        "acoustic_layer_outputs[0]": tensor_meta(session.acoustic_layer_outputs[0]),
        "acoustic_layer_outputs[1]": tensor_meta(session.acoustic_layer_outputs[1]),
        "hidden_h": tensor_meta(h),
        "hidden_c": tensor_meta(c),
        "prev_output": tensor_meta(session.prev_output),
        "num_under_thr": {"dtype": "int", "shape": [], "value": int(session.num_under_thr)},
        "buffer_length": {"dtype": "int", "shape": [], "value": int(getattr(session, "buffer_length", 0))},
    }


def tensor_meta(tensor: Any) -> dict[str, Any]:
    array = tensor.detach().cpu().numpy()
    return {"shape": list(array.shape), "dtype": str(array.dtype), "sha256": sha256_array(array)}


def load_nonblind_fixture(repo_root: Path, hop_count: int) -> np.ndarray:
    wav_path = repo_root / "backend/data/work/public_proxy/vienna-4x22/audio-extracted/audio/Chopin_Ballade/Chopin_op38_p07.wav"
    audio, sample_rate = read_wav_mono(wav_path)
    start_ms = 3000
    output_samples = hop_count * HOP_SAMPLES
    end_ms = start_ms + output_samples / SAMPLE_RATE * 1000
    return extract_resample_linear(audio, sample_rate, start_ms, end_ms, output_samples)


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
        sample_width = handle.getsampwidth()
    if sample_width != 2:
        raise ValueError(f"expected PCM16 WAV: {path}")
    pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return pcm, sample_rate


def extract_resample_linear(audio: np.ndarray, source_rate: int, start_ms: float, end_ms: float, output_samples: int) -> np.ndarray:
    start = start_ms / 1000.0 * source_rate
    end = end_ms / 1000.0 * source_rate
    positions = np.linspace(start, end, output_samples, endpoint=False)
    left = np.floor(positions).astype(np.int64)
    right = np.minimum(audio.shape[0] - 1, left + 1)
    frac = positions - left
    return (audio[left] * (1.0 - frac) + audio[right] * frac).astype(np.float32)


def model_single_worker(latencies: list[float]) -> dict[str, Any]:
    rows = []
    previous_finish = 0.0
    max_depth = 0
    for index, latency in enumerate(latencies):
        ready = index * HOP_MS
        start = max(ready, previous_finish)
        finish = start + latency
        queue_delay = start - ready
        previous_finish = finish
        depth = max(1, math.ceil(max(0.0, finish - ready) / HOP_MS))
        max_depth = max(max_depth, depth)
        rows.append({
            "hopIndex": index,
            "inputReadyAtMs": ready,
            "processingStartAtMs": start,
            "totalStepLatencyMs": latency,
            "processingFinishAtMs": finish,
            "queueDelayMs": queue_delay,
            "publicationDelayMs": finish - ready,
        })
    queue_delays = [row["queueDelayMs"] for row in rows]
    return {
        "arrivalCadenceMs": HOP_MS,
        "rowsSample": rows[:8] + rows[-3:],
        "hopCount": len(rows),
        "queueDelayMs": summarize(queue_delays),
        "finalQueueDelayMs": queue_delays[-1],
        "maximumModeledQueueDepth": max_depth,
        "queueGrowthStable": queue_delays[-1] <= max(queue_delays[: max(1, min(32, len(queue_delays)))]),
        "outcome": "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNPROVEN_PYTHON_ORACLE_ONLY",
    }


def segment_tail_report(performance_samples: int) -> dict[str, Any]:
    correction_delay_samples = math.ceil(abs(TIMING_CORRECTION_MS) / 1000 * SAMPLE_RATE)
    required_processed_samples = math.ceil((performance_samples + correction_delay_samples) / HOP_SAMPLES) * HOP_SAMPLES
    required_context_tail_samples = max(0, required_processed_samples - performance_samples)
    return {
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "correctionDelaySamples": correction_delay_samples,
        "requiredProcessedSamples": required_processed_samples,
        "requiredContextTailSamples": required_context_tail_samples,
        "finalAnalyzedThroughTimeMs": required_processed_samples / SAMPLE_RATE * 1000,
    }


def sine_hop() -> np.ndarray:
    t = np.arange(HOP_SAMPLES, dtype=np.float32) / SAMPLE_RATE
    return (0.25 * np.sin(2 * math.pi * 440 * t)).astype(np.float32)


def prepare_online_amt_imports(repo: Path) -> None:
    import librosa.filters
    import librosa.util

    original_pad_center = librosa.util.pad_center
    original_mel = librosa.filters.mel

    def compat_pad_center(data: Any, size: int, *args: Any, **kwargs: Any) -> Any:
        return original_pad_center(data, size=size, *args, **kwargs)

    def compat_mel(sr: int, n_fft: int, n_mels: int, fmin: float, fmax: float, **kwargs: Any) -> Any:
        return original_mel(sr=sr, n_fft=n_fft, n_mels=n_mels, fmin=fmin, fmax=fmax, **kwargs)

    librosa.util.pad_center = compat_pad_center
    librosa.filters.mel = compat_mel
    sys.path.insert(0, str(repo.resolve()))


def file_identity(path: Path) -> dict[str, Any]:
    return {"path": str(path), "byteSize": path.stat().st_size if path.exists() else None, "sha256": sha256(path) if path.exists() else None}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def sha256_float32(array: np.ndarray) -> str:
    return sha256_array(np.asarray(array, dtype=np.float32))


def sha256_int64(array: np.ndarray) -> str:
    return sha256_array(np.asarray(array, dtype=np.int64))


def summarize(values: list[float]) -> dict[str, float]:
    if not values:
        return {"min": math.nan, "p50": math.nan, "p95": math.nan, "max": math.nan}
    ordered = sorted(float(value) for value in values)
    return {"min": ordered[0], "p50": percentile(ordered, 0.5), "p95": percentile(ordered, 0.95), "max": ordered[-1]}


def percentile(ordered: list[float], p: float) -> float:
    if len(ordered) == 1:
        return ordered[0]
    index = (len(ordered) - 1) * p
    low = math.floor(index)
    high = math.ceil(index)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def run_text(cmd: list[str]) -> str:
    return subprocess.check_output(cmd, text=True).strip()


def rel(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def write_report(reports_dir: Path, stem: str, body: dict[str, Any]) -> None:
    body.setdefault("schemaVersion", 1)
    body.setdefault("artifact", stem)
    body.setdefault("phase", "9G-D.2")
    target = reports_dir / f"{stem}_{REPORT_DATE}.json"
    target.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
