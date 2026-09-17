from __future__ import annotations

import json
from pathlib import Path


MANIFEST_PATH = (
    Path(__file__).parent
    / "fixtures"
    / "practice_audio"
    / "paired_ground_truth_manifest.json"
)
VALID_STATUSES = {"planned", "recorded"}
VALID_OUTCOMES = {"MATCH", "NOT_MATCH"}


def test_paired_ground_truth_manifest_declares_physical_truth_contract() -> None:
    manifest = _load_manifest()

    assert manifest["version"] == 1
    assert manifest["ground_truth_contract"]["ground_truth_source"] == "paired_midi"
    assert "same acoustic performance" in manifest["ground_truth_contract"]["meaning"]
    assert "MusicXML-derived MIDI" in manifest["ground_truth_contract"]["meaning"]
    assert manifest["canonical_audio"] == {
        "sample_rate_hz": 16000,
        "channels": 1,
        "sample_format": "float32_mono",
        "byte_order": "little_endian",
        "layout": "contiguous_pcm",
    }


def test_paired_ground_truth_manifest_first_matrix_covers_triad_omissions() -> None:
    scenarios = _load_manifest()["scenarios"]
    triad_cases = {
        tuple(scenario["actual_strikes"]): scenario["expected_product_outcome"]
        for scenario in scenarios
        if scenario["id"].startswith("triad_c_e_g_actual_")
    }

    assert triad_cases == {
        ("C4",): "NOT_MATCH",
        ("E4",): "NOT_MATCH",
        ("G4",): "NOT_MATCH",
        ("C4", "E4"): "NOT_MATCH",
        ("C4", "G4"): "NOT_MATCH",
        ("E4", "G4"): "NOT_MATCH",
        ("C4", "E4", "G4"): "MATCH",
    }


def test_paired_ground_truth_manifest_schema_is_ready_for_recorded_fixtures() -> None:
    manifest = _load_manifest()
    ids: set[str] = set()
    for scenario in manifest["scenarios"]:
        assert scenario["id"] not in ids
        ids.add(scenario["id"])
        assert scenario["status"] in VALID_STATUSES
        assert scenario["expected_product_outcome"] in VALID_OUTCOMES
        assert scenario["expected_strikes"]
        assert sorted(set(scenario["expected_strikes"])) == sorted(scenario["expected_strikes"])
        assert sorted(set(scenario["actual_strikes"])) == sorted(scenario["actual_strikes"])
        if scenario["status"] == "recorded":
            _assert_recorded_fixture_identity(scenario)


def _assert_recorded_fixture_identity(scenario: dict) -> None:
    audio = scenario.get("audio")
    midi = scenario.get("midi")
    synchronization = scenario.get("synchronization")
    assert audio is not None
    assert midi is not None
    assert synchronization is not None
    assert audio["path"].endswith(".wav")
    assert len(audio["sha256"]) == 64
    assert audio["sample_rate_hz"] == 16000
    assert audio["channels"] == 1
    assert audio["sample_format"] == "float32_mono"
    assert midi["path"].endswith((".mid", ".midi"))
    assert len(midi["sha256"]) == 64
    assert midi["timebase"] in {"session_seconds", "midi_ticks_with_tempo_map"}
    assert synchronization["source"] in {"shared_capture_clock", "alignment_impulse"}


def _load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
