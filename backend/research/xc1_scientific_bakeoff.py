from __future__ import annotations

import hashlib
import json
import math
import os
import random
import shutil
import statistics
import urllib.request
import wave
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


SMD_RESOLVER_DOI = "10.5281/zenodo.10847280"
SMD_RESOLVED_VERSION_DOI = "10.5281/zenodo.13753319"
SMD_ARCHIVE_NAME = "SMD-piano_v2.zip"
SMD_ARCHIVE_BYTES = 3_221_582_754
SMD_ARCHIVE_MD5 = "984cfc48f1fa2785594769eb1e674697"
SMD_ARCHIVE_URL = "https://zenodo.org/api/records/13753319/files/SMD-piano_v2.zip/content"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def md5_file(path: Path) -> str:
    digest = hashlib.md5()  # noqa: S324 - used only to verify upstream archive checksum.
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def acquire_smd_archive(target: Path, *, timeout_seconds: int = 120) -> dict[str, Any]:
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with urllib.request.urlopen(SMD_ARCHIVE_URL, timeout=timeout_seconds) as response, target.open("wb") as output:
            shutil.copyfileobj(response, output)
    size = target.stat().st_size
    md5 = md5_file(target)
    sha256 = sha256_file(target)
    status = "PASS" if size == SMD_ARCHIVE_BYTES and md5 == SMD_ARCHIVE_MD5 else "FAIL"
    return {
        "path": str(target),
        "expectedBytes": SMD_ARCHIVE_BYTES,
        "actualBytes": size,
        "expectedMd5": SMD_ARCHIVE_MD5,
        "actualMd5": md5,
        "sha256": sha256,
        "status": status,
    }


def inventory_archive(archive: Path) -> dict[str, Any]:
    categories: dict[str, int] = {}
    files: list[dict[str, Any]] = []
    with zipfile.ZipFile(archive) as zf:
        for info in sorted(zf.infolist(), key=lambda item: item.filename):
            if info.is_dir():
                continue
            suffix = Path(info.filename).suffix.lower().lstrip(".") or "no_extension"
            category = info.filename.split("/")[0] if "/" in info.filename else "."
            categories[category] = categories.get(category, 0) + 1
            files.append({
                "relativePath": info.filename,
                "bytes": info.file_size,
                "fileType": suffix,
                "publisherDirectoryCategory": category,
            })
    return {"fileCount": len(files), "categories": categories, "files": files}


def is_real_acoustic_wav(path: str) -> bool:
    lowered = path.lower()
    return lowered.endswith(".wav") and "midi_wav" not in lowered and "midi-wav" not in lowered and "midiwav" not in lowered


def pair_smd_audio_midi(files: Iterable[dict[str, Any]]) -> dict[str, Any]:
    wavs = [item for item in files if is_real_acoustic_wav(item["relativePath"])]
    midis = [item for item in files if Path(item["relativePath"].lower()).suffix in {".mid", ".midi"}]
    midi_by_stem = {Path(item["relativePath"]).stem.lower(): item for item in midis}
    pairs = []
    excluded = []
    for wav in wavs:
        stem = Path(wav["relativePath"]).stem.lower()
        midi = midi_by_stem.get(stem)
        if midi is None:
            excluded.append({"relativePath": wav["relativePath"], "reason": "MISSING_SYNCHRONIZED_MIDI_STEM_MATCH"})
            continue
        pairs.append({
            "takeId": stem,
            "acousticWav": wav,
            "midi": midi,
            "pieceId": infer_piece_id(stem),
            "performerId": infer_performer_id(stem),
        })
    return {
        "pairCount": len(pairs),
        "pairs": pairs,
        "excluded": excluded,
        "midiOnlyCount": max(0, len(midis) - len(pairs)),
    }


def infer_piece_id(stem: str) -> str:
    parts = stem.replace("-", "_").split("_")
    return "_".join(parts[:-1]) if len(parts) > 1 else stem


def infer_performer_id(stem: str) -> str | None:
    for token in stem.replace("-", "_").split("_"):
        if token.lower().startswith("p") and token[1:].isdigit():
            return token.lower()
    return None


def decode_pcm16_wav_mono_float32(path: Path) -> tuple[list[float], int, int]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        width = wav.getsampwidth()
        if width != 2:
            raise ValueError(f"XC1_UNSUPPORTED_WAV_SAMPLE_WIDTH:{width}")
        raw = wav.readframes(wav.getnframes())
    values = [int.from_bytes(raw[i:i + 2], "little", signed=True) / 32768.0 for i in range(0, len(raw), 2)]
    if channels == 1:
        return values, sample_rate, channels
    mono = []
    for index in range(0, len(values), channels):
        mono.append(sum(values[index:index + channels]) / channels)
    return mono, sample_rate, channels


def linear_resample(source: list[float], source_rate: int, target_rate: int = 16_000) -> list[float]:
    if source_rate <= 0 or target_rate <= 0:
        raise ValueError("XC1_INVALID_SAMPLE_RATE")
    if source_rate == target_rate:
        return list(source)
    output_samples = math.floor(len(source) * target_rate / source_rate)
    if output_samples <= 0:
        return []
    scale = source_rate / target_rate
    out: list[float] = []
    for index in range(output_samples):
        pos = index * scale
        left = int(math.floor(pos))
        right = min(left + 1, len(source) - 1)
        frac = pos - left
        out.append(source[left] * (1 - frac) + source[right] * frac)
    return out


def common_scoreable_interval_ms(duration_ms: float) -> dict[str, float]:
    start = 1000.0
    end = max(start, duration_ms - 220.0)
    return {"startMs": start, "endMs": end, "pastContextMs": 1000, "futureContextMs": 220}


@dataclass(frozen=True)
class OnsetEvent:
    event_id: str
    pitch: int
    time_ms: float
    confidence: float = 1.0


def match_pitch_onsets(
    truth: list[OnsetEvent],
    predictions: list[OnsetEvent],
    tolerance_ms: float,
) -> dict[str, Any]:
    truth_by_pitch: dict[int, list[OnsetEvent]] = {}
    pred_by_pitch: dict[int, list[OnsetEvent]] = {}
    for event in truth:
        truth_by_pitch.setdefault(event.pitch, []).append(event)
    for event in predictions:
        pred_by_pitch.setdefault(event.pitch, []).append(event)

    matches = []
    unmatched_truth = set(event.event_id for event in truth)
    unmatched_pred = set(event.event_id for event in predictions)
    for pitch in sorted(set(truth_by_pitch) | set(pred_by_pitch)):
        pitch_truth = sorted(truth_by_pitch.get(pitch, []), key=lambda event: (event.time_ms, event.event_id))
        pitch_pred = sorted(pred_by_pitch.get(pitch, []), key=lambda event: (event.time_ms, event.event_id))
        pitch_matches = _match_sorted_events(pitch_truth, pitch_pred, tolerance_ms)
        for truth_event, pred_event, error in pitch_matches:
            matches.append({"truthId": truth_event.event_id, "predictionId": pred_event.event_id, "pitch": pitch, "absErrorMs": error})
            unmatched_truth.discard(truth_event.event_id)
            unmatched_pred.discard(pred_event.event_id)
    matches.sort(key=lambda item: (item["pitch"], item["truthId"], item["predictionId"]))
    return {"matches": matches, "unmatchedTruthIds": sorted(unmatched_truth), "unmatchedPredictionIds": sorted(unmatched_pred)}


def _match_sorted_events(truth: list[OnsetEvent], pred: list[OnsetEvent], tolerance_ms: float) -> list[tuple[OnsetEvent, OnsetEvent, float]]:
    n = len(truth)
    m = len(pred)
    dp: list[list[tuple[int, float, tuple[str, ...], list[tuple[int, int]]]]] = [
        [(0, 0.0, tuple(), []) for _ in range(m + 1)]
        for _ in range(n + 1)
    ]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            choices = [dp[i + 1][j], dp[i][j + 1]]
            error = abs(truth[i].time_ms - pred[j].time_ms)
            if error <= tolerance_ms:
                count, cost, tie, pairs = dp[i + 1][j + 1]
                choices.append((count + 1, cost + error, tie + (truth[i].event_id, pred[j].event_id), [(i, j), *pairs]))
            dp[i][j] = max(choices, key=lambda state: (state[0], -state[1], tuple(reversed(state[2]))))
    return [(truth[i], pred[j], abs(truth[i].time_ms - pred[j].time_ms)) for i, j in dp[0][0][3]]


def score_take(truth: list[OnsetEvent], predictions: list[OnsetEvent], duration_seconds: float, tolerance_ms: float = 50.0) -> dict[str, Any]:
    matching = match_pitch_onsets(truth, predictions, tolerance_ms)
    match_count = len(matching["matches"])
    precision = match_count / len(predictions) if predictions else (1.0 if not truth else 0.0)
    recall = match_count / len(truth) if truth else (1.0 if not predictions else 0.0)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    errors = sorted(item["absErrorMs"] for item in matching["matches"])
    fp_per_min = len(matching["unmatchedPredictionIds"]) / (duration_seconds / 60.0) if duration_seconds > 0 else 0.0
    missed_rate = len(matching["unmatchedTruthIds"]) / len(truth) if truth else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "falsePositiveOnsetsPerMinute": fp_per_min,
        "missedOnsetRate": missed_rate,
        "onsetAbsTimingMedianMs": percentile(errors, 50),
        "onsetAbsTimingP95Ms": percentile(errors, 95),
        "duplicateRetriggerFalseDetections": count_duplicate_predictions(predictions, matching["unmatchedPredictionIds"]),
        "chordNoteCompletenessDiagnostic": "NOT_AVAILABLE_WITHOUT_GROUP_METADATA",
        "matching": matching,
    }


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    pos = (len(values) - 1) * pct / 100.0
    low = math.floor(pos)
    high = math.ceil(pos)
    if low == high:
        return values[low]
    return values[low] * (high - pos) + values[high] * (pos - low)


def count_duplicate_predictions(predictions: list[OnsetEvent], unmatched_ids: list[str], window_ms: float = 50.0) -> int:
    by_id = {event.event_id: event for event in predictions}
    accepted = [event for event in predictions if event.event_id not in set(unmatched_ids)]
    duplicates = 0
    for event_id in unmatched_ids:
        event = by_id[event_id]
        if any(other.pitch == event.pitch and abs(other.time_ms - event.time_ms) <= window_ms for other in accepted):
            duplicates += 1
    return duplicates


def paired_bootstrap(
    rows: list[dict[str, Any]],
    candidate_a: str,
    candidate_b: str,
    metric: str,
    *,
    draws: int = 5000,
    seed: int = 13371,
) -> dict[str, Any]:
    take_ids = sorted({row["takeId"] for row in rows})
    by_take_candidate = {(row["takeId"], row["candidateId"]): row[metric] for row in rows}
    diffs = []
    rng = random.Random(seed)
    for _ in range(draws):
        sample = [rng.choice(take_ids) for _ in take_ids]
        values = [by_take_candidate[(take, candidate_a)] - by_take_candidate[(take, candidate_b)] for take in sample]
        diffs.append(sum(values) / len(values) if values else 0.0)
    diffs.sort()
    return {
        "candidateA": candidate_a,
        "candidateB": candidate_b,
        "metric": metric,
        "draws": draws,
        "seed": seed,
        "meanDiff": statistics.mean(diffs) if diffs else 0.0,
        "ci95": [percentile(diffs, 2.5), percentile(diffs, 97.5)],
        "outputDigest": canonical_json_sha256([round(value, 12) for value in diffs[:100]]),
    }


def runtime_eligibility(candidate_id: str, processing_p95_ms: float, sustained_backlog: bool) -> dict[str, Any]:
    threshold = 204.8 if candidate_id == "online-amt-k8-browser-v1" else 480.0
    return {
        "candidateId": candidate_id,
        "processingP95Ms": processing_p95_ms,
        "headroomThresholdMs": threshold,
        "headroomPass": processing_p95_ms <= threshold,
        "noSustainedBacklog": not sustained_backlog,
        "runtimeEligible": processing_p95_ms <= threshold and not sustained_backlog,
    }


def decide_front_runner(candidate_metrics: dict[str, dict[str, Any]], pairwise: dict[str, dict[str, Any]]) -> str:
    candidates = sorted(candidate_metrics)
    for candidate in candidates:
        if not candidate_metrics[candidate].get("runtimeEligible") or not candidate_metrics[candidate].get("completeCoverage"):
            continue
        superior = True
        safe = True
        for other in candidates:
            if other == candidate:
                continue
            f1 = pairwise[f"{candidate}__{other}__f1"]["ci95"]
            fp = pairwise[f"{candidate}__{other}__falsePositiveOnsetsPerMinute"]["ci95"]
            missed = pairwise[f"{candidate}__{other}__missedOnsetRate"]["ci95"]
            superior = superior and f1[0] is not None and f1[0] > 0
            safe = safe and not (fp[0] is not None and fp[0] > 0) and not (missed[0] is not None and missed[0] > 0)
        if superior and safe:
            labels = {
                "robust-browser-v1": "SCIENTIFIC_ACOUSTIC_FRONT_RUNNER_ROBUST_BROWSER",
                "online-amt-k8-browser-v1": "SCIENTIFIC_ACOUSTIC_FRONT_RUNNER_ONLINE_AMT_K8",
                "basic-pitch-browser-v1": "SCIENTIFIC_ACOUSTIC_FRONT_RUNNER_BASIC_PITCH",
            }
            return labels[candidate]
    return "NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER"


def create_stage_a_audio_only_root(root: Path, canonical_pcm_files: Iterable[Path], manifest: dict[str, Any]) -> dict[str, Any]:
    if root.exists():
        shutil.rmtree(root)
    (root / "audio").mkdir(parents=True)
    for pcm in canonical_pcm_files:
        shutil.copy2(pcm, root / "audio" / pcm.name)
    (root / "audio_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return {"root": str(root), "containsMidi": any(path.suffix.lower() in {".mid", ".midi"} for path in root.rglob("*"))}


def assert_stage_a_cannot_access_midi(root: Path, midi_relative_path: str) -> bool:
    target = root / midi_relative_path
    if target.exists():
        raise AssertionError("XC1_STAGE_A_TRUTH_BOUNDARY_VIOLATION")
    return True


def select_edge_subset(takes: list[dict[str, Any]], count: int = 6) -> list[str]:
    ordered = sorted(takes, key=lambda take: (take.get("performerId") or "", take.get("pieceId") or "", take["takeId"]))
    if len(ordered) <= count:
        return [take["takeId"] for take in ordered]
    step = max(1, len(ordered) // count)
    selected = []
    index = 0
    while len(selected) < count and index < len(ordered):
        selected.append(ordered[index]["takeId"])
        index += step
    return sorted(set(selected))[:count]
