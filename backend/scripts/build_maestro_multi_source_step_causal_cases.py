"""Build a multi-source MAESTRO manifest for STEP microphone causal cases.

This orchestrates the existing public paired case extractor across several
independent MAESTRO performances. Selection still uses only MIDI truth and
source timing metadata; recognizers consume only exported WAV clips.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import asdict
import json
from pathlib import Path
import shutil
import zipfile

from download_maestro_pair import HttpRangeReader, ZIP_PREFIX, extract_member
from extract_public_paired_step_causal_cases import (
    CASE_ORDER,
    export_cases,
    parse_midi_note_ons,
    parse_midi_note_spans_and_pedal,
    read_pcm_wav,
    select_case_plans,
    group_note_ons,
)
from evaluate_public_paired_midi_dataset import DEFAULT_CHORD_WINDOW_SECONDS, _file_sha256


DEFAULT_DATASET_DIR = Path("data/work/datasets/maestro-v3.0.0")
DEFAULT_OUTPUT_DIR = DEFAULT_DATASET_DIR / "production_step_causal_cases_multi_source"
DEFAULT_METADATA_URL = (
    "https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/"
    "maestro-v3.0.0.csv"
)
DEFAULT_ZIP_URL = (
    "https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/"
    "maestro-v3.0.0.zip"
)


def main() -> int:
    args = parse_args()
    metadata_path = args.dataset_dir / "maestro-v3.0.0.csv"
    if not metadata_path.exists():
        raise RuntimeError(f"MAESTRO metadata CSV not found: {metadata_path}")

    rows = _select_rows(
        metadata_path,
        split=args.split,
        source_count=args.source_count,
    )
    source_manifests = []
    combined_cases = []
    clips_dir = args.output_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    for source_index, row in enumerate(rows, start=1):
        audio_path, midi_path = _ensure_pair(
            row,
            dataset_dir=args.dataset_dir,
            zip_url=args.zip_url,
            force=args.force_download,
        )
        source_output_dir = args.output_dir / "sources" / f"s{source_index:02d}"
        cases = _extract_source_cases(
            audio_path,
            midi_path,
            output_dir=source_output_dir,
            dataset_id="MAESTRO v3.0.0",
            max_cases_per_kind=args.max_cases_per_kind,
            pre_context_seconds=args.pre_context_seconds,
            post_context_seconds=args.post_context_seconds,
            sample_rate=args.sample_rate,
        )
        rewritten_cases = []
        for case in cases:
            case_dict = asdict(case)
            old_case_id = str(case_dict["case_id"])
            new_case_id = f"s{source_index:02d}_{old_case_id}"
            source_clip = source_output_dir / str(case_dict["audio_path"])
            target_clip = clips_dir / f"{new_case_id}.wav"
            shutil.copy2(source_clip, target_clip)
            case_dict["case_id"] = new_case_id
            case_dict["audio_path"] = str(Path("clips") / target_clip.name)
            rewritten_cases.append(case_dict)
        combined_cases.extend(rewritten_cases)
        source_manifests.append(
            {
                "source_index": source_index,
                "split": row["split"],
                "year": row["year"],
                "canonical_composer": row["canonical_composer"],
                "canonical_title": row["canonical_title"],
                "duration": float(row["duration"]),
                "audio_filename": row["audio_filename"],
                "midi_filename": row["midi_filename"],
                "source_audio_sha256": _file_sha256(audio_path),
                "source_midi_sha256": _file_sha256(midi_path),
                "selected_case_counts": {
                    kind: sum(1 for case in rewritten_cases if case["case_kind"] == kind)
                    for kind in CASE_ORDER
                },
                "case_count": len(rewritten_cases),
            }
        )

    manifest = {
        "benchmark_scope": "public_paired_midi_step_causal_case_selection",
        "dataset": {
            "source_kind": "public_paired_audio_midi",
            "source_dataset": "MAESTRO v3.0.0",
            "public_dataset_case_is_product_validation": False,
            "source_count": len(source_manifests),
            "source_selection": "greedy_duration_sorted_distinct_composer_year_title",
        },
        "selection_contract": {
            "case_selection_source": "paired_midi_ground_truth_only",
            "recognizer_predictions_used_for_selection": False,
            "midi_visible_to_causal_replay_recognizer": False,
            "export_sample_rate_hz": args.sample_rate,
            "pre_context_seconds": args.pre_context_seconds,
            "post_context_seconds": args.post_context_seconds,
            "case_count": len(combined_cases),
            "requested_case_kinds": CASE_ORDER,
            "selected_case_counts": {
                kind: sum(1 for case in combined_cases if case["case_kind"] == kind)
                for kind in CASE_ORDER
            },
        },
        "sources": source_manifests,
        "cases": combined_cases,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output_dir / "public_step_causal_cases_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"manifest": str(manifest_path), "case_count": len(combined_cases)}, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--zip-url", default=DEFAULT_ZIP_URL)
    parser.add_argument("--split", choices=("train", "validation", "test"), default="test")
    parser.add_argument("--source-count", type=int, default=10)
    parser.add_argument("--max-cases-per-kind", type=int, default=2)
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--pre-context-seconds", type=float, default=1.0)
    parser.add_argument("--post-context-seconds", type=float, default=1.5)
    parser.add_argument("--force-download", action="store_true")
    return parser.parse_args()


def _select_rows(
    metadata_path: Path,
    *,
    split: str,
    source_count: int,
) -> list[dict[str, str]]:
    with metadata_path.open("r", encoding="utf-8", newline="") as file:
        rows = [row for row in csv.DictReader(file) if row["split"] == split]
    rows.sort(key=lambda row: float(row["duration"]))
    selected = []
    seen_keys = set()
    for row in rows:
        key = (row["canonical_composer"], row["canonical_title"], row["year"])
        if key in seen_keys:
            continue
        selected.append(row)
        seen_keys.add(key)
        if len(selected) >= source_count:
            break
    if len(selected) < source_count:
        raise RuntimeError(f"Only selected {len(selected)} MAESTRO {split} rows")
    return selected


def _ensure_pair(
    row: dict[str, str],
    *,
    dataset_dir: Path,
    zip_url: str,
    force: bool,
) -> tuple[Path, Path]:
    audio_path = dataset_dir / row["audio_filename"]
    midi_path = dataset_dir / row["midi_filename"]
    if not force and audio_path.exists() and midi_path.exists():
        return audio_path, midi_path

    paths = []
    reader = HttpRangeReader(zip_url)
    with zipfile.ZipFile(reader) as archive:
        names = set(archive.namelist())
        for filename in (row["audio_filename"], row["midi_filename"]):
            target = f"{ZIP_PREFIX}/{filename}"
            if target not in names:
                raise RuntimeError(f"Target not found in MAESTRO archive: {target}")
            output_path = dataset_dir / filename
            output_path.parent.mkdir(parents=True, exist_ok=True)
            if force or not output_path.exists():
                extract_member(archive, target, output_path)
            paths.append(output_path)
    return paths[0], paths[1]


def _extract_source_cases(
    audio_path: Path,
    midi_path: Path,
    *,
    output_dir: Path,
    dataset_id: str,
    max_cases_per_kind: int,
    pre_context_seconds: float,
    post_context_seconds: float,
    sample_rate: int,
):
    audio = read_pcm_wav(audio_path, sample_rate=sample_rate)
    notes = parse_midi_note_ons(midi_path)
    groups = group_note_ons(notes, chord_window_seconds=DEFAULT_CHORD_WINDOW_SECONDS)
    spans, pedal_events = parse_midi_note_spans_and_pedal(midi_path)
    plans = select_case_plans(
        groups,
        spans,
        pedal_events,
        max_cases_per_kind=max_cases_per_kind,
        pre_context_seconds=pre_context_seconds,
        post_context_seconds=post_context_seconds,
    )
    return export_cases(
        plans,
        audio=audio,
        spans=spans,
        pedal_events=pedal_events,
        audio_path=audio_path,
        midi_path=midi_path,
        output_dir=output_dir,
        dataset_id=dataset_id,
        pre_context_seconds=pre_context_seconds,
        post_context_seconds=post_context_seconds,
        sample_rate=sample_rate,
        max_cases_per_kind=max_cases_per_kind,
    )


if __name__ == "__main__":
    raise SystemExit(main())
