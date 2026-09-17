"""Research-only hybrid bounded verifier latency prototype.

This script simulates a browser/client sending a fixed-anchor bounded PCM clip
to a backend GPU verifier over one simple HTTP transport. It does not touch
production STEP progression, Matchmaker, the frozen evaluation set, or the
frozen ByteDance verifier thresholds.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from time import perf_counter
from typing import Any

import numpy as np

from compare_step_microphone_frontends_causal_cases import (
    ByteDancePianoTranscriptionProvider,
    _activation_prediction,
    _evaluate_expected,
)
from evaluate_bytedance_direct_note_frontend import (
    _checkpoint_path,
    _direct_note_forward,
    _sha256,
    _validate_policy,
    _warm_up_note_model,
)


SAMPLE_RATE = 16000
TARGET_ANCHOR_SECONDS = 1.6
EXPECTED_SAMPLE_COUNT = 29120


class VerifierServerState:
    def __init__(
        self,
        *,
        provider: ByteDancePianoTranscriptionProvider,
        device: str,
        local_pre_seconds: float,
        local_post_seconds: float,
        onset_threshold: float,
        frame_threshold: float,
    ) -> None:
        self.provider = provider
        self.device = device
        self.local_pre_seconds = local_pre_seconds
        self.local_post_seconds = local_post_seconds
        self.onset_threshold = onset_threshold
        self.frame_threshold = frame_threshold


class VerifierHandler(BaseHTTPRequestHandler):
    server_version = "HybridBoundedVerifierResearch/0.1"

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/verify":
            self.send_error(404)
            return
        state: VerifierServerState = self.server.state  # type: ignore[attr-defined]
        content_length = int(self.headers.get("Content-Length", "0"))
        expected_pitches = tuple(
            pitch for pitch in self.headers.get("X-Expected-Pitches", "").split(",") if pitch
        )
        target_second = float(self.headers.get("X-Target-Second", str(TARGET_ANCHOR_SECONDS)))
        synthetic_one_way_delay_ms = float(self.headers.get("X-Synthetic-One-Way-Delay-Ms", "0"))

        deserialize_started = perf_counter()
        body = self.rfile.read(content_length)
        audio = np.frombuffer(body, dtype="<f4")
        if audio.shape[0] != EXPECTED_SAMPLE_COUNT:
            self.send_error(400, f"expected {EXPECTED_SAMPLE_COUNT} float32 samples, got {audio.shape[0]}")
            return
        clip_audio = audio.astype(np.float32, copy=False)
        deserialize_ms = (perf_counter() - deserialize_started) * 1000.0

        raw_output, forward_latency = _direct_note_forward(
            state.provider,
            clip_audio,
            SAMPLE_RATE,
            device=state.device,
        )
        evidence_started = perf_counter()
        prediction = _activation_prediction(
            raw_output,
            expected_pitches=expected_pitches,
            clip_start_seconds=target_second - TARGET_ANCHOR_SECONDS,
            analysis_start_seconds=target_second - state.local_pre_seconds,
            analysis_end_seconds=target_second + state.local_post_seconds,
            target_second=target_second,
            onset_threshold=state.onset_threshold,
            frame_threshold=state.frame_threshold,
        )
        evidence_ms = (perf_counter() - evidence_started) * 1000.0

        evaluation_started = perf_counter()
        observed = tuple(
            pitch
            for pitch, evidence in prediction["expected_evidence"].items()
            if evidence["accepted"]
        )
        result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
        evaluation_ms = (perf_counter() - evaluation_started) * 1000.0

        response = {
            "result": result,
            "matched": matched,
            "missing": missing,
            "extra": extra,
            "evidence": prediction["expected_evidence"],
            "timings_ms": {
                "deserialize": deserialize_ms,
                "model_inference": forward_latency["forward_ms"],
                "evidence": evidence_ms,
                "evaluation": evaluation_ms,
            },
        }
        if synthetic_one_way_delay_ms > 0:
            time.sleep(synthetic_one_way_delay_ms / 1000.0)
        payload = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


def main() -> int:
    args = parse_args()
    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    _validate_policy(policy_artifact)
    policy = policy_artifact["policy"]
    window = policy_artifact["benchmark_window"]
    frontend = policy_artifact["frontend"]
    checkpoint_path = _checkpoint_path(frontend)
    checkpoint_sha256 = _sha256(checkpoint_path)
    if checkpoint_sha256 != frontend["checkpoint_sha256"]:
        raise ValueError(
            "checkpoint SHA256 mismatch: "
            f"expected {frontend['checkpoint_sha256']}, got {checkpoint_sha256}"
        )
    provider = ByteDancePianoTranscriptionProvider(
        checkpoint_path=checkpoint_path,
        device=args.device,
    )
    _warm_up_note_model(provider, device=args.device)

    fixtures = _load_fixtures(args.fixture_dir)
    references = _reference_decisions(
        fixtures,
        fixture_dir=args.fixture_dir,
        local_pre_seconds=float(window["local_pre_seconds"]),
        local_post_seconds=float(window["local_post_seconds"]),
        onset_threshold=float(policy["target_onset_min"]),
        frame_threshold=float(policy["target_frame_min"]),
    )

    server = ThreadingHTTPServer((args.host, 0), VerifierHandler)
    server.state = VerifierServerState(  # type: ignore[attr-defined]
        provider=provider,
        device=args.device,
        local_pre_seconds=float(window["local_pre_seconds"]),
        local_post_seconds=float(window["local_post_seconds"]),
        onset_threshold=float(policy["target_onset_min"]),
        frame_threshold=float(policy["target_frame_min"]),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = int(server.server_address[1])
        delay_reports = {}
        for delay_ms in args.synthetic_one_way_delay_ms:
            delay_reports[str(delay_ms)] = _run_delay_bucket(
                fixtures,
                references=references,
                fixture_dir=args.fixture_dir,
                host=args.host,
                port=port,
                synthetic_one_way_delay_ms=delay_ms,
                warm_runs=args.warm_runs,
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    report = {
        "scope": "research_only_hybrid_bounded_verifier_latency",
        "production_modified": False,
        "frozen_evaluation_used": False,
        "transport": "HTTP POST application/octet-stream",
        "request_contract": {
            "sample_rate": SAMPLE_RATE,
            "channels": 1,
            "pcm_dtype": "float32 little-endian",
            "target_anchor_ms": 1600,
            "future_ms": 220,
            "samples": EXPECTED_SAMPLE_COUNT,
            "expected_pitches_transport": "X-Expected-Pitches header",
        },
        "response_contract": {
            "result": "MATCH | PARTIAL | MISMATCH | UNCERTAIN",
            "diagnostic_evidence": "optional expected-pitch onset/frame evidence",
            "midi_returned": False,
            "matchmaker_semantics_exposed": False,
        },
        "policy": {
            "checkpoint_sha256": checkpoint_sha256,
            "onset_threshold": policy["target_onset_min"],
            "frame_threshold": policy["target_frame_min"],
        },
        "fixtures": [
            {
                "fixture_id": fixture["fixture_id"],
                "case_kind": fixture["case_kind"],
                "expected_pitches": fixture["expected_pitches"],
                "reference_result": references[fixture["fixture_id"]]["result"],
            }
            for fixture in fixtures
        ],
        "delay_reports": delay_reports,
        "architecture_boundary": {
            "StrikeVerifier": "Transport/provider-neutral interface: verify(bounded_pcm, expected_pitches) -> result + optional evidence.",
            "RemoteBoundedVerifier": "Near-term implementation candidate backed by backend GPU direct note_model.",
            "LocalBoundedVerifier": "Future swappable implementation candidate; not implemented here.",
            "STEP_progression_dependency": "STEP should depend on StrikeVerifier results, not transport/provider details.",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(_compact_summary(report), ensure_ascii=False, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--fixture-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--warm-runs", type=int, default=24)
    parser.add_argument(
        "--synthetic-one-way-delay-ms",
        type=float,
        action="append",
        default=None,
    )
    args = parser.parse_args()
    if args.synthetic_one_way_delay_ms is None:
        args.synthetic_one_way_delay_ms = [0.0, 25.0, 50.0, 100.0]
    return args


def _load_fixtures(fixture_dir: Path) -> list[dict[str, object]]:
    manifest = json.loads((fixture_dir / "manifest.json").read_text(encoding="utf-8"))
    return list(manifest["fixtures"])


def _reference_decisions(
    fixtures: list[dict[str, object]],
    *,
    fixture_dir: Path,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, dict[str, object]]:
    references = {}
    for fixture in fixtures:
        onset = np.load(fixture_dir / str(fixture["reg_onset_output_npy"]))
        frame = np.load(fixture_dir / str(fixture["frame_output_npy"]))
        velocity = np.load(fixture_dir / str(fixture["velocity_output_npy"]))
        target_second = float(fixture["target_second"])
        expected_pitches = tuple(str(pitch) for pitch in fixture["expected_pitches"])
        prediction = _activation_prediction(
            {"onset": onset, "frame": frame, "velocity": velocity},
            expected_pitches=expected_pitches,
            clip_start_seconds=target_second - TARGET_ANCHOR_SECONDS,
            analysis_start_seconds=target_second - local_pre_seconds,
            analysis_end_seconds=target_second + local_post_seconds,
            target_second=target_second,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        observed = tuple(
            pitch
            for pitch, evidence in prediction["expected_evidence"].items()
            if evidence["accepted"]
        )
        result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
        references[str(fixture["fixture_id"])] = {
            "result": result,
            "matched": matched,
            "missing": missing,
            "extra": extra,
        }
    return references


def _run_delay_bucket(
    fixtures: list[dict[str, object]],
    *,
    references: dict[str, dict[str, object]],
    fixture_dir: Path,
    host: str,
    port: int,
    synthetic_one_way_delay_ms: float,
    warm_runs: int,
) -> dict[str, object]:
    samples = []
    fixture_count = len(fixtures)
    for index in range(warm_runs):
        fixture = fixtures[index % fixture_count]
        samples.append(
            _send_request(
                fixture,
                reference=references[str(fixture["fixture_id"])],
                fixture_dir=fixture_dir,
                host=host,
                port=port,
                synthetic_one_way_delay_ms=synthetic_one_way_delay_ms,
            )
        )
    return {
        "synthetic_one_way_delay_ms": synthetic_one_way_delay_ms,
        "sample_count": len(samples),
        "correctness": {
            "decision_agreement": sum(1 for sample in samples if sample["decision_agree"]),
            "total": len(samples),
            "rate": round(sum(1 for sample in samples if sample["decision_agree"]) / len(samples), 6)
            if samples
            else None,
        },
        "request_upload_bytes": _distribution([sample["request_upload_bytes"] for sample in samples]),
        "response_bytes": _distribution([sample["response_bytes"] for sample in samples]),
        "client_serialization_ms": _distribution([sample["client_serialization_ms"] for sample in samples]),
        "transport_overhead_ms": _distribution([sample["transport_overhead_ms"] for sample in samples]),
        "backend_deserialize_ms": _distribution([sample["backend_timings_ms"]["deserialize"] for sample in samples]),
        "backend_model_inference_ms": _distribution([sample["backend_timings_ms"]["model_inference"] for sample in samples]),
        "backend_evidence_ms": _distribution([sample["backend_timings_ms"]["evidence"] for sample in samples]),
        "backend_evaluation_ms": _distribution([sample["backend_timings_ms"]["evaluation"] for sample in samples]),
        "request_to_decision_ms": _distribution([sample["request_to_decision_ms"] for sample in samples]),
        "estimated_strike_to_decision_ms": _distribution(
            [220.0 + sample["request_to_decision_ms"] for sample in samples]
        ),
        "per_fixture": _per_fixture(samples),
    }


def _send_request(
    fixture: dict[str, object],
    *,
    reference: dict[str, object],
    fixture_dir: Path,
    host: str,
    port: int,
    synthetic_one_way_delay_ms: float,
) -> dict[str, object]:
    audio = np.load(fixture_dir / str(fixture["input_tensor_npy"]))
    serialization_started = perf_counter()
    payload = np.asarray(audio, dtype="<f4").tobytes()
    client_serialization_ms = (perf_counter() - serialization_started) * 1000.0
    headers = {
        "Content-Type": "application/octet-stream",
        "Content-Length": str(len(payload)),
        "X-Expected-Pitches": ",".join(str(pitch) for pitch in fixture["expected_pitches"]),
        "X-Target-Second": str(fixture["target_second"]),
        "X-Synthetic-One-Way-Delay-Ms": str(synthetic_one_way_delay_ms),
    }
    request_started = perf_counter()
    if synthetic_one_way_delay_ms > 0:
        time.sleep(synthetic_one_way_delay_ms / 1000.0)
    connection = HTTPConnection(host, port, timeout=30)
    try:
        connection.request("POST", "/verify", body=payload, headers=headers)
        response = connection.getresponse()
        response_payload = response.read()
    finally:
        connection.close()
    request_to_decision_ms = (perf_counter() - request_started) * 1000.0
    if response.status != 200:
        raise RuntimeError(f"verifier returned {response.status}: {response_payload[:200]!r}")
    body = json.loads(response_payload.decode("utf-8"))
    backend_total = sum(float(value) for value in body["timings_ms"].values())
    transport_overhead_ms = request_to_decision_ms - backend_total - (2 * synthetic_one_way_delay_ms)
    return {
        "fixture_id": fixture["fixture_id"],
        "case_kind": fixture["case_kind"],
        "result": body["result"],
        "reference_result": reference["result"],
        "decision_agree": body["result"] == reference["result"],
        "client_serialization_ms": client_serialization_ms,
        "request_upload_bytes": len(payload),
        "response_bytes": len(response_payload),
        "request_to_decision_ms": request_to_decision_ms,
        "transport_overhead_ms": transport_overhead_ms,
        "backend_timings_ms": body["timings_ms"],
    }


def _per_fixture(samples: list[dict[str, object]]) -> dict[str, object]:
    by_fixture: dict[str, list[dict[str, object]]] = defaultdict(list)
    for sample in samples:
        by_fixture[str(sample["fixture_id"])].append(sample)
    return {
        fixture_id: {
            "sample_count": len(items),
            "decision_agreement": sum(1 for item in items if item["decision_agree"]),
            "request_to_decision_ms": _distribution([item["request_to_decision_ms"] for item in items]),
        }
        for fixture_id, items in sorted(by_fixture.items())
    }


def _distribution(values: list[float]) -> dict[str, object]:
    if not values:
        return {"median": None, "p95": None, "mean": None, "min": None, "max": None}
    ordered = sorted(float(value) for value in values)
    p95_index = min(len(ordered) - 1, int(np.ceil(len(ordered) * 0.95)) - 1)
    return {
        "min": round(float(ordered[0]), 6),
        "median": round(float(np.median(ordered)), 6),
        "p95": round(float(ordered[p95_index]), 6),
        "max": round(float(ordered[-1]), 6),
        "mean": round(float(np.mean(ordered)), 6),
    }


def _compact_summary(report: dict[str, object]) -> dict[str, object]:
    return {
        "scope": report["scope"],
        "delay_reports": {
            delay: {
                "decision_agreement": bucket["correctness"],
                "request_to_decision_ms": bucket["request_to_decision_ms"],
                "estimated_strike_to_decision_ms": bucket["estimated_strike_to_decision_ms"],
                "backend_model_inference_ms": bucket["backend_model_inference_ms"],
            }
            for delay, bucket in report["delay_reports"].items()
        },
    }


if __name__ == "__main__":
    raise SystemExit(main())
