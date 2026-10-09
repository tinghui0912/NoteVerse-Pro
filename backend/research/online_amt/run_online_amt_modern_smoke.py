"""Research-only Online-AMT modern compatibility smoke.

This script performs model execution only. It intentionally does not implement
Practice scoring; its hop artifact is consumed by the TypeScript research
adapter and ContinuousFinalizationLedger.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np


REPO_COMMIT = "ad12550909a1d86f699097d11885f427054a5ac2"
CHECKPOINT_SHA256 = "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0"
CHECKPOINT_BYTES = 178_804_960
SAMPLE_RATE = 16_000
HOP_SAMPLES = 512
ONSET_STATE_IDS = {3, 4}
MIDI_OFFSET = 21


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--online-amt-repo", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--duration-ms", type=float, default=1024)
    parser.add_argument("--segment-input", type=Path)
    parser.add_argument("--pseudo-intensity", choices=["DISABLED", "NATIVE"], default="DISABLED")
    parser.add_argument("--onset-boost", type=float, default=2.0)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    artifact = run_smoke(args)
    args.output.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(args.output)
    return 0 if artifact["runtimeSmoke"]["status"] == "PASS" else 2


def run_smoke(args: argparse.Namespace) -> dict[str, Any]:
    identity = inspect_assets(args.online_amt_repo, args.checkpoint)
    runtime = runtime_block()
    if identity["status"] != "PASS":
        return {
            "schemaVersion": 1,
            "artifact": "online_amt_modern_runtime_smoke",
            "runtime": runtime,
            "assetIdentity": identity,
            "runtimeSmoke": {"status": "BLOCKED", "reason": identity["reason"]},
            "statefulnessSmoke": {"status": "BLOCKED", "reason": identity["reason"]},
            "hopArtifact": None,
            "productAccuracyMetric": False,
            "legacyRuntimeParity": "UNPROVEN",
        }

    try:
        prepare_online_amt_imports(args.online_amt_repo)
        import torch
        from transcribe import load_model, OnlineTranscriber

        adapter = OnlineAmtAdapter(
            args.checkpoint,
            torch=torch,
            load_model=load_model,
            transcriber_cls=OnlineTranscriber,
            pseudo_intensity=args.pseudo_intensity,
            onset_boost=float(args.onset_boost),
        )
        if args.segment_input:
            fixture_segments = load_segment_input(args.segment_input)
            hop_segments = [
                adapter.process_segment(
                    segment_id=segment["segmentId"],
                    performance_start_ms=float(segment["performanceStartMs"]),
                    performance_pcm=segment["performancePcm16k"],
                    context_tail_pcm=segment["contextTailPcm16k"],
                )
                for segment in fixture_segments
            ]
            fixture = fixture_segments[0]["performancePcm16k"]
        else:
            fixture = synthetic_fixture(args.duration_ms)
            context_tail = synthetic_fixture(required_context_tail_ms(len(fixture)))
            hop_segments = [adapter.process_segment(
                segment_id="synthetic-runtime-smoke-seg-0",
                performance_start_ms=0.0,
                performance_pcm=fixture,
                context_tail_pcm=context_tail,
            )]
        determinism = reset_determinism(adapter, fixture)
        causality = prefix_causality(adapter, fixture)
        state_effect = stateful_effect(adapter, fixture)
        passed = determinism["pass"] and causality["pass"] and state_effect["statefulEffectDemonstrated"]
        return {
            "schemaVersion": 1,
            "artifact": "online_amt_modern_runtime_smoke",
            "runtime": runtime_block(torch=torch),
            "assetIdentity": identity,
            "runtimeSmoke": {"status": "PASS", "realModelLoaded": True, "realPcmProcessed": True},
            "statefulnessSmoke": {
                "status": "PASS" if passed else "INCONCLUSIVE",
                "resetDeterminism": determinism,
                "prefixCausality": causality,
                "statefulEffect": state_effect,
            },
            "hopArtifact": {
                "schemaVersion": 1,
                "artifact": "online_amt_real_hop_output",
                "policy": {
                    "pseudoIntensity": args.pseudo_intensity,
                    "onsetBoost": float(args.onset_boost),
                },
                "segments": hop_segments,
            },
            "productAccuracyMetric": False,
            "legacyRuntimeParity": "UNPROVEN",
        }
    except Exception as exc:  # pragma: no cover - exercised only with external assets.
        return {
            "schemaVersion": 1,
            "artifact": "online_amt_modern_runtime_smoke",
            "runtime": runtime,
            "assetIdentity": identity,
            "runtimeSmoke": {"status": "FAIL", "reason": repr(exc)},
            "statefulnessSmoke": {"status": "FAIL", "reason": repr(exc)},
            "hopArtifact": None,
            "productAccuracyMetric": False,
            "legacyRuntimeParity": "UNPROVEN",
        }


class OnlineAmtAdapter:
    def __init__(self, checkpoint: Path, *, torch: Any, load_model: Any, transcriber_cls: Any, pseudo_intensity: str, onset_boost: float):
        self.checkpoint = checkpoint
        self.torch = torch
        self.load_model = load_model
        self.transcriber_cls = transcriber_cls
        self.pseudo_intensity = pseudo_intensity
        self.onset_boost = onset_boost

    def new_session(self) -> Any:
        model = self.load_model(str(self.checkpoint))
        return self.transcriber_cls(model, return_roll=False)

    def process_segment(
        self,
        *,
        segment_id: str,
        performance_start_ms: float,
        performance_pcm: np.ndarray,
        context_tail_pcm: np.ndarray,
    ) -> dict[str, Any]:
        session = self.new_session()
        stream = np.concatenate([performance_pcm.astype(np.float32), context_tail_pcm.astype(np.float32)])
        hop_count = len(stream) // HOP_SAMPLES
        hops: list[dict[str, Any]] = []
        for hop_index in range(hop_count):
            start = hop_index * HOP_SAMPLES
            hop = stream[start:start + HOP_SAMPLES]
            t0 = time.perf_counter()
            state = self.step(session, hop)
            latency_ms = (time.perf_counter() - t0) * 1000
            hops.append({
                "hopIndex": hop_index,
                "localDecisionSample": start + HOP_SAMPLES,
                "processingLatencyMs": latency_ms,
                "pitchStates": [
                    {
                        "pitch": midi_note_name(MIDI_OFFSET + pitch_index),
                        "chosenState": int(state["states"][pitch_index]),
                        "probabilities": [float(value) for value in state["probabilities"][pitch_index]],
                    }
                    for pitch_index in range(88)
                ],
            })
        return {
            "segmentId": segment_id,
            "performanceStartMs": performance_start_ms,
            "performanceOwnedSamples": int(len(performance_pcm)),
            "contextTailSamples": int(len(context_tail_pcm)),
            "hops": hops,
        }

    def process_states(self, audio: np.ndarray, *, reset_every_hop: bool = False) -> list[list[int]]:
        session = self.new_session()
        states = []
        for start in range(0, len(audio) - HOP_SAMPLES + 1, HOP_SAMPLES):
            state = self.step(session, audio[start:start + HOP_SAMPLES], reset_recurrent=reset_every_hop)
            states.append([int(value) for value in state["states"]])
        return states

    def step(self, session: Any, audio: np.ndarray, *, reset_recurrent: bool = False) -> dict[str, Any]:
        th = self.torch
        with th.no_grad():
            session.update_buffer(audio.astype(np.float32))
            if self.pseudo_intensity == "NATIVE":
                session.switch_on_or_off()
                if session.num_under_thr > session.patience:
                    silent = np.zeros((88, 5), dtype=np.float32)
                    silent[:, 0] = 1.0
                    return {
                        "probabilities": silent,
                        "states": np.zeros(88, dtype=np.int64),
                    }
            session.update_mel_buffer()
            acoustic_out = session.update_acoustic_out(session.mel_buffer.transpose(-1, -2))
            if reset_recurrent:
                session.hidden = None
                session.prev_output = th.zeros_like(session.prev_output)
            language_out, session.hidden = session.model.lm_model_step(acoustic_out, session.hidden, session.prev_output)
            boosted = language_out.clone()
            boosted[0, 0, :, 3:5] *= self.onset_boost
            session.prev_output = boosted.argmax(dim=3)
            return {
                "probabilities": language_out[0, 0, :, :].detach().cpu().numpy(),
                "states": session.prev_output[0, 0, :].detach().cpu().numpy(),
            }


def inspect_assets(repo: Path, checkpoint: Path) -> dict[str, Any]:
    if not repo.exists():
        return {"status": "BLOCKED", "reason": "ONLINE_AMT_REPO_MISSING", "repo": str(repo)}
    if not checkpoint.exists():
        return {"status": "BLOCKED", "reason": "ONLINE_AMT_CHECKPOINT_MISSING", "checkpoint": str(checkpoint)}
    commit = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    checkpoint_sha = sha256(checkpoint)
    checkpoint_bytes = checkpoint.stat().st_size
    problems = []
    if commit != REPO_COMMIT:
        problems.append(f"repo commit mismatch: {commit}")
    if checkpoint_sha != CHECKPOINT_SHA256:
        problems.append(f"checkpoint SHA256 mismatch: {checkpoint_sha}")
    if checkpoint_bytes != CHECKPOINT_BYTES:
        problems.append(f"checkpoint bytes mismatch: {checkpoint_bytes}")
    return {
        "status": "PASS" if not problems else "BLOCKED",
        "reason": "; ".join(problems) if problems else "asset identity verified",
        "repoCommit": commit,
        "checkpointSha256": checkpoint_sha,
        "checkpointBytes": checkpoint_bytes,
    }


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


def reset_determinism(adapter: OnlineAmtAdapter, fixture: np.ndarray) -> dict[str, Any]:
    return {"pass": adapter.process_states(fixture) == adapter.process_states(fixture)}


def prefix_causality(adapter: OnlineAmtAdapter, fixture: np.ndarray) -> dict[str, Any]:
    prefix = fixture[: HOP_SAMPLES * 8]
    future = fixture[: HOP_SAMPLES * 12]
    a = adapter.process_states(prefix)
    b = adapter.process_states(future)
    return {"pass": a == b[:len(a)], "prefixHopCount": len(a)}


def stateful_effect(adapter: OnlineAmtAdapter, fixture: np.ndarray) -> dict[str, Any]:
    continuous = adapter.process_states(fixture)
    reset_each = adapter.process_states(fixture, reset_every_hop=True)
    return {
        "statefulEffectDemonstrated": continuous != reset_each,
        "hopCount": len(continuous),
    }


def synthetic_fixture(duration_ms: float) -> np.ndarray:
    sample_count = int(math.ceil(duration_ms / 1000 * SAMPLE_RATE))
    t = np.arange(sample_count, dtype=np.float32) / SAMPLE_RATE
    return (0.2 * np.sin(2 * math.pi * 440 * t) + 0.1 * np.sin(2 * math.pi * 660 * t)).astype(np.float32)


def required_context_tail_ms(performance_samples: int) -> float:
    correction_delay_samples = math.ceil(158 / 1000 * SAMPLE_RATE)
    required_processed_samples = math.ceil((performance_samples + correction_delay_samples) / HOP_SAMPLES) * HOP_SAMPLES
    return max(0, required_processed_samples - performance_samples) / SAMPLE_RATE * 1000


def load_segment_input(path: Path) -> list[dict[str, Any]]:
    parsed = json.loads(path.read_text(encoding="utf-8"))
    segments = parsed.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ValueError("Online-AMT segment input requires a non-empty segments array")
    output: list[dict[str, Any]] = []
    for segment in segments:
        segment_id = segment.get("segmentId")
        performance_start_ms = segment.get("performanceStartMs")
        performance_pcm = np.asarray(segment.get("performancePcm16k"), dtype=np.float32)
        context_tail_pcm = np.asarray(segment.get("contextTailPcm16k"), dtype=np.float32)
        if not segment_id or not np.isfinite(float(performance_start_ms)):
            raise ValueError("Online-AMT segment input has invalid segment identity")
        if performance_pcm.ndim != 1 or context_tail_pcm.ndim != 1:
            raise ValueError("Online-AMT segment PCM must be one-dimensional")
        if not np.all(np.isfinite(performance_pcm)) or not np.all(np.isfinite(context_tail_pcm)):
            raise ValueError("Online-AMT segment PCM must be finite")
        output.append({
            "segmentId": str(segment_id),
            "performanceStartMs": float(performance_start_ms),
            "performancePcm16k": performance_pcm,
            "contextTailPcm16k": context_tail_pcm,
        })
    return output


def runtime_block(*, torch: Any | None = None) -> dict[str, Any]:
    packages: dict[str, str] = {}
    for name in ["torch", "numpy", "librosa", "scipy", "numba", "pretty_midi", "soundfile"]:
        try:
            module = __import__(name)
            packages[name] = getattr(module, "__version__", "unknown")
        except Exception as exc:
            packages[name] = f"UNAVAILABLE:{exc.__class__.__name__}"
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "packages": packages,
        "device": "cpu",
        "torchCudaAvailable": bool(torch.cuda.is_available()) if torch is not None else False,
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def midi_note_name(midi: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return f"{names[midi % 12]}{midi // 12 - 1}"


if __name__ == "__main__":
    raise SystemExit(main())
