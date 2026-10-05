"""Evaluate ByteDance Continuous trusted-output region on dev/cal targets."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
from statistics import median
from typing import Any

import numpy as np

from compare_step_microphone_frontends_causal_cases import _read_wav


SAMPLE_RATE = 16000
INPUT_SAMPLES = 29120
FRAME_RATE_HZ = 100
MIDI_OFFSET = 21
ONSET_THRESHOLD = 0.2
FRAME_THRESHOLD = 0.2
LOCAL_SEARCH_MS = 50
MIN_PRESENCE_RATE = 0.9
MAX_P95_ABS_TIMING_MS = 50
MIN_OWNED_WIDTH_MS = 220


def main() -> int:
    args = parse_args()
    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    targets = dataset["targets"]
    rows = _evaluate_targets(
        targets,
        onnx_path=args.dynamic_onnx,
        batch_size=args.batch_size,
        limit_per_category=args.limit_per_category,
    )
    summary = _summarize(rows)
    candidate = _select_candidate(summary)
    report = {
        "reportType": "continuous_trusted_region",
        "generatedAt": dt.datetime.now(dt.UTC).isoformat(),
        "command": "python backend/scripts/evaluate_bytedance_continuous_trusted_region.py "
        + " ".join([
            "--dataset", str(args.dataset),
            "--dynamic-onnx", str(args.dynamic_onnx),
            "--output", str(args.output),
            "--batch-size", str(args.batch_size),
        ]),
        "dynamicOnnx": {
            "path": str(args.dynamic_onnx),
            "sha256": _sha256(args.dynamic_onnx),
            "byteSize": args.dynamic_onnx.stat().st_size,
        },
        "dataset": {
            "path": str(args.dataset),
            "sha256": _sha256(args.dataset),
            "targetCount": len(targets),
            "categoryCounts": dataset["categoryCounts"],
            "positionGridMs": dataset["selectionPolicy"]["positionGridMs"],
        },
        "thresholds": {
            "onset": ONSET_THRESHOLD,
            "frame": FRAME_THRESHOLD,
            "localSearchMs": LOCAL_SEARCH_MS,
            "minPresenceRate": MIN_PRESENCE_RATE,
            "maxP95AbsTimingMs": MAX_P95_ABS_TIMING_MS,
            "minOwnedWidthMs": MIN_OWNED_WIDTH_MS,
            "thresholdsFrozenBeforeEvaluation": True,
        },
        "referenceSemantics": {
            "longContextReference": "NOT_EXECUTED",
            "reason": (
                "This run uses MIDI target time plus shifted-window raw evidence. "
                "A separate long-context model reference is still required before PASS."
            ),
        },
        "summary": summary,
        "candidate": candidate,
        "verdict": "PASS" if candidate["status"] == "PASS" else "FAIL",
        "sampleRows": rows[:200],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "verdict": report["verdict"],
        "candidate": candidate,
    }, indent=2))
    return 0 if report["verdict"] == "PASS" else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--dynamic-onnx", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--limit-per-category", type=int, default=20)
    return parser.parse_args()


def _evaluate_targets(
    targets: list[dict[str, Any]],
    *,
    onnx_path: Path,
    batch_size: int,
    limit_per_category: int,
) -> list[dict[str, Any]]:
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    limited_targets = _limit_targets(targets, limit_per_category=limit_per_category)
    audio_cache: dict[str, tuple[np.ndarray, int]] = {}
    pending: list[tuple[dict[str, Any], int, np.ndarray]] = []
    rows: list[dict[str, Any]] = []
    for target in limited_targets:
        audio_path = _resolve_research_path(str(target["audioPath"]))
        if audio_path not in audio_cache:
            audio_cache[audio_path] = _read_wav(Path(audio_path))
        audio, sample_rate = audio_cache[audio_path]
        if sample_rate != SAMPLE_RATE:
            raise ValueError(f"expected {SAMPLE_RATE} Hz audio: {audio_path}")
        for position_ms in target["positionGridMs"]:
            pending.append((target, int(position_ms), _window_for(audio, target["startSeconds"], int(position_ms))))
            if len(pending) >= batch_size:
                rows.extend(_run_batch(session, pending))
                pending.clear()
    if pending:
        rows.extend(_run_batch(session, pending))
    return rows


def _resolve_research_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    path = Path(normalized)
    if path.exists():
        return str(path)
    if normalized.startswith("backend/"):
        stripped = Path(normalized.removeprefix("backend/"))
        if stripped.exists():
            return str(stripped)
    return str(path)


def _limit_targets(targets: list[dict[str, Any]], *, limit_per_category: int) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    limited = []
    for target in targets:
        category = str(target["category"])
        if counts.get(category, 0) >= limit_per_category:
            continue
        counts[category] = counts.get(category, 0) + 1
        limited.append(target)
    return limited


def _window_for(audio: np.ndarray, target_seconds: float, position_ms: int) -> np.ndarray:
    start_sample = int(round(target_seconds * SAMPLE_RATE)) - int(round(position_ms / 1000 * SAMPLE_RATE))
    output = np.zeros(INPUT_SAMPLES, dtype=np.float32)
    source_start = max(0, start_sample)
    source_end = min(audio.shape[0], start_sample + INPUT_SAMPLES)
    dest_start = max(0, -start_sample)
    if source_end > source_start:
        output[dest_start:dest_start + (source_end - source_start)] = audio[source_start:source_end].astype(np.float32, copy=False)
    return output


def _run_batch(session: Any, pending: list[tuple[dict[str, Any], int, np.ndarray]]) -> list[dict[str, Any]]:
    batch = np.stack([item[2] for item in pending], axis=0).astype(np.float32, copy=False)
    onset, frame = session.run(["reg_onset_output", "frame_output"], {"audio": batch})
    rows = []
    for index, (target, position_ms, _window) in enumerate(pending):
        pitch_index = int(target["midiNote"]) - MIDI_OFFSET
        center_frame = int(round(position_ms / 1000 * FRAME_RATE_HZ))
        radius = int(round(LOCAL_SEARCH_MS / 1000 * FRAME_RATE_HZ))
        left = max(0, center_frame - radius)
        right = min(onset.shape[1], center_frame + radius + 1)
        onset_slice = onset[index, left:right, pitch_index]
        frame_slice = frame[index, left:right, pitch_index]
        best_relative = int(np.argmax(onset_slice))
        best_frame = left + best_relative
        onset_score = float(onset[index, best_frame, pitch_index])
        frame_score = float(frame[index, best_frame, pitch_index])
        estimated_position_ms = best_frame * 1000 / FRAME_RATE_HZ
        rows.append({
            "targetId": target["targetId"],
            "category": target["category"],
            "positionMs": position_ms,
            "pitch": target["pitch"],
            "onsetScore": onset_score,
            "frameScore": frame_score,
            "present": onset_score >= ONSET_THRESHOLD and frame_score >= FRAME_THRESHOLD,
            "estimatedPositionMs": estimated_position_ms,
            "timingDeltaMs": estimated_position_ms - position_ms,
            "absTimingDeltaMs": abs(estimated_position_ms - position_ms),
        })
    return rows


def _summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_position_category: dict[tuple[int, str], list[dict[str, Any]]] = {}
    for row in rows:
        by_position_category.setdefault((int(row["positionMs"]), str(row["category"])), []).append(row)
    position_summary: dict[str, Any] = {}
    for (position_ms, category), items in sorted(by_position_category.items()):
        present = [item for item in items if item["present"]]
        timing = [float(item["absTimingDeltaMs"]) for item in present]
        position_summary.setdefault(str(position_ms), {})[category] = {
            "targetCount": len(items),
            "presentCount": len(present),
            "presenceRate": round(len(present) / len(items), 6) if items else None,
            "medianAbsTimingMs": round(median(timing), 6) if timing else None,
            "p95AbsTimingMs": _p95(timing),
            "passes": (
                bool(items)
                and len(present) / len(items) >= MIN_PRESENCE_RATE
                and timing
                and _p95(timing) <= MAX_P95_ABS_TIMING_MS
            ),
        }
    all_categories = sorted({str(row["category"]) for row in rows})
    for position, category_map in position_summary.items():
        category_map["_allCategoriesPass"] = all(
            category_map.get(category, {}).get("passes") is True
            for category in all_categories
        )
    return {
        "categoryNames": all_categories,
        "positions": position_summary,
    }


def _select_candidate(summary: dict[str, Any]) -> dict[str, Any]:
    passing_positions = [
        int(position)
        for position, item in summary["positions"].items()
        if item.get("_allCategoriesPass") is True
    ]
    if not passing_positions:
        return {
            "status": "FAIL",
            "reason": "No grid position passed every required category.",
            "passingPositionsMs": [],
        }
    passing_positions.sort()
    runs: list[list[int]] = []
    current = [passing_positions[0]]
    for position in passing_positions[1:]:
        if position - current[-1] <= 180:
            current.append(position)
        else:
            runs.append(current)
            current = [position]
    runs.append(current)
    best = max(runs, key=lambda run: run[-1] - run[0])
    start_ms = best[0]
    end_ms = best[-1]
    width_ms = end_ms - start_ms
    if width_ms < MIN_OWNED_WIDTH_MS:
        return {
            "status": "FAIL",
            "reason": "Passing contiguous region is narrower than required owned width.",
            "passingPositionsMs": passing_positions,
            "bestRunMs": best,
            "ownedWidthMs": width_ms,
        }
    return {
        "status": "PASS",
        "passingPositionsMs": passing_positions,
        "bestRunMs": best,
        "trustedStartMs": start_ms,
        "trustedEndMs": end_ms,
        "ownedWidthMs": width_ms,
        "trustedStartSample": int(round(start_ms / 1000 * SAMPLE_RATE)),
        "trustedEndSample": int(round(end_ms / 1000 * SAMPLE_RATE)),
    }


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(np.ceil(len(ordered) * 0.95)) - 1)
    return round(float(ordered[index]), 6)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
