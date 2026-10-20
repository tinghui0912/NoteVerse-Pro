from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import numpy as np


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "evaluate_public_paired_midi_dataset.py"
SPEC = importlib.util.spec_from_file_location("evaluate_public_paired_midi_dataset", SCRIPT_PATH)
assert SPEC is not None
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

MAESTRO_DOWNLOADER_PATH = Path(__file__).parents[1] / "scripts" / "download_maestro_pair.py"
MAESTRO_SPEC = importlib.util.spec_from_file_location("download_maestro_pair", MAESTRO_DOWNLOADER_PATH)
assert MAESTRO_SPEC is not None
MAESTRO_MODULE = importlib.util.module_from_spec(MAESTRO_SPEC)
assert MAESTRO_SPEC.loader is not None
sys.modules[MAESTRO_SPEC.name] = MAESTRO_MODULE
MAESTRO_SPEC.loader.exec_module(MAESTRO_MODULE)

RAW_TRANSCRIPTION_PATH = (
    Path(__file__).parents[1] / "scripts" / "evaluate_selected_truth_window_transcription.py"
)
RAW_SPEC = importlib.util.spec_from_file_location(
    "evaluate_selected_truth_window_transcription",
    RAW_TRANSCRIPTION_PATH,
)
assert RAW_SPEC is not None
RAW_MODULE = importlib.util.module_from_spec(RAW_SPEC)
assert RAW_SPEC.loader is not None
sys.modules[RAW_SPEC.name] = RAW_MODULE
RAW_SPEC.loader.exec_module(RAW_MODULE)

STEP_EVALUATION_PATH = (
    Path(__file__).parents[1] / "scripts" / "evaluate_score_conditioned_step_cases.py"
)
STEP_SPEC = importlib.util.spec_from_file_location(
    "evaluate_score_conditioned_step_cases",
    STEP_EVALUATION_PATH,
)
assert STEP_SPEC is not None
STEP_MODULE = importlib.util.module_from_spec(STEP_SPEC)
assert STEP_SPEC.loader is not None
sys.modules[STEP_SPEC.name] = STEP_MODULE
STEP_SPEC.loader.exec_module(STEP_MODULE)

TRANSKUN_BOUNDED_PATH = (
    Path(__file__).parents[1] / "scripts" / "evaluate_transkun_bounded_clips.py"
)
TRANSKUN_BOUNDED_SPEC = importlib.util.spec_from_file_location(
    "evaluate_transkun_bounded_clips",
    TRANSKUN_BOUNDED_PATH,
)
assert TRANSKUN_BOUNDED_SPEC is not None
TRANSKUN_BOUNDED_MODULE = importlib.util.module_from_spec(TRANSKUN_BOUNDED_SPEC)
assert TRANSKUN_BOUNDED_SPEC.loader is not None
sys.modules[TRANSKUN_BOUNDED_SPEC.name] = TRANSKUN_BOUNDED_MODULE
TRANSKUN_BOUNDED_SPEC.loader.exec_module(TRANSKUN_BOUNDED_MODULE)

BASIC_PITCH_ACTIVATION_PATH = (
    Path(__file__).parents[1] / "scripts" / "evaluate_basic_pitch_activation_step_cases.py"
)
BASIC_PITCH_ACTIVATION_SPEC = importlib.util.spec_from_file_location(
    "evaluate_basic_pitch_activation_step_cases",
    BASIC_PITCH_ACTIVATION_PATH,
)
assert BASIC_PITCH_ACTIVATION_SPEC is not None
BASIC_PITCH_ACTIVATION_MODULE = importlib.util.module_from_spec(BASIC_PITCH_ACTIVATION_SPEC)
assert BASIC_PITCH_ACTIVATION_SPEC.loader is not None
sys.modules[BASIC_PITCH_ACTIVATION_SPEC.name] = BASIC_PITCH_ACTIVATION_MODULE
BASIC_PITCH_ACTIVATION_SPEC.loader.exec_module(BASIC_PITCH_ACTIVATION_MODULE)

BASIC_PITCH_DEV_SELECTION_PATH = (
    Path(__file__).parents[1] / "scripts" / "build_basic_pitch_activation_dev_selection.py"
)
BASIC_PITCH_DEV_SELECTION_SPEC = importlib.util.spec_from_file_location(
    "build_basic_pitch_activation_dev_selection",
    BASIC_PITCH_DEV_SELECTION_PATH,
)
assert BASIC_PITCH_DEV_SELECTION_SPEC is not None
BASIC_PITCH_DEV_SELECTION_MODULE = importlib.util.module_from_spec(
    BASIC_PITCH_DEV_SELECTION_SPEC
)
assert BASIC_PITCH_DEV_SELECTION_SPEC.loader is not None
sys.modules[BASIC_PITCH_DEV_SELECTION_SPEC.name] = BASIC_PITCH_DEV_SELECTION_MODULE
BASIC_PITCH_DEV_SELECTION_SPEC.loader.exec_module(BASIC_PITCH_DEV_SELECTION_MODULE)


def test_midi_parser_applies_tempo_map_and_groups_chord_window(tmp_path: Path) -> None:
    midi_path = tmp_path / "paired.mid"
    midi_path.write_bytes(
        _midi_file(
            _track(
                _meta_tempo(500_000)
                + _note_on(delta=480, note=60)
                + _note_on(delta=24, note=64)
                + _meta_tempo(1_000_000)
                + _note_on(delta=480, note=67)
                + _end_track()
            )
        )
    )

    notes = MODULE.parse_midi_note_ons(midi_path)
    assert [(round(note.seconds, 3), note.pitch) for note in notes] == [
        (0.5, "C4"),
        (0.525, "E4"),
        (1.525, "G4"),
    ]

    groups = MODULE.group_note_ons(notes, chord_window_seconds=0.05)
    assert [(round(group.seconds, 3), group.pitches) for group in groups] == [
        (0.5, ("C4", "E4")),
        (1.525, ("G4",)),
    ]


def test_paired_dataset_report_keeps_physical_truth_metrics(tmp_path: Path) -> None:
    audio_path = tmp_path / "sample.wav"
    midi_path = tmp_path / "sample.mid"
    audio_path.write_bytes(b"audio")
    midi_path.write_bytes(b"midi")
    audio = np.zeros(16_000, dtype=np.float32)
    groups = (
        MODULE.MidiStrikeGroup(seconds=0.0, pitches=("C4", "E4"), midi_notes=(60, 64)),
        MODULE.MidiStrikeGroup(seconds=0.5, pitches=("G4",), midi_notes=(67,)),
    )
    group_buckets = MODULE.classify_groups(groups)
    evaluations = [
        {
            "seconds": 0.0,
            "expected_pitches": ("C4", "E4"),
            "observed_pitches": ("C4",),
            "confidence": 0.9,
            "matched_expected": ("C4",),
            "missing_expected": ("E4",),
            "extra_observed": (),
        },
        {
            "seconds": 0.5,
            "expected_pitches": ("G4",),
            "observed_pitches": ("A4",),
            "confidence": 0.9,
            "matched_expected": (),
            "missing_expected": ("G4",),
            "extra_observed": ("A4",),
        },
    ]

    report = MODULE.build_report(
        audio_path=audio_path,
        midi_path=midi_path,
        audio=audio,
        groups=groups,
        group_buckets=group_buckets,
        evaluations=evaluations,
        dataset_id="test-dataset",
        dataset_version="v1",
        official_split="test",
        recording_id="recording-1",
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        source_group_count=2,
        selection={"mode": "prefix", "selected_group_count": 2},
        observer_id="test_observer",
    )

    assert report["dataset"]["ground_truth_source"] == "paired_midi"
    assert report["dataset"]["dataset_id"] == "test-dataset"
    assert report["dataset"]["dataset_version"] == "v1"
    assert report["dataset"]["official_split"] == "test"
    assert report["dataset"]["recording_id"] == "recording-1"
    assert report["benchmark"]["benchmark_scope"] == "paired_midi_oracle_onset_window"
    assert report["benchmark"]["onset_source"] == "paired_midi"
    assert report["benchmark"]["causal"] is False
    assert report["benchmark"]["uses_future_context"] is True
    assert report["benchmark"]["source_group_count"] == 2
    assert report["benchmark"]["selection"]["mode"] == "prefix"
    assert report["benchmark"]["bucket_membership"] == "multi_label"
    assert report["metrics"]["expected_strike_recall"] == 0.3333
    assert report["metrics"]["expected_strike_precision"] == 0.5
    assert report["metrics"]["chord_complete_detection_rate"] == 0.0
    assert report["metrics"]["false_discovery_rate"] == 0.5
    assert report["metrics_by_bucket"]["dyad"]["group_count"] == 1
    assert report["metrics_by_bucket"]["single_note"]["group_count"] == 1


def test_group_classification_marks_octave_repeated_and_dense_contexts() -> None:
    groups = tuple(
        MODULE.MidiStrikeGroup(
            seconds=index * 0.1,
            pitches=("C4", "C5") if index == 3 else ("C4",),
            midi_notes=(60, 72) if index == 3 else (60,),
        )
        for index in range(8)
    )

    buckets = MODULE.classify_groups(groups)

    assert "octave" in buckets[3]
    assert "dyad" in buckets[3]
    assert "repeated_pitch_context" in buckets[0]
    assert all("dense_passage" in bucket for bucket in buckets[3:5])


def test_select_groups_supports_prefix_and_balanced_bucket_sampling() -> None:
    groups = (
        MODULE.MidiStrikeGroup(seconds=0.0, pitches=("C4",), midi_notes=(60,)),
        MODULE.MidiStrikeGroup(seconds=0.1, pitches=("D4",), midi_notes=(62,)),
        MODULE.MidiStrikeGroup(seconds=0.2, pitches=("C4", "E4"), midi_notes=(60, 64)),
        MODULE.MidiStrikeGroup(seconds=0.3, pitches=("C4", "C5"), midi_notes=(60, 72)),
        MODULE.MidiStrikeGroup(seconds=0.4, pitches=("C4", "E4", "G4"), midi_notes=(60, 64, 67)),
    )
    buckets = MODULE.classify_groups(groups)

    prefix_groups, _, prefix_selection = MODULE.select_groups(
        groups,
        buckets,
        mode="prefix",
        max_groups=2,
        groups_per_bucket=1,
    )
    assert tuple(group.seconds for group in prefix_groups) == (0.0, 0.1)
    assert prefix_selection == {
        "mode": "prefix",
        "max_groups": 2,
        "selected_group_count": 2,
        "bucket_membership": "multi_label",
    }

    balanced_groups, balanced_buckets, balanced_selection = MODULE.select_groups(
        groups,
        buckets,
        mode="balanced",
        max_groups=None,
        groups_per_bucket=1,
    )
    assert tuple(group.seconds for group in balanced_groups) == (0.0, 0.2, 0.3, 0.4)
    assert "single_note" in balanced_buckets[0]
    assert "dyad" in balanced_buckets[1]
    assert "octave" in balanced_buckets[2]
    assert "triad" in balanced_buckets[3]
    assert balanced_selection["mode"] == "balanced"
    assert balanced_selection["groups_per_bucket"] == 1
    assert balanced_selection["selected_group_count"] == 4
    assert balanced_selection["selected_by_bucket"]["single_note"] == 1
    assert balanced_selection["selected_by_bucket"]["dyad"] == 2
    assert balanced_selection["selected_by_bucket"]["triad"] == 1


def test_selection_manifest_round_trips_frozen_group_selection(tmp_path: Path) -> None:
    audio_path = tmp_path / "sample.wav"
    midi_path = tmp_path / "sample.mid"
    audio_path.write_bytes(b"audio")
    midi_path.write_bytes(b"midi")
    groups = (
        MODULE.MidiStrikeGroup(seconds=0.0, pitches=("C4",), midi_notes=(60,)),
        MODULE.MidiStrikeGroup(seconds=0.5, pitches=("E4", "G4"), midi_notes=(64, 67)),
    )
    buckets = MODULE.classify_groups(groups)
    manifest = MODULE.build_selection_manifest(
        audio_path=audio_path,
        midi_path=midi_path,
        dataset_id="fixture",
        dataset_version="v1",
        official_split="test",
        recording_id="fixture-1",
        groups=(groups[1],),
        group_buckets=(buckets[1],),
        all_groups=groups,
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        selection={"mode": "balanced", "selected_group_count": 1},
    )
    manifest_path = tmp_path / "selection.json"
    manifest_path.write_text(MODULE.json.dumps(manifest), encoding="utf-8")

    loaded = MODULE.load_selection_manifest(manifest_path)
    selected_groups, selected_buckets, selection = MODULE.select_groups_from_manifest(
        groups,
        buckets,
        manifest=loaded,
        manifest_path=manifest_path,
    )

    assert manifest["dataset"]["official_split"] == "test"
    assert manifest["benchmark"]["bucket_membership"] == "multi_label"
    assert selected_groups == (groups[1],)
    assert selected_buckets == (buckets[1],)
    assert selection == {
        "mode": "manifest",
        "manifest_path": str(manifest_path),
        "selected_group_count": 1,
    }


def test_basic_pitch_dev_selection_excludes_test_and_contaminated_groups(
    tmp_path: Path,
    monkeypatch,
) -> None:
    audio_path = tmp_path / "sample.wav"
    midi_path = tmp_path / "sample.mid"
    audio_path.write_bytes(b"audio")
    midi_path.write_bytes(b"midi")
    groups = (
        MODULE.MidiStrikeGroup(seconds=0.0, pitches=("C4",), midi_notes=(60,)),
        MODULE.MidiStrikeGroup(seconds=1.0, pitches=("D4",), midi_notes=(62,)),
        MODULE.MidiStrikeGroup(seconds=1.4, pitches=("E4",), midi_notes=(64,)),
        MODULE.MidiStrikeGroup(seconds=3.0, pitches=("G4",), midi_notes=(67,)),
    )
    buckets = MODULE.classify_groups(groups)
    excluded_manifest = MODULE.build_selection_manifest(
        audio_path=audio_path,
        midi_path=midi_path,
        dataset_id="fixture",
        dataset_version="v1",
        official_split="test",
        recording_id="fixture-1",
        groups=(groups[0],),
        group_buckets=(buckets[0],),
        all_groups=groups,
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        selection={"mode": "balanced", "selected_group_count": 1},
    )
    excluded_manifest_path = tmp_path / "excluded.json"
    excluded_manifest_path.write_text(MODULE.json.dumps(excluded_manifest), encoding="utf-8")

    monkeypatch.setattr(
        BASIC_PITCH_DEV_SELECTION_MODULE,
        "read_pcm_wav",
        lambda _path, *, sample_rate: np.zeros(sample_rate * 10, dtype=np.float32),
    )
    monkeypatch.setattr(
        BASIC_PITCH_DEV_SELECTION_MODULE,
        "parse_midi_note_ons",
        lambda _path: (),
    )
    monkeypatch.setattr(
        BASIC_PITCH_DEV_SELECTION_MODULE,
        "group_note_ons",
        lambda _notes, *, chord_window_seconds: groups,
    )

    manifest = BASIC_PITCH_DEV_SELECTION_MODULE.build_basic_pitch_activation_dev_selection(
        audio_path=audio_path,
        midi_path=midi_path,
        exclude_selection_manifest=excluded_manifest_path,
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        horizon_seconds=0.5,
        require_no_subsequent_strike=True,
        max_groups=8,
        dataset_id="fixture",
        dataset_version="v1",
        official_split="dev",
        recording_id="fixture-1",
    )

    selected_source_indices = [
        group["source_index"]
        for group in manifest["groups"]
    ]
    assert selected_source_indices == [2, 3]
    assert manifest["benchmark"]["selection"]["selected_source_indices"] == [2, 3]
    assert manifest["benchmark"]["selection"]["excluded_source_group_count"] == 1


def test_raw_transcription_benchmark_scores_provider_owned_onsets(tmp_path: Path) -> None:
    truth_midi_path = tmp_path / "truth.mid"
    predicted_midi_path = tmp_path / "prediction.mid"
    audio_path = tmp_path / "audio.wav"
    selection_manifest_path = tmp_path / "selection.json"
    audio_path.write_bytes(b"audio")
    truth_midi_path.write_bytes(b"truth")
    predicted_midi_path.write_bytes(b"prediction")
    truth_groups = (
        MODULE.MidiStrikeGroup(seconds=1.0, pitches=("C4", "E4"), midi_notes=(60, 64)),
        MODULE.MidiStrikeGroup(seconds=2.0, pitches=("G4",), midi_notes=(67,)),
    )
    truth_buckets = MODULE.classify_groups(truth_groups)
    manifest = MODULE.build_selection_manifest(
        audio_path=audio_path,
        midi_path=truth_midi_path,
        dataset_id="fixture",
        dataset_version="v1",
        official_split="test",
        recording_id="fixture-recording",
        groups=truth_groups,
        group_buckets=truth_buckets,
        all_groups=truth_groups,
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        selection={"mode": "balanced", "selected_group_count": 2},
    )
    selection_manifest_path.write_text(MODULE.json.dumps(manifest), encoding="utf-8")
    loaded_manifest = RAW_MODULE.load_selection_manifest(selection_manifest_path)
    predicted_groups = (
        MODULE.MidiStrikeGroup(seconds=1.03, pitches=("C4", "F4"), midi_notes=(60, 65)),
        MODULE.MidiStrikeGroup(seconds=2.2, pitches=("G4",), midi_notes=(67,)),
    )

    evaluations = RAW_MODULE.evaluate_transcription(
        RAW_MODULE.load_truth_groups_from_manifest(loaded_manifest),
        predicted_groups=predicted_groups,
        onset_tolerance_seconds=0.08,
    )
    report = RAW_MODULE.build_report(
        manifest=manifest,
        selection_manifest_path=selection_manifest_path,
        predicted_midi_path=predicted_midi_path,
        provider_id="test-provider",
        provider_version="1",
        provider_checkpoint="checkpoint",
        onset_tolerance_seconds=0.08,
        chord_window_seconds=0.05,
        predicted_group_count=len(predicted_groups),
        evaluations=evaluations,
    )

    assert report["benchmark"]["benchmark_scope"] == "selected_truth_window_transcription"
    assert report["benchmark"]["provider_owns_onsets"] is True
    assert report["benchmark"]["uses_score"] is False
    assert report["metrics"]["onset_group_recall"] == 0.5
    assert report["metrics"]["expected_strike_recall"] == 0.3333
    assert report["metrics"]["predicted_strike_precision"] == 0.5
    assert report["metrics"]["false_discovery_rate"] == 0.5
    assert report["metrics"]["chord_complete_detection_rate"] == 0.0
    assert report["metrics"]["median_abs_onset_error_seconds"] == 0.03
    assert evaluations[0]["missing_truth"] == ("E4",)
    assert evaluations[0]["extra_predicted"] == ("F4",)
    assert evaluations[1]["predicted_pitches"] == ()


def test_score_conditioned_step_cases_generate_counterfactual_negatives(
    tmp_path: Path,
) -> None:
    truth_midi_path = tmp_path / "truth.mid"
    predicted_midi_path = tmp_path / "prediction.mid"
    audio_path = tmp_path / "audio.wav"
    selection_manifest_path = tmp_path / "selection.json"
    audio_path.write_bytes(b"audio")
    truth_midi_path.write_bytes(b"truth")
    predicted_midi_path.write_bytes(b"prediction")
    truth_groups = (
        MODULE.MidiStrikeGroup(
            seconds=1.0,
            pitches=("C4", "E4"),
            midi_notes=(60, 64),
        ),
        MODULE.MidiStrikeGroup(seconds=2.0, pitches=("G4",), midi_notes=(67,)),
    )
    truth_buckets = MODULE.classify_groups(truth_groups)
    manifest = MODULE.build_selection_manifest(
        audio_path=audio_path,
        midi_path=truth_midi_path,
        dataset_id="fixture",
        dataset_version="v1",
        official_split="test",
        recording_id="fixture-recording",
        groups=truth_groups,
        group_buckets=truth_buckets,
        all_groups=truth_groups,
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        selection={"mode": "balanced", "selected_group_count": 2},
    )
    selection_manifest_path.write_text(MODULE.json.dumps(manifest), encoding="utf-8")
    loaded_manifest = STEP_MODULE.load_selection_manifest(selection_manifest_path)
    cases = STEP_MODULE.generate_step_cases(
        STEP_MODULE.load_truth_groups_from_manifest(loaded_manifest),
        max_cases_per_kind=1,
    )
    predicted_groups = (
        MODULE.MidiStrikeGroup(
            seconds=1.01,
            pitches=("C4", "E4"),
            midi_notes=(60, 64),
        ),
    )

    evaluations = STEP_MODULE.evaluate_step_cases(
        cases,
        predicted_groups=predicted_groups,
        onset_tolerance_seconds=0.08,
    )
    report = STEP_MODULE.build_report(
        manifest=manifest,
        selection_manifest_path=selection_manifest_path,
        predicted_midi_path=predicted_midi_path,
        provider_id="test-provider",
        provider_version="1",
        provider_checkpoint="checkpoint",
        onset_tolerance_seconds=0.08,
        chord_window_seconds=0.05,
        predicted_group_count=len(predicted_groups),
        evaluations=evaluations,
    )

    evaluations_by_kind = {evaluation.case.kind: evaluation for evaluation in evaluations}
    assert evaluations_by_kind["positive"].result == "MATCH"
    assert evaluations_by_kind["missing_added_pitch_negative"].result == "PARTIAL"
    assert evaluations_by_kind["semitone_confusion_negative"].result == "MISMATCH"
    assert evaluations_by_kind["octave_confusion_negative"].result == "MISMATCH"
    assert report["benchmark"]["benchmark_scope"] == "score_conditioned_step_evaluation"
    assert report["benchmark"]["evaluation_mode"] == "offline_full_transcript"
    assert report["benchmark"]["causal"] is False
    assert report["benchmark"]["product_false_advance_eligible"] is False
    assert report["metrics"]["single_pass_correct_acceptance_rate"] == 1.0
    assert report["metrics"]["false_completion_rate"] == 0.0
    assert report["metrics"]["product_false_advance_rate"] is None


def test_score_conditioned_step_cases_report_bounded_context_metrics(
    tmp_path: Path,
) -> None:
    truth_midi_path = tmp_path / "truth.mid"
    predicted_midi_path = tmp_path / "prediction.mid"
    audio_path = tmp_path / "audio.wav"
    selection_manifest_path = tmp_path / "selection.json"
    audio_path.write_bytes(b"audio")
    truth_midi_path.write_bytes(b"truth")
    predicted_midi_path.write_bytes(b"prediction")
    truth_groups = (
        MODULE.MidiStrikeGroup(
            seconds=1.0,
            pitches=("C4", "E4"),
            midi_notes=(60, 64),
        ),
    )
    truth_buckets = MODULE.classify_groups(truth_groups)
    manifest = MODULE.build_selection_manifest(
        audio_path=audio_path,
        midi_path=truth_midi_path,
        dataset_id="fixture",
        dataset_version="v1",
        official_split="test",
        recording_id="fixture-recording",
        groups=truth_groups,
        group_buckets=truth_buckets,
        all_groups=truth_groups,
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        selection={"mode": "balanced", "selected_group_count": 1},
    )
    selection_manifest_path.write_text(MODULE.json.dumps(manifest), encoding="utf-8")
    loaded_manifest = STEP_MODULE.load_selection_manifest(selection_manifest_path)
    cases = STEP_MODULE.generate_step_cases(
        STEP_MODULE.load_truth_groups_from_manifest(loaded_manifest),
        max_cases_per_kind=1,
    )
    predicted_groups = (
        MODULE.MidiStrikeGroup(
            seconds=1.3,
            pitches=("C4", "E4", "B4"),
            midi_notes=(60, 64, 71),
        ),
    )

    offline_evaluations = STEP_MODULE.evaluate_step_cases(
        cases,
        predicted_groups=predicted_groups,
        onset_tolerance_seconds=0.08,
    )
    bounded_evaluations = STEP_MODULE.evaluate_step_cases_with_bounded_context(
        cases,
        predicted_groups=predicted_groups,
        horizon_seconds=0.5,
        onset_preroll_seconds=0.08,
    )
    report = STEP_MODULE.build_report(
        manifest=manifest,
        selection_manifest_path=selection_manifest_path,
        predicted_midi_path=predicted_midi_path,
        provider_id="test-provider",
        provider_version="1",
        provider_checkpoint="checkpoint",
        onset_tolerance_seconds=0.08,
        chord_window_seconds=0.05,
        predicted_group_count=len(predicted_groups),
        evaluations=offline_evaluations,
        bounded_context_evaluations={0.5: bounded_evaluations},
    )

    offline_by_kind = {evaluation.case.kind: evaluation for evaluation in offline_evaluations}
    bounded_by_kind = {evaluation.case.kind: evaluation for evaluation in bounded_evaluations}
    assert offline_by_kind["missing_added_pitch_negative"].result == "UNCERTAIN"
    assert bounded_by_kind["missing_added_pitch_negative"].result == "MATCH"
    bounded_metrics = report["bounded_context_metrics"]["500ms"]
    assert bounded_metrics["evaluation_mode"] == "bounded_offline_transcript_context"
    assert bounded_metrics["causal"] is False
    assert bounded_metrics["uses_future_context"] is True
    assert bounded_metrics["product_false_advance_eligible"] is False
    assert bounded_metrics["product_false_advance_rate"] is None
    assert bounded_metrics["bounded_false_completion_rate"] == 0.3333


def test_score_conditioned_step_cases_report_transcript_shadow_runtime_metrics(
    tmp_path: Path,
) -> None:
    truth_midi_path = tmp_path / "truth.mid"
    predicted_midi_path = tmp_path / "prediction.mid"
    audio_path = tmp_path / "audio.wav"
    selection_manifest_path = tmp_path / "selection.json"
    audio_path.write_bytes(b"audio")
    truth_midi_path.write_bytes(b"truth")
    predicted_midi_path.write_bytes(b"prediction")
    truth_groups = (
        MODULE.MidiStrikeGroup(
            seconds=1.0,
            pitches=("C4", "E4"),
            midi_notes=(60, 64),
        ),
    )
    truth_buckets = MODULE.classify_groups(truth_groups)
    manifest = MODULE.build_selection_manifest(
        audio_path=audio_path,
        midi_path=truth_midi_path,
        dataset_id="fixture",
        dataset_version="v1",
        official_split="test",
        recording_id="fixture-recording",
        groups=truth_groups,
        group_buckets=truth_buckets,
        all_groups=truth_groups,
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        selection={"mode": "balanced", "selected_group_count": 1},
    )
    selection_manifest_path.write_text(MODULE.json.dumps(manifest), encoding="utf-8")
    loaded_manifest = STEP_MODULE.load_selection_manifest(selection_manifest_path)
    cases = STEP_MODULE.generate_step_cases(
        STEP_MODULE.load_truth_groups_from_manifest(loaded_manifest),
        max_cases_per_kind=1,
    )
    predicted_groups = (
        MODULE.MidiStrikeGroup(
            seconds=1.05,
            pitches=("C4",),
            midi_notes=(60,),
        ),
        MODULE.MidiStrikeGroup(
            seconds=1.3,
            pitches=("C4", "E4"),
            midi_notes=(60, 64),
        ),
    )

    bounded_evaluations = STEP_MODULE.evaluate_step_cases_with_bounded_context(
        cases,
        predicted_groups=predicted_groups,
        horizon_seconds=0.5,
        onset_preroll_seconds=0.08,
    )
    shadow_evaluations = STEP_MODULE.evaluate_step_cases_with_transcript_shadow_runtime(
        cases,
        predicted_groups=predicted_groups,
        horizon_seconds=0.5,
        onset_preroll_seconds=0.08,
    )
    offline_evaluations = STEP_MODULE.evaluate_step_cases(
        cases,
        predicted_groups=predicted_groups,
        onset_tolerance_seconds=0.08,
    )
    report = STEP_MODULE.build_report(
        manifest=manifest,
        selection_manifest_path=selection_manifest_path,
        predicted_midi_path=predicted_midi_path,
        provider_id="test-provider",
        provider_version="1",
        provider_checkpoint="checkpoint",
        onset_tolerance_seconds=0.08,
        chord_window_seconds=0.05,
        predicted_group_count=len(predicted_groups),
        evaluations=offline_evaluations,
        bounded_context_evaluations={0.5: bounded_evaluations},
        transcript_shadow_runtime_evaluations={0.5: shadow_evaluations},
    )

    bounded_by_kind = {evaluation.case.kind: evaluation for evaluation in bounded_evaluations}
    shadow_by_kind = {evaluation.case.kind: evaluation for evaluation in shadow_evaluations}
    assert bounded_by_kind["positive"].result == "PARTIAL"
    assert shadow_by_kind["positive"].result == "MATCH"
    shadow_metrics = report["transcript_shadow_runtime_metrics"]["500ms"]
    assert shadow_metrics["evaluation_mode"] == "transcript_shadow_runtime"
    assert shadow_metrics["causal_runtime_loop"] is True
    assert shadow_metrics["causal_provider"] is False
    assert shadow_metrics["uses_future_context"] is True
    assert shadow_metrics["product_false_advance_eligible"] is False
    assert shadow_metrics["product_false_advance_rate"] is None
    assert shadow_metrics["shadow_correct_acceptance_rate"] == 1.0


def test_score_conditioned_step_cases_report_causal_audio_provider_metrics(
    tmp_path: Path,
) -> None:
    truth_midi_path = tmp_path / "truth.mid"
    predicted_midi_path = tmp_path / "prediction.mid"
    audio_path = tmp_path / "audio.wav"
    selection_manifest_path = tmp_path / "selection.json"
    audio_path.write_bytes(b"audio")
    truth_midi_path.write_bytes(b"truth")
    predicted_midi_path.write_bytes(b"prediction")
    truth_groups = (
        MODULE.MidiStrikeGroup(
            seconds=0.0,
            pitches=("C4", "E4"),
            midi_notes=(60, 64),
        ),
    )
    truth_buckets = MODULE.classify_groups(truth_groups)
    manifest = MODULE.build_selection_manifest(
        audio_path=audio_path,
        midi_path=truth_midi_path,
        dataset_id="fixture",
        dataset_version="v1",
        official_split="test",
        recording_id="fixture-recording",
        groups=truth_groups,
        group_buckets=truth_buckets,
        all_groups=truth_groups,
        sample_rate=16_000,
        window_seconds=0.35,
        chord_window_seconds=0.05,
        selection={"mode": "balanced", "selected_group_count": 1},
    )
    selection_manifest_path.write_text(MODULE.json.dumps(manifest), encoding="utf-8")
    loaded_manifest = STEP_MODULE.load_selection_manifest(selection_manifest_path)
    cases = STEP_MODULE.generate_step_cases(
        STEP_MODULE.load_truth_groups_from_manifest(loaded_manifest),
        max_cases_per_kind=1,
    )
    audio = _mix(_sine(261.625565), _sine(329.627557))

    causal_evaluations = STEP_MODULE.evaluate_step_cases_with_causal_audio_provider(
        cases,
        audio=audio,
        sample_rate=16_000,
        provider=STEP_MODULE.TargetConditionedPianoObserver(),
        horizon_seconds=0.5,
        onset_preroll_seconds=0.0,
    )
    offline_evaluations = STEP_MODULE.evaluate_step_cases(
        cases,
        predicted_groups=(),
        onset_tolerance_seconds=0.08,
    )
    report = STEP_MODULE.build_report(
        manifest=manifest,
        selection_manifest_path=selection_manifest_path,
        predicted_midi_path=predicted_midi_path,
        provider_id="test-provider",
        provider_version="1",
        provider_checkpoint="checkpoint",
        onset_tolerance_seconds=0.08,
        chord_window_seconds=0.05,
        predicted_group_count=0,
        evaluations=offline_evaluations,
        causal_audio_provider_evaluations={0.5: causal_evaluations},
        causal_audio_provider_id="target-conditioned-dsp-v1",
        causal_audio_path=audio_path,
        sample_rate=16_000,
    )

    causal_by_kind = {evaluation.case.kind: evaluation for evaluation in causal_evaluations}
    assert causal_by_kind["positive"].result == "MATCH"
    causal_metrics = report["causal_audio_provider_metrics"]["500ms"]
    assert causal_metrics["evaluation_mode"] == "causal_audio_window_provider"
    assert causal_metrics["provider_id"] == "target-conditioned-dsp-v1"
    assert causal_metrics["causal_provider"] is True
    assert causal_metrics["causal_runtime_loop"] is False
    assert causal_metrics["uses_future_context"] is False
    assert causal_metrics["product_false_advance_eligible"] is False
    assert causal_metrics["product_false_advance_rate"] is None
    assert causal_metrics["correct_acceptance_rate"] == 1.0


def test_transkun_bounded_clip_evaluation_shares_clip_predictions_across_cases() -> None:
    cases = (
        STEP_MODULE.StepCase(
            case_id="g0000:positive",
            kind="positive",
            seconds=1.0,
            actual_pitches=("C4",),
            expected_pitches=("C4",),
            source_group_index=0,
            mutation={},
        ),
        STEP_MODULE.StepCase(
            case_id="g0000:missing-added:G4",
            kind="missing_added_pitch_negative",
            seconds=1.0,
            actual_pitches=("C4",),
            expected_pitches=("C4", "G4"),
            source_group_index=0,
            mutation={"added_expected_pitch": "G4"},
        ),
    )
    clip_predictions = {
        0: (
            MODULE.MidiStrikeGroup(seconds=1.01, pitches=("C4",), midi_notes=(60,)),
            MODULE.MidiStrikeGroup(seconds=1.3, pitches=("C4", "G4"), midi_notes=(60, 67)),
        )
    }

    evaluations = TRANSKUN_BOUNDED_MODULE.evaluate_cases_from_clip_predictions(
        cases,
        clip_predictions=clip_predictions,
        horizon_seconds=0.5,
        pre_roll_seconds=0.25,
    )
    report = TRANSKUN_BOUNDED_MODULE._horizon_report(
        horizon_seconds=0.5,
        evaluations=evaluations,
        clip_predictions=clip_predictions,
        truth_groups=(
            MODULE.MidiStrikeGroup(seconds=1.0, pitches=("C4",), midi_notes=(60,)),
            MODULE.MidiStrikeGroup(seconds=1.3, pitches=("G4",), midi_notes=(67,)),
        ),
    )

    evaluations_by_kind = {evaluation.case.kind: evaluation for evaluation in evaluations}
    assert evaluations_by_kind["positive"].result == "MATCH"
    assert evaluations_by_kind["missing_added_pitch_negative"].result == "MATCH"
    assert report["correct_acceptance_rate"] == 1.0
    assert report["false_completion_rate"] == 1.0
    assert report["false_completion_rate_excluding_contaminated_negatives"] is None
    assert report["contaminated_negative_false_match_count"] == 1
    assert report["first_20_positive_misses"] == []
    assert report["first_20_false_matches"][0]["case_kind"] == "missing_added_pitch_negative"
    assert (
        report["first_20_contaminated_false_matches"][0][
            "continuous_performance_contamination"
        ]["counterfactual_expected_supported_by_later_truth"]
        == ("G4",)
    )


def test_transkun_bounded_clip_report_includes_positive_miss_diagnostics() -> None:
    cases = (
        STEP_MODULE.StepCase(
            case_id="g0000:positive",
            kind="positive",
            seconds=1.0,
            actual_pitches=("C4", "E4"),
            expected_pitches=("C4", "E4"),
            source_group_index=0,
            mutation={},
        ),
    )
    clip_predictions = {
        0: (
            MODULE.MidiStrikeGroup(seconds=1.01, pitches=("C4",), midi_notes=(60,)),
        )
    }

    evaluations = TRANSKUN_BOUNDED_MODULE.evaluate_cases_from_clip_predictions(
        cases,
        clip_predictions=clip_predictions,
        horizon_seconds=0.5,
        pre_roll_seconds=0.25,
    )
    report = TRANSKUN_BOUNDED_MODULE._horizon_report(
        horizon_seconds=0.5,
        evaluations=evaluations,
        clip_predictions=clip_predictions,
        truth_groups=(
            MODULE.MidiStrikeGroup(seconds=1.0, pitches=("C4", "E4"), midi_notes=(60, 64)),
        ),
    )

    assert report["correct_acceptance_rate"] == 0.0
    assert report["first_20_positive_misses"][0]["case_kind"] == "positive"
    assert report["first_20_positive_misses"][0]["missing_expected"] == ("E4",)


def test_transkun_bounded_clip_source_group_offset_selects_stable_shard() -> None:
    cases = tuple(
        STEP_MODULE.StepCase(
            case_id=f"g{index:04d}:positive",
            kind="positive",
            seconds=float(index),
            actual_pitches=("C4",),
            expected_pitches=("C4",),
            source_group_index=index,
            mutation={},
        )
        for index in range(5)
    )

    assert TRANSKUN_BOUNDED_MODULE._selected_source_indices(
        cases,
        truth_groups=tuple(
            MODULE.MidiStrikeGroup(seconds=float(index), pitches=("C4",), midi_notes=(60,))
            for index in range(5)
        ),
        horizon_seconds=0.5,
        requested_source_indices=None,
        source_group_offset=2,
        max_source_groups=2,
    ) == (2, 3)


def test_transkun_bounded_clip_isolated_selection_excludes_continuous_following_strikes() -> None:
    cases = tuple(
        STEP_MODULE.StepCase(
            case_id=f"g{index:04d}:positive",
            kind="positive",
            seconds=float(index),
            actual_pitches=("C4",),
            expected_pitches=("C4",),
            source_group_index=index,
            mutation={},
        )
        for index in range(3)
    )
    truth_groups = (
        MODULE.MidiStrikeGroup(seconds=0.0, pitches=("C4",), midi_notes=(60,)),
        MODULE.MidiStrikeGroup(seconds=0.4, pitches=("D4",), midi_notes=(62,)),
        MODULE.MidiStrikeGroup(seconds=1.0, pitches=("C4",), midi_notes=(60,)),
        MODULE.MidiStrikeGroup(seconds=2.0, pitches=("C4",), midi_notes=(60,)),
    )

    assert TRANSKUN_BOUNDED_MODULE._selected_source_indices(
        cases,
        truth_groups=truth_groups,
        horizon_seconds=0.5,
        requested_source_indices=None,
        source_group_offset=0,
        max_source_groups=3,
        require_isolated_gesture=True,
    ) == (1, 2)


def test_transkun_bounded_clip_explicit_source_indices_are_stable() -> None:
    cases = tuple(
        STEP_MODULE.StepCase(
            case_id=f"g{index:04d}:positive",
            kind="positive",
            seconds=float(index),
            actual_pitches=("C4",),
            expected_pitches=("C4",),
            source_group_index=index,
            mutation={},
        )
        for index in range(5)
    )

    assert TRANSKUN_BOUNDED_MODULE._parse_source_group_indices("3, 1, 3") == (3, 1)
    assert TRANSKUN_BOUNDED_MODULE._selected_source_indices(
        cases,
        truth_groups=tuple(
            MODULE.MidiStrikeGroup(seconds=float(index), pitches=("C4",), midi_notes=(60,))
            for index in range(5)
        ),
        horizon_seconds=0.5,
        requested_source_indices=(3, 1),
        source_group_offset=0,
        max_source_groups=12,
    ) == (3, 1)


def test_basic_pitch_activation_provider_projects_raw_expected_pitch_evidence() -> None:
    onsets = np.zeros((20, 88), dtype=np.float32)
    notes = np.zeros((20, 88), dtype=np.float32)
    c4_index = 60 - BASIC_PITCH_ACTIVATION_MODULE.MIDI_OFFSET
    e4_index = 64 - BASIC_PITCH_ACTIVATION_MODULE.MIDI_OFFSET
    g4_index = 67 - BASIC_PITCH_ACTIVATION_MODULE.MIDI_OFFSET
    onsets[5, c4_index] = 0.8
    notes[5, c4_index] = 0.7
    onsets[5, e4_index] = 0.4
    notes[5, e4_index] = 0.8
    onsets[5, g4_index] = 0.9
    notes[5, g4_index] = 0.9

    prediction = BASIC_PITCH_ACTIVATION_MODULE.activation_prediction_from_output(
        {"onset": onsets, "note": notes},
        expected_pitches=("C4", "E4"),
        clip_start_seconds=0.0,
        decision_start_seconds=0.0,
        decision_end_seconds=0.5,
        onset_threshold=0.5,
        note_threshold=0.3,
    )

    assert prediction["expected_evidence"]["C4"]["accepted"] is True
    assert prediction["expected_evidence"]["E4"]["accepted"] is False
    assert "G4" in prediction["unexpected_evidence"]
    assert prediction["observed_pitches"] == ("C4",)


def test_basic_pitch_activation_can_include_unexpected_pitches_for_diagnostics() -> None:
    onsets = np.zeros((10, 88), dtype=np.float32)
    notes = np.zeros((10, 88), dtype=np.float32)
    c4_index = 60 - BASIC_PITCH_ACTIVATION_MODULE.MIDI_OFFSET
    g4_index = 67 - BASIC_PITCH_ACTIVATION_MODULE.MIDI_OFFSET
    onsets[5, c4_index] = 0.8
    notes[5, c4_index] = 0.7
    onsets[5, g4_index] = 0.9
    notes[5, g4_index] = 0.9

    prediction = BASIC_PITCH_ACTIVATION_MODULE.activation_prediction_from_output(
        {"onset": onsets, "note": notes},
        expected_pitches=("C4",),
        clip_start_seconds=0.0,
        decision_start_seconds=0.0,
        decision_end_seconds=0.5,
        onset_threshold=0.5,
        note_threshold=0.3,
        unexpected_pitch_policy="all_activated",
    )

    assert "G4" in prediction["unexpected_evidence"]
    assert prediction["observed_pitches"] == ("C4", "G4")


def test_basic_pitch_activation_evaluation_keeps_match_semantics_in_evaluator() -> None:
    cases = (
        STEP_MODULE.StepCase(
            case_id="g0000:positive",
            kind="positive",
            seconds=1.0,
            actual_pitches=("C4", "E4"),
            expected_pitches=("C4", "E4"),
            source_group_index=0,
            mutation={},
        ),
    )
    predictions = {
        0: BASIC_PITCH_ACTIVATION_MODULE.ActivationPrediction(
            observed_pitches=("C4",),
            expected_evidence={
                "C4": {"onset_activation": 0.8, "note_activation": 0.7, "accepted": True},
                "E4": {"onset_activation": 0.4, "note_activation": 0.8, "accepted": False},
            },
            unexpected_evidence={},
        )
    }

    evaluations = BASIC_PITCH_ACTIVATION_MODULE.evaluate_cases_from_activation_predictions(
        cases,
        activation_predictions=predictions,
    )

    assert evaluations[0].result == "PARTIAL"
    assert evaluations[0].matched_expected == ("C4",)
    assert evaluations[0].missing_expected == ("E4",)


def test_maestro_downloader_selects_shortest_row_inside_requested_split(tmp_path: Path) -> None:
    metadata_path = tmp_path / "maestro-v3.0.0.csv"
    metadata_path.write_text(
        "\n".join(
            [
                "canonical_composer,canonical_title,split,year,midi_filename,audio_filename,duration",
                "Composer A,Title A,train,2018,train-long.midi,train-long.wav,10.0",
                "Composer B,Title B,test,2018,test-long.midi,test-long.wav,50.0",
                "Composer C,Title C,test,2018,test-short.midi,test-short.wav,20.0",
            ]
        ),
        encoding="utf-8",
    )

    row = MAESTRO_MODULE.select_metadata_row(metadata_path, audio_filename=None, split="test")

    assert row["audio_filename"] == "test-short.wav"
    assert row["split"] == "test"


def _midi_file(track: bytes) -> bytes:
    return b"MThd" + (6).to_bytes(4, "big") + b"\x00\x00\x00\x01\x01\xe0" + track


def _track(events: bytes) -> bytes:
    return b"MTrk" + len(events).to_bytes(4, "big") + events


def _meta_tempo(microseconds_per_quarter: int) -> bytes:
    return _vlq(0) + b"\xff\x51\x03" + microseconds_per_quarter.to_bytes(3, "big")


def _note_on(*, delta: int, note: int) -> bytes:
    return _vlq(delta) + bytes([0x90, note, 80])


def _end_track() -> bytes:
    return _vlq(0) + b"\xff\x2f\x00"


def _vlq(value: int) -> bytes:
    parts = [value & 0x7F]
    value >>= 7
    while value:
        parts.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(parts))


def _sine(frequency_hz: float, *, sample_rate: int = 16_000) -> np.ndarray:
    t = np.arange(int(sample_rate * 0.5), dtype=np.float32) / sample_rate
    return (0.25 * np.sin(2 * np.pi * frequency_hz * t)).astype(np.float32)


def _mix(*signals: np.ndarray) -> np.ndarray:
    mixed = np.sum(np.stack(signals), axis=0)
    peak = float(np.max(np.abs(mixed)))
    if peak <= 0.0:
        return mixed.astype(np.float32)
    return (0.25 * mixed / peak).astype(np.float32)
