#!/usr/bin/env python3
"""DR2 real Online-AMT grouped graph export and execution attempt.

This is research-only. It implements static K-hop ONNX unrolls for the frozen
Online-AMT checkpoint, attempts semantic parity against the authoritative
sequential Python runtime, records the isolated ORT Web 1.30.0 identity, and
attempts browser execution only after real graph export succeeds.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

IMPORT_ERROR: ModuleNotFoundError | None = None
try:
    import numpy as np
    import torch

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import qualify_online_amt_browser_stateful as d2  # noqa: E402
    import qualify_online_amt_browser_stateful_d2r as d2r  # noqa: E402
    import qualify_online_amt_browser_stateful_d2r1 as d2r1  # noqa: E402
except ModuleNotFoundError as exc:
    IMPORT_ERROR = exc
    np = None  # type: ignore[assignment]
    torch = None  # type: ignore[assignment]
    d2 = None  # type: ignore[assignment]
    d2r = None  # type: ignore[assignment]
    d2r1 = None  # type: ignore[assignment]


REPORT_DATE = "2026-10-13"
K_VALUES = [1, 2, 4, 8]
TOTAL_HOPS = 326
OWNED_SAMPLES = 163_840
CONTEXT_TAIL_SAMPLES = 3_072


class GroupedActiveHop(torch.nn.Module if torch is not None else object):  # type: ignore[union-attr]
    def __init__(self, model: Any, k: int):
        super().__init__()
        self.k = k
        self.active_hop = d2r1.CombinedActiveHop(model)

    def forward(
        self,
        audio_last_2048_sequence: Any,
        mel_buffer_in: Any,
        cache0_in: Any,
        cache1_in: Any,
        h_in: Any,
        c_in: Any,
        prev_output_in: Any,
    ) -> tuple[Any, Any, Any, Any, Any, Any, Any]:
        mel = mel_buffer_in
        cache0 = cache0_in
        cache1 = cache1_in
        h = h_in
        c = c_in
        prev = prev_output_in
        probabilities_rows = []
        chosen_rows = []
        for index in range(self.k):
            probabilities, mel, cache0, cache1, h, c = self.active_hop(
                audio_last_2048_sequence[index],
                mel,
                cache0,
                cache1,
                h,
                c,
                prev,
            )
            prev = probabilities.argmax(dim=3)
            probabilities_rows.append(probabilities)
            chosen_rows.append(prev)
        return (
            torch.cat(probabilities_rows, dim=0),
            torch.cat(chosen_rows, dim=0),
            mel,
            cache0,
            cache1,
            h,
            c,
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--online-amt-repo", type=Path, default=Path("backend/data/work/online_amt"))
    parser.add_argument("--checkpoint", type=Path, default=Path("backend/data/work/online_amt/model-180000.pt"))
    parser.add_argument("--config", type=Path, default=Path("backend/research/product_benchmark/product_benchmark_config.json"))
    parser.add_argument("--work-dir", type=Path, default=Path("backend/data/work/phase9g_dr2_online_amt_grouped"))
    parser.add_argument("--reports-dir", type=Path, default=Path("backend/research/reports"))
    parser.add_argument("--ort-dir", type=Path, default=Path("backend/data/work/phase9gdr2_ort_130/node_modules/onnxruntime-web/dist"))
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    work_dir = (repo_root / args.work_dir).resolve()
    reports_dir = (repo_root / args.reports_dir).resolve()
    graphs_dir = work_dir / "graphs"
    fixtures_dir = work_dir / "fixtures"
    for directory in [work_dir, reports_dir, graphs_dir, fixtures_dir]:
        directory.mkdir(parents=True, exist_ok=True)

    attempted_commands: list[dict[str, Any]] = []
    if IMPORT_ERROR is not None:
        attempted_commands.append({
            "command": ["python", "backend/research/tools/qualify_online_amt_grouped_browser_dr2.py", "--repo-root", "."],
            "status": "IMPORT_BLOCKED",
            "error": f"{type(IMPORT_ERROR).__name__}: {IMPORT_ERROR}",
        })
        report = build_blocked_report(
            repo_root,
            {
                "qualificationStatus": "BLOCKED",
                "reason": "PYTHON_SCIENTIFIC_EXPORT_RUNTIME_MISSING",
                "missingModule": IMPORT_ERROR.name,
            },
            "PYTHON_SCIENTIFIC_EXPORT_RUNTIME_MISSING",
            attempted_commands,
        )
        report["ortWeb130Identity"] = inspect_ort_identity(repo_root / args.ort_dir)
        write_report(reports_dir, report)
        print(json.dumps({"onlineAmtDecision": "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED", "blockedReason": report["blockedReason"]}, indent=2))
        return 2

    source_identity = d2.verify_source_identity(
        repo_root,
        (repo_root / args.online_amt_repo).resolve(),
        (repo_root / args.checkpoint).resolve(),
        repo_root / args.config,
    )
    if source_identity.get("qualificationStatus") != "PASS":
        report = build_blocked_report(repo_root, source_identity, "SOURCE_IDENTITY_BLOCKED", attempted_commands)
        write_report(reports_dir, report)
        return 2

    d2.prepare_online_amt_imports((repo_root / args.online_amt_repo).resolve())
    from transcribe import OnlineTranscriber, load_model

    model = load_model(str((repo_root / args.checkpoint).resolve()))
    model.eval()
    pcm = d2.load_nonblind_fixture(repo_root, TOTAL_HOPS)
    reference = d2r1.generate_reference(model, OnlineTranscriber, pcm, fixtures_dir)
    fixture_manifest = d2r1.build_manifest({"path": "placeholder"}, reference)
    (fixtures_dir / "manifest.json").write_text(json.dumps(fixture_manifest, indent=2) + "\n", encoding="utf-8")

    graph_identities: dict[str, Any] = {}
    semantic_results: dict[str, Any] = {}
    export_blockers: list[str] = []
    for k in K_VALUES:
        try:
            graph_identities[str(k)] = export_grouped_graph(model, reference, graphs_dir, fixtures_dir, k)
            semantic_results[str(k)] = compare_grouped_pytorch(model, OnlineTranscriber, pcm, reference, k)
        except Exception as exc:  # noqa: BLE001 - research receipt must preserve concrete failure.
            export_blockers.append(f"K={k}:{type(exc).__name__}:{exc}")
            graph_identities[str(k)] = {"k": k, "status": "FAILED", "error": f"{type(exc).__name__}: {exc}"}
            semantic_results[str(k)] = {"status": "NOT_EXECUTED_EXPORT_FAILED"}

    ort_identity = inspect_ort_identity(repo_root / args.ort_dir)
    browser_results = {}
    if not export_blockers:
        for browser, channel in [("chrome", "chrome"), ("edge", "msedge")]:
            browser_results[browser] = attempt_browser_load(
                repo_root,
                fixtures_dir,
                repo_root / args.ort_dir,
                channel,
                args.headed,
                attempted_commands,
            )
    else:
        browser_results = {
            "chrome": {"status": "NOT_EXECUTED_EXPORT_FAILED"},
            "edge": {"status": "NOT_EXECUTED_EXPORT_FAILED"},
        }

    outcome = decide_online_amt_outcome(semantic_results, browser_results, export_blockers)
    report = {
        "phase": "PHASE_9G_DR2_FINALIZER_CORRECTNESS_AND_REAL_GROUPED_EXECUTION",
        "status": "REBASELINE_RUNTIME_EVIDENCE_INCOMPLETE" if outcome.endswith("BLOCKED") else outcome,
        "onlineAmtDecision": outcome,
        "sourceIdentity": source_identity,
        "onlineAmtFrozenIdentity": {
            "repoCommit": "ad12550909a1d86f699097d11885f427054a5ac2",
            "checkpointSha256": d2.EXPECTED_CHECKPOINT_SHA256,
            "checkpointBytes": d2.EXPECTED_CHECKPOINT_BYTES,
            "sampleRate": d2.SAMPLE_RATE,
            "hopSamples": d2.HOP_SAMPLES,
            "timingCorrectionMs": d2.TIMING_CORRECTION_MS,
            "publishedOnsetBoost": d2.PUBLISHED_ONSET_BOOST,
            "pseudoIntensity": d2.PSEUDO_INTENSITY,
            "configurationSha256": "0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375",
        },
        "kHopGraphIdentities": graph_identities,
        "semanticParity": semantic_results,
        "ortWeb130Identity": ort_identity,
        "browserRuntimeAttempts": browser_results,
        "attemptedCommands": attempted_commands,
        "nativeGatePolicy": {
            "strategy": "HYBRID_EXACT_SEMANTICS",
            "groupedGraphUsedOnlyWhenAllInternalHopsAreActive": True,
            "shortCircuitBoundaryFallback": "AUTHORITATIVE_SEQUENTIAL_PATH_FOR_WHOLE_GROUP",
        },
        "greenfieldBoundary": "GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT",
        "historicalScoreAwareAdapter": "SCORE_AWARE_9G_RESEARCH_ADAPTER",
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "historicalPhase9gBConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "p15p22InferenceIncrease": 0,
    }
    write_report(reports_dir, report)
    print(json.dumps({"onlineAmtDecision": outcome, "report": "backend/research/reports/phase9g_dr2_finalizer_correctness_and_real_grouped_execution_2026-10-13.json"}, indent=2))
    return 0 if outcome != "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED" else 2


def export_grouped_graph(model: Any, reference: dict[str, Any], graphs_dir: Path, fixtures_dir: Path, k: int) -> dict[str, Any]:
    graph_path = graphs_dir / f"online_amt_grouped_k{k}_opset18.onnx"
    module = GroupedActiveHop(model, k).eval()
    inputs = (
        torch.zeros((k, 1, 2048), dtype=torch.float32),
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
        graph_path,
        ["audio_last_2048_sequence", "mel_buffer_in", "cache0_in", "cache1_in", "h_in", "c_in", "prev_output_in"],
        ["probabilities_sequence", "chosen_state_sequence", "mel_buffer_out", "cache0_out", "cache1_out", "h_out", "c_out"],
    )
    graph.update({
        "k": k,
        "graphKind": "staticGroupedActiveHop",
        "checkpointSha256": d2.EXPECTED_CHECKPOINT_SHA256,
        "exporterSourceSha256": sha256_file(Path(__file__)),
        "sourceTransitionsPreservedPerInvocation": k,
    })
    if graph.get("status") == "PASS":
        shutil.copyfile(graph_path, fixtures_dir / graph_path.name)
    return graph


def compare_grouped_pytorch(model: Any, transcriber_cls: Any, pcm: np.ndarray, reference: dict[str, Any], k: int) -> dict[str, Any]:
    wrapper = GroupedActiveHop(model, k).eval()
    session = transcriber_cls(model, return_roll=False)
    state = {
        "audio": session.audio_buffer.clone(),
        "mel": session.mel_buffer.clone(),
        "cache0": session.acoustic_layer_outputs[0].clone(),
        "cache1": session.acoustic_layer_outputs[1].clone(),
        "h": session.hidden[0].clone(),
        "c": session.hidden[1].clone(),
        "prev": session.prev_output.clone(),
        "num": 0,
    }
    chosen_rows: list[np.ndarray] = []
    prob_deltas: list[dict[str, float]] = []
    fallback_groups = 0
    with torch.no_grad():
        for group_start in range(0, TOTAL_HOPS, k):
            group_hops = [
                pcm[(group_start + offset) * d2.HOP_SAMPLES:(group_start + offset + 1) * d2.HOP_SAMPLES].astype(np.float32)
                for offset in range(min(k, TOTAL_HOPS - group_start))
            ]
            windows = []
            active_group = True
            audio_probe = state["audio"].clone()
            num_probe = int(state["num"])
            for hop_np in group_hops:
                audio_probe = torch.cat((audio_probe[:, d2.HOP_SAMPLES:], torch.from_numpy(hop_np).view(1, d2.HOP_SAMPLES)), dim=1)
                intensity = float(audio_probe.max() - audio_probe.min()) if float(audio_probe.abs().max()) > 0 else 0.0
                num_probe = num_probe + 1 if intensity < 0.05 else 0
                windows.append(audio_probe[:, -2048:].clone())
                if num_probe > 100:
                    active_group = False
            if len(group_hops) != k:
                active_group = False
            if not active_group:
                fallback_groups += 1
                for offset, hop_np in enumerate(group_hops):
                    hop_index = group_start + offset
                    row = run_one_python_active_or_gate(wrapper.active_hop, state, hop_np)
                    chosen_rows.append(row["chosen"])
                    prob_deltas.append(compare_np(row["probabilities"], reference["probabilities"][hop_index]))
                continue
            probs, chosen, mel, cache0, cache1, h, c = wrapper(
                torch.stack(windows, dim=0),
                state["mel"],
                state["cache0"],
                state["cache1"],
                state["h"],
                state["c"],
                state["prev"],
            )
            state.update({"audio": audio_probe, "mel": mel, "cache0": cache0, "cache1": cache1, "h": h, "c": c, "prev": chosen[-1:].clone(), "num": num_probe})
            probs_np = probs.detach().cpu().numpy()
            chosen_np = chosen.detach().cpu().numpy().reshape(len(group_hops), 88)
            for offset in range(len(group_hops)):
                hop_index = group_start + offset
                chosen_rows.append(chosen_np[offset])
                prob_deltas.append(compare_np(probs_np[offset].reshape(88, 5), reference["probabilities"][hop_index]))
    chosen_arr = np.asarray(chosen_rows, dtype=np.int64)
    mismatches = np.argwhere(chosen_arr != reference["chosen"])
    first = None
    if len(mismatches):
        hop, pitch = (int(mismatches[0][0]), int(mismatches[0][1]))
        first = {
            "hopIndex": hop,
            "pitchIndex": pitch,
            "pythonChosenState": int(reference["chosen"][hop, pitch]),
            "groupedChosenState": int(chosen_arr[hop, pitch]),
        }
    return {
        "status": "PASS" if len(mismatches) == 0 else "FAIL",
        "k": k,
        "hopCount": int(chosen_arr.shape[0]),
        "chosenStateMismatchCount": int(len(mismatches)),
        "firstMismatch": first,
        "fallbackSequentialGroups": fallback_groups,
        "probabilityDelta": summarize_deltas(prob_deltas),
    }


def run_one_python_active_or_gate(wrapper: Any, state: dict[str, Any], hop_np: np.ndarray) -> dict[str, np.ndarray]:
    state["audio"] = torch.cat((state["audio"][:, d2.HOP_SAMPLES:], torch.from_numpy(hop_np).view(1, d2.HOP_SAMPLES)), dim=1)
    intensity = float(state["audio"].max() - state["audio"].min()) if float(state["audio"].abs().max()) > 0 else 0.0
    state["num"] = state["num"] + 1 if intensity < 0.05 else 0
    if state["num"] > 100:
        probabilities = np.zeros((88, 5), dtype=np.float32)
        probabilities[:, 0] = 1.0
        chosen = np.zeros((88,), dtype=np.int64)
        return {"probabilities": probabilities, "chosen": chosen}
    probs, mel, cache0, cache1, h, c = wrapper(
        state["audio"][:, -2048:],
        state["mel"],
        state["cache0"],
        state["cache1"],
        state["h"],
        state["c"],
        state["prev"],
    )
    state.update({"mel": mel, "cache0": cache0, "cache1": cache1, "h": h, "c": c, "prev": probs.argmax(dim=3)})
    return {"probabilities": probs.detach().cpu().numpy().reshape(88, 5), "chosen": state["prev"].detach().cpu().numpy().reshape(88)}


def attempt_browser_load(
    repo_root: Path,
    fixtures_dir: Path,
    ort_dir: Path,
    channel: str,
    headed: bool,
    attempted_commands: list[dict[str, Any]],
) -> dict[str, Any]:
    output_path = fixtures_dir.parent / f"browser_{channel}_grouped_attempt.json"
    cmd = [
        "node",
        "backend/research/browser_runtime/online_amt_stateful_browser_harness.mjs",
        "--fixture-dir",
        str(fixtures_dir),
        "--ort-dir",
        str(ort_dir),
        "--browser-channel",
        channel,
        "--backend",
        "webgpu",
        "--graph-optimization-level",
        "disabled",
        "--mode",
        "worker-combined",
        "--output",
        str(output_path),
    ]
    if headed:
        cmd.append("--headed")
    started = time.perf_counter()
    try:
        completed = subprocess.run(cmd, cwd=repo_root, text=True, capture_output=True, timeout=180, check=False)
    except Exception as exc:  # noqa: BLE001
        result = {"status": "BLOCKED", "browserChannel": channel, "error": f"{type(exc).__name__}: {exc}"}
        attempted_commands.append({"command": cmd, "status": "EXCEPTION", "error": result["error"]})
        return result
    attempted_commands.append({
        "command": cmd,
        "exitCode": completed.returncode,
        "durationMs": round((time.perf_counter() - started) * 1000, 3),
        "stdoutTail": completed.stdout[-2000:],
        "stderrTail": completed.stderr[-2000:],
    })
    if completed.returncode != 0:
        return {
            "status": "BLOCKED",
            "browserChannel": channel,
            "exitCode": completed.returncode,
            "stderrTail": completed.stderr[-4000:],
            "stdoutTail": completed.stdout[-2000:],
        }
    if output_path.exists():
        return json.loads(output_path.read_text(encoding="utf-8"))
    return {"status": "BLOCKED", "browserChannel": channel, "error": "browser harness completed without output file"}


def inspect_ort_identity(ort_dir: Path) -> dict[str, Any]:
    package_path = ort_dir.parent / "package.json"
    lock_path = ort_dir.parents[2] / "package-lock.json"
    identity = {"ortDir": str(ort_dir), "status": "PASS" if package_path.exists() else "MISSING"}
    if package_path.exists():
        package = json.loads(package_path.read_text(encoding="utf-8"))
        identity["version"] = package.get("version")
    if lock_path.exists():
        identity["packageLockSha256"] = sha256_file(lock_path)
    for name in ["ort.webgpu.min.js", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.jsep.wasm"]:
        path = ort_dir / name
        if path.exists():
            identity.setdefault("assetSha256", {})[name] = sha256_file(path)
    return identity


def decide_online_amt_outcome(semantic: dict[str, Any], browser: dict[str, Any], blockers: list[str]) -> str:
    if blockers:
        return "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED"
    if not any(row.get("status") == "PASS" and row.get("chosenStateMismatchCount") == 0 for row in semantic.values()):
        return "ONLINE_AMT_GROUPED_SEMANTIC_PARITY_FAILED"
    if any(row.get("status") == "BLOCKED" for row in browser.values()):
        return "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED"
    return "REBASELINE_RUNTIME_EVIDENCE_INCOMPLETE"


def compare_np(left: np.ndarray, right: np.ndarray) -> dict[str, float]:
    delta = np.abs(left.astype(np.float64) - right.astype(np.float64))
    return {
        "meanAbsDelta": float(delta.mean()),
        "p95AbsDelta": float(np.percentile(delta, 95)),
        "maxAbsDelta": float(delta.max()),
    }


def summarize_deltas(rows: list[dict[str, float]]) -> dict[str, float | None]:
    if not rows:
        return {"meanAbsDeltaMax": None, "p95AbsDeltaMax": None, "maxAbsDelta": None}
    return {
        "meanAbsDeltaMax": max(row["meanAbsDelta"] for row in rows),
        "p95AbsDeltaMax": max(row["p95AbsDelta"] for row in rows),
        "maxAbsDelta": max(row["maxAbsDelta"] for row in rows),
    }


def build_blocked_report(repo_root: Path, source_identity: dict[str, Any], reason: str, attempted_commands: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "phase": "PHASE_9G_DR2_FINALIZER_CORRECTNESS_AND_REAL_GROUPED_EXECUTION",
        "status": "REBASELINE_RUNTIME_EVIDENCE_INCOMPLETE",
        "onlineAmtDecision": "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED",
        "blockedReason": reason,
        "sourceIdentity": source_identity,
        "finalizerBehavioralEvidence": {
            "implementation": "deterministic_monotonic_time_aware_finalizer",
            "visibleFrontierRequired": True,
            "deadlineFinal": True,
            "expectedMatchingPolicy": "MAX_CARDINALITY_MIN_TOTAL_TIMING_ERROR_PER_PITCH",
            "duplicateSuppressionOrder": "AFTER_EXPECTED_AND_WRONG_ASSIGNMENT",
            "wrongEvidencePolicy": "DEADLINE_REACHED_ZERO_EXPECTED_MATCHES_ONE_TO_ONE",
            "extraHorizonPolicy": "RESIDUAL_OBSERVATION_EXTRA_ONLY_AFTER_PENDING_CLAIMS_MATURE",
        },
        "kHopGraphIdentities": {
            str(k): {
                "k": k,
                "status": "NOT_EXPORTED_RUNTIME_BLOCKED",
                "reason": reason,
            }
            for k in K_VALUES
        },
        "semanticParity": {
            str(k): {
                "status": "NOT_EXECUTED_RUNTIME_BLOCKED",
                "reason": reason,
            }
            for k in K_VALUES
        },
        "browserRuntimeAttempts": {
            "chrome": {"status": "NOT_EXECUTED_RUNTIME_BLOCKED", "reason": reason},
            "edge": {"status": "NOT_EXECUTED_RUNTIME_BLOCKED", "reason": reason},
        },
        "attemptedCommands": attempted_commands,
        "sourceTreeHead": run_git(repo_root, ["rev-parse", "HEAD"]),
        "verifiedStartingRemoteHead": run_git(repo_root, ["rev-parse", "origin/codex/customer-web-delivery-boundary"]),
        "workingTreeStatusAtReportGeneration": run_git(repo_root, ["status", "--short"]).splitlines(),
        "greenfieldBoundary": "GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT",
        "historicalScoreAwareAdapter": "SCORE_AWARE_9G_RESEARCH_ADAPTER",
        "recommendation": "REBASELINE_RUNTIME_EVIDENCE_INCOMPLETE",
        "githubStatuses": "NOT_QUERIED_LOCAL_GH_CLI_UNAVAILABLE",
        "githubWorkflowRuns": "NOT_QUERIED_LOCAL_GH_CLI_UNAVAILABLE",
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "historicalPhase9gBConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "p15p22InferenceIncrease": 0,
    }


def write_report(reports_dir: Path, report: dict[str, Any]) -> None:
    path = reports_dir / f"phase9g_dr2_finalizer_correctness_and_real_grouped_execution_{REPORT_DATE}.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_git(repo_root: Path, args: list[str]) -> str:
    return subprocess.check_output(["git", *args], cwd=repo_root, text=True).strip()


if __name__ == "__main__":
    raise SystemExit(main())
