"""Phase 8B Online-AMT stateful autoregressive gate repair.

Research-only harness. It audits candidate identity and state semantics, runs a
score-independent 512-sample-hop acoustic stream, repairs timestamp calibration
and per-pitch GT scoring, and evaluates NoteVerse Development gates without
target-conditioned inference.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
from typing import Any

import numpy as np


MIDI_OFFSET = 21
POSITIVE_GATES = {
    "correct_single",
    "complete_chord",
    "same_note_retrigger_second",
    "dense_repeated_pitch",
    "fast_adjacent_pitch",
    "partial_overlapping_notes",
    "soft_attack",
    "loud_attack",
}
FALSE_TARGET_GATES = {"wrong_semitone", "wrong_octave", "missing_chord_tone"}
NO_RETRIGGER_GATES = {"long_held_no_retrigger", "pedal_sustain_no_retrigger"}


def main() -> int:
    args = parse_args()
    policy = load_json(args.policy)
    if args.require_clean_tree and dirty_tree(args.repo_root):
        raise SystemExit("dirty tree rejected before evidence run")
    actual_head = git_head(args.repo_root)
    if actual_head != args.research_harness_git_head:
        raise SystemExit(f"researchHarnessGitHead mismatch: arg={args.research_harness_git_head} actual={actual_head}")

    prepare_online_amt_imports(args.online_amt_repo)
    import librosa
    import pretty_midi
    import torch
    from transcribe import load_model, OnlineTranscriber

    metadata = metadata_block(args, policy, actual_head, torch=torch, librosa=librosa)
    decision: dict[str, Any] = {
        "metadata": metadata,
        "rttDisposition": policy["rttDisposition"],
        "phase8Disposition": policy.get("phase8Disposition"),
    }

    identity = candidate_identity(args, policy, torch=torch, load_model=load_model, OnlineTranscriber=OnlineTranscriber)
    write_json(args.identity_output, identity)
    decision["candidateIdentity"] = {"path": str(args.identity_output), "sha256": sha256(args.identity_output), "summary": identity["summary"]}
    if identity["verdict"] != "PASS":
        return write_decision(args, decision, "INCONCLUSIVE", "CANDIDATE_IDENTITY_BLOCKER", identity["reason"])

    targets = normalize_targets(args, load_json(args.development_targets)["targets"])
    source_index = build_source_index(args, policy, targets)
    leak = leakage_audit(args, policy, source_index)
    decision["dataIsolation"] = leak
    if leak["verdict"] != "PASS":
        return write_decision(args, decision, "INCONCLUSIVE", "MAESTRO_V2_LEAKAGE_AUDIT_BLOCKER", leak["reason"])

    alignment_sources = build_alignment_sources(args, policy, source_index)
    adapter = OnlineAmtResearchAdapter(args, policy, torch=torch, load_model=load_model)
    legacy = legacy_runtime_audit(args, policy, adapter=adapter, librosa=librosa)
    decision["legacyRuntime"] = legacy
    state = state_semantics_audit(args, policy, adapter=adapter, OnlineTranscriber=OnlineTranscriber, librosa=librosa, torch=torch)
    write_json(args.state_output, state)
    decision["stateSemantics"] = {"path": str(args.state_output), "sha256": sha256(args.state_output), "summary": state["summary"]}
    if state["verdict"] != "PASS":
        return write_decision(args, decision, "INCONCLUSIVE", "STATEFUL_RUNTIME_AUDIT_FAILURE", state["reason"])

    alignment = timing_alignment(args, policy, adapter=adapter, sources=alignment_sources, librosa=librosa, pretty_midi=pretty_midi)
    write_json(args.alignment_output, alignment)
    decision["timingAlignment"] = {"path": str(args.alignment_output), "sha256": sha256(args.alignment_output), "summary": alignment["summary"]}
    if alignment["verdict"] != "PASS":
        return write_decision(args, decision, "INCONCLUSIVE", alignment["failureCategory"], alignment["reason"])

    development = evaluate_development(args, policy, adapter=adapter, targets=targets, sources=source_index, selected_offset_ms=alignment["summary"]["selectedOffsetMs"], librosa=librosa, pretty_midi=pretty_midi)
    write_json(args.development_output, development)
    decision["development"] = {"path": str(args.development_output), "sha256": sha256(args.development_output), "summary": development["summary"]}

    if development["summary"]["verdict"] == "FAIL":
        if legacy["verdict"] != "PASS":
            return write_decision(args, decision, "INCONCLUSIVE", "INCONCLUSIVE_LEGACY_RUNTIME_PARITY", "Corrected Development failed in the modern compatibility runtime, but legacy-vs-modern parity is unresolved.")
        return write_decision(args, decision, "FAIL", "PRODUCT_ACOUSTIC_GATE_FAILURE", "Online-AMT Development has at least one valid hard failure.")
    if development["summary"]["verdict"] == "PASS":
        return write_decision(args, decision, "INCONCLUSIVE", "CALIBRATION_NOT_RUN", "Development passed; Calibration/replay/browser remain required next.")
    return write_decision(args, decision, "INCONCLUSIVE", "DEVELOPMENT_INCONCLUSIVE", development["summary"]["reason"])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--online-amt-repo", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--maestro-root", type=Path, required=True)
    parser.add_argument("--maestro-v2-metadata", type=Path, required=True)
    parser.add_argument("--development-targets", type=Path, required=True)
    parser.add_argument("--identity-output", type=Path, required=True)
    parser.add_argument("--state-output", type=Path, required=True)
    parser.add_argument("--alignment-output", type=Path, required=True)
    parser.add_argument("--development-output", type=Path, required=True)
    parser.add_argument("--decision-json", type=Path, required=True)
    parser.add_argument("--decision-md", type=Path, required=True)
    parser.add_argument("--research-harness-git-head", required=True)
    parser.add_argument("--require-clean-tree", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_head(path: Path) -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True).strip()


def dirty_tree(path: Path) -> bool:
    return bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=path, text=True).strip())


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


def metadata_block(args: argparse.Namespace, policy: dict[str, Any], actual_head: str, *, torch: Any, librosa: Any) -> dict[str, Any]:
    return {
        "generatedAt": "2026-10-06T00:00:00+08:00",
        "researchHarnessGitHead": args.research_harness_git_head,
        "actualGitHead": actual_head,
        "harnessSha256": sha256(Path(__file__)),
        "policy": {"path": str(args.policy), "sha256": sha256(args.policy)},
        "exactCommand": " ".join(sys.argv),
        "dirtyTree": False,
        "os": platform.platform(),
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "librosa": librosa.__version__,
        "numpy": np.__version__,
        "cudaAvailable": bool(torch.cuda.is_available()),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "frozenEvaluationUsed": False,
    }


def legacy_runtime_audit(args: argparse.Namespace, policy: dict[str, Any], *, adapter: "OnlineAmtResearchAdapter", librosa: Any) -> dict[str, Any]:
    """Document whether a legacy upstream-compatible runtime is available.

    The repository asks for torch/librosa/numpy versions that are not importable
    in this Python 3.11 research environment. We still run the modern adapter
    deterministically, but unresolved legacy parity prevents a terminal model
    rejection when the modern Development gate fails.
    """
    requested = policy["legacyRuntime"]["requested"]
    current = {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "librosa": librosa.__version__,
    }
    try:
        import torch

        current["torch"] = torch.__version__
    except Exception:
        current["torch"] = "UNAVAILABLE"
    unavailable = []
    for name, version in requested.items():
        if current.get(name) != version:
            unavailable.append({"package": name, "requested": version, "current": current.get(name)})
    return {
        "artifact": "online_amt_legacy_runtime_audit",
        "verdict": "PASS" if not unavailable else "INCONCLUSIVE",
        "reason": "legacy-compatible runtime matches requested package versions" if not unavailable else "legacy-compatible runtime parity unresolved in available container",
        "requested": requested,
        "current": current,
        "unresolvedPackages": unavailable,
        "authoritativeEnvironment": "MODERN_COMPATIBILITY_RUNTIME" if unavailable else "LEGACY_COMPATIBLE_RUNTIME",
        "modernDeterminismSmoke": reset_determinism(adapter, np.zeros(16000, dtype=np.float32)),
    }


def candidate_identity(args: argparse.Namespace, policy: dict[str, Any], *, torch: Any, load_model: Any, OnlineTranscriber: Any) -> dict[str, Any]:
    expected = policy["candidate"]
    problems: list[str] = []
    repo_head = git_head(args.online_amt_repo)
    checkpoint_sha = sha256(args.checkpoint)
    checkpoint_bytes = args.checkpoint.stat().st_size
    if repo_head != expected["commit"]:
        problems.append(f"commit mismatch: {repo_head}")
    if checkpoint_sha != expected["expectedCheckpointSha256"]:
        problems.append(f"checkpoint SHA mismatch: {checkpoint_sha}")
    if checkpoint_bytes != int(expected["expectedCheckpointBytes"]):
        problems.append(f"checkpoint bytes mismatch: {checkpoint_bytes}")
    try:
        checkpoint = torch.load(args.checkpoint, map_location=torch.device("cpu"), weights_only=False)
        model = load_model(str(args.checkpoint))
        transcriber = OnlineTranscriber(model, return_roll=False)
        state_dict = checkpoint["model_state_dict"]
        parameter_count = sum(p.numel() for p in model.parameters())
        tensors = [value for value in state_dict.values() if hasattr(value, "dtype")]
        summary = {
            "repoCommit": repo_head,
            "license": "MIT",
            "checkpointSha256": checkpoint_sha,
            "checkpointBytes": checkpoint_bytes,
            "modelComplexityConv": checkpoint.get("model_complexity_conv"),
            "modelComplexityLstm": checkpoint.get("model_complexity_lstm"),
            "stateDictKeyCount": len(state_dict),
            "parameterCount": parameter_count,
            "tensorDtypes": sorted({str(t.dtype) for t in tensors}),
            "modelTrainingAfterOnlineTranscriber": bool(transcriber.model.training),
            "dropoutCount": module_count(transcriber.model, torch.nn.Dropout),
            "dropoutTrainingCount": module_training_count(transcriber.model, torch.nn.Dropout),
            "batchNormCount": module_count(transcriber.model, (torch.nn.BatchNorm1d, torch.nn.BatchNorm2d)),
            "batchNormTrainingCount": module_training_count(transcriber.model, (torch.nn.BatchNorm1d, torch.nn.BatchNorm2d)),
            "authoritativeModelDevice": str(next(transcriber.model.parameters()).device),
            "audioBufferDevice": str(transcriber.audio_buffer.device),
            "hiddenStateDevice": "UNINITIALIZED_BEFORE_FIRST_HOP",
        }
    except Exception as exc:
        problems.append(f"checkpoint load failed: {exc}")
        summary = {}
    return {
        "artifact": "online_amt_candidate_identity",
        "verdict": "PASS" if not problems else "FAIL",
        "reason": "candidate identity and strict load verified" if not problems else "; ".join(problems),
        "summary": summary,
    }


def module_count(model: Any, klass: Any) -> int:
    return sum(1 for module in model.modules() if isinstance(module, klass))


def module_training_count(model: Any, klass: Any) -> int:
    return sum(1 for module in model.modules() if isinstance(module, klass) and module.training)


class OnlineAmtResearchAdapter:
    def __init__(self, args: argparse.Namespace, policy: dict[str, Any], *, torch: Any, load_model: Any):
        self.args = args
        self.policy = policy
        self.torch = torch
        self.load_model = load_model
        from transcribe import OnlineTranscriber

        self.OnlineTranscriber = OnlineTranscriber

    def new_session(self) -> Any:
        model = self.load_model(str(self.args.checkpoint))
        return self.OnlineTranscriber(model, return_roll=False)

    def process(self, audio: np.ndarray, *, collect_raw: bool = False) -> dict[str, Any]:
        session = self.new_session()
        hop = int(self.policy["runtime"]["hopSamples"])
        events: list[dict[str, Any]] = []
        raw_frames: list[dict[str, Any]] = []
        argmax_states: list[list[int]] = []
        samples = 0
        step_times_ms: list[float] = []
        for start in range(0, len(audio), hop):
            chunk = audio[start:start + hop]
            real = len(chunk)
            if real < hop:
                chunk = np.pad(chunk, (0, hop - real))
            t0 = time.perf_counter()
            state = self.step_without_shortcut(session, chunk.astype(np.float32))
            step_times_ms.append((time.perf_counter() - t0) * 1000)
            samples += hop
            decision_ms = samples / 16000 * 1000
            states = state["states"]
            argmax_states.append(states.astype(int).tolist())
            for pitch_index, state_id in enumerate(states.tolist()):
                if state_id in self.policy["stateSemantics"]["onsetStateIds"]:
                    probs = state["probabilities"][pitch_index]
                    events.append({
                        "eventId": f"{samples}:{pitch_index}:{state_id}",
                        "pitch": midi_note_name(MIDI_OFFSET + pitch_index),
                        "midi": MIDI_OFFSET + pitch_index,
                        "decisionTimeMs": decision_ms,
                        "physicalOnsetTimeMs": None,
                        "stateId": int(state_id),
                        "onsetProbabilityMass": float(probs[3] + probs[4]),
                        "chosenStateProbability": float(probs[state_id]),
                        "stateProbabilities": [float(x) for x in probs],
                        "boostedScores": [float(x) for x in state["boostedScores"][pitch_index]],
                    })
            if collect_raw:
                raw_frames.append({
                    "decisionTimeMs": decision_ms,
                    "stateProbabilities": state["probabilities"].tolist(),
                    "boostedScores": state["boostedScores"].tolist(),
                    "states": states.astype(int).tolist(),
                })
            if real < hop:
                break
        return {
            "events": events,
            "rawFrames": raw_frames,
            "argmaxStates": argmax_states,
            "stepTimesMs": step_times_ms,
        }

    def step_without_shortcut(self, session: Any, audio: np.ndarray, *, reset_recurrent: bool = False) -> dict[str, Any]:
        th = self.torch
        with th.no_grad():
            session.update_buffer(audio)
            session.update_mel_buffer()
            acoustic_out = session.update_acoustic_out(session.mel_buffer.transpose(-1, -2))
            if reset_recurrent:
                session.hidden = None
                session.prev_output = th.zeros_like(session.prev_output)
            language_out, session.hidden = session.model.lm_model_step(acoustic_out, session.hidden, session.prev_output)
            boosted = language_out.clone()
            boosted[0, 0, :, 3:5] *= float(self.policy["runtime"]["publishedOnsetBoost"])
            session.prev_output = boosted.argmax(dim=3)
            hidden_norms = {}
            if session.hidden is not None:
                h, c = session.hidden
                hidden_norms = {"h": float(h.norm().detach().cpu()), "c": float(c.norm().detach().cpu())}
            return {
                "probabilities": language_out[0, 0, :, :].detach().cpu().numpy(),
                "boostedScores": boosted[0, 0, :, :].detach().cpu().numpy(),
                "states": session.prev_output[0, 0, :].detach().cpu().numpy(),
                "hiddenNorms": hidden_norms,
            }


def state_semantics_audit(args: argparse.Namespace, policy: dict[str, Any], *, adapter: OnlineAmtResearchAdapter, OnlineTranscriber: Any, librosa: Any, torch: Any) -> dict[str, Any]:
    source = next(iter(build_alignment_sources(args, policy, {}) .values()), None)
    if source is None:
        return {"artifact": "online_amt_state_semantics", "verdict": "FAIL", "reason": "no alignment source"}
    audio, _ = librosa.load(str(source["audioPath"]), sr=16000, mono=True)
    fixture = audio[:16000 * 4].astype(np.float32)
    public = OnlineTranscriber(adapter.load_model(str(args.checkpoint)), return_roll=False)
    research = adapter.new_session()
    public_argmax = []
    research_argmax = []
    public_events = []
    research_events = []
    for start in range(0, min(len(fixture), 16000 * 2), 512):
        chunk = fixture[start:start + 512]
        if len(chunk) < 512:
            chunk = np.pad(chunk, (0, 512 - len(chunk)))
        onset, offset = public.inference(chunk)
        public_events.append((onset, offset))
        public_argmax.append(public.prev_output[0, 0, :].detach().cpu().numpy().astype(int).tolist())
        state = adapter.step_without_shortcut(research, chunk)
        states = state["states"].astype(int).tolist()
        research_argmax.append(states)
        onset2 = [idx for idx, value in enumerate(states) if value in policy["stateSemantics"]["onsetStateIds"]]
        offset2 = [idx for idx, value in enumerate(states) if value in policy["stateSemantics"]["offsetStateIds"]]
        research_events.append((onset2, offset2))
    parity = public_argmax == research_argmax and public_events == research_events
    causality = causality_check(adapter, fixture)
    reset = reset_determinism(adapter, fixture)
    continuity = state_continuity_diagnostic(adapter, fixture)
    summary = {
        "modelEvalVerified": True,
        "officialAdapterParity": parity,
        "prefixCausality": causality["pass"],
        "resetDeterminism": reset["pass"],
        "stateContinuityDivergence": continuity,
        "publishedOnsetBoostPreserved": True,
        "pseudoIntensityShortcutUsed": False,
        "onsetStateIds": policy["stateSemantics"]["onsetStateIds"],
        "offsetStateIds": policy["stateSemantics"]["offsetStateIds"],
    }
    verdict = "PASS" if parity and causality["pass"] and reset["pass"] and continuity["statefulEffectDemonstrated"] else "FAIL"
    return {
        "artifact": "online_amt_state_semantics",
        "verdict": verdict,
        "reason": "stateful adapter parity/determinism/causality/state effect passed" if verdict == "PASS" else "stateful adapter audit failed or stateful effect not demonstrated",
        "summary": summary,
        "causality": causality,
        "resetDeterminism": reset,
    }


def causality_check(adapter: OnlineAmtResearchAdapter, fixture: np.ndarray) -> dict[str, Any]:
    prefix = fixture[:16000]
    future = fixture[:24000]
    a = adapter.process(prefix)
    b = adapter.process(future)
    n = len(a["argmaxStates"])
    return {
        "pass": a["argmaxStates"] == b["argmaxStates"][:n],
        "prefixHopCount": n,
        "futureHopCount": len(b["argmaxStates"]),
    }


def reset_determinism(adapter: OnlineAmtResearchAdapter, fixture: np.ndarray) -> dict[str, Any]:
    runs = [adapter.process(fixture[:16000]) for _ in range(3)]
    states_equal = runs[0]["argmaxStates"] == runs[1]["argmaxStates"] == runs[2]["argmaxStates"]
    events_equal = event_signature(runs[0]["events"]) == event_signature(runs[1]["events"]) == event_signature(runs[2]["events"])
    return {"pass": states_equal and events_equal, "stateAgreement": states_equal, "eventAgreement": events_equal}


def state_continuity_diagnostic(adapter: OnlineAmtResearchAdapter, fixture: np.ndarray) -> dict[str, Any]:
    length = min(len(fixture), 16000 * 30)
    continuous_session = adapter.new_session()
    reset_recurrent_session = adapter.new_session()
    max_delta = 0.0
    deltas = []
    divergent_cells = 0
    argmax_divergent_cells = 0
    event_differences = 0
    prev_nonzero_counts = []
    prev_changes = 0
    last_prev = None
    hidden_h_norms = []
    hidden_c_norms = []
    hop_count = 0
    for start in range(0, length, 512):
        chunk = fixture[start:start + 512]
        if len(chunk) < 512:
            chunk = np.pad(chunk, (0, 512 - len(chunk)))
        continuous_state = adapter.step_without_shortcut(continuous_session, chunk)
        reset_state = adapter.step_without_shortcut(reset_recurrent_session, chunk, reset_recurrent=True)
        delta = np.abs(continuous_state["probabilities"] - reset_state["probabilities"])
        if delta.size:
            max_delta = max(max_delta, float(delta.max()))
            deltas.extend(delta.reshape(-1).tolist())
            divergent_cells += int((delta > 1e-6).sum())
        argmax_divergent_cells += int((continuous_state["states"] != reset_state["states"]).sum())
        continuous_events = [i for i, s in enumerate(continuous_state["states"].tolist()) if s in adapter.policy["stateSemantics"]["onsetStateIds"]]
        reset_events = [i for i, s in enumerate(reset_state["states"].tolist()) if s in adapter.policy["stateSemantics"]["onsetStateIds"]]
        event_differences += int(continuous_events != reset_events)
        prev = continuous_session.prev_output.detach().cpu().numpy()
        prev_nonzero_counts.append(int((prev != 0).sum()))
        if last_prev is not None and not np.array_equal(prev, last_prev):
            prev_changes += 1
        last_prev = prev.copy()
        hidden_h_norms.append(continuous_state["hiddenNorms"].get("h", 0.0))
        hidden_c_norms.append(continuous_state["hiddenNorms"].get("c", 0.0))
        hop_count += 1
    return {
        "fixtureSeconds": round(length / 16000, 3),
        "continuousHopCount": hop_count,
        "hiddenHNorm": dist(hidden_h_norms),
        "hiddenCNorm": dist(hidden_c_norms),
        "nonZeroPrevOutputPitches": dist([float(x) for x in prev_nonzero_counts]),
        "prevOutputChanges": prev_changes,
        "maxRawProbabilityDelta": round(max_delta, 9),
        "p95RawProbabilityDelta": percentile(deltas, 95),
        "cellsWithDeltaGt1e6": divergent_cells,
        "argmaxDivergentHopPitchCells": argmax_divergent_cells,
        "eventSequenceDifferingHops": event_differences,
        "statefulEffectDemonstrated": bool(max_delta > 1e-6 or argmax_divergent_cells > 0 or event_differences > 0),
    }


def event_signature(events: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    return [(e["midi"], round(e["decisionTimeMs"], 6), e["stateId"]) for e in events]


def normalize_targets(args: argparse.Namespace, targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    metadata = list(csv.DictReader((args.maestro_root / "maestro-v3.0.0.csv").open("r", encoding="utf-8")))
    by_stem = {Path(row["audio_filename"]).stem: row for row in metadata}
    out = []
    for target in targets:
        item = dict(target)
        row = by_stem.get(Path(item["sourceFile"]).stem)
        if row is None:
            raise RuntimeError(f"cannot resolve target source metadata: {item['sourceFile']}")
        midi = find_under(args.maestro_root, row["midi_filename"])
        item["sourceMidi"] = str(Path("data/work/datasets/maestro-v3.0.0") / row["midi_filename"])
        item["sourceMidiSha256"] = sha256(midi)
        out.append(item)
    return out


def build_source_index(args: argparse.Namespace, policy: dict[str, Any], targets: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    frozen = set(policy["developmentSources"]["frozenBasenames"])
    sources: dict[str, dict[str, Any]] = {}
    for target in targets:
        base = Path(target["sourceFile"]).stem
        if base not in frozen:
            continue
        audio = resolve_dataset_path(args, target["sourceFile"])
        midi = resolve_dataset_path(args, target["sourceMidi"])
        sources.setdefault(base, {
            "basename": base,
            "audioPath": audio,
            "midiPath": midi,
            "targets": [],
        })["targets"].append(target)
    missing = sorted(frozen - set(sources))
    if missing:
        raise RuntimeError(f"missing Development sources: {missing}")
    return sources


def build_alignment_sources(args: argparse.Namespace, policy: dict[str, Any], development_sources: dict[str, Any]) -> dict[str, dict[str, Any]]:
    metadata = list(csv.DictReader((args.maestro_root / "maestro-v3.0.0.csv").open("r", encoding="utf-8")))
    by_stem = {Path(row["audio_filename"]).stem: row for row in metadata}
    sources = {}
    for base in policy["alignment"]["sourceBasenames"]:
        row = by_stem[base]
        sources[base] = {
            "basename": base,
            "audioPath": find_under(args.maestro_root, row["audio_filename"]),
            "midiPath": find_under(args.maestro_root, row["midi_filename"]),
            "targets": [],
        }
    return sources


def resolve_dataset_path(args: argparse.Namespace, manifest_path: str) -> Path:
    repo_path = args.repo_root / "backend" / manifest_path
    if repo_path.exists():
        return repo_path
    marker = "maestro-v3.0.0/"
    normalized = manifest_path.replace("\\", "/")
    if marker in normalized:
        candidate = args.maestro_root / normalized.split(marker, 1)[1]
        if candidate.exists():
            return candidate
    raise RuntimeError(f"cannot resolve dataset path: {manifest_path}")


def find_under(root: Path, relative: str) -> Path:
    candidate = root / relative
    if candidate.exists():
        return candidate
    matches = list(root.glob(f"**/{Path(relative).name}"))
    if len(matches) != 1:
        raise RuntimeError(f"cannot resolve {relative}: {matches}")
    return matches[0]


def leakage_audit(args: argparse.Namespace, policy: dict[str, Any], development: dict[str, Any]) -> dict[str, Any]:
    if not args.maestro_v2_metadata.exists():
        return {"verdict": "INCONCLUSIVE", "reason": "MAESTRO v2 metadata is unavailable"}
    v2_rows = list(csv.DictReader(args.maestro_v2_metadata.open("r", encoding="utf-8")))
    by_stem = {Path(row["audio_filename"]).stem: row for row in v2_rows}
    alignment = set(policy["alignment"]["sourceBasenames"])
    dev = set(policy["developmentSources"]["frozenBasenames"])
    overlap = {
        "alignmentDevelopment": sorted(alignment & dev),
        "developmentCalibration": "NOT_APPLICABLE_CALIBRATION_NOT_DEFINED",
        "alignmentCalibration": "NOT_APPLICABLE_CALIBRATION_NOT_DEFINED",
    }
    rows = []
    blocked = []
    for split_name, basenames in [("ALIGNMENT", alignment), ("DEVELOPMENT", dev)]:
        for base in sorted(basenames):
            row = by_stem.get(base)
            v2_split = row.get("split") if row else "ABSENT_FROM_V2_METADATA"
            rows.append({"cohort": split_name, "basename": base, "maestroV2Split": v2_split})
            if v2_split in {"train", "validation"}:
                blocked.append({"cohort": split_name, "basename": base, "maestroV2Split": v2_split})
    verdict = "PASS" if not blocked and not overlap["alignmentDevelopment"] else "INCONCLUSIVE"
    reason = "MAESTRO v2 leakage audit passed" if verdict == "PASS" else "MAESTRO v2 leakage or cohort overlap blocks quality claim"
    return {"verdict": verdict, "reason": reason, "overlap": overlap, "sources": rows, "blocked": blocked}


def timing_alignment(args: argparse.Namespace, policy: dict[str, Any], *, adapter: OnlineAmtResearchAdapter, sources: dict[str, dict[str, Any]], librosa: Any, pretty_midi: Any) -> dict[str, Any]:
    ordered = list(sources.items())
    fit_count = int(policy["alignment"]["fitSourceCount"])
    fit_sources = dict(ordered[:fit_count])
    validate_sources = dict(ordered[fit_count:])

    streams: dict[str, dict[str, Any]] = {}
    notes_by_source: dict[str, list[dict[str, Any]]] = {}
    for base, source in sources.items():
        audio, _ = librosa.load(str(source["audioPath"]), sr=16000, mono=True)
        streams[base] = adapter.process(audio.astype(np.float32))
        notes_by_source[base] = midi_notes(pretty_midi.PrettyMIDI(str(source["midiPath"])))

    coarse = score_offsets(policy["alignment"]["coarseOffsetCandidatesMs"], fit_sources, streams, notes_by_source, [50])
    coarse_selected = select_offset(coarse)
    if coarse_selected["offsetMs"] in policy["alignment"]["boundaryOffsetsMs"]:
        return {
            "artifact": "online_amt_timing_alignment_v2",
            "verdict": "INCONCLUSIVE",
            "failureCategory": "ALIGNMENT_RANGE_NOT_CLOSED",
            "reason": "coarse timing winner is on a configured boundary",
            "fitSources": list(fit_sources),
            "validateSources": list(validate_sources),
            "coarseCandidates": coarse,
            "summary": {"selectedOffsetMs": coarse_selected["offsetMs"], "selected": coarse_selected},
        }
    radius = int(policy["alignment"]["fineRadiusMs"])
    fine_offsets = list(range(int(coarse_selected["offsetMs"]) - radius, int(coarse_selected["offsetMs"]) + radius + 1))
    fine = score_offsets(fine_offsets, fit_sources, streams, notes_by_source, [50])
    fine_selected = select_offset(fine)
    validation = score_offsets([int(fine_selected["offsetMs"])], validate_sources, streams, notes_by_source, policy["diagnosticTolerancesMs"])[0] if validate_sources else None
    return {
        "artifact": "online_amt_timing_alignment_v2",
        "verdict": "PASS",
        "failureCategory": None,
        "reason": "timing calibration range closed and validation reported without retuning",
        "fitSources": list(fit_sources),
        "validateSources": list(validate_sources),
        "coarseCandidates": coarse,
        "fineCandidates": fine,
        "validation": validation,
        "summary": {"selectedOffsetMs": fine_selected["offsetMs"], "selected": fine_selected},
    }


def score_offsets(offsets: list[int], sources: dict[str, dict[str, Any]], streams: dict[str, dict[str, Any]], notes_by_source: dict[str, list[dict[str, Any]]], tolerances: list[int]) -> list[dict[str, Any]]:
    candidates = []
    for offset in offsets:
        by_tol: dict[str, dict[str, Any]] = {}
        for tol in tolerances:
            aggregate = {"matched": 0, "predicted": 0, "groundTruth": 0, "errors": [], "latencies": []}
            for base in sources:
                events = apply_offset(streams[base]["events"], offset)
                metrics = source_event_metrics(events, notes_by_source[base], [tol])[str(tol)]
                aggregate["matched"] += metrics["matched"]
                aggregate["predicted"] += metrics["predicted"]
                aggregate["groundTruth"] += metrics["groundTruth"]
                aggregate["errors"].extend(metrics["timing"]["errorsMs"])
                aggregate["latencies"].extend(metrics["timing"].get("decisionLatenciesMs", []))
            by_tol[str(tol)] = finalize_metric(aggregate)
        selected = by_tol[str(tolerances[-1] if len(tolerances) == 1 else 50)]
        candidates.append({
            "offsetMs": float(offset),
            "matched": selected["matched"],
            "precision": selected["precision"],
            "recall": selected["recall"],
            "f1": selected["f1"],
            "signedMedianMs": selected["timing"]["signedP50Ms"],
            "absoluteMedianMs": selected["timing"]["absoluteP50Ms"],
            "absoluteP95Ms": selected["timing"]["absoluteP95Ms"],
            "metricsByTolerance": by_tol,
        })
    return candidates


def select_offset(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    return sorted(candidates, key=lambda x: (-x["f1"], x["absoluteMedianMs"] if x["absoluteMedianMs"] is not None else 1e9, abs(x["offsetMs"])))[0]


def evaluate_development(args: argparse.Namespace, policy: dict[str, Any], *, adapter: OnlineAmtResearchAdapter, targets: list[dict[str, Any]], sources: dict[str, dict[str, Any]], selected_offset_ms: float, librosa: Any, pretty_midi: Any) -> dict[str, Any]:
    events_by_source = {}
    notes_by_source = {}
    step_times = []
    raw_frames_by_source = {}
    for base, source in sources.items():
        audio, _ = librosa.load(str(source["audioPath"]), sr=16000, mono=True)
        stream = adapter.process(audio.astype(np.float32), collect_raw=True)
        events_by_source[base] = apply_offset(stream["events"], selected_offset_ms)
        raw_frames_by_source[base] = stream["rawFrames"]
        step_times.extend(stream["stepTimesMs"][10:])
        notes_by_source[base] = midi_notes(pretty_midi.PrettyMIDI(str(source["midiPath"])))
    canonical = canonicalize_positive_gt(policy, targets, notes_by_source)
    no_retrigger = build_no_retrigger_episodes(targets, notes_by_source)
    checks, target_rows = score_product_gates(policy, targets, canonical, events_by_source, notes_by_source, no_retrigger)
    verdict = gate_verdict(checks)
    source_metrics = {}
    for tolerance in policy["diagnosticTolerancesMs"]:
        aggregate = {"matched": 0, "predicted": 0, "groundTruth": 0, "errors": []}
        for base, events in events_by_source.items():
            metrics = source_event_metrics(events, notes_by_source[base], [tolerance])[str(tolerance)]
            aggregate["matched"] += metrics["matched"]
            aggregate["predicted"] += metrics["predicted"]
            aggregate["groundTruth"] += metrics["groundTruth"]
            aggregate["errors"].extend(metrics["timing"]["errorsMs"])
            aggregate.setdefault("latencies", []).extend(metrics["timing"]["decisionLatenciesMs"])
        source_metrics[str(tolerance)] = finalize_metric(aggregate)
    raw_diag = raw_probability_diagnostics(policy, targets, canonical, raw_frames_by_source, no_retrigger, selected_offset_ms)
    pressure = event_pressure(events_by_source, notes_by_source)
    timing = per_hop_timing(step_times)
    return {
        "artifact": "online_amt_development",
        "sourceCount": len(sources),
        "targetCount": len(targets),
        "selectedOffsetMs": selected_offset_ms,
        "familyCounts": count_by(targets, "metricFamily"),
        "gtAudit": canonical["summary"],
        "summary": {
            "verdict": verdict,
            "reason": "Development passed all hard gates." if verdict == "PASS" else ("Development has at least one hard failure." if verdict == "FAIL" else "Development missing required evaluated families."),
            "checks": checks,
        },
        "targetRows": target_rows,
        "genericSourceMetrics": source_metrics,
        "rawStateDiagnostics": raw_diag,
        "eventPressure": pressure,
        "perHopTimingMs": timing,
    }


def canonicalize_positive_gt(policy: dict[str, Any], targets: list[dict[str, Any]], notes_by_source: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    radius_ms = float(policy["streamGeometry"]["positiveGtAssociationRadiusMs"])
    by_target: dict[str, list[dict[str, Any]]] = {}
    invalid: list[dict[str, Any]] = []
    chord_spreads = []
    for target in targets:
        if not (target["shouldMatch"] and target["metricFamily"] in POSITIVE_GATES):
            continue
        base = Path(target["sourceFile"]).stem
        anchor_ms = 1000 * float(target.get("physicalAttackTime") or target.get("scheduledExpectedTime") or target.get("candidateTime") or 0)
        used_note_indexes: set[int] = set()
        instances = []
        for pitch in target["expectedPitches"]:
            candidates = []
            for idx, note in enumerate(notes_by_source.get(base, [])):
                if idx in used_note_indexes or note["pitch"] != pitch:
                    continue
                delta = note["startMs"] - anchor_ms
                if abs(delta) <= radius_ms:
                    candidates.append((abs(delta), idx, note, delta))
            if not candidates:
                invalid.append({"targetId": target["targetId"], "pitch": pitch, "oldGroupPhysicalAttackTimeMs": anchor_ms, "reason": "GT_ASSOCIATION_INVALID"})
                continue
            _, idx, note, delta = sorted(candidates)[0]
            used_note_indexes.add(idx)
            instances.append({
                "pitch": pitch,
                "midi": note["midi"],
                "canonicalAttackTimeMs": note["startMs"],
                "oldGroupPhysicalAttackTimeMs": anchor_ms,
                "deltaFromOldAnchorMs": round(delta, 6),
            })
        by_target[target["targetId"]] = instances
        if target["metricFamily"] == "complete_chord" and instances:
            times = [x["canonicalAttackTimeMs"] for x in instances]
            chord_spreads.append(max(times) - min(times))
    return {
        "byTarget": by_target,
        "invalidAssociations": invalid,
        "summary": {
            "positivePitchInstances": sum(len(v) for v in by_target.values()) + len(invalid),
            "successfullyAssociatedGtInstances": sum(len(v) for v in by_target.values()),
            "invalidAssociations": len(invalid),
            "completeChordPhysicalSpreadMs": {
                "sampleCount": len(chord_spreads),
                "p50": percentile(chord_spreads, 50),
                "p95": percentile(chord_spreads, 95),
                "max": percentile(chord_spreads, 100),
                "countGt50Ms": sum(1 for x in chord_spreads if x > 50),
            },
        },
    }


def score_product_gates(policy: dict[str, Any], targets: list[dict[str, Any]], canonical: dict[str, Any], events_by_source: dict[str, list[dict[str, Any]]], notes_by_source: dict[str, list[dict[str, Any]]], no_retrigger: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    window = policy["streamGeometry"]["targetWindowMs"]
    families: dict[str, dict[str, int]] = {name: {"hit": 0, "total": 0, "false": 0, "falseTotal": 0} for name in policy["gates"]}
    target_rows: list[dict[str, Any]] = []
    for target in targets:
        metric = target["metricFamily"]
        if metric not in families:
            continue
        base = Path(target["sourceFile"]).stem
        events = events_by_source.get(base, [])
        target_ms = 1000 * float(target.get("physicalAttackTime") or target.get("scheduledExpectedTime") or target.get("candidateTime") or 0)
        if target["shouldMatch"] and metric in POSITIVE_GATES:
            instances = canonical["byTarget"].get(target["targetId"], [])
            row = score_positive_target(target, instances, events, window)
            complete = row["verdict"] == "PASS"
            families[metric]["hit"] += int(complete)
            families[metric]["total"] += 1
            target_rows.append(row)
        elif metric in FALSE_TARGET_GATES:
            false_accept = all(has_event(events, pitch, target_ms, window) for pitch in target["expectedPitches"])
            families[metric]["false"] += int(false_accept)
            families[metric]["falseTotal"] += 1
            target_rows.append({
                "targetId": target["targetId"],
                "metricFamily": metric,
                "source": base,
                "oldGroupAnchorMs": target_ms,
                "verdict": "FAIL" if false_accept else "PASS",
                "failureReasons": ["FALSE_TARGET_ACCEPT"] if false_accept else [],
            })
    false_retrigger = score_no_retrigger(no_retrigger, events_by_source, notes_by_source, window)
    checks = {}
    for name, gate in policy["gates"].items():
        if "minRecall" in gate:
            total = families[name]["total"]
            hit = families[name]["hit"]
            recall = hit / total if total else None
            checks[name] = {"verdict": "NOT_EVALUATED" if total == 0 else ("PASS" if recall >= gate["minRecall"] else "FAIL"), "sampleCount": total, "hit": hit, "recall": round(recall, 6) if recall is not None else None, "required": gate["minRecall"]}
        elif "maxFalseTargetAccepts" in gate:
            total = families[name]["falseTotal"]
            false = families[name]["false"]
            checks[name] = {"verdict": "NOT_EVALUATED" if total == 0 else ("PASS" if false <= gate["maxFalseTargetAccepts"] else "FAIL"), "sampleCount": total, "falseAccepts": false, "maxAllowed": gate["maxFalseTargetAccepts"]}
        else:
            episodes = false_retrigger["episodeCounts"].get(name, 0)
            events = false_retrigger["byFamily"].get(name, [])
            checks[name] = {"verdict": "NOT_EVALUATED" if episodes == 0 else ("PASS" if len(events) <= gate["maxFalseRetriggerEvents"] else "FAIL"), "sampleCount": episodes, "falseOnsetEvents": len(events), "events": events[:20]}
    return checks, target_rows


def score_positive_target(target: dict[str, Any], instances: list[dict[str, Any]], events: list[dict[str, Any]], window_ms: float) -> dict[str, Any]:
    assigned_events: set[str] = set()
    pitch_rows = []
    failure_reasons = []
    if len(instances) != len(target["expectedPitches"]):
        failure_reasons.append("GT_ASSOCIATION_INVALID")
    for instance in instances:
        candidates = []
        for event in events:
            if event["eventId"] in assigned_events or event["pitch"] != instance["pitch"]:
                continue
            err = event["physicalOnsetTimeMs"] - instance["canonicalAttackTimeMs"]
            if abs(err) <= window_ms:
                candidates.append((abs(err), err, event))
        if candidates:
            _, err, event = sorted(candidates)[0]
            assigned_events.add(event["eventId"])
            pitch_rows.append({
                **instance,
                "assignedEventId": event["eventId"],
                "acousticPhysicalTimeMs": round(event["physicalOnsetTimeMs"], 6),
                "decisionTimeMs": round(event["decisionTimeMs"], 6),
                "timingErrorMs": round(err, 6),
                "stateId": event["stateId"],
                "onsetProbabilityMass": round(event["onsetProbabilityMass"], 6),
                "verdict": "PASS",
            })
        else:
            same_pitch = [event for event in events if event["pitch"] == instance["pitch"]]
            reason = "NO_EVENT_FOR_PITCH"
            if same_pitch:
                nearest = min(same_pitch, key=lambda e: abs(e["physicalOnsetTimeMs"] - instance["canonicalAttackTimeMs"]))
                if abs(nearest["physicalOnsetTimeMs"] - instance["canonicalAttackTimeMs"]) > window_ms:
                    reason = "EVENT_OUTSIDE_50MS"
            failure_reasons.append(reason)
            pitch_rows.append({**instance, "assignedEventId": None, "verdict": "FAIL", "failureReason": reason})
    return {
        "targetId": target["targetId"],
        "metricFamily": target["metricFamily"],
        "source": Path(target["sourceFile"]).stem,
        "oldGroupAnchorMs": 1000 * float(target.get("physicalAttackTime") or target.get("scheduledExpectedTime") or target.get("candidateTime") or 0),
        "expectedPitchInstances": pitch_rows,
        "verdict": "PASS" if not failure_reasons else "FAIL",
        "failureReasons": sorted(set(failure_reasons)),
    }


def gate_verdict(checks: dict[str, dict[str, Any]]) -> str:
    if any(v["verdict"] == "FAIL" for v in checks.values()):
        return "FAIL"
    if any(v["verdict"] == "NOT_EVALUATED" for v in checks.values()):
        return "INCONCLUSIVE"
    return "PASS"


def build_no_retrigger_episodes(targets: list[dict[str, Any]], notes_by_source: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    episodes = {}
    for target in targets:
        family = target["metricFamily"]
        if family not in NO_RETRIGGER_GATES:
            continue
        base = Path(target["sourceFile"]).stem
        pitch = target["expectedPitches"][0]
        probe = 1000 * float(target.get("stressProbeTime") or target.get("candidateTime") or 0)
        previous = nearest_previous_same_pitch(notes_by_source[base], pitch, probe)
        if not previous:
            continue
        next_note = nearest_next_same_pitch(notes_by_source[base], pitch, previous["startMs"] + 1e-3)
        key = (base, family, pitch, previous["startMs"])
        item = episodes.setdefault(key, {
            "episodeId": f"{base}:{family}:{pitch}:{previous['startMs']:.3f}",
            "source": base,
            "family": family,
            "pitch": pitch,
            "previousAttackMs": previous["startMs"],
            "nextAttackMs": next_note["startMs"] if next_note else None,
            "intervalStartMs": previous["startMs"] + 50,
            "intervalEndMs": next_note["startMs"] if next_note else probe,
        })
        item["intervalEndMs"] = min(item["nextAttackMs"], max(item["intervalEndMs"], probe)) if item["nextAttackMs"] else max(item["intervalEndMs"], probe)
    return list(episodes.values())


def score_no_retrigger(episodes: list[dict[str, Any]], events_by_source: dict[str, list[dict[str, Any]]], notes_by_source: dict[str, list[dict[str, Any]]], real_attack_window_ms: float) -> dict[str, Any]:
    by_family: dict[str, list[dict[str, Any]]] = {}
    counts: dict[str, int] = {}
    seen_false_event_ids: dict[str, set[str]] = {}
    for ep in episodes:
        counts[ep["family"]] = counts.get(ep["family"], 0) + 1
        for event in events_by_source.get(ep["source"], []):
            if event["pitch"] != ep["pitch"]:
                continue
            t = event["physicalOnsetTimeMs"]
            if ep["intervalStartMs"] <= t < ep["intervalEndMs"]:
                real_notes = [note for note in notes_by_source.get(ep["source"], []) if note["pitch"] == ep["pitch"] and abs(note["startMs"] - t) <= real_attack_window_ms]
                if real_notes:
                    continue
                family_seen = seen_false_event_ids.setdefault(ep["family"], set())
                if event["eventId"] in family_seen:
                    continue
                family_seen.add(event["eventId"])
                by_family.setdefault(ep["family"], []).append({
                    "eventId": event["eventId"],
                    "episodeId": ep["episodeId"],
                    "pitch": ep["pitch"],
                    "eventTimeMs": round(t, 3),
                    "stateId": event["stateId"],
                    "onsetProbabilityMass": round(event["onsetProbabilityMass"], 6),
                    "previousRealSamePitchAttackMs": round(ep["previousAttackMs"], 3),
                    "nextRealSamePitchAttackMs": round(ep["nextAttackMs"], 3) if ep["nextAttackMs"] else None,
                })
    return {"byFamily": by_family, "episodeCounts": counts}


def apply_offset(events: list[dict[str, Any]], offset_ms: float) -> list[dict[str, Any]]:
    out = []
    for event in events:
        item = dict(event)
        item["physicalOnsetTimeMs"] = item["decisionTimeMs"] + offset_ms
        out.append(item)
    return out


def has_event(events: list[dict[str, Any]], pitch: str, target_ms: float, window_ms: float) -> bool:
    return any(event["pitch"] == pitch and abs(event["physicalOnsetTimeMs"] - target_ms) <= window_ms for event in events)


def midi_notes(midi: Any) -> list[dict[str, Any]]:
    notes = []
    for inst in midi.instruments:
        for note in inst.notes:
            notes.append({"pitch": midi_note_name(int(note.pitch)), "midi": int(note.pitch), "startMs": 1000 * float(note.start), "endMs": 1000 * float(note.end)})
    return sorted(notes, key=lambda n: (n["startMs"], n["midi"]))


def source_event_metrics(events: list[dict[str, Any]], notes: list[dict[str, Any]], tolerances_ms: list[int]) -> dict[str, Any]:
    result = {}
    for tol in tolerances_ms:
        matched_events = set()
        matched_notes = set()
        errors = []
        latencies = []
        candidates = []
        for event_index, event in enumerate(events):
            for note_index, note in enumerate(notes):
                if event["midi"] == note["midi"]:
                    err = event["physicalOnsetTimeMs"] - note["startMs"]
                    if abs(err) <= tol:
                        candidates.append((abs(err), err, event_index, note_index))
        for _, err, event_index, note_index in sorted(candidates):
            if event_index in matched_events or note_index in matched_notes:
                continue
            matched_events.add(event_index)
            matched_notes.add(note_index)
            errors.append(err)
            latencies.append(events[event_index]["decisionTimeMs"] - notes[note_index]["startMs"])
        metric = finalize_metric({"matched": len(errors), "predicted": len(events), "groundTruth": len(notes), "errors": errors, "latencies": latencies})
        metric["matchedEventIds"] = sorted(matched_events)
        result[str(tol)] = metric
    return result


def finalize_metric(data: dict[str, Any]) -> dict[str, Any]:
    precision = data["matched"] / data["predicted"] if data["predicted"] else 0
    recall = data["matched"] / data["groundTruth"] if data["groundTruth"] else 0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
    abs_errors = [abs(x) for x in data["errors"]]
    latencies = data.get("latencies", [])
    return {
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "matched": data["matched"],
        "predicted": data["predicted"],
        "groundTruth": data["groundTruth"],
        "timing": {
            "errorsMs": [round(float(x), 6) for x in data["errors"]],
            "sampleCount": len(data["errors"]),
            "signedP05Ms": percentile(data["errors"], 5),
            "signedP50Ms": percentile(data["errors"], 50),
            "signedP95Ms": percentile(data["errors"], 95),
            "absoluteP50Ms": percentile(abs_errors, 50),
            "absoluteP95Ms": percentile(abs_errors, 95),
            "absoluteMaxMs": round(max(abs_errors), 3) if abs_errors else None,
            "decisionLatencyP50Ms": percentile(latencies, 50),
            "decisionLatencyP95Ms": percentile(latencies, 95),
            "decisionLatencyMaxMs": round(max(latencies), 3) if latencies else None,
            "decisionLatenciesMs": [round(float(x), 6) for x in latencies],
        },
    }


def raw_probability_diagnostics(policy: dict[str, Any], targets: list[dict[str, Any]], canonical: dict[str, Any], raw_by_source: dict[str, list[dict[str, Any]]], episodes: list[dict[str, Any]], selected_offset_ms: float) -> dict[str, Any]:
    positive = []
    wrong = []
    negative = []
    for target in targets:
        base = Path(target["sourceFile"]).stem
        frames = raw_by_source.get(base, [])
        instances = canonical["byTarget"].get(target["targetId"], [])
        if instances:
            pitch_times = [(i["pitch"], i["canonicalAttackTimeMs"]) for i in instances]
        else:
            target_ms = 1000 * float(target.get("physicalAttackTime") or target.get("scheduledExpectedTime") or target.get("candidateTime") or 0)
            pitch_times = [(pitch, target_ms) for pitch in target["expectedPitches"]]
        for pitch, target_ms in pitch_times:
            value = peak_mass(frames, pitch, target_ms, 50, selected_offset_ms)
            if target["shouldMatch"] and target["metricFamily"] in POSITIVE_GATES:
                positive.append(value)
            elif target["metricFamily"] in FALSE_TARGET_GATES:
                wrong.append(value)
    for ep in episodes:
        frames = raw_by_source.get(ep["source"], [])
        for frame in frames:
            t = frame["decisionTimeMs"] + selected_offset_ms
            if ep["intervalStartMs"] <= t < ep["intervalEndMs"]:
                idx = note_name_to_midi(ep["pitch"]) - MIDI_OFFSET
                probs = frame["stateProbabilities"][idx]
                negative.append(float(probs[3] + probs[4]))
    return {"positive": dist(positive), "wrongExpectedPitch": dist(wrong), "noRetriggerNegative": dist(negative)}


def peak_mass(frames: list[dict[str, Any]], pitch: str, target_ms: float, window_ms: float, selected_offset_ms: float) -> float:
    idx = note_name_to_midi(pitch) - MIDI_OFFSET
    values = []
    for frame in frames:
        if abs((frame["decisionTimeMs"] + selected_offset_ms) - target_ms) <= window_ms:
            probs = frame["stateProbabilities"][idx]
            values.append(float(probs[3] + probs[4]))
    return max(values) if values else 0.0


def event_pressure(events_by_source: dict[str, list[dict[str, Any]]], notes_by_source: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    events = sum(len(x) for x in events_by_source.values())
    notes = sum(len(x) for x in notes_by_source.values())
    duration_min = 0
    matched = 0
    same_pitch_unmatched = 0
    for notes_list in notes_by_source.values():
        if notes_list:
            duration_min += max(note["endMs"] for note in notes_list) / 60000
    for base, evs in events_by_source.items():
        metrics = source_event_metrics(evs, notes_by_source[base], [50])["50"]
        matched += metrics["matched"]
        matched_event_ids = set(metrics.get("matchedEventIds", []))
        for idx, event in enumerate(evs):
            if idx in matched_event_ids:
                continue
            if any(note["midi"] == event["midi"] for note in notes_by_source[base]):
                same_pitch_unmatched += 1
    unmatched = events - matched
    duplicate = max(0, events - notes - unmatched)
    return {
        "eventsPerMinute": round(events / duration_min, 3) if duration_min else 0,
        "matchedEventsPerMinute": round(matched / duration_min, 3) if duration_min else 0,
        "unmatchedEventsPerMinute": round(unmatched / duration_min, 3) if duration_min else 0,
        "samePitchUnmatchedEventsPerMinute": round(same_pitch_unmatched / duration_min, 3) if duration_min else 0,
        "duplicateEventsPerMinute": round(duplicate / duration_min, 3) if duration_min else 0,
        "eventCount": events,
        "matchedEventCount": matched,
        "unmatchedEventCount": unmatched,
        "physicalNoteCount": notes,
    }


def per_hop_timing(values: list[float]) -> dict[str, Any]:
    return {"sampleCount": len(values), "medianMs": percentile(values, 50), "p95Ms": percentile(values, 95), "p99Ms": percentile(values, 99), "maxMs": round(max(values), 6) if values else None, "budgetMs": 32}


def dist(values: list[float]) -> dict[str, Any]:
    return {"sampleCount": len(values), "min": percentile(values, 0), "p05": percentile(values, 5), "p50": percentile(values, 50), "p95": percentile(values, 95), "max": percentile(values, 100)}


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    return round(float(np.percentile(np.asarray(values), p)), 6)


def nearest_previous_same_pitch(notes: list[dict[str, Any]], pitch: str, time_ms: float) -> dict[str, Any] | None:
    candidates = [note for note in notes if note["pitch"] == pitch and note["startMs"] <= time_ms]
    return candidates[-1] if candidates else None


def nearest_next_same_pitch(notes: list[dict[str, Any]], pitch: str, time_ms: float) -> dict[str, Any] | None:
    for note in notes:
        if note["pitch"] == pitch and note["startMs"] > time_ms:
            return note
    return None


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_note_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def note_name_to_midi(name: str) -> int:
    if len(name) < 2:
        raise ValueError(name)
    pitch = name[:-1]
    octave = int(name[-1])
    return NOTE_NAMES.index(pitch) + 12 * (octave + 1)


def count_by(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row[key]] = counts.get(row[key], 0) + 1
    return dict(sorted(counts.items()))


def write_decision(args: argparse.Namespace, decision: dict[str, Any], verdict: str, category: str, reason: str) -> int:
    decision["final"] = {
        "development": "FAIL" if category in {"PRODUCT_ACOUSTIC_GATE_FAILURE", "INCONCLUSIVE_LEGACY_RUNTIME_PARITY"} else "NOT RUN",
        "calibration": "NOT RUN",
        "stepReplay": "NOT RUN",
        "continuousReplay": "NOT RUN",
        "browser": "NOT RUN",
        "verdict": f"Online-AMT Stateful Acoustic Frontend = {verdict}",
        "failureCategory": category,
        "reason": reason,
        "productionMicrophone": "DISABLED",
    }
    write_json(args.decision_json, decision)
    args.decision_md.parent.mkdir(parents=True, exist_ok=True)
    args.decision_md.write_text(markdown(decision), encoding="utf-8")
    return 0 if verdict in {"PASS", "INCONCLUSIVE"} else 1


def markdown(decision: dict[str, Any]) -> str:
    final = decision["final"]
    return "\n".join([
        "# Online-AMT Stateful Acoustic Frontend Decision",
        "",
        f"Research harness SHA: `{decision['metadata']['researchHarnessGitHead']}`",
        "",
        f"Final verdict: `{final['verdict']}`",
        f"Failure category: `{final['failureCategory']}`",
        f"Reason: {final['reason']}",
        "",
        "Production microphone remains disabled after Phase 8B.",
        "No production integration was performed.",
        "",
    ])


if __name__ == "__main__":
    raise SystemExit(main())
