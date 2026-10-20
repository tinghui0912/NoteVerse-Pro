from __future__ import annotations

import argparse
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pretty_midi

from backend.research.xc1_scientific_bakeoff import (
    OnsetEvent,
    decide_front_runner,
    paired_bootstrap,
    score_take,
    sha256_file,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
CANDIDATES = [
    "robust-browser-v1",
    "online-amt-k8-browser-v1",
    "basic-pitch-browser-v1",
]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def verify_seal(seal: dict[str, Any]) -> None:
    if not seal.get("complete"):
        raise SystemExit("XC1_STAGE_B_SEAL_INCOMPLETE")
    for row in seal["cells"]:
        path = REPO_ROOT / row["artifactPath"]
        if sha256_file(path) != row["artifactSha256"]:
            raise SystemExit("XC1_INVALID_EVALUATION_PREDICTION_CHANGED_AFTER_TRUTH_REVEAL")
        artifact = read_json(path)
        if artifact.get("stage") != "XC1_STAGE_A_SCIENTIFIC_PREDICTION":
            raise SystemExit("XC1_STAGE_B_REJECTED_NON_SCIENTIFIC_ARTIFACT")


def read_truth_from_smd_zip(zf: zipfile.ZipFile, midi_relative_path: str, take_id: str, start_ms: float, end_ms: float) -> list[OnsetEvent]:
    with zf.open(midi_relative_path) as handle:
        midi_bytes = handle.read()
    midi = pretty_midi.PrettyMIDI(io.BytesIO(midi_bytes))
    events = []
    ordinal = 0
    for instrument in midi.instruments:
        for note in instrument.notes:
            if note.velocity <= 0:
                continue
            time_ms = note.start * 1000.0
            if start_ms <= time_ms < end_ms:
                events.append(OnsetEvent(
                    event_id=f"truth:{take_id}:{note.pitch}:{round(time_ms * 1000)}:{ordinal}",
                    pitch=int(note.pitch),
                    time_ms=time_ms,
                    confidence=1.0,
                ))
                ordinal += 1
    events.sort(key=lambda event: (event.time_ms, event.pitch, event.event_id))
    return events


def predictions_from_artifact(artifact: dict[str, Any], start_ms: float, end_ms: float) -> list[OnsetEvent]:
    events = []
    for index, observation in enumerate(artifact.get("acousticObservations", [])):
        time_ms = float(observation["performanceTimeMs"])
        if start_ms <= time_ms < end_ms:
            events.append(OnsetEvent(
                event_id=observation.get("candidateObservationId", f"{artifact['deploymentId']}:{artifact['takeId']}:{index}"),
                pitch=int(observation["pitch"]),
                time_ms=time_ms,
                confidence=float(observation.get("confidence", 1.0)),
            ))
    events.sort(key=lambda event: (event.time_ms, event.pitch, event.event_id))
    return events


def aggregate(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_candidate: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_candidate.setdefault(row["candidateId"], []).append(row)
    result = {}
    for candidate, items in by_candidate.items():
        result[candidate] = {
            "takeCount": len(items),
            "completeCoverage": len(items) == 50,
            "precisionMean": sum(item["precision"] for item in items) / len(items) if items else 0,
            "recallMean": sum(item["recall"] for item in items) / len(items) if items else 0,
            "f1Mean": sum(item["f1"] for item in items) / len(items) if items else 0,
            "falsePositiveOnsetsPerMinuteMean": sum(item["falsePositiveOnsetsPerMinute"] for item in items) / len(items) if items else 0,
            "missedOnsetRateMean": sum(item["missedOnsetRate"] for item in items) / len(items) if items else 0,
        }
    return result


def main() -> None:
    raise SystemExit('XC1_F4_PERMANENTLY_INVALIDATED_USE_R3D_STAGE_B')
    parser = argparse.ArgumentParser()
    parser.add_argument("--seal", required=True)
    parser.add_argument("--f3-manifest", required=True)
    parser.add_argument("--smd-archive", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    seal_path = Path(args.seal).resolve()
    f3_manifest_path = Path(args.f3_manifest).resolve()
    smd_archive_path = Path(args.smd_archive).resolve()
    seal = read_json(seal_path)
    verify_seal(seal)
    truth_reveal_timestamp = datetime.now(timezone.utc).isoformat()
    f3 = read_json(f3_manifest_path)
    takes = {take["takeId"]: take for take in f3["takes"]}
    cells = {(row["candidateId"], row["takeId"]): row for row in seal["cells"]}

    truth_by_take = {}
    with zipfile.ZipFile(smd_archive_path) as zf:
      for take_id, take in takes.items():
          interval = take["scoreableInterior"]
          truth_by_take[take_id] = read_truth_from_smd_zip(
              zf,
              take["midiRelativePath"],
              take_id,
              interval["startMs"],
              interval["endMs"],
          )

    all_metric_rows = []
    for tolerance in [50.0, 25.0, 100.0]:
        for candidate in CANDIDATES:
            for take_id, take in takes.items():
                row = cells.get((candidate, take_id))
                if not row or row["status"] != "XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE":
                    continue
                artifact_path = REPO_ROOT / row["artifactPath"]
                artifact = read_json(artifact_path)
                if sha256_file(artifact_path) != row["artifactSha256"]:
                    raise SystemExit("XC1_INVALID_EVALUATION_PREDICTION_CHANGED_AFTER_TRUTH_REVEAL")
                interval = take["scoreableInterior"]
                predictions = predictions_from_artifact(artifact, interval["startMs"], interval["endMs"])
                duration_seconds = (interval["endMs"] - interval["startMs"]) / 1000.0
                score = score_take(truth_by_take[take_id], predictions, duration_seconds, tolerance)
                all_metric_rows.append({
                    "candidateId": candidate,
                    "takeId": take_id,
                    "toleranceMs": tolerance,
                    **{key: value for key, value in score.items() if key != "matching"},
                    "matchCount": len(score["matching"]["matches"]),
                    "truthCount": len(truth_by_take[take_id]),
                    "predictionCount": len(predictions),
                })

    primary = [row for row in all_metric_rows if row["toleranceMs"] == 50.0]
    pairwise = {}
    for left, right in [
        ("robust-browser-v1", "online-amt-k8-browser-v1"),
        ("robust-browser-v1", "basic-pitch-browser-v1"),
        ("online-amt-k8-browser-v1", "basic-pitch-browser-v1"),
    ]:
        for metric in ["f1", "falsePositiveOnsetsPerMinute", "missedOnsetRate"]:
            pairwise[f"{left}__{right}__{metric}"] = paired_bootstrap(primary, left, right, metric, draws=5000, seed=13371)
            pairwise[f"{right}__{left}__{metric}"] = paired_bootstrap(primary, right, left, metric, draws=5000, seed=13371)

    aggregate_primary = aggregate(primary)
    raise RuntimeError('XC1_MEASURED_F5_RUNTIME_REPORT_REQUIRED')
    report = {
        "phase": "PHASE_9G_XC1_R3C_SCIENTIFIC_SEMANTICS_F4_FULL_SEALED_BAKEOFF",
        "artifact": "xc1_r3c_stage_b_scoring_report",
        "sealManifest": str(seal_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "sealSha256": seal.get("sealSha256"),
        "truthRevealTimestamp": truth_reveal_timestamp,
        "truthReader": {
            "source": "SMD synchronized MIDI from sealed archive",
            "noteOnVelocityPositiveOnly": True,
            "pedalControllersExcluded": True,
            "additionalAlignmentMs": 0,
        },
        "primary50ms": primary,
        "sensitivity25ms": [row for row in all_metric_rows if row["toleranceMs"] == 25.0],
        "sensitivity100ms": [row for row in all_metric_rows if row["toleranceMs"] == 100.0],
        "aggregatePrimary50ms": aggregate_primary,
        "pairedBootstrap": pairwise,
        "candidateMetricsForDecision": candidate_metrics,
        "scientificFrontRunnerDecision": decision,
        "commercialQualificationStatus": "NOT_PERFORMED",
    }
    write_json(Path(args.output).resolve(), report)
    print(json.dumps({"output": args.output, "decision": decision}, indent=2))


if __name__ == "__main__":
    main()
