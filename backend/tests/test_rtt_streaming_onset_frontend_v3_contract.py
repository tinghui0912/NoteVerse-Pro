import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_rtt_streaming_onset_frontend_v3.py"
POLICY = ROOT / "research" / "policies" / "rtt_streaming_onset_policy_v3_2026-10-05.json"
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("rtt_v3", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_one_to_one_midi_matching_does_not_reuse_events():
    m = load_module()
    events = [{"pitch": "C4", "absoluteOnsetTime": 1.0}]
    notes = [
        {"pitch": "C4", "start": 0.99},
        {"pitch": "C4", "start": 1.01},
    ]
    assert len(m.one_to_one_match(events, notes, 0.05)) == 1


def test_no_retrigger_excludes_real_later_midi_attack():
    m = load_module()
    episodes = [{
        "episodeId": "s:long:C4:1",
        "source": "s",
        "family": "long_held_no_retrigger",
        "pitch": "C4",
        "previousAttack": 1.0,
        "nextAttack": 1.4,
        "intervalStart": 1.05,
        "intervalEnd": 1.5,
    }]
    events = {"s": [{"pitch": "C4", "absoluteOnsetTime": 1.4, "onsetProbability": 0.9}]}
    notes = {"s": [{"pitch": "C4", "start": 1.0}, {"pitch": "C4", "start": 1.4}]}
    scored = m.score_no_retrigger_episodes(episodes, events, notes, 0.05)
    assert scored["byFamily"]["long_held_no_retrigger"] == []


def test_three_probes_do_not_triple_count_one_false_event():
    m = load_module()
    notes = {"s": [{"pitch": "C4", "start": 1.0}]}
    targets = [
        {"metricFamily": "long_held_no_retrigger", "sourceFile": "s.wav", "expectedPitches": ["C4"], "stressProbeTime": t}
        for t in [1.4, 1.7, 2.0]
    ]
    episodes = m.build_no_retrigger_episodes(targets, notes)
    assert len(episodes) == 1
    events = {"s": [{"pitch": "C4", "absoluteOnsetTime": 1.6, "onsetProbability": 0.8}]}
    scored = m.score_no_retrigger_episodes(episodes, events, notes, 0.05)
    assert len(scored["byFamily"]["long_held_no_retrigger"]) == 1


def test_threshold_decision_truth_table():
    m = load_module()
    assert m.summarize_threshold_feasibility({"summary": {"thresholds": {"0.5": {"verdict": "PASS", "checks": pass_checks()}}}}, {})["development"] == "PASS"
    assert m.summarize_threshold_feasibility({"summary": {"thresholds": {"0.5": {"verdict": "FAIL", "checks": fail_checks()}}}}, {})["development"] == "FAIL"
    assert m.summarize_threshold_feasibility({"summary": {"thresholds": {"0.5": {"verdict": "INCONCLUSIVE", "checks": inconclusive_checks()}}}}, {})["development"] == "INCONCLUSIVE"


def test_threshold_selection_uses_minimum_positive_margin():
    m = load_module()
    high_margin = pass_checks(recall=0.99)
    low_margin = pass_checks(recall=0.91)
    result = m.summarize_threshold_feasibility({
        "summary": {
            "thresholds": {
                "0.4": {"verdict": "PASS", "checks": high_margin},
                "0.5": {"verdict": "PASS", "checks": low_margin},
            }
        }
    }, {})
    assert result["selectedThreshold"] == 0.4


def test_aggregate_timing_distribution_is_not_empty_when_matches_exist():
    m = load_module()
    events = [{"pitch": "C4", "absoluteOnsetTime": 1.01}]
    notes = [{"pitch": "C4", "start": 1.0}]
    metrics = m.source_level_metrics({"s": events}, {"s": notes}, {"diagnosticTolerancesMs": [20]})
    assert metrics["20"]["matched"] == 1
    assert metrics["20"]["timing"]["sampleCount"] == 1


def pass_checks(recall=0.96):
    checks = {}
    positives = [
        "correct_single",
        "complete_chord",
        "same_note_retrigger_second",
        "dense_repeated_pitch",
        "fast_adjacent_pitch",
        "partial_overlapping_notes",
        "soft_attack",
        "loud_attack",
    ]
    for name in positives:
        checks[name] = {"verdict": "PASS", "sampleCount": 1, "recall": recall, "required": 0.9}
    for name in ["wrong_semitone", "wrong_octave", "missing_chord_tone"]:
        checks[name] = {"verdict": "PASS", "sampleCount": 1, "falseAccepts": 0}
    for name in ["long_held_no_retrigger", "pedal_sustain_no_retrigger"]:
        checks[name] = {"verdict": "PASS", "sampleCount": 1, "falseRetriggerEvents": 0}
    return checks


def fail_checks():
    checks = pass_checks()
    checks["correct_single"] = {"verdict": "FAIL", "sampleCount": 1, "recall": 0.0, "required": 0.95}
    return checks


def inconclusive_checks():
    checks = pass_checks()
    checks["correct_single"] = {"verdict": "NOT_EVALUATED", "sampleCount": 0, "recall": None, "required": 0.95}
    return checks
