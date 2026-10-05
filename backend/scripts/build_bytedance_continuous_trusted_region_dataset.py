"""Build a dev/cal Continuous trusted-region dataset from existing MAESTRO cases.

The selectors are based only on MIDI ground truth and fixed before model
evaluation. This script does not inspect ByteDance outputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from statistics import quantiles
from typing import Any


POSITION_GRID_MS = (120, 240, 360, 480, 600, 760, 920, 1080, 1240, 1400, 1560, 1700)
MIN_PER_CATEGORY = 20
MAX_PER_CATEGORY = 32


def main() -> int:
    args = parse_args()
    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]
    events = _event_rows(cases)
    velocities = sorted(row["velocity"] for row in events)
    quartiles = quantiles(velocities, n=4) if len(velocities) >= 4 else [40, 64, 90]
    soft_max = quartiles[0]
    loud_min = quartiles[2]

    selectors = {
        "single_note": lambda row: row["simultaneous_count"] == 1,
        "chord": lambda row: row["simultaneous_count"] >= 2,
        "same_note_retrigger": lambda row: row["same_pitch_prev_gap_ms"] is not None and row["same_pitch_prev_gap_ms"] <= 300,
        "dense_repeated_pitch": lambda row: row["same_pitch_prev_gap_ms"] is not None and row["same_pitch_prev_gap_ms"] <= 220,
        "fast_scale_adjacent_pitches": lambda row: row["prev_gap_ms"] is not None and row["prev_gap_ms"] <= 180 and row["prev_abs_semitones"] in {1, 2},
        "partial_overlapping_notes": lambda row: row["overlaps_previous"],
        "soft_attack": lambda row: row["velocity"] <= soft_max,
        "loud_attack": lambda row: row["velocity"] >= loud_min,
    }

    targets: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    for category, predicate in selectors.items():
        selected = _balanced_take([row for row in events if predicate(row)], limit=MAX_PER_CATEGORY)
        counts[category] = len(selected)
        for index, row in enumerate(selected):
            targets.append({
                "targetId": f"{category}_{index + 1:03d}",
                "category": category,
                **{key: row[key] for key in (
                    "caseId",
                    "caseKind",
                    "manifestPath",
                    "audioPath",
                    "sourceFile",
                    "sourceMidi",
                    "sourceAudioSha256",
                    "sourceMidiSha256",
                    "pitch",
                    "midiNote",
                    "startSeconds",
                    "endSeconds",
                    "velocity",
                    "simultaneousCount",
                )},
                "positionGridMs": list(POSITION_GRID_MS),
            })

    report = {
        "reportType": "continuous_trusted_region_dataset",
        "selectionPolicy": {
            "positionGridMs": list(POSITION_GRID_MS),
            "minPerCategoryRequested": MIN_PER_CATEGORY,
            "maxPerCategory": MAX_PER_CATEGORY,
            "simultaneousWindowMs": 30,
            "samePitchRetriggerMaxMs": 300,
            "denseRepeatedPitchMaxMs": 220,
            "fastScaleAdjacentMaxMs": 180,
            "softVelocityMax": soft_max,
            "loudVelocityMin": loud_min,
            "modelOutputsInspected": False,
        },
        "caseManifests": [
            {
                "path": str(path),
                "sha256": _sha256(path),
            }
            for path in args.case_manifest
        ],
        "categoryCounts": counts,
        "categoryReadiness": {
            category: ("PASS" if count >= MIN_PER_CATEGORY else "INSUFFICIENT")
            for category, count in counts.items()
        },
        "targetCount": len(targets),
        "targets": targets,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "targetCount": len(targets),
        "categoryCounts": counts,
        "categoryReadiness": report["categoryReadiness"],
    }, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def _event_rows(cases: list[tuple[Path, dict[str, Any]]]) -> list[dict[str, Any]]:
    rows = []
    for manifest_path, case in cases:
        notes = sorted(case.get("ground_truth_note_events", ()), key=lambda item: (float(item["start_seconds"]), int(item["midi_note"])))
        for index, note in enumerate(notes):
            start = float(note["start_seconds"])
            midi_note = int(note["midi_note"])
            simultaneous = [
                other for other in notes
                if abs(float(other["start_seconds"]) - start) <= 0.03
            ]
            previous = notes[index - 1] if index > 0 else None
            prev_gap_ms = None if previous is None else (start - float(previous["start_seconds"])) * 1000
            prev_abs_semitones = None if previous is None else abs(midi_note - int(previous["midi_note"]))
            same_pitch_previous = next(
                (other for other in reversed(notes[:index]) if int(other["midi_note"]) == midi_note),
                None,
            )
            same_pitch_prev_gap_ms = None if same_pitch_previous is None else (
                start - float(same_pitch_previous["start_seconds"])
            ) * 1000
            overlaps_previous = previous is not None and float(previous["end_seconds"]) > start
            rows.append({
                "caseId": str(case["case_id"]),
                "caseKind": str(case["case_kind"]),
                "manifestPath": str(manifest_path),
                "audioPath": str(manifest_path.parent / str(case["audio_path"])),
                "sourceFile": str(case["source_file"]),
                "sourceMidi": str(case["source_midi"]),
                "sourceAudioSha256": str(case["source_audio_sha256"]),
                "sourceMidiSha256": str(case["source_midi_sha256"]),
                "pitch": str(note["pitch"]),
                "midiNote": midi_note,
                "startSeconds": start,
                "endSeconds": float(note["end_seconds"]),
                "velocity": int(note["velocity"]),
                "simultaneousCount": len(simultaneous),
                "prevGapMs": prev_gap_ms,
                "prevAbsSemitones": prev_abs_semitones,
                "samePitchPrevGapMs": same_pitch_prev_gap_ms,
                "overlapsPrevious": overlaps_previous,
                "prev_gap_ms": prev_gap_ms,
                "prev_abs_semitones": prev_abs_semitones,
                "same_pitch_prev_gap_ms": same_pitch_prev_gap_ms,
                "overlaps_previous": overlaps_previous,
                "simultaneous_count": len(simultaneous),
            })
    return rows


def _balanced_take(rows: list[dict[str, Any]], *, limit: int) -> list[dict[str, Any]]:
    by_source: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_source.setdefault(str(row["sourceFile"]), []).append(row)
    selected = []
    while len(selected) < limit:
        progressed = False
        for source in sorted(by_source):
            bucket = by_source[source]
            if not bucket:
                continue
            selected.append(bucket.pop(0))
            progressed = True
            if len(selected) >= limit:
                break
        if not progressed:
            break
    return selected


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
